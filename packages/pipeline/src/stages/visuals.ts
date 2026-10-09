/**
 * Stage 4 — Visual planning and asset generation.
 *
 * planScene: turn a scene's visualDirection into a Hedra prompt + anim spec.
 * narrate:   narration via Hedra speech, then forced alignment.
 * renderSceneAssets: storyboard still → vision check → (clip | animated still |
 *                    programmatic assets) → vision check → retry on next model
 *                    → demote to a safer visual type.
 *
 * All generated assets are mirrored; both the Hedra asset id and our URL are kept.
 */
import { z } from "zod";
import { AnimSpec, RenderSpec, SceneAssets, QaResult, type Scene, type ScenePlan, type Brief, type MirroredAsset } from "@explainer/schemas";
import { generateStill, animateStill, generateClip, generateSpeech, HedraError, type GenOutcome } from "@explainer/hedra";
import type { Ctx } from "../context.js";
import { makeProgress } from "../context.js";
import { rescale } from "../providers/alignment.js";

const Planned = z.object({
  hedraPrompt: z.string().nullable(),
  animSpec: AnimSpec,
});

const VisionScore = z.object({
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

export async function planScene(ctx: Ctx, brief: Brief, scene: Scene): Promise<RenderSpec> {
  const refs = [ctx.style.referenceFrames[brief.background].assetId];
  const planned = await ctx.llm.json({
    system: `You write generation prompts for an explainer in a fixed house style and the matching programmatic animation spec.
House style: ${ctx.style.styleText}
Background: ${brief.background} (${ctx.style.backgrounds[brief.background].hex}).
Rules for hedraPrompt (null for visualType chart/text, since those are fully programmatic):
- Start with "Flat vector illustration, detailed." Then the scene's metaphor and its supporting details from the visual direction. End with "No text, no labels. Leave the bottom-right quarter clear."
- Describe one action for a clip; still-animated prompts describe the still only.
- Never ask for legible text; labels are composited.
animSpec: labelled-diagram (labels with the exact onScreenTerms and the narration word each appears on), chart (series from the cited claim; claimId), kinetic-text (lines with cue words), path-reveal (ids with cue words) or none.`,
    user: `Scene ${scene.id} (${scene.beat}, ${scene.visualType}): ${scene.visualDirection}\nNarration: ${scene.narration}\nOn-screen terms: ${scene.onScreenTerms.join(", ")}`,
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
  const aligned = await ctx.aligner.align(asset.url, scene.narration);
  const words = aligned.exact ? aligned.words : rescale(aligned.words, durationS);
  return { asset, durationS, words };
}

export async function renderSceneAssets(ctx: Ctx, brief: Brief, plan: ScenePlan, sceneIn: Scene, audio: SceneAssets["audio"]): Promise<SceneAssets> {
  const progress = makeProgress(ctx, brief.projectId, "visuals");
  let scene = sceneIn;
  const qa: QaResult[] = [];
  const visuals: SceneAssets["visuals"] = [];
  const refs = scene.render?.referenceAssetIds ?? [ctx.style.referenceFrames[brief.background].assetId];
  const scope = (k: string) => `${brief.projectId}:${scene.id}:${k}`;

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
      }
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

    // 2. Motion, if the type calls for it.
    if (scene.visualType === "diagram") break;

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
      const score = await scoreFrames(ctx, scene, await ctx.frames.sample(m.url, 3));
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
