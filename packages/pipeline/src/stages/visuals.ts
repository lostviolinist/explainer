/**
 * Stage 4 — Visual planning and asset generation.
 *
 * planScene: turn a scene's visualDirection into a Hedra prompt + anim spec.
 * narrate:   narration via Hedra speech, then forced alignment.
 * renderSceneAssets: storyboard still → vision check → (clip | animated still |
 *                    programmatic assets) → vision check → retry on next model
 *                    → demote to a safer visual type.
 *
 * Code scenes (manim / three): the model writes Manim or React Three Fiber code,
 * the animator sandbox renders it, sampled frames are checked, and failures
 * (render errors or reviewer notes) are fed back for up to three attempts.
 *
 * All generated assets are mirrored; both the Hedra asset id and our URL are kept.
 */
import { z } from "zod";
import { AnimSpec, RenderSpec, SceneAssets, QaResult, VIDEO_TIMING, type Scene, type ScenePlan, type Brief, type MirroredAsset, type CastMember } from "@explainer/schemas";
import { generateStill, animateStill, generateClip, generateSpeech, HedraError, type GenOutcome } from "@explainer/hedra";
import type { Ctx } from "../context.js";
import { makeProgress } from "../context.js";
import type { Engine, OverlayImage } from "../providers/animator.js";
import { MANIM_RULES, threeRules, motionRules, narrationTimeline, stripFences, fallbackManim, type StillPart } from "./engines.js";

export const Planned = z.object({
  hedraPrompt: z.string().nullable(),
  animSpec: AnimSpec,
});

export const VisionScore = z.object({
  matchesDirection: z.number().min(0).max(1),
  styleMatch: z.number().min(0).max(1),
  hasText: z.boolean(),
  notes: z.string(),
});

const PASS = 0.7;

/** Per-type ladder for demotion when a generated asset fails twice. */
const DEMOTE: Partial<Record<Scene["visualType"], Scene["visualType"]>> = {
  clip: "still-animated",
  "reference-seq": "still-animated",
  "still-animated": "diagram",
};

/** What the model returns for a code scene. */
export const SceneCode = z.object({ code: z.string() });

const isCodeScene = (t: Scene["visualType"]): t is Engine => t === "manim" || t === "three" || t === "motion";

/** Where the parts of a still are, so an overlay can point at them (0–1, origin top-left). */
export const StillLayout = z.object({
  parts: z.array(z.object({ name: z.string(), x0: z.number(), y0: z.number(), x1: z.number(), y1: z.number() })),
});

/** "name: look (colour)" lines for prompts, so the same thing looks the same in every scene. */
const castLines = (cast: CastMember[]) => cast.map((c) => `- ${c.name}: ${c.look} (${c.color})`).join("\n");

export async function planScene(ctx: Ctx, brief: Brief, scene: Scene, cast: CastMember[] = []): Promise<RenderSpec> {
  // Code scenes are written later, once the narration's timing is known.
  if (isCodeScene(scene.visualType)) {
    return RenderSpec.parse({ hedraPrompt: null, model: scene.visualType, referenceAssetIds: [], storyboardAssetId: null, animSpec: { kind: "none" } });
  }
  const refs = [ctx.style.referenceFrames[brief.background].assetId];
  const planned = await ctx.llm.json({
    system: `You write generation prompts for an explainer in a fixed house style and the matching programmatic animation spec.
House style: ${ctx.style.styleText}
Background: ${brief.background} (${ctx.style.backgrounds[brief.background].hex}).
Rules for hedraPrompt (null for visualType chart/text, since those are fully programmatic):
- Start with "Flat vector illustration, detailed." Then the scene's metaphor and its supporting details from the visual direction. End with "No text, no labels. Leave the bottom-right quarter clear."
- Describe one action for a clip; still-animated prompts describe the still only.
- Never ask for legible text; labels are composited.
- Recurring things (below) are described the same way in every prompt, so they're recognisable from scene to scene.
animSpec: labelled-diagram (labels with the exact onScreenTerms and the narration word each appears on), chart (series from the cited claim; claimId), kinetic-text (lines with cue words), path-reveal (ids with cue words) or none.`,
    user: `Scene ${scene.id} (${scene.beat}, ${scene.visualType}): ${scene.visualDirection}\nNarration: ${scene.narration}\nOn-screen terms: ${scene.onScreenTerms.join(", ")}${cast.length ? `\nRecurring things:\n${castLines(cast)}` : ""}`,
    schema: Planned,
    maxTokens: 1200,
  });
  const modelKey = scene.visualType === "clip" ? "generatedClip" : scene.visualType === "reference-seq" ? "referenceSequence" : scene.visualType === "still-animated" ? "animatedStill" : "still";
  return RenderSpec.parse({
    hedraPrompt: planned.hedraPrompt,
    model: ctx.style.models[modelKey]?.[0] ?? null,
    referenceAssetIds: refs,
    storyboardAssetId: null,
    animSpec: planned.animSpec,
  });
}

