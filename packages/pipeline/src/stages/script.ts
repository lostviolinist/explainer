/**
 * Stage 3 — Learning arc and script, with self-review in place of user review.
 *
 *   arc (7 beats) → scenes (narration, visual direction, claim ids)
 *   → learner pass (can a novice follow it and meet the goal?)
 *   → expert pass (is every sentence sourced and not overstated?)
 *   Two consecutive failures → simpler arc (fewer claims, longer explanations).
 *
 * Length cap: the finished video must fit maxVideoSeconds() (3 min by default).
 * The script's word count predicts it before any media is generated; a draft
 * that runs over is sent back with the numbers, and the last resort trims
 * sentences from the middle scenes.
 */
import { z } from "zod";
import { ScenePlan, Scene, Beat, VisualType, VIDEO_TIMING, lengthFromClaims, type Brief, type ResearchBrief } from "@explainer/schemas";
import type { Ctx } from "../context.js";
import { makeProgress, maxVideoSeconds } from "../context.js";

export const Arc = z.object({
  beats: z.array(
    z.object({
      beat: Beat,
      purpose: z.string(),
      claimIds: z.array(z.string()),
      targetS: z.number(),
    }),
  ),
});

export const Scenes = z.object({
  scenes: z.array(
    z.object({
      beat: Beat,
      purpose: z.string(),
      narration: z.string(),
      claimIds: z.array(z.string()),
      visualDirection: z.string(),
      visualType: VisualType,
      targetS: z.number(),
      onScreenTerms: z.array(z.string()),
    }),
  ).min(3, "write at least 3 scenes"),
});

export const LearnerPass = z.object({
  goalAnswer: z.string(),
  unclearSentences: z.array(z.string()),
  couldMeetGoal: z.boolean(),
});

export const ExpertPass = z.object({
  unsourced: z.array(z.string()),
  overstated: z.array(z.string()),
});

/** Aim a little under the cap: real narration runs a few percent off the words-per-minute estimate. */
const LENGTH_MARGIN = 0.95;

const countWords = (s: string) => s.split(/\s+/).filter(Boolean).length;
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

/** Predicted length of the rendered video: narration at the house pace, plus scene pauses and the end card. */
export function estimateVideoS(scenes: Pick<Scene, "narration">[], wordsPerMinute: number): number {
  return scenes.reduce((t, s) => t + (countWords(s.narration) / wordsPerMinute) * 60 + VIDEO_TIMING.sceneTailS, 0) + VIDEO_TIMING.endCardS;
}

/**
 * Last resort when rewrites still run long: drop closing sentences from the longest
 * middle scenes (never the hook or recap), then whole middle scenes, until it fits.
 */
