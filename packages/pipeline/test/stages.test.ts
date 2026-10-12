import { test } from "node:test";
import assert from "node:assert/strict";
import type { z } from "zod";
import { MemoryStore } from "../src/providers/store.ts";
import { loadHouseStyle, type Ctx } from "../src/context.ts";
import { intake } from "../src/stages/intake.ts";
import { script, estimateVideoS, trimToFit } from "../src/stages/script.ts";
import { research as runResearch } from "../src/stages/research.ts";
import { pacingCheck } from "../src/stages/assemble.ts";
import { renderSceneAssets, planScene } from "../src/stages/visuals.ts";
import { visualTypesFor, fitVisualType } from "../src/stages/script.ts";
import type { Animator, Engine, OverlayImage } from "../src/providers/animator.ts";
import { evenSplit, rescale } from "../src/providers/alignment.ts";
import type { LLM } from "../src/providers/llm.ts";
import { noAnimator } from "../src/providers/animator.ts";
import type { Brief, ResearchBrief, Scene, ScenePlan, SceneAssets } from "@explainer/schemas";

const PID = "11111111-1111-4111-8111-111111111111";

/** Scripted LLM: answers by matching a substring of the system prompt. */
function scriptedLLM(answers: [RegExp, unknown][]): LLM {
  const calls: string[] = [];
  const llm: LLM = {
    async json<T>(a: { system: string; schema: z.ZodType<T> }) {
      calls.push(a.system.slice(0, 40));
      const hit = answers.find(([re]) => re.test(a.system));
      if (!hit) throw new Error(`no scripted answer for: ${a.system.slice(0, 80)}`);
      return a.schema.parse(hit[1]);
    },
    async vision<T>(a: { schema: z.ZodType<T> }) {
      return a.schema.parse({ matchesDirection: 0.9, styleMatch: 0.9, hasText: false, notes: "ok" });
    },
  };
  (llm as any).calls = calls;
  return llm;
}

function ctxWith(llm: LLM): Ctx {
  return {
    llm,
    search: { search: async () => [], open: async () => null },
    hedra: {} as any,
    mirror: {} as any,
    aligner: { align: async (_u: string, t: string, d: number) => ({ words: evenSplit(t, d), exact: false }) },
    frames: { sample: async () => [] },
    animator: noAnimator,
    store: new MemoryStore(),
    style: loadHouseStyle(),
    now: () => "2026-10-07T20:00:00.000Z",
  };
}

const research: ResearchBrief = {
  projectId: PID,
  claims: [
    { id: "c1", text: "Chlorophyll breaks down in autumn", type: "process", confidence: "corroborated", fit: "needed", sources: [{ url: "https://a.edu/x", quote: "q" }] },
    { id: "c2", text: "Carotenoids were present all along", type: "fact", confidence: "corroborated", fit: "needed", sources: [{ url: "https://b.edu/y", quote: "q" }] },
    { id: "c3", text: "Anthocyanins are made fresh in autumn", type: "process", confidence: "single", fit: "nice", sources: [{ url: "https://c.org/z", quote: "q" }] },
  ],
  misconceptions: [{ belief: "Cold turns leaves red", correctsWith: ["c1", "c2"] }],
  analogies: [{ text: "like a stage light switching off", breaksDown: "nothing is revealed by removal on stage", explains: ["c1", "c2"] }],
  sources: [{ url: "https://a.edu/x", title: "A", domain: "a.edu", reputation: 0.95, openedAt: "2026-10-07T19:00:00.000Z" }],
  neededClaimCount: 2,
};

