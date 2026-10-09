/**
 * Inngest orchestration. One workflow per project; each stage is a step with
 * its own retries. Scenes fan out in parallel for narration and visuals.
 *
 * Events:
 *   project/created        { projectId, question, history?, derivedFrom? }
 *   project/stage.failed   { projectId, stage, error }
 */
import { Inngest, EventSchemas } from "inngest";
import type { Brief } from "@explainer/schemas";
import type { Ctx } from "./context.js";
import type { Renderer } from "./stages/assemble.js";
import { intake } from "./stages/intake.js";
import { research } from "./stages/research.js";
import { script } from "./stages/script.js";
import { planScene, narrate, renderSceneAssets } from "./stages/visuals.js";
import { assemble } from "./stages/assemble.js";

type Events = {
  "project/created": {
    data: {
      projectId: string;
      question: string;
      history?: { level?: Brief["level"]; pressedSimpler?: number; pressedDeeper?: number };
      derivedFrom?: Brief["derivedFrom"];
    };
  };
  "project/stage.failed": { data: { projectId: string; stage: string; error: string } };
};

export const inngest = new Inngest({ id: "explainer", schemas: new EventSchemas().fromRecord<Events>() });

export function makeFunctions(getCtx: () => Ctx, getRenderer: () => Renderer) {
  const makeVideo = inngest.createFunction(
    {
      id: "make-video",
      retries: 2,
      concurrency: { limit: 20 },
      onFailure: async ({ event, error, step }) => {
        const { projectId } = event.data.event.data;
        await step.sendEvent("notify-failure", { name: "project/stage.failed", data: { projectId, stage: "unknown", error: error.message } });
        await getCtx().store.progress({ projectId, stage: "failed", message: `something went wrong: ${error.message.slice(0, 300)}`, fraction: 1, at: new Date().toISOString() });
      },
    },
    { event: "project/created" },
    async ({ event, step }) => {
      const ctx = getCtx();
      const { projectId, question, history, derivedFrom } = event.data;

      const brief0 = await step.run("intake", () => intake(ctx, { projectId, question, history, derivedFrom }));
      const { brief, research: rb } = await step.run("research", () => research(ctx, brief0));
      const plan = await step.run("script", () => script(ctx, brief, rb));

      // Plan render specs for every scene (cheap text calls), in parallel.
      const planned = await Promise.all(
        plan.scenes.map((s) =>
          step.run(`plan-${s.id}`, async () => ({ ...s, render: await planScene(ctx, brief, s) })),
        ),
      );
      const planWithRender = { ...plan, scenes: planned };
      await step.run("save-plan", () => ctx.store.savePlan(planWithRender));

      // Narration and visuals fan out per scene. Narration first (cheap, sets
      // the clip duration), then visuals.
      const assets = await Promise.all(
        planned.map((s) =>
          step.run(`scene-${s.id}`, async () => {
            const audio = await narrate(ctx, brief, s);
            const a = await renderSceneAssets(ctx, brief, planWithRender, s, audio);
            await ctx.store.saveSceneAssets(a);
            return a;
          }),
        ),
      );

      const result = await step.run("assemble", () => assemble(ctx, getRenderer(), brief, planWithRender, assets, rb));
      return result;
    },
  );

  return [makeVideo];
}
