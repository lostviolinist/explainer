/**
 * Stage 4 — Visual planning and asset generation.
 *
 * planScene: turn a scene's visualDirection into a Hedra prompt + anim spec.
 * narrate:   narration via Hedra speech, then forced alignment.
 * renderSceneAssets: storyboard still → vision check → (clip | animated still |
 *                    programmatic assets) → vision check → retry on next model
 *                    → demote to a safer visual type.
 *
 * Illustrated motion graphics (motion / chart / text / the callouts of a diagram)
 * are hand-designed templates filled in by the model at plan time and drawn by
 * the composition: no model-written code, no sandbox, nothing to review. With
 * ANIMATION_AUTHOR=model the model also writes each motion scene's animation
 * as code around the scene's picture (the kit in packages/render), rendered in
 * the sandbox and judged on frames; the template stays as the safety net.
 *
 * Code scenes (manim / three, the 3Blue1Brown style): the model writes Manim or
 * React Three Fiber code, the animator sandbox renders it, sampled frames are
 * checked, and failures (render errors or reviewer notes) are fed back for up
 * to three attempts.
 *
 * All generated assets are mirrored; both the Hedra asset id and our URL are kept.
 */
import { z } from "zod";
import { AnimSpec, ChartSpec, MotionSpec, PointsSpec, RenderSpec, SceneAssets, QaResult, SoundCue, VIDEO_TIMING, type Scene, type ScenePlan, type Brief, type MirroredAsset, type CastMember } from "@explainer/schemas";
import { generateStill, animateStill, generateClip, generateSpeech, HedraError, type GenOutcome } from "@explainer/hedra";
import type { Ctx } from "../context.js";
import { makeProgress } from "../context.js";
import type { Engine, OverlayImage } from "../providers/animator.js";
import { MANIM_RULES, threeRules, motionRules, narrationTimeline, stripFences, fallbackManim } from "./engines.js";
import { CHART_PLAN_RULES, DIAGRAM_CALLOUT_RULES, MOTION_PLAN_RULES, POINTS_PLAN_RULES, pictureRules } from "./templates.js";

/** What the planner returns, by scene type: a template filled in, a picture prompt, or both. */
export const MotionPlan = z.object({ animSpec: MotionSpec, hedraPrompt: z.string() });
export const ChartPlan = z.object({ animSpec: ChartSpec });
export const PointsPlan = z.object({ animSpec: PointsSpec });
export const PicturePlan = z.object({ hedraPrompt: z.string() });
export const DiagramPlan = z.object({ hedraPrompt: z.string(), callouts: z.array(z.object({ label: z.string().min(1).max(28), cue: z.string().min(1).max(40) })).min(1).max(6) });

export const VisionScore = z.object({
  matchesDirection: z.number().min(0).max(1),
  styleMatch: z.number().min(0).max(1),
  /** Would a first-time viewer understand what this shows at a glance? Clutter and abstraction score low. */
  clarity: z.number().min(0).max(1),
  hasText: z.boolean(),
  notes: z.string(),
});
const CLEAR = 0.6;

const PASS = 0.7;

/** Per-type ladder for demotion when a generated asset fails twice. */
const DEMOTE: Partial<Record<Scene["visualType"], Scene["visualType"]>> = {
  clip: "still-animated",
  "reference-seq": "still-animated",
  "still-animated": "diagram",
};

/** What the model returns for a code scene: the code, and the sound effects it wants, cued in seconds. */
export const SceneCode = z.object({ code: z.string(), sounds: z.array(SoundCue) });

/** Sound cues in order, inside the scene, at most eight and not on top of each other. */
export function tidySounds(sounds: SoundCue[], durationS: number): SoundCue[] {
  const out: SoundCue[] = [];
  for (const s of [...sounds].sort((a, b) => a.at - b.at)) {
    if (!(s.at >= 0 && s.at <= durationS)) continue;
    if (out.length && s.at - out.at(-1)!.at < 0.4) continue;
    out.push({ at: +s.at.toFixed(2), kind: s.kind });
    if (out.length === 8) break;
  }
  return out;
}

/** Scenes whose visual is code the model writes (the 3Blue1Brown style); a motion scene is a template unless the operator opts in. */
const isCodeScene = (t: Scene["visualType"]): t is "manim" | "three" => t === "manim" || t === "three";