async function mirrorOutcome(ctx: Ctx, projectId: string, out: GenOutcome): Promise<MirroredAsset> {
  const o = out.job.outputs[0];
  if (!o) throw new Error("no output");
  const m = await ctx.mirror.mirror(projectId, o);
  return { ...m, model: out.model, costUsd: out.costUsd };
}

/**
 * Run one generation attempt. A non-retryable failure (moderation, invalid
 * input, every model in the allowlist refused) counts as a failed attempt so
 * the retry/demotion ladder handles it; rate limits and outages are rethrown
 * so the orchestrator retries the step.
 */
async function attemptGeneration(qa: QaResult[], check: QaResult["check"], attempt: number, gen: () => Promise<GenOutcome>): Promise<GenOutcome | null> {
  try {
    return await gen();
  } catch (e) {
    if (!(e instanceof HedraError) || e.retryable) throw e;
    qa.push({ check, passed: false, score: null, attempts: attempt, fallback: null, notes: `generation failed: ${e.code}: ${e.message}` });
    return null;
  }
}

async function scoreFrames(ctx: Ctx, scene: Scene, imageUrls: string[]) {
  return ctx.llm.vision({
    system: `Score frames from an explainer video scene. matchesDirection: does the picture show what the direction describes (metaphor and details)? styleMatch: flat vector illustration, limited palette, no outlines, no gradients except glow, bottom-right clear? hasText: any legible text or labels baked into the image? Scores 0–1.`,
    user: `Direction: ${scene.visualDirection}`,
    imageUrls,
    schema: VisionScore,
  });
}

export async function narrate(ctx: Ctx, brief: Brief, scene: Scene): Promise<SceneAssets["audio"]> {
  const v = ctx.style.voice;
  const speed = brief.derivedFrom?.reaction === "deeper" ? v.deeperSpeed : v.speed;
  const model = brief.tone === "playful" ? v.playfulModel : v.model;
  const out = await generateSpeech(ctx.hedra, `${brief.projectId}:${scene.id}:speech`, model, {
    text: scene.narration,
    voiceId: v.voiceId,
    speed,
  });
  const asset = await mirrorOutcome(ctx, brief.projectId, out);
  await ctx.store.recordCost(brief.projectId, "narration", out.costUsd, scene.id);
  await makeProgress(ctx, brief.projectId, "visuals")(`recorded narration for scene ${scene.id.slice(1)}`, 0.2, { sceneId: scene.id, audioUrl: asset.url });
  // Hedra reports duration for audio; estimate from word count if it ever doesn't.
  const durationS = asset.durationMs ? asset.durationMs / 1000 : (scene.narration.split(/\s+/).length / v.wordsPerMinute) * 60;
  const { words } = await ctx.aligner.align(asset.url, scene.narration, durationS);
  return { asset, durationS, words };
}

