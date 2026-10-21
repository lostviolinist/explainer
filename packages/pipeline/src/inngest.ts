/**
 * Inngest orchestration. One workflow per project; each stage is a step with
 * its own retries. Scenes fan out in parallel for narration and visuals.
 *
 * Events:
 *   project/created        { projectId, question, history?, derivedFrom?, style? }
 *   project/resume         the same data; picks a stopped project up from what it saved
 *   project/stage.failed   { projectId, stage, error }
 */
import { Inngest, EventSchemas, NonRetriableError } from "inngest";
import type { Brief, ScenePlan, SceneAssets, VideoStyle } from "@explainer/schemas";
import type { Ctx } from "./context.js";
import type { Renderer } from "./stages/assemble.js";
import { intake } from "./stages/intake.js";
import { research } from "./stages/research.js";
import { script } from "./stages/script.js";
import { planScene, narrate, renderSceneAssets } from "./stages/visuals.js";
import { assemble, reviewScript } from "./stages/assemble.js";
import { ensureMusicBed, ensureSfxKit } from "./stages/library.js";

type ProjectData = {
  projectId: string;
  question: string;
  history?: { level?: Brief["level"]; pressedSimpler?: number; pressedDeeper?: number };
  derivedFrom?: Brief["derivedFrom"];
  style?: VideoStyle;
};

type Events = {
  "project/created": { data: ProjectData };
  "project/resume": { data: ProjectData };
  "project/stage.failed": { data: { projectId: string; stage: string; error: string } };
};

/** The scenes a stopped project still has to make: those in the plan with no saved assets. */
export function scenesToRedo(plan: ScenePlan, assets: SceneAssets[]): ScenePlan["scenes"] {
  const have = new Set(assets.map((a) => a.sceneId));
  return plan.scenes.filter((s) => !have.has(s.id));
}

/** Assets in the plan's scene order, so the cut is assembled the same whether a scene was made now or earlier. */
export function inPlanOrder(plan: ScenePlan, assets: SceneAssets[]): SceneAssets[] {
  const byId = new Map(assets.map((a) => [a.sceneId, a]));
  return plan.scenes.map((s) => byId.get(s.id)).filter((a): a is SceneAssets => Boolean(a));
}

export const inngest = new Inngest({ id: "explainer", schemas: new EventSchemas().fromRecord<Events>() });

/**
 * The final cut, with two reasons not to retry it. A render that hit its time ceiling: the retry
 * would take as long and start from frame one. And a render whose process was killed under it
 * (almost always out of memory: the container restarts, and the worker's retry would be killed the
 * same way, all night). Either way the run stops with what to change, and "Try again" redoes only
 * the edit. A note in the store tells the two apart: "started" with no "ended" means killed.
 */
export async function finalCut<T>(ctx: Ctx, projectId: string, runId: string, run: () => Promise<T>): Promise<T> {
  const prior = await ctx.store.getRenderAttempt(projectId);
  if (prior?.runId === runId && prior.state === "started") {
    console.warn(`[render] ${projectId}: the previous attempt of this run started a render and never finished it; not rendering again`);
    throw new NonRetriableError("the render was killed part-way, almost always for lack of memory: give Docker more memory, or set RENDER_SCALE=0.6667 for 720p");
  }
  await ctx.store.saveRenderAttempt(projectId, { runId, state: "started", at: ctx.now() });
  try {
    return await run();
  } catch (e) {
    if ((e as Error).name === "RenderTimeout") throw new NonRetriableError((e as Error).message, { cause: e });
    throw e;
  } finally {
    await ctx.store.saveRenderAttempt(projectId, { runId, state: "ended", at: ctx.now() }).catch(() => undefined);
  }
}