/** Where the frame sampler takes its frames (mirrors packages/render sampleTimes), so a reviewer knows the times. */
const sampleTimes = (durationS: number, count: number) => {
  const inset = Math.min(0.5, durationS / 10);
  const span = durationS - 2 * inset;
  return count === 1 ? [inset + span / 2] : Array.from({ length: count }, (_, i) => inset + (span * i) / (count - 1));
};

/** Where the parts of a still are, so callouts can point at them (0–1 in the image, origin top-left). */
export const Located = z.object({
  parts: z.array(z.object({ label: z.string(), x: z.number().min(0).max(1).nullable(), y: z.number().min(0).max(1).nullable() })),
});

/**
 * A point in an image (0–1), as it lands in the 1920×1080 frame once the image
 * is cover-fitted (scaled to fill, centred, the overflow cropped). Identity
 * when the image's size is unknown.
 */
export function coverPoint(x: number, y: number, width: number | null, height: number | null): { x: number; y: number } {
  if (!width || !height) return { x, y };
  const scale = Math.max(1920 / width, 1080 / height);
  const dw = width * scale, dh = height * scale;
  const px = (1920 - dw) / 2 + x * dw, py = (1080 - dh) / 2 + y * dh;
  const clamp = (v: number) => Math.min(0.98, Math.max(0.02, v));
  return { x: +clamp(px / 1920).toFixed(4), y: +clamp(py / 1080).toFixed(4) };
}

/** "name: look (colour)" lines for prompts, so the same thing looks the same in every scene. */
const castLines = (cast: CastMember[]) => cast.map((c) => `- ${c.name}: ${c.look} (${c.color})`).join("\n");

export async function planScene(ctx: Ctx, brief: Brief, scene: Scene, cast: CastMember[] = []): Promise<RenderSpec> {
  // Code scenes are written later, once the narration's timing is known.
  if (isCodeScene(scene.visualType)) {
    return RenderSpec.parse({ hedraPrompt: null, model: scene.visualType, referenceAssetIds: [], storyboardAssetId: null, animSpec: { kind: "none" } });
  }
  const spec = (hedraPrompt: string | null, animSpec: AnimSpec, modelKey?: keyof Ctx["style"]["models"]): RenderSpec =>
    RenderSpec.parse({ hedraPrompt, model: modelKey ? (ctx.style.models[modelKey]?.[0] ?? null) : null, referenceAssetIds: hedraPrompt ? [ctx.style.referenceFrames[brief.background].assetId] : [], storyboardAssetId: null, animSpec });
  const about = [
    `Scene ${scene.id} (${scene.beat}): ${scene.purpose}`,
    `What is seen: ${scene.visualDirection}`,
    `Narration: ${scene.narration}`,
    scene.onScreenTerms.length ? `On-screen terms: ${scene.onScreenTerms.join(", ")}` : "",
    scene.claimIds.length ? `Claim ids: ${scene.claimIds.join(", ")}` : "",
  ].filter(Boolean).join("\n");
  const withCast = cast.length ? `${about}\nRecurring things:\n${castLines(cast)}` : about;
  const picture = pictureRules(ctx.style.styleText, ctx.style.backgrounds[brief.background].hex);

  switch (scene.visualType) {
    case "motion": {
      // The template, and the illustration of the subject it sits beside (a split fills the frame on its own).
      const { animSpec, hedraPrompt } = await ctx.llm.json({ system: MOTION_PLAN_RULES, user: withCast, schema: MotionPlan, maxTokens: 1800, effort: "low" });
      return spec(animSpec.kind === "split" ? null : hedraPrompt, animSpec, "still");
    }
    case "chart": {
      const { animSpec } = await ctx.llm.json({ system: CHART_PLAN_RULES, user: about, schema: ChartPlan, maxTokens: 900, effort: "low" });
      return spec(null, { ...animSpec, claimId: scene.claimIds.includes(animSpec.claimId) ? animSpec.claimId : (scene.claimIds[0] ?? animSpec.claimId) });
    }
    case "text": {
      const { animSpec } = await ctx.llm.json({ system: POINTS_PLAN_RULES, user: about, schema: PointsPlan, maxTokens: 900, effort: "low" });
      return spec(null, animSpec);
    }
    case "diagram": {
      // The picture, and which of its parts get pointed at; where they are is found once it is drawn.
      const { hedraPrompt, callouts } = await ctx.llm.json({ system: `${picture}\n${DIAGRAM_CALLOUT_RULES}`, user: withCast, schema: DiagramPlan, maxTokens: 1200, effort: "low" });
      return spec(hedraPrompt, { kind: "reveal", items: callouts.map((c) => ({ label: c.label, cue: c.cue, x: null, y: null })) }, "still");
    }
    default: {
      const { hedraPrompt } = await ctx.llm.json({ system: picture, user: withCast, schema: PicturePlan, maxTokens: 800, effort: "low" });
      const modelKey = scene.visualType === "clip" ? "generatedClip" : scene.visualType === "reference-seq" ? "referenceSequence" : scene.visualType === "still-animated" ? "animatedStill" : "still";
      return spec(hedraPrompt, { kind: "none" }, modelKey);
    }
  }
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
    system: `Score frames from an explainer video scene. matchesDirection: does the picture show what the direction describes (metaphor and details)? styleMatch: flat vector illustration, limited palette, no outlines, no gradients except glow, bottom-right clear? clarity: would a first-time viewer understand what it shows at a glance (one clear subject; cluttered or abstract scores low)? hasText: any legible text or labels baked into the image? Scores 0–1.`,
    user: `Direction: ${scene.visualDirection}`,
    imageUrls,
    schema: VisionScore,
  });
}