export async function renderSceneAssets(ctx: Ctx, brief: Brief, plan: ScenePlan, sceneIn: Scene, audio: SceneAssets["audio"]): Promise<SceneAssets> {
  const progress = makeProgress(ctx, brief.projectId, "visuals");
  let scene = sceneIn;
  const qa: QaResult[] = [];
  const visuals: SceneAssets["visuals"] = [];
  const refs = scene.render?.referenceAssetIds?.length ? scene.render.referenceAssetIds : [ctx.style.referenceFrames[brief.background].assetId];
  const scope = (k: string) => `${brief.projectId}:${scene.id}:${k}`;

  const cast = plan.cast ?? [];
  if (isCodeScene(scene.visualType)) {
    let animation = await renderCodeScene(ctx, brief, scene, audio, qa, cast);
    // A 3D scene that never worked: Manim in the math style (no Hedra visuals there), an illustration otherwise.
    if (!animation && scene.visualType === "three" && brief.style === "math") {
      qa.push({ check: "visual-matches-direction", passed: false, score: null, attempts: 3, fallback: "demoted three → manim", notes: null });
      scene = { ...scene, visualType: "manim" };
      animation = await renderCodeScene(ctx, brief, scene, audio, qa, cast);
    }
    if (animation) return SceneAssets.parse({ projectId: brief.projectId, sceneId: scene.id, audio, visuals: [{ asset: animation, role: "animation" }], qa });
    if (brief.style === "math") return SceneAssets.parse({ projectId: brief.projectId, sceneId: scene.id, audio, visuals, qa });
    // Illustrated: a 3D scene becomes an animated illustration; flat motion graphics become an illustrated diagram.
    const next = scene.visualType === "motion" ? "diagram" : "still-animated";
    qa.push({ check: "visual-matches-direction", passed: false, score: null, attempts: 3, fallback: `demoted ${scene.visualType} → ${next}`, notes: null });
    scene = { ...scene, visualType: next, render: scene.render ? { ...scene.render, hedraPrompt: null, referenceAssetIds: [] } : null };
  }

  // Fully programmatic scenes need no Hedra visuals beyond an optional background.
  if (scene.visualType === "chart" || scene.visualType === "text") {
    qa.push({ check: "visual-matches-direction", passed: true, score: null, attempts: 0, fallback: null, notes: "programmatic" });
    return SceneAssets.parse({ projectId: brief.projectId, sceneId: scene.id, audio, visuals, qa });
  }

  for (let demotions = 0; demotions < 3; demotions++) {
    const prompt = scene.render?.hedraPrompt ?? `Flat vector illustration, detailed. ${scene.visualDirection}. No text, no labels. Leave the bottom-right quarter clear.`;

    // 1. Storyboard still (also the start frame for animated stills, and the vision target).
    let still: MirroredAsset | null = null;
    let stillScore: z.infer<typeof VisionScore> | null = null;
    // Best rejected still, so a scene never ends up blank: no baked-in text beats a higher score.
    let bestRejected: { asset: MirroredAsset; rank: number } | null = null;
    const stillModels = ctx.style.models.still ?? ["gpt-image-2"];
    for (let attempt = 1; attempt <= 2 && !still; attempt++) {
      await progress(`drawing scene ${scene.id.slice(1)}`, 0.3, undefined);
      const out = await attemptGeneration(qa, "visual-matches-direction", attempt, () =>
        generateStill(ctx.hedra, scope(`still:${demotions}:${attempt}`), attempt === 1 ? stillModels : stillModels.slice(1).length ? stillModels.slice(1) : stillModels, {
          prompt: attempt === 1 ? prompt : `${prompt} Match the reference image's style exactly.`,
          references: refs,
        }),
      );
      if (!out) continue;
      const m = await mirrorOutcome(ctx, brief.projectId, out);
      await ctx.store.recordCost(brief.projectId, "still", out.costUsd, scene.id);
      const score = await scoreFrames(ctx, scene, [m.url]);
      const ok = score.matchesDirection >= PASS && score.styleMatch >= PASS && !score.hasText;
      qa.push({ check: "visual-matches-direction", passed: ok, score: Math.min(score.matchesDirection, score.styleMatch), attempts: attempt, fallback: null, notes: score.notes });
      if (ok) {
        still = m;
        stillScore = score;
      } else {
        const rank = Math.min(score.matchesDirection, score.styleMatch) - (score.hasText ? 1 : 0);
        if (!bestRejected || rank > bestRejected.rank) bestRejected = { asset: m, rank };
      }
    }
    if (!still && bestRejected && !DEMOTE[scene.visualType]) {
      // Last rung of the ladder: show the best attempt rather than an empty scene.
      still = bestRejected.asset;
      qa.push({ check: "visual-matches-direction", passed: false, score: null, attempts: 2, fallback: "kept the best rejected still", notes: null });
    }
    if (!still) {
      const next = DEMOTE[scene.visualType];
      if (!next) break;
      qa.push({ check: "visual-matches-direction", passed: false, score: null, attempts: 2, fallback: `demoted ${scene.visualType} → ${next}`, notes: null });
      scene = { ...scene, visualType: next };
      continue;
    }
    visuals.push({ asset: still, role: scene.visualType === "diagram" ? "background" : "still" });
    await progress(`drew scene ${scene.id.slice(1)}`, 0.4, { sceneId: scene.id, stillUrl: still.url });

    // 2. Motion, if the type calls for it. Diagrams: animated callouts over the still, when the motion engine runs.
    if (scene.visualType === "diagram") {
      if ((await ctx.animator.available()).includes("motion")) {
        const animated = await overlayCallouts(ctx, brief, scene, audio, still, qa, cast);
        if (animated) visuals.push({ asset: animated, role: "animation" });
      }
      break;
    }

    const durationMs = Math.min(ctx.style.clip.maxDurationMs, Math.max(5000, Math.round(audio.durationS * 1000 / 2 / 1000) * 1000));
    let moving: MirroredAsset | null = null;
    const models = scene.visualType === "still-animated" ? ctx.style.models.animatedStill! : scene.visualType === "clip" ? ctx.style.models.generatedClip! : ctx.style.models.referenceSequence!;

    for (let attempt = 1; attempt <= 2 && !moving; attempt++) {
      await progress(`animating scene ${scene.id.slice(1)}`, 0.6);
      const tryModels = attempt === 1 ? models : models.slice(1).length ? models.slice(1) : models;
      const out = await attemptGeneration(qa, "style-consistency", attempt, () =>
        scene.visualType === "still-animated"
          ? animateStill(ctx.hedra, scope(`anim:${demotions}:${attempt}`), tryModels, {
              prompt: `Keep every shape exactly as in the frame. Subtle motion only: ${scene.visualDirection}. Static camera, no new objects.`,
              startAssetId: still!.hedraAssetId,
              durationMs: 5000,
            })
          : generateClip(ctx.hedra, scope(`clip:${demotions}:${attempt}`), tryModels, {
              prompt,
              references: [...refs, still!.hedraAssetId],
              durationMs,
            }),
      );
      if (!out) continue;
      const m = await mirrorOutcome(ctx, brief.projectId, out);
      await ctx.store.recordCost(brief.projectId, "video", out.costUsd, scene.id);
      // Score start / middle / end frames: both bake-off failures appeared after the first second.
      // A clip we can't decode counts as a failed attempt (next model, then a simpler visual).
      const frames = await ctx.frames.sample(m.url, 3).catch((e: Error) => {
        qa.push({ check: "style-consistency", passed: false, score: null, attempts: attempt, fallback: null, notes: `unreadable clip: ${e.message.slice(0, 200)}` });
        return null;
      });
      if (!frames) continue;
      const score = await scoreFrames(ctx, scene, frames);
      const ok = score.styleMatch >= PASS && score.matchesDirection >= PASS - 0.1 && !score.hasText;
      qa.push({ check: "style-consistency", passed: ok, score: score.styleMatch, attempts: attempt, fallback: null, notes: score.notes });
      if (ok) moving = m;
    }
    if (moving) {
      visuals.push({ asset: moving, role: "clip" });
      await progress(`animated scene ${scene.id.slice(1)}`, 0.9, { sceneId: scene.id, clipUrl: moving.url });
      break;
    }
    const next = DEMOTE[scene.visualType];
    if (!next) break;
    qa.push({ check: "style-consistency", passed: false, score: null, attempts: 2, fallback: `demoted ${scene.visualType} → ${next}`, notes: null });
    scene = { ...scene, visualType: next };
  }

  return SceneAssets.parse({ projectId: brief.projectId, sceneId: scene.id, audio, visuals, qa });
}

