"use server";

import { redirect } from "next/navigation";
import { randomBytes } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { inngest } from "@explainer/pipeline";
import { VideoStyle } from "@explainer/schemas";
import type { Brief, ResearchBrief } from "@explainer/schemas";
import { db, schema } from "@/lib/db";
import { latest, drizzleStore } from "@/lib/store";
import { getCtx } from "@/lib/pipeline";
import { preflight, MANIM_CHECK } from "@/lib/preflight";

const { projects, progressEvents } = schema;
const slug = () => randomBytes(6).toString("base64url");

const Ask = z.object({ question: z.string().trim().min(3).max(500), style: VideoStyle.catch("illustrated") });

/** The one user decision: what do you want to understand? */
export async function ask(formData: FormData) {
  const { question, style } = Ask.parse({ question: formData.get("question"), style: formData.get("style") });
  // Never start a run that would fail on a missing key, credits or service, or a 3Blue1Brown video without
  // its Manim sandbox. Illustrated videos need no sandbox. The check is cached, so this is quick.
  const checks = await preflight();
  const manim = checks.find((c) => c.name === MANIM_CHECK);
  if (checks.some((c) => c.status === "fail") || (style === "math" && manim?.status !== "ok")) redirect("/?setup");
  const [project] = await db.insert(projects).values({ question, style, shareSlug: slug() }).returning({ id: projects.id });
  await db.insert(progressEvents).values({ projectId: project!.id, stage: "queued", message: "starting", fraction: 0 });
  await inngest.send({ name: "project/created", data: { projectId: project!.id, question, style } });
  redirect(`/p/${project!.id}`);
}

const React = z.object({
  projectId: z.string().uuid(),
  reaction: z.enum(["simpler", "deeper", "follow-up"]),
  followUp: z.string().trim().max(300).optional(),
});

/** Reactions, not reviews: Simpler / Deeper re-run from the script; a follow-up is a short continuation. */
export async function react(formData: FormData) {
  const r = React.parse({
    projectId: formData.get("projectId"),
    reaction: formData.get("reaction"),
    followUp: formData.get("followUp") || undefined,
  });
  const [parent] = await db.select().from(projects).where(eq(projects.id, r.projectId)).limit(1);
  if (!parent) throw new Error("project not found");

  const question = r.reaction === "follow-up" ? `${r.followUp} (follow-up to: ${parent.question})` : parent.question;
  const [child] = await db
    .insert(projects)
    .values({ question, style: parent.style, parentId: parent.id, reaction: r.reaction, userId: parent.userId, shareSlug: slug() })
    .returning({ id: projects.id });
  await db.insert(progressEvents).values({ projectId: child!.id, stage: "queued", message: "starting", fraction: 0 });

  const lineage = parent.userId
    ? await db.select({ reaction: projects.reaction }).from(projects).where(and(eq(projects.userId, parent.userId), inArray(projects.reaction, ["simpler", "deeper"])))
    : [];
  await inngest.send({
    name: "project/created",
    data: {
      projectId: child!.id,
      question,
      history: {
        pressedSimpler: lineage.filter((x) => x.reaction === "simpler").length,
        pressedDeeper: lineage.filter((x) => x.reaction === "deeper").length,
      },
      derivedFrom: { projectId: parent.id, reaction: r.reaction, followUpQuestion: r.followUp },
      style: VideoStyle.catch("illustrated").parse(parent.style),
    },
  });
  redirect(`/p/${child!.id}`);
}

/** A run that has said nothing for this long died with its worker (a restart, a laptop asleep) or hung. The page offers "Try again" after 15 minutes. */
const QUIET_AFTER_MS = 10 * 60_000;

/**
 * Pick a stopped video up where it left off: one that failed, or one that went quiet. Everything it
 * saved stays (research, script, voice, the scenes that were made); the worker makes only what is
 * missing, then the cut.
 */
export async function retryProject(projectId: string): Promise<void> {
  const id = z.string().uuid().parse(projectId);
  const [project] = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
  if (!project) throw new Error("project not found");
  if (project.stage === "done") return;

  // Where it stopped: the stage of the last event before the failure (or the silence).
  const recent = await db.select({ stage: progressEvents.stage, at: progressEvents.at }).from(progressEvents).where(eq(progressEvents.projectId, id)).orderBy(desc(progressEvents.at)).limit(20);
  const stoppedAt = recent.map((e) => e.stage).find((st) => st !== "failed" && st !== "queued") ?? "intake";
  // Should the old run still be alive, the resume event cancels it (see the worker's cancelOn).
  const lastAt = recent[0]?.at ?? project.createdAt;
  const quiet = Date.now() - lastAt.getTime() > QUIET_AFTER_MS;
  if (project.stage !== "failed" && !quiet) return; // still running

  const lineage = project.userId
    ? await db.select({ reaction: projects.reaction }).from(projects).where(and(eq(projects.userId, project.userId), inArray(projects.reaction, ["simpler", "deeper"])))
    : [];
  const reaction = project.reaction as "simpler" | "deeper" | "follow-up" | null;
  await inngest.send({
    name: "project/resume",
    data: {
      projectId: id,
      question: project.question,
      style: VideoStyle.catch("illustrated").parse(project.style),
      history: { pressedSimpler: lineage.filter((x) => x.reaction === "simpler").length, pressedDeeper: lineage.filter((x) => x.reaction === "deeper").length },
      derivedFrom:
        project.parentId && reaction
          ? { projectId: project.parentId, reaction, followUpQuestion: reaction === "follow-up" ? project.question.replace(/\s*\(follow-up to: .*\)$/, "") : undefined }
          : undefined,
    },
  });
  // Only once the worker has the event: the page leaves the stopped state on this, and the stream reopens.
  await drizzleStore.progress({ projectId: id, stage: stoppedAt as never, message: "trying again", fraction: 0, at: new Date().toISOString() });
}

const Graded = z.object({
  verdict: z.enum(["got it", "nearly", "not yet"]),
  feedback: z.string(),
  missing: z.array(z.string()),
});

/**
 * The learner explains the video back in their own words; a kind tutor says
 * what landed and what to watch again. Judged against the learning goal and
 * the claims the video was built from, nothing else.
 */
export async function explainBack(projectId: string, text: string): Promise<z.infer<typeof Graded>> {
  const id = z.string().uuid().parse(projectId);
  const answer = z.string().trim().min(15).max(600).parse(text);
  const [brief, research] = await Promise.all([latest<Brief>(id, "brief"), latest<ResearchBrief>(id, "research")]);
  if (!brief) throw new Error("video not found");
  const claims = (research?.claims ?? []).filter((c) => c.fit === "needed" && c.confidence !== "contested").slice(0, 10).map((c) => `- ${c.text}`).join("\n");
  return getCtx().llm.json({
    system: `You are a kind, exact tutor. A learner watched a short explainer video and is now explaining it back in their own words. Judge only whether they understood the core mechanism, not their wording or spelling. verdict: "got it" when the mechanism is right in their own words (details may be missing); "nearly" when it is partly right or vague on the key step; "not yet" when it is wrong or the mechanism is absent. feedback: two short sentences, warm and specific, naming what they got right and the one thing to fix. missing: the key ideas they left out, at most three, a few words each; empty when they got it.`,
    user: `Learning goal: ${brief.learningGoal}\n\nWhat the video claimed:\n${claims || "(no claims recorded)"}\n\nThe learner wrote:\n${answer}`,
    schema: Graded,
    maxTokens: 500,
    effort: "low",
  });
}
