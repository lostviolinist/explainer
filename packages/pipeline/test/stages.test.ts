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
import { visualTypesFor, fitVisualType, balanceTypes } from "../src/stages/script.ts";
import type { Animator, Engine } from "../src/providers/animator.ts";
import { coverPoint } from "../src/stages/visuals.ts";
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
      return a.schema.parse({ matchesDirection: 0.9, styleMatch: 0.9, clarity: 0.9, hasText: false, notes: "ok" });
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
    { projectId: PID, sceneId: "s1", audio: { asset: {} as any, durationS: 21, words: [] }, visuals: [], sounds: [], animSpec: null, qa: [] },
    { projectId: PID, sceneId: "s2", audio: { asset: {} as any, durationS: 36, words: [] }, visuals: [], sounds: [], animSpec: null, qa: [] },
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
    return a.schema.parse({ matchesDirection: 0.9, styleMatch: 0.9, clarity: 0.9, hasText: false, notes: "ok" });
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
  const visionPrompts: string[] = [];
  const renders: { engine: Engine; code: string; durationS: number; background: string }[] = [];
  let visionCalls = 0;
  const llm: LLM = {
    async json<T>(a: { system: string; user: string; schema: z.ZodType<T> }) {
      prompts.push({ system: a.system, user: a.user });
      return a.schema.parse({ code: `class GeneratedScene(Scene):\n    # attempt ${prompts.length}\n    def construct(self): pass`, sounds: [{ at: 2.5, kind: "pop" }, { at: 0.5, kind: "whoosh" }, { at: 0.7, kind: "tick" }, { at: 99, kind: "chime" }] });
    },
    async vision<T>(a: { system: string; schema: z.ZodType<T> }) {
      visionPrompts.push(a.system);
      const q = opts.vision?.(++visionCalls) ?? 0.9;
      return a.schema.parse({ matchesDirection: q, styleMatch: q, clarity: q, hasText: true, notes: q < 0.7 ? "the equation runs off the right edge" : "ok" });
    },
  };
  const ctx = ctxWith(llm);
  ctx.animator = {
    available: async () => ["manim", "three"],
    render: async (engine, code, durationS, background) => {
      renders.push({ engine, code, durationS, background });
      const r = opts.render(engine, code, durationS);
      return r.ok ? { ok: true, video: new Uint8Array([1, 2, 3]) } : r;
    },
  } satisfies Animator;
  ctx.mirror = { put: async (_p: string, name: string, bytes: Uint8Array, contentType: string, meta: any) => ({ hedraAssetId: `local:${name}`, url: `http://localhost:9000/explainer-assets/${name}`, contentType, width: 1920, height: 1080, durationMs: meta.durationMs, bytes: bytes.length }) } as any;
  ctx.frames = { sample: async () => ["data:image/jpeg;base64,AAA", "data:image/jpeg;base64,AAA", "data:image/jpeg;base64,AAA"] };
  return { ctx, prompts, renders, visionPrompts };
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

test("styles offer their own scene types: the Illustrated menu needs no sandbox, the math menu needs Manim", () => {
  assert.deepEqual(visualTypesFor("math", ["manim", "three"]), ["manim", "three", "chart", "text"]);
  assert.deepEqual(visualTypesFor("math", ["manim"]), ["manim", "chart", "text"]);
  assert.deepEqual(visualTypesFor("illustrated", []), ["motion", "diagram", "chart", "text", "still-animated", "clip", "reference-seq"]);
  assert.deepEqual(visualTypesFor("illustrated", ["manim", "three"]), visualTypesFor("illustrated", []), "sandboxes change nothing for the Illustrated style");
  assert.equal(fitVisualType("diagram", visualTypesFor("math", ["manim"])), "manim");
  assert.equal(fitVisualType("chart", visualTypesFor("math", ["manim"])), "chart");
  assert.equal(fitVisualType("three", visualTypesFor("illustrated", [])), "motion", "a 3D wish becomes motion graphics");
  assert.equal(fitVisualType("manim", visualTypesFor("illustrated", [])), "motion");
  assert.equal(fitVisualType("presenter", visualTypesFor("illustrated", [])), "still-animated");
});