export function trimToFit(scenes: Scene[], limitS: number, wordsPerMinute: number): Scene[] {
  let out = scenes.map((s) => ({ ...s }));
  const sentences = (t: string) => t.match(/[^.!?]+[.!?]+["')\]]*/g)?.map((x) => x.trim()) ?? [t];
  const longestMiddle = (pred: (s: Scene) => boolean) =>
    out.slice(1, -1).filter(pred).sort((a, b) => countWords(b.narration) - countWords(a.narration))[0];
  while (estimateVideoS(out, wordsPerMinute) > limitS) {
    const s = longestMiddle((x) => sentences(x.narration).length > 1);
    if (s) {
      s.narration = sentences(s.narration).slice(0, -1).join(" ");
      continue;
    }
    const victim = out.length > 3 ? longestMiddle(() => true) : undefined;
    if (!victim) break;
    out = out.filter((x) => x !== victim);
  }
  return out.map((s, i) => ({ ...s, id: `s${i + 1}` }));
}

const TYPE_DESCRIPTIONS: Record<string, string> = {
  diagram: "diagram (systems, labelled parts)",
  chart: "chart (numbers from a claim)",
  text: "text (key terms, recap)",
  "still-animated": 'still-animated (metaphors, "imagine a…", historical scenes)',
  clip: "clip (establishing shots, nature, demonstrations)",
  "reference-seq": "reference-seq (a recurring character)",
  manim: "manim (the 3Blue1Brown look: equations, graphs, geometry, arrows, step-by-step derivations; the default in this style)",
  three: "three (a 3D animated model: orbits, molecules, light paths, anything spatial that reads better in 3D)",
};

/** Scene types on offer: by style, and only the animation engines that are running. */
export function visualTypesFor(style: Brief["style"], engines: string[]): Scene["visualType"][] {
  const three = engines.includes("three") ? (["three"] as const) : [];
  if (style === "math" && engines.includes("manim")) return ["manim", ...three, "chart", "text"];
  return ["diagram", "chart", "text", "still-animated", "clip", "reference-seq", ...three];
}

/** Off-menu choices map to the closest type on offer. */
export function fitVisualType(t: Scene["visualType"], offered: Scene["visualType"][]): Scene["visualType"] {
  if (offered.includes(t)) return t;
  if (offered.includes("manim")) return t === "chart" || t === "text" ? t : "manim";
  return t === "manim" ? "diagram" : "still-animated";
}

const LEVEL_WORDS: Record<Brief["level"], string> = {
  nothing: "someone with no background at all; every term is introduced before it is used",
  basics: "someone who knows the everyday basics; technical terms are fine once defined",
  deep: "someone who knows the subject and wants the mechanism; skip the preliminaries",
};

export async function script(ctx: Ctx, brief: Brief, research: ResearchBrief): Promise<ScenePlan> {
  const progress = makeProgress(ctx, brief.projectId, "script");
  const maxS = maxVideoSeconds();
  const lengthS = Math.min(brief.lengthS ?? 180, maxS);
  const [minScenes, maxScenes] = brief.sceneRange ?? [4, 9];
  const wpm = ctx.style.voice.wordsPerMinute;
  // Narration that fits the cap once scene pauses and the end card are added.
  const limitS = maxS * LENGTH_MARGIN;
  const wordLimit = Math.floor(((limitS - VIDEO_TIMING.endCardS - maxScenes * VIDEO_TIMING.sceneTailS) / 60) * wpm);
  const wordBudget = Math.min(brief.wordBudget ?? wordLimit, wordLimit);
  const condensed = lengthFromClaims(research.neededClaimCount) > lengthS;
  const offered = visualTypesFor(brief.style, await ctx.animator.available());

  const usable = research.claims.filter((c) => c.confidence !== "contested" || c.type === "history");
  const claimList = usable.map((c) => `${c.id} (${c.type}, ${c.fit}, ${c.confidence}): ${c.text}`).join("\n");
  const misconceptions = research.misconceptions.map((m) => `- "${m.belief}" → corrected by ${m.correctsWith.join(", ")}`).join("\n");
  const analogies = research.analogies.map((a) => `- ${a.text} (explains ${a.explains.join(", ")}; breaks down: ${a.breaksDown})`).join("\n");

  let simplify = 0;
  let lengthNote = "";
  let lastPlan: ScenePlan | null = null;

  for (let attempt = 1; attempt <= 3; attempt++) {
    await progress(
      attempt === 1 ? "planning the story" : lengthNote ? `shortening the script to fit ${clock(maxS)}` : "rewriting the parts a learner couldn't follow",
      0.1 + 0.2 * (attempt - 1),
    );

    const arc = await ctx.llm.json({
      system: `Plan a ${Math.round(lengthS / 60)}-minute explainer as exactly seven beats in this order: hook, ground, misconception, build-up, core, payoff, recap.
Audience: ${LEVEL_WORDS[brief.level]}. Tone: ${brief.tone}.${brief.ageMode ? ` Age mode: ${brief.ageMode}.` : ""}
Assign claim ids to beats; use every "needed" claim, "nice" claims as time allows, and no "advanced" claims${brief.level === "deep" ? " unless they serve the goal" : ""}.
${condensed ? `The research holds more than fits in ${clock(lengthS)}. Keep only what the learner needs to meet the goal: every "needed" claim that serves it, explained simply; skip "nice" and "advanced" detail rather than rushing through it.` : ""}
${simplify ? `SIMPLIFY (round ${simplify}): use fewer claims and give each more time; drop "nice" claims first.` : ""}
Beat durations sum to ${lengthS} s; the whole video must not exceed ${clock(maxS)}.`,
      user: `Learning goal: ${brief.learningGoal}\n\nClaims:\n${claimList}\n\nMisconceptions:\n${misconceptions}\n\nAnalogies:\n${analogies}`,
      schema: Arc,
      maxTokens: 2500,
    });

    const { scenes } = await ctx.llm.json({
      system: `Write the scenes for this arc. ${minScenes}–${maxScenes} scenes, 20–40 s each, ${wordBudget} words of narration in total (hard limit), spoken at about ${ctx.style.voice.wordsPerMinute} words per minute.
Each scene has three tracks:
- narration: what is said. Short sentences. Every sentence maps to a claim id in claimIds. Introduce a term before using it. The hook is a question or a surprising fact; the recap restates the goal in one breath.
- visualDirection: what is seen. It MUST name the scene's metaphor and at least two supporting details, never only the objects (good: "an eye as the observer, a dotted ring for the horizon, ghost stars where the light seems to come from"; bad: "a black hole and a star").
- visualType, one of: ${offered.map((t) => TYPE_DESCRIPTIONS[t]).join("; ")}.
Rules: one idea per scene; name a thing before showing its label; a misconception is stated, then corrected; the recap uses the exact words of the learning goal.
onScreenTerms: words that will appear as labels; must appear in the narration.
Tone: ${brief.tone}. Audience: ${LEVEL_WORDS[brief.level]}.${lengthNote ? `\nLENGTH: ${lengthNote}` : ""}`,
      user: `Arc:\n${JSON.stringify(arc.beats, null, 1)}\n\nClaims:\n${claimList}\n\nAnalogies:\n${analogies}`,
      schema: Scenes,
      maxTokens: 6000,
    });

    let planScenes: Scene[] = scenes.map((s, i) =>
      Scene.parse({
        ...s,
        id: `s${i + 1}`,
        // Only types on offer for this style and the running engines; Scene allows 5–45 s.
        visualType: fitVisualType(s.visualType, offered),
        targetS: Math.min(45, Math.max(5, s.targetS)),
        render: null,
      }),
    );

    // Length check, before any media is paid for. Over the cap → rewrite shorter (no review of the long draft).
    const estS = estimateVideoS(planScenes, wpm);
    if (estS > limitS) {
      const words = planScenes.reduce((n, s) => n + countWords(s.narration), 0);
      if (attempt < 3) {
        lengthNote = `Your previous draft had ${words} words of narration (about ${clock(estS)} of video). The hard limit is ${wordLimit} words, so the video stays under ${clock(maxS)}. Cut to what the learner needs to meet the goal: merge or drop scenes, drop nice-to-have detail, keep sentences short. Simpler beats faster.`;
        simplify++;
        continue;
      }
      planScenes = trimToFit(planScenes, limitS, wpm);
    }
    const narration = planScenes.map((s) => s.narration).join("\n\n");

    await progress("checking a learner could follow it", 0.6 + 0.1 * (attempt - 1));
    const learner = await ctx.llm.json({
      system: `You are ${LEVEL_WORDS[brief.level]}. You will hear the narration below once, with pictures. Afterwards, answer the learning goal in your own words. List verbatim any sentence you could not follow or any term used before it was explained. Be honest; this is a test of the script, not of you.`,
      user: `Learning goal: ${brief.learningGoal}\n\nNarration:\n${narration}`,
      schema: LearnerPass,
      maxTokens: 1500,
    });

    const expert = await ctx.llm.json({
      system: `You are a careful subject expert with the research notes. For each narrated sentence, check it against the claims it cites. List verbatim: (a) sentences with no supporting claim, (b) sentences stated more confidently than their claim's confidence allows (a "single" claim stated as fact; a hedged source stated flatly).`,
      user: `Claims:\n${claimList}\n\nScenes:\n${planScenes.map((s) => `[${s.id} → ${s.claimIds.join(",")}] ${s.narration}`).join("\n")}`,
      schema: ExpertPass,
      maxTokens: 1500,
    });

    const learnerPassed = learner.couldMeetGoal && learner.unclearSentences.length === 0;
    const expertPassed = expert.unsourced.length === 0 && expert.overstated.length === 0;

    lastPlan = ScenePlan.parse({
      projectId: brief.projectId,
      background: brief.background,
      scenes: planScenes,
      review: {
        learnerPass: { passed: learnerPassed, goalAnswer: learner.goalAnswer, unclearSentences: learner.unclearSentences },
        expertPass: { passed: expertPassed, unsourced: expert.unsourced, overstated: expert.overstated },
        attempts: attempt,
      },
    });

    if (learnerPassed && expertPassed) break;
    if (attempt >= 2) simplify++;
  }

  await ctx.store.savePlan(lastPlan!);
  await progress("script ready", 1, { hookLine: lastPlan!.scenes[0]?.narration.split(/(?<=[.?!])\s/)[0] });
  return lastPlan!;
}