// ---------------------------------------------------------------------------
// Code scenes

/** Background behind a code scene, matching the composition. */
function codeBackground(brief: Brief): string {
  return brief.style === "math" ? "#000000" : brief.background === "dark" ? "#0B1C3F" : "#F6F3EC";
}

const ENGINE_LOOK: Record<Engine, string> = {
  manim: "Manim, in the 3Blue1Brown style",
  three: "three.js (3D)",
  motion: "flat 2D motion graphics in a flat-illustration house style",
};

async function scoreCode(ctx: Ctx, scene: Scene, engine: Engine, frames: string[], overlay = false) {
  const look = overlay ? "animated callouts (rings, arrows, labels, spotlight) drawn over an illustration; check they point at the right parts" : ENGINE_LOOK[engine];
  return ctx.llm.vision({
    system: `Score frames from an animated explainer scene: ${look}. matchesDirection: does it show what the direction describes? styleMatch: is it clean and readable: nothing cut off at the frame edges, no text spilling out of its pill or box, no overlapping text or objects, good contrast, the bottom-right corner clear for captions? hasText: any legible text (fine for equations and short labels). Scores 0–1. In notes, say concretely what to fix.`,
    user: `Direction: ${scene.visualDirection}\nNarration: ${scene.narration}`,
    imageUrls: frames,
    schema: VisionScore,
  });
}

