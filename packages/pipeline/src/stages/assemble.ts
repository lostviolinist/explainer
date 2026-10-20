/**
 * Stage 5 — Assemble and QA.
 *
 * Pre-render checks that need only the plan and scene assets (pacing, factual
 * integrity, watchability) run here; the vision checks ran per asset in Stage 4;
 * on-screen text and audio checks run on the rendered output.
 *
 * Rendering itself is delegated to a Renderer (local @remotion/renderer or
 * Remotion Lambda) implemented in packages/render; this stage builds the props.
 */
import { z } from "zod";
import { RenderResult, QaResult, type Brief, type ScenePlan, type SceneAssets, type ResearchBrief, type SoundCue, type SoundKind } from "@explainer/schemas";
import type { Ctx } from "../context.js";
import { makeProgress } from "../context.js";
import type { MusicBed, SfxKit } from "./library.js";

export interface RenderProps {
  projectId: string;
  background: "dark" | "light" | "math";
  scenes: {
    id: string;
    narration: string;
    visualType: ScenePlan["scenes"][number]["visualType"];
    animSpec: NonNullable<ScenePlan["scenes"][number]["render"]>["animSpec"];
    audioUrl: string;
    durationS: number;
    words: SceneAssets["audio"]["words"];
    visuals: SceneAssets["visuals"];
    onScreenTerms: string[];
    /** Sound cues the scene's animation asked for. */
    sounds: SoundCue[];
  }[];
  sources: { title: string; domain: string; url: string }[];
  learningGoal: string;
  /** The tone's music bed; the composition end-aligns it so its ending lands on the end card. */
  music: { url: string; durationS: number } | null;
  /** Sound-effect kit, by kind. */
  sfx: Partial<Record<SoundKind, string>>;
}

export type RenderExtras = { music: MusicBed | null; sfx: SfxKit };

export type RenderProgress = { frames: number; total: number; fps: number; fraction: number; elapsedS: number };
export interface Renderer {
  render(props: RenderProps, opts?: { onProgress?: (p: RenderProgress) => void }): Promise<{ videoUrl: string; srtUrl: string; durationS: number }>;
}

export const Watchability = z.object({ goalAnswer: z.string(), couldMeetGoal: z.boolean(), confusingScenes: z.array(z.string()) });
export const FactCheck = z.object({ driftedSentences: z.array(z.string()) });

export function buildRenderProps(brief: Brief, plan: ScenePlan, assets: SceneAssets[], research: ResearchBrief, extras: RenderExtras = { music: null, sfx: {} }): RenderProps {
  const byScene = new Map(assets.map((a) => [a.sceneId, a]));
  return {
    projectId: brief.projectId,
    background: brief.style === "math" ? "math" : plan.background,
    learningGoal: brief.learningGoal,
    music: extras.music ? { url: extras.music.url, durationS: extras.music.durationS } : null,
    sfx: extras.sfx,
    scenes: plan.scenes.map((s) => {
      const a = byScene.get(s.id);
      if (!a) throw new Error(`no assets for ${s.id}`);
      // The captions must say what the voice says: the words the recording was made from win over the plan's,
      // which can differ when the script was written again after the narration was recorded.
      if (a.audio.narration && a.audio.narration !== s.narration) console.warn(`[assemble] ${s.id}: the plan's narration differs from the recorded one; captions follow the recording`);
      return {
        id: s.id,
        narration: a.audio.narration ?? s.narration,
        visualType: s.visualType,
        // The spec refined after the visuals (callouts placed on the still) wins over the plan's.
        animSpec: a.animSpec ?? s.render?.animSpec ?? { kind: "none" },
        audioUrl: a.audio.asset.url,
        durationS: a.audio.durationS,
        words: a.audio.words,
        visuals: a.visuals,
        onScreenTerms: s.onScreenTerms,
        sounds: a.sounds ?? [],
      };
    }),
    sources: research.sources.map((s) => ({ title: s.title, domain: s.domain, url: s.url })),
  };
}

export function pacingCheck(plan: ScenePlan, assets: SceneAssets[]): QaResult[] {
  const byScene = new Map(assets.map((a) => [a.sceneId, a]));
  return plan.scenes.map((s) => {
    const a = byScene.get(s.id);
    const actual = a?.audio.durationS ?? 0;
    const over = actual / s.targetS - 1;
    const passed = over <= 0.1;
    return {
      check: "pacing",
      passed,
      score: +over.toFixed(3),
      attempts: 1,
      fallback: passed ? null : "re-run script for scene with tighter word budget",
      notes: `${s.id}: target ${s.targetS}s, narration ${actual.toFixed(1)}s`,
    };
  });
}

