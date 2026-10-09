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
import { RenderResult, QaResult, type Brief, type ScenePlan, type SceneAssets, type ResearchBrief } from "@explainer/schemas";
import type { Ctx } from "../context.js";
import { makeProgress } from "../context.js";

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
  }[];
  sources: { title: string; domain: string; url: string }[];
  learningGoal: string;
}

export interface Renderer {
  render(props: RenderProps): Promise<{ videoUrl: string; srtUrl: string; durationS: number }>;
}

export const Watchability = z.object({ goalAnswer: z.string(), couldMeetGoal: z.boolean(), confusingScenes: z.array(z.string()) });
export const FactCheck = z.object({ driftedSentences: z.array(z.string()) });

export function buildRenderProps(brief: Brief, plan: ScenePlan, assets: SceneAssets[], research: ResearchBrief): RenderProps {
  const byScene = new Map(assets.map((a) => [a.sceneId, a]));
  return {
    projectId: brief.projectId,
    background: brief.style === "math" ? "math" : plan.background,
    learningGoal: brief.learningGoal,
    scenes: plan.scenes.map((s) => {
      const a = byScene.get(s.id);
      if (!a) throw new Error(`no assets for ${s.id}`);
      return {
        id: s.id,
        narration: s.narration,
        visualType: s.visualType,
        animSpec: s.render?.animSpec ?? { kind: "none" },
        audioUrl: a.audio.asset.url,
        durationS: a.audio.durationS,
        words: a.audio.words,
        visuals: a.visuals,
        onScreenTerms: s.onScreenTerms,
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

export async function assemble(ctx: Ctx, renderer: Renderer, brief: Brief, plan: ScenePlan, assets: SceneAssets[], research: ResearchBrief): Promise<RenderResult> {
  const progress = makeProgress(ctx, brief.projectId, "assemble");
  const qa: QaResult[] = [];

  await progress("checking timing", 0.1);
  qa.push(...pacingCheck(plan, assets));

  await progress("checking every sentence against its source", 0.25);
  const claimList = research.claims.map((c) => `${c.id}: ${c.text}`).join("\n");
  const fact = await ctx.llm.json({
    system: "Final transcript check. List verbatim any narrated sentence that is not supported by the claim ids its scene cites.",
    user: `Claims:\n${claimList}\n\nScenes:\n${plan.scenes.map((s) => `[${s.id} → ${s.claimIds.join(",")}] ${s.narration}`).join("\n")}`,
    schema: FactCheck,
    maxTokens: 1200,
  });
  qa.push({ check: "factual-integrity", passed: fact.driftedSentences.length === 0, score: null, attempts: 1, fallback: fact.driftedSentences.length ? "cut sentence and re-time" : null, notes: fact.driftedSentences.join(" | ") || null });

  await progress("checking a learner would get it", 0.4);
  const watch = await ctx.llm.json({
    system: "You are the intended learner. You watch the video: each scene's narration with a description of its picture. Answer the learning goal afterwards and name any scene ids you found confusing.",
    user: `Learning goal: ${brief.learningGoal}\n\n${plan.scenes.map((s) => `[${s.id}] PICTURE: ${s.visualDirection}\nNARRATION: ${s.narration}`).join("\n\n")}`,
    schema: Watchability,
    maxTokens: 1200,
  });
  qa.push({ check: "watchability", passed: watch.couldMeetGoal && watch.confusingScenes.length === 0, score: null, attempts: 1, fallback: watch.couldMeetGoal ? null : "ship and flag for internal spot-check", notes: watch.confusingScenes.join(",") || null });

  await progress("rendering", 0.5);
  const props = buildRenderProps(brief, plan, assets, research);
  const out = await renderer.render(props);

  const costUsd = 0; // summed from the store by the web layer
  const result = RenderResult.parse({ projectId: brief.projectId, videoUrl: out.videoUrl, srtUrl: out.srtUrl, durationS: out.durationS, qa, costUsd });
  await ctx.store.saveRender(result);
  await ctx.store.progress({ projectId: brief.projectId, stage: "done", message: "your video is ready", fraction: 1, at: ctx.now() });
  return result;
}