/** What the delivery pass returns: the script with audio tags. */
export const Delivery = z.object({ text: z.string() });

/** ElevenLabs v3 audio tags we allow (documented ones that colour delivery without adding sounds). */
export const DELIVERY_TAGS = ["curious", "excited", "thoughtful", "whispers", "sighs", "surprised", "cheerfully", "seriously", "amazed", "mischievously"];

/** The script without its delivery marks. */
export const stripDelivery = (text: string) => text.replace(/\[[a-z ]+\]/gi, " ").replace(/\.\.\./g, " ").replace(/\s+/g, " ").trim();

/** True when the tagged text says exactly the script's words (tags and pauses aside). */
export function sameWords(delivery: string, narration: string): boolean {
  const words = (s: string) => s.split(/\s+/).map((w) => w.toLowerCase().replace(/[^a-z0-9']/g, "")).filter(Boolean).join(" ");
  return words(stripDelivery(delivery)) === words(narration);
}

/**
 * Delivery marks for an expressive voice: a few tags and pauses, placed by the
 * model, kept only if not one word changed. Null means "read it plain".
 */
export async function deliveryFor(ctx: Ctx, brief: Brief, scene: Scene): Promise<string | null> {
  if (!/elevenlabs-v3/.test(ctx.style.voice.model)) return null;
  try {
    const { text } = await ctx.llm.json({
      system: `You direct an expressive narrator (ElevenLabs v3) reading one scene of an explainer video. Return the narration with delivery marks for the voice: audio tags in square brackets, only from this list: ${DELIVERY_TAGS.map((t) => `[${t}]`).join(" ")}. A tag goes right before the sentence it colours and lasts a few words. At most one tag per two sentences; the scene's first sentence gets one if it is a hook or a surprise. "..." (an ellipsis) marks a short dramatic pause, at most two per scene, before a reveal. Never change, add, remove or reorder a word, and no other brackets or notes. Tone of the video: ${brief.tone}. Beat: ${scene.beat}.`,
      user: scene.narration,
      schema: Delivery,
      maxTokens: 800,
      effort: "low",
    });
    return sameWords(text, scene.narration) && text !== scene.narration ? text : null;
  } catch {
    return null;
  }
}

export async function narrate(ctx: Ctx, brief: Brief, scene: Scene): Promise<SceneAssets["audio"]> {
  const v = ctx.style.voice;
  const speed = brief.derivedFrom?.reaction === "deeper" ? v.deeperSpeed : v.speed;
  const delivery = await deliveryFor(ctx, brief, scene);
  const out = await generateSpeech(ctx.hedra, `${brief.projectId}:${scene.id}:speech`, [v.model, v.fallbackModel].filter(Boolean), {
    text: scene.narration,
    delivery,
    voiceId: v.voiceId,
    speed,
  });
  const asset = await mirrorOutcome(ctx, brief.projectId, out);
  await ctx.store.recordCost(brief.projectId, "narration", out.costUsd, scene.id);
  await makeProgress(ctx, brief.projectId, "visuals")(`recorded narration for scene ${scene.id.slice(1)}`, 0.2, { sceneId: scene.id, audioUrl: asset.url });
  // Hedra reports duration for audio; estimate from word count if it ever doesn't.
  const durationS = asset.durationMs ? asset.durationMs / 1000 : (scene.narration.split(/\s+/).length / v.wordsPerMinute) * 60;
  const { words, exact, reason } = await ctx.aligner.align(asset.url, scene.narration, durationS);
  if (!exact) await makeProgress(ctx, brief.projectId, "visuals")(`caption timing for scene ${scene.id.slice(1)} is estimated (${reason ?? "no transcription"})`, 0.2, { sceneId: scene.id });
  return { asset, durationS, words, exact, timingNote: exact ? null : (reason ?? "no transcription") };
}

export async function renderSceneAssets(ctx: Ctx, brief: Brief, plan: ScenePlan, sceneIn: Scene, audio: SceneAssets["audio"]): Promise<SceneAssets> {
  const progress = makeProgress(ctx, brief.projectId, "visuals");
  let scene = sceneIn;
  const qa: QaResult[] = [];
  const visuals: SceneAssets["visuals"] = [];
  const refs = scene.render?.referenceAssetIds?.length ? scene.render.referenceAssetIds : [ctx.style.referenceFrames[brief.background].assetId];
  const scope = (k: string) => `${brief.projectId}:${scene.id}:${k}`;

  const cast = plan.cast ?? [];
  let animSpec: AnimSpec | null = null;
  // Code scenes belong to the 3Blue1Brown style; an Illustrated plan never asks for one (the menu has none).
  if (isCodeScene(scene.visualType) && brief.style !== "math") {
    qa.push({ check: "visual-matches-direction", passed: false, score: null, attempts: 0, fallback: `demoted ${scene.visualType} → still-animated`, notes: "code scenes are not drawn in the Illustrated style" });
    scene = { ...scene, visualType: "still-animated" };
  }
  if (isCodeScene(scene.visualType)) {
    let animation = await renderCodeScene(ctx, brief, scene, audio, qa, cast);
    // A 3D scene that never worked becomes a Manim scene.
    if (!animation && scene.visualType === "three") {
      qa.push({ check: "visual-matches-direction", passed: false, score: null, attempts: 3, fallback: "demoted three → manim", notes: null });
      scene = { ...scene, visualType: "manim" };
      animation = await renderCodeScene(ctx, brief, scene, audio, qa, cast);
    }
    if (animation) return SceneAssets.parse({ projectId: brief.projectId, sceneId: scene.id, audio, visuals: [{ asset: animation.asset, role: "animation" }], sounds: animation.sounds, qa });
    return SceneAssets.parse({ projectId: brief.projectId, sceneId: scene.id, audio, visuals, qa });
  }

  // Template scenes are drawn by the composition from the plan's spec; a motion scene also gets an
  // illustration of its subject to sit beside (if the picture fails, the template fills the frame).
  if (scene.visualType === "motion" || scene.visualType === "chart" || scene.visualType === "text") {
    const kind = scene.render?.animSpec.kind ?? "none";
    qa.push({ check: "visual-matches-direction", passed: kind !== "none", score: null, attempts: 0, fallback: kind === "none" ? "no template planned; the scene shows its captions only" : null, notes: `template: ${kind}` });
    let picture: MirroredAsset | null = null;
    if (scene.visualType === "motion" && scene.render?.hedraPrompt) {
      const { still, bestRejected } = await drawStill(ctx, brief, scene, scene.render.hedraPrompt, refs, "still:0", qa);
      picture = still ?? bestRejected?.asset ?? null;
      if (picture) {
        visuals.push({ asset: picture, role: "still" });
        if (!still) qa.push({ check: "visual-matches-direction", passed: false, score: null, attempts: 2, fallback: "kept the best rejected still", notes: null });
        await progress(`drew scene ${scene.id.slice(1)}`, 0.6, { sceneId: scene.id, stillUrl: picture.url });
      }
    }
    // Opt-in: the model writes the animation itself, around the picture. The template is already
    // planned, so when no attempt passes the review the scene is drawn from it as usual.
    if (scene.visualType === "motion" && ctx.modelAnimation) {
      const animated = await modelAnimation(ctx, brief, scene, audio, qa, cast, picture);
      if (animated) {
        visuals.push({ asset: animated.asset, role: "animation" });
        await progress(`animated scene ${scene.id.slice(1)}`, 0.9, { sceneId: scene.id, clipUrl: animated.asset.url });
        return SceneAssets.parse({ projectId: brief.projectId, sceneId: scene.id, audio, visuals, sounds: animated.sounds, qa });
      }
    }
    await progress(`built scene ${scene.id.slice(1)} (${kind})`, 0.9, { sceneId: scene.id });
    return SceneAssets.parse({ projectId: brief.projectId, sceneId: scene.id, audio, visuals, qa });
  }

  for (let demotions = 0; demotions < 3; demotions++) {
    const prompt = scene.render?.hedraPrompt ?? `Flat vector illustration, detailed. ${scene.visualDirection}. No text, no labels. Leave the bottom-right quarter clear.`;

    // 1. Storyboard still (also the start frame for animated stills, and the vision target).
    const drawn = await drawStill(ctx, brief, scene, prompt, refs, `still:${demotions}`, qa);
    let still: MirroredAsset | null = drawn.still;
    const bestRejected = drawn.bestRejected;
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

    // 2. Motion, if the type calls for it. Diagrams: the callouts are located on the still, then pointed at as they're mentioned.
    if (scene.visualType === "diagram") {
      animSpec = await locateCallouts(ctx, scene, still, qa);
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

  return SceneAssets.parse({ projectId: brief.projectId, sceneId: scene.id, audio, visuals, animSpec, qa });
}

/**
 * A still from Hedra, checked by looking at it: two attempts (the second on
 * the next model, told to match the reference), and the least-bad rejected
 * one kept aside so a scene never has to go blank.
 */
async function drawStill(ctx: Ctx, brief: Brief, scene: Scene, prompt: string, refs: string[], key: string, qa: QaResult[]): Promise<{ still: MirroredAsset | null; bestRejected: { asset: MirroredAsset; rank: number } | null }> {
  const progress = makeProgress(ctx, brief.projectId, "visuals");
  const scope = (k: string) => `${brief.projectId}:${scene.id}:${k}`;
  let still: MirroredAsset | null = null;
  let bestRejected: { asset: MirroredAsset; rank: number } | null = null;
  const stillModels = ctx.style.models.still ?? ["gpt-image-2"];
  for (let attempt = 1; attempt <= 2 && !still; attempt++) {
    await progress(`drawing scene ${scene.id.slice(1)}`, 0.3, undefined);
    const out = await attemptGeneration(qa, "visual-matches-direction", attempt, () =>
      generateStill(ctx.hedra, scope(`${key}:${attempt}`), attempt === 1 ? stillModels : stillModels.slice(1).length ? stillModels.slice(1) : stillModels, {
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
    if (ok) still = m;
    else {
      const rank = Math.min(score.matchesDirection, score.styleMatch) - (score.hasText ? 1 : 0);
      if (!bestRejected || rank > bestRejected.rank) bestRejected = { asset: m, rank };
    }
  }
  return { still, bestRejected };
}

/**
 * Where the diagram's callouts go: the vision model finds each named part in
 * the still; parts it can't find stack in a column instead. The positions are
 * mapped to the frame the still is cover-fitted into.
 */
async function locateCallouts(ctx: Ctx, scene: Scene, still: MirroredAsset, qa: QaResult[]): Promise<AnimSpec | null> {
  const spec = scene.render?.animSpec;
  if (!spec || spec.kind !== "reveal") return null;
  try {
    const found = await ctx.llm.vision({
      system: "Locate the named parts in this illustration. For each label, give the point where a marker should sit on that part (x, y from 0 to 1, origin top-left, inside the part, not on its edge), or null for x and y when the part is not visible in the picture.",
      user: `Parts: ${spec.items.map((i) => i.label).join("; ")}\nThe picture shows: ${scene.visualDirection}`,
      imageUrls: [still.url],
      schema: Located,
    });
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
    const items = spec.items.map((item) => {
      const hit = found.parts.find((p) => norm(p.label) === norm(item.label)) ?? found.parts.find((p) => norm(p.label).includes(norm(item.label)) || norm(item.label).includes(norm(p.label)));
      if (!hit || hit.x === null || hit.y === null) return { ...item, x: null, y: null };
      return { ...item, ...coverPoint(hit.x, hit.y, still.width, still.height) };
    });
    const placed = items.filter((i) => i.x !== null).length;
    qa.push({ check: "visual-matches-direction", passed: placed > 0, score: placed / items.length, attempts: 1, fallback: placed ? null : "callouts listed beside the picture", notes: `${placed} of ${items.length} callouts located` });
    return { kind: "reveal", items };
  } catch (e) {
    qa.push({ check: "visual-matches-direction", passed: false, score: null, attempts: 1, fallback: "callouts listed beside the picture", notes: `locating parts failed: ${(e as Error).message.slice(0, 200)}` });
    return null;
  }
}

/**
 * ANIMATION_AUTHOR=model: the model writes this motion scene's animation as code
 * on the kit, with the scene's picture to place. Null when the sandbox isn't
 * running or no attempt passed the review, and the template is shown instead.
 */
async function modelAnimation(ctx: Ctx, brief: Brief, scene: Scene, audio: SceneAssets["audio"], qa: QaResult[], cast: CastMember[], picture: MirroredAsset | null): Promise<CodeRender | null> {
  if (!(await ctx.animator.available()).includes("motion")) {
    qa.push({ check: "visual-matches-direction", passed: false, score: null, attempts: 0, fallback: "template kept", notes: "model-written animation: the animation sandbox is not running" });
    return null;
  }
  let image: OverlayImage | undefined;
  if (picture) {
    const res = await fetch(picture.url).catch(() => null);
    if (res?.ok) image = { data: new Uint8Array(await res.arrayBuffer()), type: res.headers.get("content-type") ?? picture.contentType };
  }
  const animated = await renderCodeScene(ctx, brief, scene, audio, qa, cast, { engine: "motion", image });
  if (!animated) qa.push({ check: "visual-matches-direction", passed: false, score: null, attempts: 3, fallback: "template kept", notes: "model-written animation did not pass the review; the template is shown" });
  return animated;
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
  motion: "flat 2D motion graphics in a flat-illustration house style, built around an illustration of the scene's subject",
};

async function scoreCode(ctx: Ctx, scene: Scene, engine: Engine, frames: string[], times?: number[]) {
  // Motion scenes are judged on motion too: frames at known times, and change between them.
  const timing = times
    ? ` The ${frames.length} frames are in time order, at t = ${times.map((x) => x.toFixed(1)).join(", ")} s of the narration below. Judge the MOTION as well: does each frame show what is being said at that moment, and is something visibly different between consecutive frames (nothing static for long)? Count an empty frame, or one still showing an earlier moment, against matchesDirection. The illustration itself is given; judge what is drawn around it.`
    : "";
  return ctx.llm.vision({
    system: `Score frames from an animated explainer scene: ${ENGINE_LOOK[engine]}.${timing} matchesDirection: does it show what the direction describes? styleMatch: is it clean and readable: nothing cut off at the frame edges, no text spilling out of its box, no overlapping text or objects, good contrast, the bottom-right corner clear for captions? clarity: would a first-time viewer understand what it shows at a glance? One subject and a few supporting things score high; a frame crowded with boxes, arrows and labels, or an abstract diagram standing in for the real thing, scores low even if it is "correct". hasText: any legible text (fine for equations and short labels). Scores 0–1. In notes, say concretely what to fix, and what to remove.`,
    user: `Direction: ${scene.visualDirection}\nNarration: ${scene.narration}`,
    imageUrls: frames,
    schema: VisionScore,
  });
}

type CodeRender = { asset: MirroredAsset; sounds: SoundCue[] };

/**
 * Write → render → check, up to three times, feeding render errors and reviewer
 * notes back. Keeps the best render that worked. Manim scenes that never pass
 * use a plain safe scene; a 3D scene returns null so the caller can demote it.
 */
async function renderCodeScene(ctx: Ctx, brief: Brief, scene: Scene, audio: SceneAssets["audio"], qa: QaResult[], cast: CastMember[] = [], opts: { engine?: Engine; image?: OverlayImage } = {}): Promise<CodeRender | null> {
  const engine = opts.engine ?? (scene.visualType as Engine);
  const progress = makeProgress(ctx, brief.projectId, "visuals");
  const n = scene.id.slice(1);
  const durationS = +(audio.durationS + VIDEO_TIMING.sceneTailS).toFixed(2);
  const background = codeBackground(brief);
  const rules = (engine === "manim" ? MANIM_RULES : engine === "motion" ? motionRules(brief.background) : threeRules(brief.style, brief.background))
    .replaceAll("{DURATION}", durationS.toFixed(1))
    .replaceAll("{BUDGET}", Math.max(1, durationS - 0.5).toFixed(1))
    .replaceAll("{FRAMES}", String(Math.round(durationS * 30)));
  const brief0 = [
    `Scene ${n} (${scene.beat}): ${scene.purpose}`,
    `What is seen: ${scene.visualDirection}`,
    scene.onScreenTerms.length ? `Terms that may appear as labels: ${scene.onScreenTerms.join(", ")}` : "",
    cast.length ? `Recurring cast (draw these exactly so, the same as in every other scene):\n${castLines(cast)}` : "",
    `Narration timeline (seconds from the start of the scene):\n${narrationTimeline(scene.narration, audio.words)}`,
    engine === "motion" ? (opts.image ? "The scene's picture, an illustration of what is seen above, is ready for <Picture />." : "No picture could be drawn for this scene, so <Picture /> shows nothing: draw the subject yourself, simply.") : "",
  ].filter(Boolean).join("\n\n");

  let feedback = "";
  let best: { asset: MirroredAsset; score: number; sounds: SoundCue[] } | null = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const what = engine === "manim" ? "Manim scene" : engine === "three" ? "3D scene" : "animation";
    await progress(`${attempt === 1 ? "writing" : "fixing"} the ${what} for scene ${n}`, 0.3 + 0.15 * attempt);
    const { code: raw, sounds } = await ctx.llm.json({ system: rules, user: brief0 + feedback, schema: SceneCode, maxTokens: engine === "motion" ? 8000 : 6000 });
    const code = stripFences(raw);
    const r = await ctx.animator.render(engine, code, durationS, background, opts.image);
    if (!r.ok) {
      qa.push({ check: "visual-matches-direction", passed: false, score: null, attempts: attempt, fallback: null, notes: `${engine} code failed: ${r.error.slice(-300)}` });
      feedback = `\n\nYOUR PREVIOUS CODE FAILED. Fix it and return the full code.\n--- code ---\n${code}\n--- error ---\n${r.error.slice(-1500)}`;
      continue;
    }
    const name = `${scene.id}-${engine}-${attempt}.mp4`;
    const asset = await ctx.mirror.put(brief.projectId, name, r.video, "video/mp4", { width: 1920, height: 1080, durationMs: Math.round(durationS * 1000) });
    const mirrored: MirroredAsset = { ...asset, model: engine, costUsd: 0 };
    const nFrames = engine === "motion" ? 5 : 3;
    const frames = await ctx.frames.sample(mirrored.url, nFrames).catch(() => null);
    const score = frames
      ? await scoreCode(ctx, scene, engine, frames, engine === "motion" ? sampleTimes(durationS, frames.length) : undefined)
      : { matchesDirection: 0.5, styleMatch: 0.5, clarity: 0.5, hasText: true, notes: "frames could not be sampled" };
    const s = Math.min(score.matchesDirection, score.styleMatch, score.clarity);
    const ok = score.matchesDirection >= PASS - 0.1 && score.styleMatch >= PASS && score.clarity >= CLEAR;
    qa.push({ check: "visual-matches-direction", passed: ok, score: s, attempts: attempt, fallback: null, notes: score.notes });
    if (!best || s > best.score) best = { asset: mirrored, score: s, sounds: tidySounds(sounds, durationS) };
    if (ok) break;
    feedback = `\n\nYOUR PREVIOUS CODE RENDERED, but a reviewer looking at frames said: ${score.notes}${score.clarity < CLEAR ? " It was not clear at a glance: remove things rather than add; one subject, a few supporting details." : ""}\nImprove it and return the full code.\n--- code ---\n${code}`;
  }

  if (!best && engine === "manim") {
    const r = await ctx.animator.render("manim", fallbackManim(scene.narration, scene.onScreenTerms), durationS, background);
    if (r.ok) {
      const asset = await ctx.mirror.put(brief.projectId, `${scene.id}-manim-fallback.mp4`, r.video, "video/mp4", { width: 1920, height: 1080, durationMs: Math.round(durationS * 1000) });
      best = { asset: { ...asset, model: "manim", costUsd: 0 }, score: 0, sounds: [] };
      qa.push({ check: "visual-matches-direction", passed: false, score: null, attempts: 3, fallback: "safe Manim scene", notes: null });
    }
  }
  if (best) await progress(`animated scene ${n}`, 0.9, { sceneId: scene.id, clipUrl: best.asset.url });
  return best ? { asset: best.asset, sounds: best.sounds } : null;
}