/**
 * The checks that need only the script and the research (factual integrity,
 * watchability). They run as their own step, alongside the scene generation,
 * so they cost no wall-clock time before the render.
 */
export async function reviewScript(ctx: Ctx, brief: Brief, plan: ScenePlan, research: ResearchBrief): Promise<QaResult[]> {
  const claimList = research.claims.map((c) => `${c.id}: ${c.text}`).join("\n");
  const [fact, watch] = await Promise.all([
    ctx.llm.json({
      system: "Final transcript check. List verbatim any narrated sentence that is not supported by the claim ids its scene cites.",
      user: `Claims:\n${claimList}\n\nScenes:\n${plan.scenes.map((s) => `[${s.id} → ${s.claimIds.join(",")}] ${s.narration}`).join("\n")}`,
      schema: FactCheck,
      maxTokens: 1200,
    }),
    ctx.llm.json({
      system: "You are the intended learner. You watch the video: each scene's narration with a description of its picture. Answer the learning goal afterwards and name any scene ids you found confusing.",
      user: `Learning goal: ${brief.learningGoal}\n\n${plan.scenes.map((s) => `[${s.id}] PICTURE: ${s.visualDirection}\nNARRATION: ${s.narration}`).join("\n\n")}`,
      schema: Watchability,
      maxTokens: 1200,
    }),
  ]);
  return [
    { check: "factual-integrity", passed: fact.driftedSentences.length === 0, score: null, attempts: 1, fallback: fact.driftedSentences.length ? "cut sentence and re-time" : null, notes: fact.driftedSentences.join(" | ") || null },
    { check: "watchability", passed: watch.couldMeetGoal && watch.confusingScenes.length === 0, score: null, attempts: 1, fallback: watch.couldMeetGoal ? null : "ship and flag for internal spot-check", notes: watch.confusingScenes.join(",") || null },
  ];
}

/**
 * Progress events while the final cut renders, at most one every 20 s or 5%, with the
 * numbers the page shows: "rendering 1240 of 5400 frames (4.1 fps)".
 */
export function renderProgress(progress: ReturnType<typeof makeProgress>, nowMs: () => number = Date.now): (p: RenderProgress) => void {
  let lastAt = -Infinity; // the first report always goes through: it tells the page the frame count
  let lastFrames = 0;
  return (p) => {
    const t = nowMs();
    if (p.frames < p.total && t - lastAt < 20_000 && (p.frames - lastFrames) / Math.max(1, p.total) < 0.05) return;
    lastAt = t;
    lastFrames = p.frames;
    const fps = p.fps ? ` (${p.fps.toFixed(1)} fps)` : "";
    void progress(`rendering ${p.frames} of ${p.total} frames${fps}`, 0.5 + 0.48 * Math.min(1, p.fraction));
  };
}

export async function assemble(ctx: Ctx, renderer: Renderer, brief: Brief, plan: ScenePlan, assets: SceneAssets[], research: ResearchBrief, extras: RenderExtras = { music: null, sfx: {} }, reviewed?: QaResult[]): Promise<RenderResult> {
  const progress = makeProgress(ctx, brief.projectId, "assemble");
  const qa: QaResult[] = [];

  await progress("checking timing", 0.1);
  qa.push(...pacingCheck(plan, assets));
  qa.push(...(reviewed ?? (await reviewScript(ctx, brief, plan, research))));

  const sfxCount = Object.keys(extras.sfx).length;
  qa.push({
    check: "sound",
    passed: Boolean(extras.music) && sfxCount > 0,
    score: null,
    attempts: 1,
    fallback: extras.music ? null : "no music bed",
    notes: `${extras.music ? `${brief.tone} music bed ${extras.music.durationS.toFixed(0)}s, end-aligned` : "no music bed"}; ${sfxCount} sound effects`,
  });

  await progress("rendering", 0.5);
  const props = buildRenderProps(brief, plan, assets, research, extras);
  const out = await renderer.render(props, { onProgress: renderProgress(progress) });

  const costUsd = 0; // summed from the store by the web layer
  const result = RenderResult.parse({ projectId: brief.projectId, videoUrl: out.videoUrl, srtUrl: out.srtUrl, durationS: out.durationS, qa, costUsd });
  await ctx.store.saveRender(result);
  await ctx.store.progress({ projectId: brief.projectId, stage: "done", message: "your video is ready", fraction: 1, at: ctx.now() });
  return result;
}
