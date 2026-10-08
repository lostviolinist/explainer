/**
 * Stage 3 — Learning arc and script, with self-review in place of user review.
 *
 *   arc (7 beats) → scenes (narration, visual direction, claim ids)
 *   → learner pass (can a novice follow it and meet the goal?)
 *   → expert pass (is every sentence sourced and not overstated?)
 *   Two consecutive failures → simpler arc (fewer claims, longer explanations).
 */
import { z } from "zod";
import { ScenePlan, Scene, Beat, VisualType, type Brief, type ResearchBrief } from "@explainer/schemas";
import type { Ctx } from "../context.js";
import { makeProgress } from "../context.js";

const Arc = z.object({
  beats: z.array(
    z.object({
      beat: Beat,
      purpose: z.string(),
      claimIds: z.array(z.string()),
      targetS: z.number(),
    }),
  ),
});

const Scenes = z.object({
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
  ),
});

const LearnerPass = z.object({
  goalAnswer: z.string(),
  unclearSentences: z.array(z.string()),
  couldMeetGoal: z.boolean(),
});

const ExpertPass = z.object({
  unsourced: z.array(z.string()),
  overstated: z.array(z.string()),
});

const LEVEL_WORDS: Record<Brief["level"], string> = {
  nothing: "someone with no background at all; every term is introduced before it is used",
  basics: "someone who knows the everyday basics; technical terms are fine once defined",
  deep: "someone who knows the subject and wants the mechanism; skip the preliminaries",
};

export async function script(ctx: Ctx, brief: Brief, research: ResearchBrief): Promise<ScenePlan> {
  const progress = makeProgress(ctx, brief.projectId, "script");
  const lengthS = brief.lengthS ?? 180;
  const wordBudget = brief.wordBudget ?? 495;
  const [minScenes, maxScenes] = brief.sceneRange ?? [4, 9];

  const usable = research.claims.filter((c) => c.confidence !== "contested" || c.type === "history");
  const claimList = usable.map((c) => `${c.id} (${c.type}, ${c.fit}, ${c.confidence}): ${c.text}`).join("\n");
  const misconceptions = research.misconceptions.map((m) => `- "${m.belief}" → corrected by ${m.correctsWith.join(", ")}`).join("\n");
  const analogies = research.analogies.map((a) => `- ${a.text} (explains ${a.explains.join(", ")}; breaks down: ${a.breaksDown})`).join("\n");

  let simplify = 0;
  let lastPlan: ScenePlan | null = null;

  for (let attempt = 1; attempt <= 3; attempt++) {
    await progress(attempt === 1 ? "planning the story" : "rewriting the parts a learner couldn't follow", 0.1 + 0.2 * (attempt - 1));

    const arc = await ctx.llm.json({
      system: `Plan a ${Math.round(lengthS / 60)}-minute explainer as exactly seven beats in this order: hook, ground, misconception, build-up, core, payoff, recap.
Audience: ${LEVEL_WORDS[brief.level]}. Tone: ${brief.tone}.${brief.ageMode ? ` Age mode: ${brief.ageMode}.` : ""}
Assign claim ids to beats; use every "needed" claim, "nice" claims as time allows, and no "advanced" claims${brief.level === "deep" ? " unless they serve the goal" : ""}.
${simplify ? `SIMPLIFY (round ${simplify}): use fewer claims and give each more time; drop "nice" claims first.` : ""}
Beat durations sum to ${lengthS} s.`,
      user: `Learning goal: ${brief.learningGoal}\n\nClaims:\n${claimList}\n\nMisconceptions:\n${misconceptions}\n\nAnalogies:\n${analogies}`,
      schema: Arc,
      maxTokens: 2500,
    });

    const { scenes } = await ctx.llm.json({
      system: `Write the scenes for this arc. ${minScenes}–${maxScenes} scenes, 20–40 s each, ${wordBudget} words of narration in total (hard limit), spoken at about ${ctx.style.voice.wordsPerMinute} words per minute.
Each scene has three tracks:
- narration: what is said. Short sentences. Every sentence maps to a claim id in claimIds. Introduce a term before using it. The hook is a question or a surprising fact; the recap restates the goal in one breath.
- visualDirection: what is seen. It MUST name the scene's metaphor and at least two supporting details, never only the objects (good: "an eye as the observer, a dotted ring for the horizon, ghost stars where the light seems to come from"; bad: "a black hole and a star").
- visualType: diagram (systems, labelled parts), chart (numbers from a claim), text (key terms, recap), still-animated (metaphors, "imagine a…", historical scenes), clip (establishing shots, nature, demonstrations), reference-seq (a recurring character), presenter (never in v1).
Rules: one idea per scene; name a thing before showing its label; a misconception is stated, then corrected; the recap uses the exact words of the learning goal.
onScreenTerms: words that will appear as labels; must appear in the narration.
Tone: ${brief.tone}. Audience: ${LEVEL_WORDS[brief.level]}.`,
      user: `Arc:\n${JSON.stringify(arc.beats, null, 1)}\n\nClaims:\n${claimList}\n\nAnalogies:\n${analogies}`,
      schema: Scenes,
      maxTokens: 6000,
    });

    const planScenes: Scene[] = scenes.map((s, i) => Scene.parse({ ...s, id: `s${i + 1}`, render: null }));
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