/** Find the still's parts, then animate callouts over it with the motion engine. */
async function overlayCallouts(ctx: Ctx, brief: Brief, scene: Scene, audio: SceneAssets["audio"], still: MirroredAsset, qa: QaResult[], cast: CastMember[]): Promise<MirroredAsset | null> {
  const res = await fetch(still.url);
  if (!res.ok) return null;
  const image: OverlayImage = { data: new Uint8Array(await res.arrayBuffer()), type: res.headers.get("content-type") ?? still.contentType };
  const layout = await ctx.llm.vision({
    system: "List the visually distinct parts of this illustration that the narration talks about or that explain it (up to 8). For each, a short name and a tight bounding box in normalized coordinates (0–1, origin top-left; x0 < x1, y0 < y1).",
    user: `Narration: ${scene.narration}\nDirection: ${scene.visualDirection}`,
    imageUrls: [still.url],
    schema: StillLayout,
  });
  // The still is cover-fitted to 1920×1080 underneath the overlay.
  const parts: StillPart[] = layout.parts
    .filter((p) => p.x1 > p.x0 && p.y1 > p.y0)
    .slice(0, 8)
    .map((p) => ({ name: p.name, box: [p.x0 * 1920, p.y0 * 1080, p.x1 * 1920, p.y1 * 1080].map((v) => Math.round(Math.min(1920, Math.max(0, v)))) as StillPart["box"] }));
  if (!parts.length) return null;
  return renderCodeScene(ctx, brief, { ...scene, visualType: "motion" }, audio, qa, cast, { image, parts });
}

/**
 * Write → render → check, up to three times, feeding render errors and reviewer
 * notes back. Keeps the best render that worked. Manim scenes that never pass
 * use a plain safe scene; a 3D scene returns null so the caller can demote it.
 */