export function makeFunctions(getCtx: () => Ctx, getRenderer: () => Renderer) {
  const makeVideo = inngest.createFunction(
    {
      id: "make-video",
      retries: 2,
      // One run per project, ever: a second "project/created" for the same project (a re-sent event, a
      // double submit) would write a second script and second recordings over the first, scene by scene.
      idempotency: "event.data.projectId",
      concurrency: [{ limit: 20 }, { key: "event.data.projectId", limit: 1 }],
      // "Try again" on a run that went quiet sends project/resume. Should this run in fact still be alive
      // (one very slow step), it is cancelled rather than left racing the resume over the same scenes.
      cancelOn: [{ event: "project/resume", if: "async.data.projectId == event.data.projectId" }],
      onFailure: async ({ event, error, step }) => {
        const { projectId } = event.data.event.data;
        await step.sendEvent("notify-failure", { name: "project/stage.failed", data: { projectId, stage: "unknown", error: error.message } });
        await getCtx().store.progress({ projectId, stage: "failed", message: `something went wrong: ${error.message.slice(0, 300)}`, fraction: 1, at: new Date().toISOString() });
      },
    },
    { event: "project/created" },
    async ({ event, step, runId }) => {
      const ctx = getCtx();
      const { projectId, question, history, derivedFrom, style } = event.data;

      const brief0 = await step.run("intake", () => intake(ctx, { projectId, question, history, derivedFrom, style }));
      const { brief, research: rb } = await step.run("research", () => research(ctx, brief0));
      const plan = await step.run("script", () => script(ctx, brief, rb));

      // Plan render specs for every scene (cheap text calls), in parallel.
      const planned = await Promise.all(
        plan.scenes.map((s) =>
          step.run(`plan-${s.id}`, async () => ({ ...s, render: await planScene(ctx, brief, s, plan.cast) })),
        ),
      );
      const planWithRender = { ...plan, scenes: planned };
      await step.run("save-plan", () => ctx.store.savePlan(planWithRender));

      // Narration and visuals fan out per scene. Narration first (cheap, sets
      // the clip duration), then visuals. The music bed and sound kit come from
      // the library (made once, on the first video that needs them).
      const [assets, music, sfx, reviewed] = await Promise.all([
        Promise.all(
          planned.map((s) =>
            step.run(`scene-${s.id}`, async () => {
              const audio = await narrate(ctx, brief, s);
              const a = await renderSceneAssets(ctx, brief, planWithRender, s, audio);
              await ctx.store.saveSceneAssets(a);
              return a;
            }),
          ),
        ),
        step.run("music", () => ensureMusicBed(ctx, projectId, brief.tone)),
        step.run("sfx", () => ensureSfxKit(ctx, projectId)),
        // Script-only checks (facts, watchability) run now rather than before the render.
        step.run("review-script", () => reviewScript(ctx, brief, planWithRender, rb)),
      ]);

      return step.run("assemble", () => finalCut(ctx, projectId, runId, () => assemble(ctx, getRenderer(), brief, planWithRender, assets, rb, { music, sfx }, reviewed)));
    },
  );

  /**
   * Pick a stopped project up where it left off. Everything it saved (brief, research, plan,
   * the scenes that were made) is kept; only what is missing is made, then the cut is assembled.
   */
  const resumeVideo = inngest.createFunction(
    {
      id: "resume-video",
      retries: 2,
      concurrency: [{ limit: 20 }, { key: "event.data.projectId", limit: 1 }],
      // A later "Try again" supersedes this one. The timestamp check keeps a run's own trigger from cancelling it.
      cancelOn: [{ event: "project/resume", if: "async.data.projectId == event.data.projectId && async.ts > event.ts" }],
      onFailure: async ({ event, error, step }) => {
        const { projectId } = event.data.event.data;
        await step.sendEvent("notify-failure", { name: "project/stage.failed", data: { projectId, stage: "unknown", error: error.message } });
        await getCtx().store.progress({ projectId, stage: "failed", message: `something went wrong: ${error.message.slice(0, 300)}`, fraction: 1, at: new Date().toISOString() });
      },
    },
    { event: "project/resume" },
    async ({ event, step, runId }) => {
      const ctx = getCtx();
      const { projectId, question, history, derivedFrom, style } = event.data;
      const saved = async <T,>(get: () => Promise<T>): Promise<T | null> => get().catch(() => null);

      const brief0 = await step.run("brief", async () => (await saved(() => ctx.store.getBrief(projectId))) ?? (await intake(ctx, { projectId, question, history, derivedFrom, style })));
      const { brief, research: rb } = await step.run("research", async () => {
        const have = await saved(() => ctx.store.getResearch(projectId));
        return have ? { brief: brief0, research: have } : await research(ctx, brief0);
      });

      let planWithRender = await step.run("saved-plan", () => saved(() => ctx.store.getPlan(projectId)));
      if (!planWithRender) {
        const plan = await step.run("script", () => script(ctx, brief, rb));
        const planned = await Promise.all(
          plan.scenes.map((s) =>
            step.run(`plan-${s.id}`, async () => ({ ...s, render: await planScene(ctx, brief, s, plan.cast) })),
          ),
        );
        planWithRender = { ...plan, scenes: planned };
        await step.run("save-plan", () => ctx.store.savePlan(planWithRender!));
      }
      const plan = planWithRender;

      const kept = await step.run("saved-scenes", () => ctx.store.getSceneAssets(projectId));
      const redo = scenesToRedo(plan, kept);
      await step.run("note", () =>
        ctx.store.progress({
          projectId,
          stage: redo.length ? "visuals" : "assemble",
          message: redo.length ? `trying ${redo.length === 1 ? "scene " + redo[0]!.id.slice(1) : redo.length + " scenes"} again` : "finishing the cut",
          fraction: 0,
          at: ctx.now(),
        }),
      );

      const [made, music, sfx, reviewed] = await Promise.all([
        Promise.all(
          redo.map((s) =>
            step.run(`scene-${s.id}`, async () => {
              const audio = await narrate(ctx, brief, s);
              const a = await renderSceneAssets(ctx, brief, plan, s, audio);
              await ctx.store.saveSceneAssets(a);
              return a;
            }),
          ),
        ),
        step.run("music", () => ensureMusicBed(ctx, projectId, brief.tone)),
        step.run("sfx", () => ensureSfxKit(ctx, projectId)),
        step.run("review-script", () => reviewScript(ctx, brief, plan, rb)),
      ]);

      const assets = inPlanOrder(plan, [...kept, ...made]);
      return step.run("assemble", () => finalCut(ctx, projectId, runId, () => assemble(ctx, getRenderer(), brief, plan, assets, rb, { music, sfx }, reviewed)));
    },
  );

  return [makeVideo, resumeVideo];
}
