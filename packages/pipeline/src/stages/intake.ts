/**
 * Stage 1 — Infer the brief from the question alone. Never shown for approval.
 * Length is left null; the research stage sets it from the needed-claim count.
 */
import { z } from "zod";
import { Brief, Level, Tone, Background } from "@explainer/schemas";
import type { Ctx } from "../context.js";

const Inferred = z.object({
  topic: z.string(),
  learningGoal: z.string(),
  level: Level,
  ageMode: z.enum(["8-12", "teen"]).nullable(),
  tone: Tone,
  background: Background,
  statement: z.string(),
});

export interface IntakeInput {
  projectId: string;
  question: string;
  /** From the user's library: what level they've watched before, which reactions they pressed. */
  history?: { level?: z.infer<typeof Level>; pressedSimpler?: number; pressedDeeper?: number };
  derivedFrom?: Brief["derivedFrom"];
}

const SYSTEM = `You turn a learner's question or topic into a brief for a short animated explainer video.
You infer everything; nothing is asked of the learner.

Rules:
- A question ("why…", "how does…") becomes the learning goal directly. A bare topic gets the angle most people actually wonder about.
- level: "nothing" if the wording suggests no background; "basics" by default; "deep" only if the question uses the field's jargon correctly or asks a second-order "why".
- ageMode: only from explicit cues ("for my 9-year-old"); otherwise null.
- tone: history → documentary; physics/biology/process → neutral; "why is X weird/funny" → playful; medicine/law/finance/grief → serious.
- background: "dark" for space, physics, anything luminous or microscopic in the dark; "light" otherwise.
- learningGoal starts "After watching, the viewer can…".
- statement is one paragraph of intent: "A 3-minute neutral explainer on X, for someone who Y, so they can Z." Use "3-minute" as a placeholder; length is decided after research.`;

export async function intake(ctx: Ctx, input: IntakeInput): Promise<Brief> {
  const hist = input.history ?? {};
  const user = [
    `Question or topic: ${input.question}`,
    hist.level ? `This learner's past videos were at level "${hist.level}".` : "",
    hist.pressedSimpler ? `They pressed "Simpler" ${hist.pressedSimpler} time(s) before.` : "",
    hist.pressedDeeper ? `They pressed "Deeper" ${hist.pressedDeeper} time(s) before.` : "",
    input.derivedFrom ? `This is a "${input.derivedFrom.reaction}" re-run of a previous video.` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const inferred = await ctx.llm.json({ system: SYSTEM, user, schema: Inferred, maxTokens: 1500 });

  // Reactions override inference.
  let level = inferred.level;
  if (input.derivedFrom?.reaction === "simpler") level = level === "deep" ? "basics" : "nothing";
  if (input.derivedFrom?.reaction === "deeper") level = level === "nothing" ? "basics" : "deep";

  const brief = Brief.parse({
    projectId: input.projectId,
    question: input.question,
    ...inferred,
    level,
    lengthS: null,
    wordBudget: null,
    sceneRange: null,
    derivedFrom: input.derivedFrom ?? null,
  });
  await ctx.store.saveBrief(brief);
  return brief;
}