async function renderCodeScene(
  ctx: Ctx,
  brief: Brief,
  scene: Scene,
  audio: SceneAssets["audio"],
  qa: QaResult[],
  cast: CastMember[] = [],
  overlay?: { image: OverlayImage; parts: StillPart[] },
): Promise<MirroredAsset | null> {
  const engine = scene.visualType as Engine;
  const progress = makeProgress(ctx, brief.projectId, "visuals");
  const n = scene.id.slice(1);
  const durationS = +(audio.durationS + VIDEO_TIMING.sceneTailS).toFixed(2);
  const background = codeBackground(brief);
  const rules = (engine === "manim" ? MANIM_RULES : engine === "motion" ? motionRules(brief.background, overlay?.parts) : threeRules(brief.style, brief.background))
    .replaceAll("{DURATION}", durationS.toFixed(1))
    .replaceAll("{BUDGET}", Math.max(1, durationS - 0.5).toFixed(1))
    .replaceAll("{FRAMES}", String(Math.round(durationS * 30)));
  const brief0 = [
    `Scene ${n} (${scene.beat}): ${scene.purpose}`,
    `What is seen: ${scene.visualDirection}`,
    scene.onScreenTerms.length ? `Terms that may appear as labels: ${scene.onScreenTerms.join(", ")}` : "",
    cast.length && !overlay ? `Recurring cast (draw these exactly so, the same as in every other scene):\n${castLines(cast)}` : "",
    `Narration timeline (seconds from the start of the scene):\n${narrationTimeline(scene.narration, audio.words)}`,
  ].filter(Boolean).join("\n\n");

  let feedback = "";
  let best: { asset: MirroredAsset; score: number } | null = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const what = engine === "three" ? "3D scene" : overlay ? "animation over the picture" : "animation";
    await progress(`${attempt === 1 ? "writing" : "fixing"} the ${what} for scene ${n}`, 0.3 + 0.15 * attempt);
    const { code: raw } = await ctx.llm.json({ system: rules, user: brief0 + feedback, schema: SceneCode, maxTokens: 6000 });
    const code = stripFences(raw);
    const r = await ctx.animator.render(engine, code, durationS, background, overlay?.image);
    if (!r.ok) {
      qa.push({ check: "visual-matches-direction", passed: false, score: null, attempts: attempt, fallback: null, notes: `${engine} code failed: ${r.error.slice(-300)}` });
      feedback = `\n\nYOUR PREVIOUS CODE FAILED. Fix it and return the full corrected code.\n--- code ---\n${code}\n--- error ---\n${r.error}`;
      continue;
    }
    const name = `${scene.id}-${overlay ? "overlay" : engine}-${attempt}.mp4`;
    const asset = await ctx.mirror.put(brief.projectId, name, r.video, "video/mp4", { width: 1920, height: 1080, durationMs: Math.round(durationS * 1000) });
    const mirrored: MirroredAsset = { ...asset, model: engine, costUsd: 0 };
    const frames = await ctx.frames.sample(mirrored.url, 3).catch(() => null);
    const score = frames ? await scoreCode(ctx, scene, engine, frames, Boolean(overlay)) : { matchesDirection: 0.7, styleMatch: 0.7, hasText: false, notes: "frames unavailable; accepted unchecked" };
    const s = Math.min(score.matchesDirection, score.styleMatch);
    const ok = score.matchesDirection >= PASS - 0.1 && score.styleMatch >= PASS;
    qa.push({ check: "visual-matches-direction", passed: ok, score: s, attempts: attempt, fallback: null, notes: score.notes });
    if (!best || s > best.score) best = { asset: mirrored, score: s };
    if (ok) break;
    feedback = `\n\nYOUR PREVIOUS CODE RENDERED, but a reviewer looking at frames said: ${score.notes}\nImprove it and return the full code.\n--- code ---\n${code}`;
  }

  if (!best && engine === "manim" && !overlay) {
    const r = await ctx.animator.render("manim", fallbackManim(scene.narration, scene.onScreenTerms), durationS, background);
    if (r.ok) {
      const asset = await ctx.mirror.put(brief.projectId, `${scene.id}-manim-fallback.mp4`, r.video, "video/mp4", { width: 1920, height: 1080, durationMs: Math.round(durationS * 1000) });
      best = { asset: { ...asset, model: "manim", costUsd: 0 }, score: 0 };
      qa.push({ check: "visual-matches-direction", passed: false, score: null, attempts: 3, fallback: "safe Manim scene", notes: null });
    }
  }
  if (best) await progress(`animated scene ${n}`, 0.9, { sceneId: scene.id, clipUrl: best.asset.url });
  return best?.asset ?? null;
}
