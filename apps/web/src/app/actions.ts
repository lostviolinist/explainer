"use server";

import { redirect } from "next/navigation";
import { randomBytes } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { inngest } from "@explainer/pipeline";
import { VideoStyle } from "@explainer/schemas";
import { db, schema } from "@/lib/db";

const { projects, progressEvents } = schema;
const slug = () => randomBytes(6).toString("base64url");

const Ask = z.object({ question: z.string().trim().min(3).max(500), style: VideoStyle.catch("illustrated") });

/** The one user decision: what do you want to understand? */
export async function ask(formData: FormData) {
  const { question, style } = Ask.parse({ question: formData.get("question"), style: formData.get("style") });
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