test("a diagram whose stills are all rejected keeps the best one instead of going blank", async () => {
  const llm = scriptedLLM([]);
  let n = 0;
  llm.vision = async <T,>(a: { schema: z.ZodType<T> }) => a.schema.parse({ matchesDirection: ++n === 1 ? 0.6 : 0.4, styleMatch: 0.8, clarity: 0.8, hasText: n === 2, notes: "labels baked in" });
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
// Templates (illustrated style): planned by the model, drawn by the composition

const motionScene: Scene = { ...codeScene("motion"), visualDirection: "the sun warms the ground, warm air rises, cools into cloud, rain falls", narration: "First the sun warms the ground. Then warm air rises. It cools into cloud, and rain falls." };

/** A fake Hedra that draws one still, and a mirror that keeps it. */
function withStill(ctx: Ctx) {
  ctx.hedra = { run: async (model: string) => ({ job_id: "j1", model, status: "COMPLETED", error: null, cost: 0.08, currency: "USD", outputs: [{ status: "COMPLETED", asset_id: "asset_subject", voice_id: null, url: "https://h/subject", content_type: "image/png", width: 1024, height: 1536, duration_ms: null, fps: null, error: null }] }) } as any;
  ctx.mirror = { mirror: async (_p: string, o: any) => ({ hedraAssetId: o.asset_id, url: `http://localhost:9000/explainer-assets/${o.asset_id}`, contentType: o.content_type, width: o.width, height: o.height, durationMs: null }) } as any;
  return ctx;
}

test("an illustrated motion scene is a template the model fills in, beside a picture of its subject; no sandbox, no review loop", async () => {
  const steps = { kind: "steps", title: "How rain happens", cycle: false, steps: [{ label: "Sun warms ground", sub: null, icon: "sun", cue: "sun" }, { label: "Air rises", sub: null, icon: "cloud", cue: "rises" }, { label: "Rain falls", sub: null, icon: "drop", cue: "rain" }] };
  const llm = scriptedLLM([[/choosing a template/, { animSpec: steps, hedraPrompt: "Flat vector illustration, detailed. The sun over a field. No text, no labels." }]]);
  const ctx = withStill(ctxWith(llm));
  const render = await planScene(ctx, briefFor(120), motionScene, [{ name: "the sun", look: "a yellow disc", color: "#F2C14E" }]);
  assert.deepEqual(render.animSpec, steps);
  assert.match(render.hedraPrompt!, /^Flat vector illustration/);
  assert.equal(render.referenceAssetIds.length, 1, "the house reference frame goes with the picture");
  assert.match((llm as any).calls[0], /You plan one scene/);

  const out = await renderSceneAssets(ctx, briefFor(120), {} as ScenePlan, { ...motionScene, render }, codeAudio);
  assert.deepEqual(out.visuals.map((v) => [v.role, v.asset.url]), [["still", "http://localhost:9000/explainer-assets/asset_subject"]], "the subject picture, nothing else");
  assert.equal(out.animSpec, null, "the plan's spec is the final spec");
  assert.ok(out.qa.some((q) => q.passed && q.notes === "template: steps"));
  assert.equal((ctx.store as MemoryStore).events.at(-1)?.message, "built scene 2 (steps)");
});

test("a split fills the frame on its own: no picture is drawn for it", async () => {
  const split = { kind: "split", left: { heading: "Myth", text: "Cold turns leaves red", icon: null, cue: "Short" }, right: { heading: "Fact", text: "Sugar does", icon: null, cue: "Blue" }, winner: "right", verdictCue: null };
  const llm = scriptedLLM([[/choosing a template/, { animSpec: split, hedraPrompt: "Flat vector illustration, detailed. A leaf. No text, no labels." }]]);
  const ctx = withStill(ctxWith(llm));
  ctx.hedra = { run: async () => { throw new Error("no picture should be asked for"); } } as any;
  const render = await planScene(ctx, briefFor(120), motionScene);
  assert.equal(render.hedraPrompt, null);
  const out = await renderSceneAssets(ctx, briefFor(120), {} as ScenePlan, { ...motionScene, render }, codeAudio);
  assert.deepEqual(out.visuals, []);
});

test("the Illustrated plan is kept illustrated: the hook is a picture, text is for the recap, a third are pictures", () => {
  const mk = (id: string, visualType: Scene["visualType"], beat: Scene["beat"] = "core"): Scene => ({ ...codeScene("motion"), id, beat, visualType });
  const slides = balanceTypes([mk("s1", "motion", "hook"), mk("s2", "text"), mk("s3", "motion"), mk("s4", "motion"), mk("s5", "text"), mk("s6", "text", "recap")]);
  assert.deepEqual(slides.map((s) => s.visualType), ["still-animated", "still-animated", "motion", "motion", "still-animated", "text"], "hook and extra text scenes become pictures; the recap keeps its points");
  const allMotion = balanceTypes([mk("s1", "motion", "hook"), mk("s2", "motion"), mk("s3", "motion"), mk("s4", "motion"), mk("s5", "motion"), mk("s6", "motion"), mk("s7", "motion")]);
  assert.deepEqual(allMotion.map((s) => s.visualType), ["still-animated", "still-animated", "still-animated", "motion", "motion", "motion", "motion"], "a third are pictures, from the front, the last scene kept");
  const fine = balanceTypes([mk("s1", "clip", "hook"), mk("s2", "motion"), mk("s3", "diagram"), mk("s4", "motion"), mk("s5", "text", "recap")]);
  assert.deepEqual(fine.map((s) => s.visualType), ["clip", "motion", "diagram", "motion", "text"], "a balanced plan is left alone");
  const numbers = balanceTypes([mk("s1", "motion", "hook"), mk("s2", "motion"), mk("s3", "motion")]);
  assert.deepEqual(numbers.map((s) => s.visualType), ["still-animated", "motion", "motion"], "the hook alone meets a third");
});

test("a template the planner gets wrong is rejected by the schema, not drawn", async () => {
  const llm = scriptedLLM([[/choosing a template/, { animSpec: { kind: "steps", title: null, cycle: false, steps: [{ label: "only one", sub: null, icon: "sun", cue: "sun" }] }, hedraPrompt: "Flat vector illustration, detailed. The sun. No text, no labels." }]]);
  await assert.rejects(planScene(ctxWith(llm), briefFor(120), motionScene), /too_small|at least 2/i);
  const bad = scriptedLLM([[/choosing a template/, { animSpec: { kind: "count", value: 71, unit: "%", label: "of the surface", cue: "Seventy", outOf: 100, comparison: { text: "two oceans", icon: "octopus", cue: "two" } }, hedraPrompt: "Flat vector illustration, detailed. The sea. No text, no labels." }]]);
  await assert.rejects(planScene(ctxWith(bad), briefFor(120), motionScene), /octopus|invalid_enum/i);
});

test("chart and text scenes are templates too, with the claim id kept to the scene's claims", async () => {
  const llm = scriptedLLM([
    [/bar chart/, { animSpec: { kind: "chart", title: "Scattering", unit: "×", series: [{ label: "Blue", value: 5, cue: "Blue" }, { label: "Red", value: 1, cue: "red" }], claimId: "c9" } }],
    [/key points/, { animSpec: { kind: "points", title: null, points: [{ text: "Short waves scatter most", icon: "wave", cue: "Short" }] } }],
  ]);
  const ctx = ctxWith(llm);
  const chart = await planScene(ctx, briefFor(120), { ...codeScene("motion"), visualType: "chart", claimIds: ["c1"] });
  assert.equal(chart.animSpec.kind, "chart");
  assert.equal((chart.animSpec as any).claimId, "c1", "a claim id the scene doesn't cite is replaced");
  const text = await planScene(ctx, briefFor(120), { ...codeScene("motion"), visualType: "text" });
  assert.equal(text.animSpec.kind, "points");
});

/** A diagram scene with a fake Hedra still and a vision model that also locates the still's parts. */
function diagramCtx(parts: { label: string; x: number | null; y: number | null }[] | Error, size: { width: number; height: number } = { width: 1920, height: 1080 }) {
  const llm = scriptedLLM([[/You write generation prompts/, { hedraPrompt: "Flat vector illustration, detailed. A leaf cell as a factory. No text, no labels.", callouts: [{ label: "chloroplast", cue: "chloroplasts" }, { label: "cell wall", cue: "wall" }] }]]);
  const locateCalls: { user: string; url: string }[] = [];
  llm.vision = async <T,>(a: { system: string; user: string; imageUrls: string[]; schema: z.ZodType<T> }) => {
    if (/Locate the named parts/.test(a.system)) {
      locateCalls.push({ user: a.user, url: a.imageUrls[0]! });
      if (parts instanceof Error) throw parts;
      return a.schema.parse({ parts });
    }
    return a.schema.parse({ matchesDirection: 0.9, styleMatch: 0.9, clarity: 0.9, hasText: false, notes: "ok" });
  };
  const ctx = ctxWith(llm);
  ctx.hedra = { run: async (model: string) => ({ job_id: "j1", model, status: "COMPLETED", error: null, cost: 0.08, currency: "USD", outputs: [{ status: "COMPLETED", asset_id: "asset_still", voice_id: null, url: "https://h/1", content_type: "image/png", width: size.width, height: size.height, duration_ms: null, fps: null, error: null }] }) } as any;
  ctx.mirror = { mirror: async (_p: string, o: any) => ({ hedraAssetId: o.asset_id, url: `http://localhost:9000/explainer-assets/${o.asset_id}`, contentType: o.content_type, width: o.width, height: o.height, durationMs: null }) } as any;
  const scene: Scene = { ...codeScene("motion"), visualType: "diagram", narration: "Inside, chloroplasts catch the light. The cell wall holds it all.", visualDirection: "a leaf cell as a factory, chloroplasts as solar panels", onScreenTerms: ["chloroplast"] };
  return { ctx, locateCalls, scene };
}

test("a diagram's callouts are planned with the picture, then located on the still and mapped into the frame", async () => {
  const { ctx, locateCalls, scene } = diagramCtx([{ label: "Chloroplast", x: 0.25, y: 0.5 }, { label: "cell wall", x: null, y: null }], { width: 1536, height: 1024 });
  const render = await planScene(ctx, briefFor(120), scene);
  assert.equal(render.animSpec.kind, "reveal");
  assert.deepEqual((render.animSpec as any).items, [{ label: "chloroplast", cue: "chloroplasts", x: null, y: null }, { label: "cell wall", cue: "wall", x: null, y: null }]);
  assert.match(render.hedraPrompt!, /^Flat vector illustration/);

  const out = await renderSceneAssets(ctx, briefFor(120), {} as ScenePlan, { ...scene, render }, codeAudio);
  assert.deepEqual(locateCalls.map((c) => c.url), ["http://localhost:9000/explainer-assets/asset_still"]);
  assert.match(locateCalls[0]!.user, /Parts: chloroplast; cell wall/);
  assert.deepEqual(out.visuals.map((v) => v.role), ["background"]);
  assert.equal(out.animSpec?.kind, "reveal");
  const items = (out.animSpec as any).items;
  // A 3:2 still is cover-fitted into 16:9: x maps straight, y is cropped top and bottom.
  assert.deepEqual(items[0], { label: "chloroplast", cue: "chloroplasts", ...coverPoint(0.25, 0.5, 1536, 1024) });
  assert.equal(items[0].x, 0.25);
  assert.equal(items[0].y, 0.5);
  assert.deepEqual(items[1], { label: "cell wall", cue: "wall", x: null, y: null }, "an unfound part stays unplaced");
  assert.ok(out.qa.some((q) => q.notes === "1 of 2 callouts located"));
});

test("cover-fitting maps image points into the frame", () => {
  assert.deepEqual(coverPoint(0.5, 0.5, 1536, 1024), { x: 0.5, y: 0.5 });
  // A 3:2 image scaled to 1920 wide is 1280 tall: 100 px are cropped top and bottom.
  assert.deepEqual(coverPoint(0, 0, 1536, 1024), { x: 0.02, y: 0.02 });
  assert.deepEqual(coverPoint(0.5, 0.25, 1536, 1024), { x: 0.5, y: +((-100 + 0.25 * 1280) / 1080).toFixed(4) });
  // A square image fills the width and is cropped top and bottom; a point on its left edge sits on the frame's.
  assert.deepEqual(coverPoint(0, 0.5, 1000, 1000), { x: 0.02, y: 0.5 });
  assert.deepEqual(coverPoint(0.5, 0.25, 1000, 1000), { x: 0.5, y: +((-420 + 0.25 * 1920) / 1080).toFixed(4) });
  assert.deepEqual(coverPoint(0.3, 0.7, null, null), { x: 0.3, y: 0.7 });
});

test("when the parts can't be located the callouts stack beside the picture, and the still stays", async () => {
  const { ctx, scene } = diagramCtx(new Error("vision down"));
  const render = await planScene(ctx, briefFor(120), scene);
  const out = await renderSceneAssets(ctx, briefFor(120), {} as ScenePlan, { ...scene, render }, codeAudio);
  assert.deepEqual(out.visuals.map((v) => v.role), ["background"]);
  assert.equal(out.animSpec, null, "the plan's spec (no positions) is used as is");
  assert.ok(out.qa.some((q) => q.fallback === "callouts listed beside the picture"));
});

test("a code scene in an Illustrated plan is not drawn as code", async () => {
  const { ctx, renders } = codeCtx({ render: () => ({ ok: true }) });
  ctx.llm.json = async <T,>(a: { schema: z.ZodType<T> }) => a.schema.parse({ hedraPrompt: "Flat vector illustration, detailed. A sun. No text, no labels." });
  ctx.hedra = { run: async () => { throw new Error("stop here"); } } as any;
  await assert.rejects(renderSceneAssets(ctx, briefFor(120), {} as ScenePlan, codeScene("three"), codeAudio), /stop here/);
  assert.equal(renders.length, 0, "the sandbox is never asked");
});
