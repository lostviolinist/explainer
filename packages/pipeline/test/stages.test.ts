import { test } from "node:test";
import assert from "node:assert/strict";
import type { z } from "zod";
import { MemoryStore } from "../src/providers/store.ts";
import { loadHouseStyle, type Ctx } from "../src/context.ts";
import { intake } from "../src/stages/intake.ts";
import { script } from "../src/stages/script.ts";
import { pacingCheck } from "../src/stages/assemble.ts";
import { evenSplit, rescale } from "../src/providers/alignment.ts";
import type { LLM } from "../src/providers/llm.ts";
import type { ResearchBrief, SceneAssets } from "@explainer/schemas";

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
    aligner: { align: async (_u: string, t: string) => ({ words: evenSplit(t, 1), exact: false }) },
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
    [/Write the scenes/, { scenes }],
    [/You will hear the narration/, { goalAnswer: "chlorophyll breaks down and other pigments show", unclearSentences: [], couldMeetGoal: true }],
    [/careful subject expert/, { unsourced: [], overstated: [] }],
  ]);
  const ctx = ctxWith(llm);
  const brief = { projectId: PID, question: "q", topic: "t", learningGoal: "After watching, the viewer can explain it", level: "basics" as const, ageMode: null, tone: "neutral" as const, background: "light" as const, lengthS: 120, wordBudget: 330, sceneRange: [3, 6] as [number, number], statement: "s", derivedFrom: null };
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