test("intake infers a brief from a question with no user input", async () => {
  const llm = scriptedLLM([
    [/turn a learner's question/, { topic: "autumn leaf colour", learningGoal: "After watching, the viewer can explain what happens to chlorophyll", level: "basics", ageMode: null, tone: "neutral", background: "light", statement: "A 3-minute neutral explainer…" }],
  ]);
  const ctx = ctxWith(llm);
  const brief = await intake(ctx, { projectId: PID, question: "why do leaves change colour in autumn?" });
  assert.equal(brief.level, "basics");
  assert.equal(brief.lengthS, null, "length is decided after research");
  assert.ok((await ctx.store.getBrief(PID)).statement.length > 0);
});

test("a 'simpler' re-run lowers the level even if the model inferred basics", async () => {
  const llm = scriptedLLM([
    [/turn a learner's question/, { topic: "t", learningGoal: "After watching, the viewer can x", level: "basics", ageMode: null, tone: "neutral", background: "light", statement: "s" }],
  ]);
  const brief = await intake(ctxWith(llm), { projectId: PID, question: "q", derivedFrom: { projectId: PID, reaction: "simpler" } });
  assert.equal(brief.level, "nothing");
});

test("script passes learner and expert review on the first attempt and records it", async () => {
  const scenes = [
    { beat: "hook", purpose: "p", narration: "Why do leaves turn red? Here's the odd part.", claimIds: ["c1"], visualDirection: "a leaf as a stage, a green spotlight switching off, orange set revealed behind", visualType: "still-animated", targetS: 20, onScreenTerms: [] },
    { beat: "core", purpose: "p", narration: "The green was hiding the orange all along.", claimIds: ["c1", "c2"], visualDirection: "cross-section with three bands, green fading, orange and red beneath", visualType: "diagram", targetS: 30, onScreenTerms: ["chlorophyll"] },
    { beat: "recap", purpose: "p", narration: "So: chlorophyll goes, the other pigments show.", claimIds: ["c1", "c2"], visualDirection: "the three bands side by side, the green one dimmed, two labels", visualType: "text", targetS: 20, onScreenTerms: [] },
  ];
  const llm = scriptedLLM([
    [/exactly seven beats/, { beats: ["hook", "ground", "misconception", "build-up", "core", "payoff", "recap"].map((b) => ({ beat: b, purpose: "p", claimIds: ["c1"], targetS: 26 })) }],
    [/Write the scenes/, { scenes, cast: [] }],
    [/You will hear the narration/, { goalAnswer: "chlorophyll breaks down and other pigments show", unclearSentences: [], couldMeetGoal: true }],
    [/careful subject expert/, { unsourced: [], overstated: [] }],
  ]);
  const ctx = ctxWith(llm);
  const brief = { projectId: PID, question: "q", topic: "t", learningGoal: "After watching, the viewer can explain it", level: "basics" as const, ageMode: null, tone: "neutral" as const, background: "light" as const, lengthS: 120, wordBudget: 330, sceneRange: [3, 6] as [number, number], statement: "s", style: "illustrated" as const, derivedFrom: null };
  const plan = await script(ctx, brief, research);
  assert.equal(plan.scenes.length, 3);
  assert.equal(plan.scenes[0]!.id, "s1");
  assert.equal(plan.review.learnerPass.passed, true);
  assert.equal(plan.review.expertPass.passed, true);
  assert.equal(plan.review.attempts, 1);
  const hook = (ctx.store as MemoryStore).events.at(-1)?.preview?.hookLine;
  assert.equal(hook, "Why do leaves turn red?");
});

test("pacing check flags a scene more than 10% over target", () => {
  const plan: any = { scenes: [{ id: "s1", targetS: 20 }, { id: "s2", targetS: 30 }] };
  const assets: SceneAssets[] = [
    { projectId: PID, sceneId: "s1", audio: { asset: {} as any, durationS: 21, words: [] }, visuals: [], qa: [] },
    { projectId: PID, sceneId: "s2", audio: { asset: {} as any, durationS: 36, words: [] }, visuals: [], qa: [] },
  ];
  const r = pacingCheck(plan, assets);
  assert.equal(r[0]!.passed, true);
  assert.equal(r[1]!.passed, false);
});

test("even-split alignment rescales to the real duration", () => {
  const w = rescale(evenSplit("one two three four", 1), 8);
  assert.equal(w.length, 4);
  assert.equal(w.at(-1)!.end, 8);
  assert.equal(w[1]!.start, 2);
});

test("clip QA scores frames sampled from the clip, not the video file", async () => {
  const visionCalls: string[][] = [];
  const sampled: [string, number][] = [];
  const llm = scriptedLLM([]);
  llm.vision = async <T,>(a: { imageUrls: string[]; schema: z.ZodType<T> }) => {
    visionCalls.push(a.imageUrls);
    return a.schema.parse({ matchesDirection: 0.9, styleMatch: 0.9, hasText: false, notes: "ok" });
  };
  const ctx = ctxWith(llm);
  const style = ctx.style;
  let n = 0;
  ctx.hedra = {
    run: async (model: string) => {
      const video = style.models.generatedClip!.includes(model);
      const id = `asset_${++n}`;
      return {
        job_id: `job_${n}`, model, status: "COMPLETED", error: null, cost: 0.1, currency: "USD",
        outputs: [{ status: "COMPLETED", asset_id: id, voice_id: null, url: `https://hedra.example/${id}`, content_type: video ? "video/mp4" : "image/png", width: 1280, height: 720, duration_ms: video ? 5000 : null }],
      };
    },
  } as any;
  ctx.mirror = {
    mirror: async (_p: string, o: any) => ({ hedraAssetId: o.asset_id, url: `http://localhost:9000/explainer-assets/${o.asset_id}`, contentType: o.content_type, width: o.width, height: o.height, durationMs: o.duration_ms }),
  } as any;
  ctx.frames = {
    sample: async (url: string, count: number) => {
      sampled.push([url, count]);
      return Array.from({ length: count }, (_, i) => `data:image/jpeg;base64,frame${i}`);
    },
  };

  const brief: Brief = {
    projectId: PID, question: "why is the sky blue?", topic: "sky colour", learningGoal: "explain scattering",
    level: "basics", ageMode: null, tone: "neutral", background: "light", lengthS: 90, wordBudget: 250,
    sceneRange: [3, 5], statement: "s", style: "illustrated" as const, derivedFrom: null,
  };
  const scene: Scene = {
    id: "s1", beat: "hook", purpose: "p", narration: "Sunlight scatters off air.", claimIds: [],
    visualDirection: "sunlight hitting air molecules, blue rays bouncing, a child looking up", visualType: "clip",
    targetS: 10, onScreenTerms: [], render: null,
  };
  const audio: SceneAssets["audio"] = {
    asset: { hedraAssetId: "a", url: "http://localhost:9000/explainer-assets/a.mp3", contentType: "audio/mpeg", width: null, height: null, durationMs: 4000, model: "m", costUsd: 0 },
    durationS: 4,
    words: [],
  };

  const out = await renderSceneAssets(ctx, brief, {} as ScenePlan, scene, audio);

  assert.deepEqual(out.visuals.map((v) => v.role), ["still", "clip"]);
  const clipUrl = out.visuals[1]!.asset.url;
  assert.deepEqual(sampled, [[clipUrl, 3]]);
  assert.equal(visionCalls.length, 2);
  assert.deepEqual(visionCalls[0], [out.visuals[0]!.asset.url]); // the still itself
  assert.equal(visionCalls[1]!.length, 3);
  assert.ok(visionCalls[1]!.every((u) => u.startsWith("data:image/jpeg")), "clip QA must see images, never the video URL");
});

// ---------------------------------------------------------------------------
// 3-minute cap

const BEATS7 = ["hook", "ground", "misconception", "build-up", "core", "payoff", "recap"] as const;
const briefFor = (lengthS: number) => ({ projectId: PID, question: "q", topic: "t", learningGoal: "After watching, the viewer can explain it", level: "deep" as const, ageMode: null, tone: "neutral" as const, background: "light" as const, lengthS, wordBudget: Math.round((lengthS / 60) * 165), sceneRange: [4, 9] as [number, number], statement: "s", style: "illustrated" as const, derivedFrom: null });
const sceneWith = (beat: string, sentences: number) => ({
  beat, purpose: "p", claimIds: ["c1"], visualDirection: "a leaf as a stage, a spotlight, an orange set", visualType: "still-animated", targetS: 25, onScreenTerms: [],
  narration: Array.from({ length: sentences }, (_, i) => `Sentence ${i + 1} about the ${beat} has ten words in it.`).join(" "),
});

test("deep research is capped at the 3-minute default instead of 5 minutes", async () => {
  const claims = Array.from({ length: 12 }, (_, i) => ({ id: `c${i + 1}`, text: `claim ${i + 1}`, type: "fact", fit: "needed", evidence: [0], contested: false }));
  const llm = scriptedLLM([
    [/web search queries/, { queries: ["a", "b", "c"] }],
    [/Extract the claims/, { claims: [{ text: "claim", type: "fact", fit: "needed", quote: "claim" }] }],
    [/Merge overlapping claims/, { claims, misconceptions: [], analogies: [] }],
  ]);
  const ctx = ctxWith(llm);
  ctx.search = { search: async () => [{ url: "https://a.edu/x", title: "A", snippet: "s" }], open: async (url) => ({ url, title: "A", text: "x".repeat(600) }) };
  const { brief } = await runResearch(ctx, briefFor(0) as any);
  assert.equal(brief.lengthS, 180, "12 needed claims would be 300 s without the cap");
  assert.match((ctx.store as MemoryStore).events.at(-1)!.message, /condensing them into a 3-minute video/);
});

test("a script that would run past 3 minutes is sent back with the numbers and rewritten shorter", async () => {
  const systems: string[] = [];
  let draft = 0;
  const llm: LLM = {
    async json<T>(a: { system: string; schema: z.ZodType<T> }) {
      systems.push(a.system);
      if (/exactly seven beats/.test(a.system)) return a.schema.parse({ beats: BEATS7.map((b) => ({ beat: b, purpose: "p", claimIds: ["c1"], targetS: 25 })) });
      // First draft: 7 scenes × 8 sentences × 10 words = 560 words (~3:54). Second: 7 × 4 × 10 = 280 words.
      if (/Write the scenes/.test(a.system)) return a.schema.parse({ scenes: BEATS7.map((b) => sceneWith(b, ++draft <= 7 ? 8 : 4)), cast: [] });
      if (/You will hear the narration/.test(a.system)) return a.schema.parse({ goalAnswer: "g", unclearSentences: [], couldMeetGoal: true });
      if (/careful subject expert/.test(a.system)) return a.schema.parse({ unsourced: [], overstated: [] });
      throw new Error("unexpected");
    },
    async vision<T>(a: { schema: z.ZodType<T> }) { return a.schema.parse({}); },
  };
  const plan = await script(ctxWith(llm), briefFor(180), research);
  const sceneCalls = systems.filter((x) => /Write the scenes/.test(x));
  assert.equal(sceneCalls.length, 2);
  assert.doesNotMatch(sceneCalls[0]!, /LENGTH:/);
  assert.match(sceneCalls[1]!, /LENGTH: Your previous draft had 560 words .*under 3:00/);
  assert.equal(systems.filter((x) => /You will hear the narration/.test(x)).length, 1, "the over-long draft isn't reviewed");
  assert.ok(estimateVideoS(plan.scenes, 165) <= 180);
  assert.equal(plan.review.attempts, 2);
});

test("if every rewrite runs long, middle scenes are trimmed until it fits; hook and recap stay whole", async () => {
  const llm = scriptedLLM([
    [/exactly seven beats/, { beats: BEATS7.map((b) => ({ beat: b, purpose: "p", claimIds: ["c1"], targetS: 25 })) }],
    [/Write the scenes/, { scenes: BEATS7.map((b) => sceneWith(b, 9)), cast: [] }],
    [/You will hear the narration/, { goalAnswer: "g", unclearSentences: [], couldMeetGoal: true }],
    [/careful subject expert/, { unsourced: [], overstated: [] }],
  ]);
  const plan = await script(ctxWith(llm), briefFor(180), research);
  assert.ok(estimateVideoS(plan.scenes, 165) <= 180 * 0.95, `estimated ${estimateVideoS(plan.scenes, 165)} s`);
  assert.equal(plan.scenes[0]!.narration, sceneWith("hook", 9).narration);
  assert.equal(plan.scenes.at(-1)!.narration, sceneWith("recap", 9).narration);
  assert.deepEqual(plan.scenes.map((s) => s.id), plan.scenes.map((_, i) => `s${i + 1}`));
});

test("trimToFit drops whole middle scenes only when sentences run out, and keeps at least 3", () => {
  const scenes = BEATS7.map((b, i) => ({ ...sceneWith(b, 1), id: `s${i + 1}`, render: null })) as any;
  const out = trimToFit(scenes, 10, 165);
  assert.equal(out.length, 3);
  assert.equal(out[0]!.beat, "hook");
  assert.equal(out.at(-1)!.beat, "recap");
});

// ---------------------------------------------------------------------------
// Code scenes (Manim / three.js) and styles

function codeCtx(opts: { render: (engine: Engine, code: string, durationS: number) => { ok: true } | { ok: false; error: string }; vision?: (n: number) => number }) {
  const prompts: { system: string; user: string }[] = [];
  const renders: { engine: Engine; code: string; durationS: number; background: string; image?: OverlayImage }[] = [];
  let visionCalls = 0;
  const llm: LLM = {
    async json<T>(a: { system: string; user: string; schema: z.ZodType<T> }) {
      prompts.push({ system: a.system, user: a.user });
      return a.schema.parse({ code: `class GeneratedScene(Scene):\n    # attempt ${prompts.length}\n    def construct(self): pass` });
    },
    async vision<T>(a: { schema: z.ZodType<T> }) {
      const q = opts.vision?.(++visionCalls) ?? 0.9;
      return a.schema.parse({ matchesDirection: q, styleMatch: q, hasText: true, notes: q < 0.7 ? "the equation runs off the right edge" : "ok" });
    },
  };
  const ctx = ctxWith(llm);
  ctx.animator = {
    available: async () => ["manim", "three", "motion"],
    render: async (engine, code, durationS, background, image) => {
      renders.push({ engine, code, durationS, background, image });
      const r = opts.render(engine, code, durationS);
      return r.ok ? { ok: true, video: new Uint8Array([1, 2, 3]) } : r;
    },
  } satisfies Animator;
  ctx.mirror = { put: async (_p: string, name: string, bytes: Uint8Array, contentType: string, meta: any) => ({ hedraAssetId: `local:${name}`, url: `http://localhost:9000/explainer-assets/${name}`, contentType, width: 1920, height: 1080, durationMs: meta.durationMs, bytes: bytes.length }) } as any;
  ctx.frames = { sample: async () => ["data:image/jpeg;base64,AAA", "data:image/jpeg;base64,AAA", "data:image/jpeg;base64,AAA"] };
  return { ctx, prompts, renders };
}

const mathBrief = { ...briefFor(180), style: "math" as const, background: "dark" as const };
const codeScene = (visualType: "manim" | "three" | "motion"): Scene => ({
  id: "s2", beat: "core", purpose: "show the 1/λ⁴ law", narration: "Short waves scatter far more. Blue scatters about five times more than red.",
  claimIds: ["c1"], visualDirection: "the curve 1/λ⁴ drawn on axes, blue end highlighted", visualType, targetS: 10, onScreenTerms: ["wavelength"], render: null,
});
const codeAudio: SceneAssets["audio"] = {
  asset: { hedraAssetId: "a", url: "http://localhost:9000/explainer-assets/a.mp3", contentType: "audio/mpeg", width: null, height: null, durationMs: 6000, model: "m", costUsd: 0 },
  durationS: 6,
  words: evenSplit("Short waves scatter far more. Blue scatters about five times more than red.", 6),
};

test("a Manim scene whose code fails is sent back with the code and the error, then renders", async () => {
  const { ctx, prompts, renders } = codeCtx({ render: (_e, code) => (code.includes("attempt 1") ? { ok: false, error: "NameError: name 'Creat' is not defined" } : { ok: true }) });
  const out = await renderSceneAssets(ctx, mathBrief, {} as ScenePlan, { ...codeScene("manim"), render: await planScene(ctx, mathBrief, codeScene("manim")) }, codeAudio);
  assert.equal(renders.length, 2);
  assert.equal(renders[0]!.durationS, 6.6, "narration + scene pause");
  assert.equal(renders[0]!.background, "#000000");
  assert.match(prompts[0]!.system, /class GeneratedScene\(Scene\)/);
  assert.match(prompts[0]!.user, /\[0\.0 s\] Short waves scatter far more\.\n\[\d\.\d s\] Blue scatters/);
  assert.match(prompts[1]!.user, /YOUR PREVIOUS CODE FAILED[\s\S]*attempt 1[\s\S]*NameError: name 'Creat'/);
  assert.deepEqual(out.visuals.map((v) => v.role), ["animation"]);
  assert.equal(out.visuals[0]!.asset.durationMs, 6600);
  assert.equal((ctx.store as MemoryStore).events.at(-1)?.preview?.clipUrl, out.visuals[0]!.asset.url);
});

test("reviewer notes on a rendered scene are fed back, and the best render is kept", async () => {
  const { ctx, prompts } = codeCtx({ render: () => ({ ok: true }), vision: (n) => (n === 1 ? 0.5 : 0.9) });
  const out = await renderSceneAssets(ctx, mathBrief, {} as ScenePlan, codeScene("manim"), codeAudio);
  assert.match(prompts[1]!.user, /a reviewer looking at frames said: the equation runs off the right edge/);
  assert.match(out.visuals[0]!.asset.url, /s2-manim-2\.mp4$/);
});

test("in the math style a 3D scene that never works becomes Manim; Manim that never works uses the safe scene", async () => {
  const { ctx, renders } = codeCtx({ render: (engine, code) => (engine === "manim" && code.includes("Write(title)") ? { ok: true } : { ok: false, error: "boom" }) });
  const out = await renderSceneAssets(ctx, mathBrief, {} as ScenePlan, codeScene("three"), codeAudio);
  assert.deepEqual(renders.map((r) => r.engine), ["three", "three", "three", "manim", "manim", "manim", "manim"]);
  assert.match(renders.at(-1)!.code, /Short waves scatter far more\./, "safe scene shows the key line");
  assert.deepEqual(out.visuals.map((v) => v.role), ["animation"]);
  assert.ok(out.qa.some((q) => q.fallback === "demoted three → manim"));
  assert.ok(out.qa.some((q) => q.fallback === "safe Manim scene"));
});

test("styles offer their own scene types, limited to running engines", () => {
  assert.deepEqual(visualTypesFor("math", ["manim", "three"]), ["manim", "three", "chart", "text"]);
  assert.deepEqual(visualTypesFor("math", ["manim"]), ["manim", "chart", "text"]);
  assert.ok(visualTypesFor("illustrated", ["manim", "three"]).includes("three"));
  assert.ok(!visualTypesFor("illustrated", ["manim", "three"]).includes("manim"));
  assert.ok(!visualTypesFor("illustrated", []).includes("three"));
  assert.equal(fitVisualType("diagram", visualTypesFor("math", ["manim"])), "manim");
  assert.equal(fitVisualType("chart", visualTypesFor("math", ["manim"])), "chart");
  assert.equal(fitVisualType("three", visualTypesFor("illustrated", [])), "still-animated");
  assert.equal(fitVisualType("manim", visualTypesFor("illustrated", ["three"])), "diagram");
  assert.equal(visualTypesFor("illustrated", ["three", "motion"])[0], "motion", "flat motion graphics lead the illustrated menu");
  assert.ok(!visualTypesFor("illustrated", ["three"]).includes("motion"));
  assert.ok(!visualTypesFor("math", ["manim", "motion"]).includes("motion"));
  assert.equal(fitVisualType("manim", visualTypesFor("illustrated", ["motion"])), "motion");
  assert.equal(fitVisualType("presenter", visualTypesFor("illustrated", [])), "still-animated");
});

test("a diagram whose stills are all rejected keeps the best one instead of going blank", async () => {
  const llm = scriptedLLM([]);
  let n = 0;
  llm.vision = async <T,>(a: { schema: z.ZodType<T> }) => a.schema.parse({ matchesDirection: ++n === 1 ? 0.6 : 0.4, styleMatch: 0.8, hasText: n === 2, notes: "labels baked in" });
  const ctx = ctxWith(llm);
  let jobs = 0;
  ctx.hedra = { run: async (model: string) => ({ job_id: `j${++jobs}`, model, status: "COMPLETED", error: null, cost: 0.08, currency: "USD", outputs: [{ status: "COMPLETED", asset_id: `asset_${jobs}`, voice_id: null, url: `https://h/${jobs}`, content_type: "image/jpeg", width: 2048, height: 1152, duration_ms: null, fps: null, error: null }] }) } as any;
  ctx.mirror = { mirror: async (_p: string, o: any) => ({ hedraAssetId: o.asset_id, url: `http://localhost:9000/explainer-assets/${o.asset_id}`, contentType: o.content_type, width: o.width, height: o.height, durationMs: null }) } as any;
  const scene: Scene = { id: "s2", beat: "ground", purpose: "p", narration: "Leaves have three pigments.", claimIds: [], visualDirection: "a leaf cross-section as a layered cake, three pigment layers", visualType: "diagram", targetS: 10, onScreenTerms: [], render: null };
  const audio: SceneAssets["audio"] = { asset: { hedraAssetId: "a", url: "http://localhost:9000/a.mp3", contentType: "audio/mpeg", width: null, height: null, durationMs: 3000, model: "m", costUsd: 0 }, durationS: 3, words: [] };
  const out = await renderSceneAssets(ctx, briefFor(120), {} as ScenePlan, scene, audio);
  assert.equal(out.visuals.length, 1, "not blank");
  assert.match(out.visuals[0]!.asset.url, /asset_1$/, "the attempt without baked-in text wins");
  assert.ok(out.qa.some((q) => q.fallback === "kept the best rejected still"));
});

// ---------------------------------------------------------------------------
// Flat motion graphics (illustrated style)

test("an illustrated motion scene is written as flat motion graphics on the house background", async () => {
  const { ctx, prompts, renders } = codeCtx({ render: () => ({ ok: true }) });
  const out = await renderSceneAssets(ctx, briefFor(120), {} as ScenePlan, codeScene("motion"), codeAudio);
  assert.deepEqual(renders.map((r) => [r.engine, r.background, r.image]), [["motion", "#F6F3EC", undefined]]);
  assert.match(prompts[0]!.system, /2D motion-graphics scene/);
  assert.match(prompts[0]!.system, /\(198 frames\)/, "frame count filled in");
  assert.doesNotMatch(prompts[0]!.system, /OVERLAY MODE/);
  assert.deepEqual(out.visuals.map((v) => v.role), ["animation"]);
  assert.match(out.visuals[0]!.asset.url, /s2-motion-1\.mp4$/);
});

/** A diagram scene with a fake Hedra still and a vision model that also maps the still's parts. */
function diagramCtx(render: () => { ok: true } | { ok: false; error: string }, parts = [{ name: "chloroplast", x0: 0.1, y0: 0.2, x1: 0.3, y1: 0.5 }]) {
  const { ctx, prompts, renders } = codeCtx({ render });
  const layoutCalls: string[] = [];
  ctx.llm.vision = async <T,>(a: { system: string; imageUrls: string[]; schema: z.ZodType<T> }) => {
    if (/List the visually distinct parts/.test(a.system)) {
      layoutCalls.push(a.imageUrls[0]!);
      return a.schema.parse({ parts });
    }
    return a.schema.parse({ matchesDirection: 0.9, styleMatch: 0.9, hasText: false, notes: "ok" });
  };
  ctx.hedra = { run: async (model: string) => ({ job_id: "j1", model, status: "COMPLETED", error: null, cost: 0.08, currency: "USD", outputs: [{ status: "COMPLETED", asset_id: "asset_still", voice_id: null, url: "https://h/1", content_type: "image/png", width: 1920, height: 1080, duration_ms: null, fps: null, error: null }] }) } as any;
  (ctx.mirror as any).mirror = async (_p: string, o: any) => ({ hedraAssetId: o.asset_id, url: `http://localhost:9000/explainer-assets/${o.asset_id}`, contentType: o.content_type, width: o.width, height: o.height, durationMs: null });
  const scene: Scene = { ...codeScene("motion"), visualType: "diagram", visualDirection: "a leaf cell as a factory, chloroplasts as solar panels", onScreenTerms: ["chloroplast"] };
  return { ctx, prompts, renders, layoutCalls, scene };
}

async function withStillFetch<T>(fn: () => Promise<T>): Promise<T> {
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: string) => (String(url).endsWith("asset_still") ? new Response(new Uint8Array([137, 80, 78, 71]), { headers: { "content-type": "image/png" } }) : real(url))) as typeof fetch;
  try {
    return await fn();
  } finally {
    globalThis.fetch = real;
  }
}

