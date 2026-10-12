import { test } from "node:test";
import assert from "node:assert/strict";
import type { z } from "zod";
import { HedraError } from "@explainer/hedra";
import { MemoryStore } from "../src/providers/store.ts";
import { loadHouseStyle, type Ctx } from "../src/context.ts";
import { narrate, sameWords, stripDelivery } from "../src/stages/visuals.ts";
import { evenSplit } from "../src/providers/alignment.ts";
import { noAnimator } from "../src/providers/animator.ts";
import type { Brief, Scene } from "@explainer/schemas";

const PID = "11111111-1111-4111-8111-111111111111";
const brief: Brief = { projectId: PID, question: "q", topic: "t", learningGoal: "g", level: "basics", ageMode: null, tone: "neutral", background: "light", lengthS: 120, wordBudget: 330, sceneRange: [4, 9], statement: "s", style: "illustrated", derivedFrom: null };
const scene: Scene = { id: "s1", beat: "hook", purpose: "p", narration: "Why is the sky blue? The answer is hiding in the air itself.", claimIds: ["c1"], visualDirection: "d", visualType: "motion", targetS: 10, onScreenTerms: [], render: null };

test("delivery marks are tags and pauses only; a changed word is caught", () => {
  assert.equal(stripDelivery("[curious] Why is the sky blue? The answer... is hiding in the air itself."), "Why is the sky blue? The answer is hiding in the air itself.");
  assert.ok(sameWords("[curious] Why is the sky blue? [whispers] The answer... is hiding in the air itself.", scene.narration));
  assert.ok(!sameWords("[curious] Why is the sky so blue? The answer is hiding in the air itself.", scene.narration), "an added word");
  assert.ok(!sameWords("[curious] Why is the sky blue? The answer is hiding in the air.", scene.narration), "a dropped word");
});

function ctxWith(deliveryText: string, opts: { v3Fails?: boolean } = {}) {
  const runs: { model: string; input: Record<string, unknown> }[] = [];
  const ctx: Ctx = {
    llm: {
      async json<T>(a: { system: string; schema: z.ZodType<T> }) {
        assert.match(a.system, /expressive narrator/);
        return a.schema.parse({ text: deliveryText });
      },
      vision: async () => { throw new Error("no vision here"); },
    },
    search: {} as any,
    hedra: {
      run: async (model: string, input: Record<string, unknown>) => {
        runs.push({ model, input });
        if (opts.v3Fails && /v3/.test(model)) throw new HedraError("unstable", "INTERNAL", 500, false);
        return { job_id: "j", model, status: "COMPLETED", error: null, cost: 0.02, currency: "USD", outputs: [{ status: "COMPLETED", asset_id: "asset_a", voice_id: null, url: "https://h/a", content_type: "audio/mpeg", width: null, height: null, duration_ms: 5000, fps: null, error: null }] };
      },
    } as any,
    mirror: { mirror: async (_p: string, o: any) => ({ hedraAssetId: o.asset_id, url: "http://localhost:9000/a.mp3", contentType: o.content_type, width: null, height: null, durationMs: o.duration_ms }) } as any,
    aligner: { align: async (_u: string, t: string, d: number) => ({ words: evenSplit(t, d), exact: false }) },
    frames: { sample: async () => [] },
    animator: noAnimator,
    store: new MemoryStore(),
    style: loadHouseStyle(),
    now: () => "2026-10-12T10:00:00.000Z",
  };
  return { ctx, runs };
}

test("the voice reads the tagged delivery on v3 at natural stability; captions keep the clean script", async () => {
  const tagged = "[curious] Why is the sky blue? The answer... is hiding in the air itself.";
  const { ctx, runs } = ctxWith(tagged);
  const audio = await narrate(ctx, brief, scene);
  assert.equal(runs.length, 1);
  assert.equal(runs[0]!.model, "elevenlabs-v3");
  assert.equal(runs[0]!.input.text, tagged);
  assert.equal(runs[0]!.input.stability, 0.5);
  assert.equal(runs[0]!.input.speed, 1.1);
  assert.deepEqual(audio.words.map((w) => w.w), scene.narration.split(" "), "word timing is for the clean script");
});

test("a delivery that changed a word is dropped for the plain script; v3 refusing falls back to v2 with plain text", async () => {
  const bad = "[curious] Why is the sky so blue? The answer is hiding in the air itself.";
  const { ctx, runs } = ctxWith(bad);
  await narrate(ctx, brief, scene);
  assert.equal(runs[0]!.input.text, scene.narration);

  const fallback = ctxWith("[excited] Why is the sky blue? The answer is hiding in the air itself.", { v3Fails: true });
  await narrate(fallback.ctx, brief, scene);
  assert.deepEqual(fallback.runs.map((r) => r.model), ["elevenlabs-v3", "elevenlabs-multilingual-v2"]);
  assert.equal(fallback.runs[1]!.input.text, scene.narration, "v2 never sees the tags");
  assert.equal(fallback.runs[1]!.input.stability, 1);
});