test("a diagram's still gets animated callouts: its parts are located, then pointed at as they're mentioned", async () => {
  const { ctx, prompts, renders, layoutCalls, scene } = diagramCtx(() => ({ ok: true }));
  const out = await withStillFetch(() => renderSceneAssets(ctx, briefFor(120), {} as ScenePlan, scene, codeAudio));
  assert.deepEqual(layoutCalls, ["http://localhost:9000/explainer-assets/asset_still"]);
  assert.equal(renders.length, 1);
  assert.equal(renders[0]!.engine, "motion");
  assert.deepEqual([...renders[0]!.image!.data], [137, 80, 78, 71], "the still is sent with the code");
  assert.equal(renders[0]!.image!.type, "image/png");
  assert.match(prompts[0]!.system, /OVERLAY MODE[\s\S]*- chloroplast: \[192, 216, 576, 540\]/, "parts in 1920×1080 pixels");
  assert.deepEqual(out.visuals.map((v) => v.role), ["background", "animation"], "the still stays as a fallback layer");
  assert.match(out.visuals[1]!.asset.url, /s2-overlay-1\.mp4$/);
});

test("a diagram keeps its plain still when the callout code never renders, or the still has no parts", async () => {
  const failing = diagramCtx(() => ({ ok: false, error: "SyntaxError" }));
  const out1 = await withStillFetch(() => renderSceneAssets(failing.ctx, briefFor(120), {} as ScenePlan, failing.scene, codeAudio));
  assert.equal(failing.renders.length, 3);
  assert.deepEqual(out1.visuals.map((v) => v.role), ["background"]);

  const empty = diagramCtx(() => ({ ok: true }), []);
  const out2 = await withStillFetch(() => renderSceneAssets(empty.ctx, briefFor(120), {} as ScenePlan, empty.scene, codeAudio));
  assert.equal(empty.renders.length, 0);
  assert.deepEqual(out2.visuals.map((v) => v.role), ["background"]);
});
