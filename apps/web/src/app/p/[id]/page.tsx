import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getLiveState } from "@/lib/live";
import { toPublic } from "@/lib/public-urls";
import { watchData } from "@/lib/watch";
import { cleanTitle } from "@/lib/titles";
import { Header } from "@/app/Header";
import { Watch } from "@/app/Watch";
import { Progress } from "./Progress";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const [project] = await db.select({ question: schema.projects.question, title: schema.projects.title }).from(schema.projects).where(eq(schema.projects.id, id)).limit(1);
  return { title: project ? cleanTitle(project.question, project.title) : "Not found" };
}

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, id)).limit(1);
  if (!project) notFound();

  const events = await db.select().from(schema.progressEvents).where(eq(schema.progressEvents.projectId, id)).orderBy(asc(schema.progressEvents.at));
  const title = cleanTitle(project.question, project.title);
  if (project.stage !== "done") {
    return (
      <>
        <Header wide />
        <main className="mk-page">
          <Link href="/" className="mk-back">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M19 12H5M11 6l-6 6 6 6" /></svg>
            Back to home
          </Link>
          <h1 className="mk-title">{title}</h1>
          <Progress
            projectId={id}
            question={project.question}
            title={title}
            style={project.style}
            initialLive={toPublic(await getLiveState(id))}
            initial={events.map((e) => ({ stage: e.stage, message: e.message, fraction: e.fraction, preview: toPublic(e.preview as any), at: e.at.toISOString() }))}
          />
        </main>
      </>
    );
  }

  const data = await watchData(project);
  if (!data) notFound();
  return (
    <>
      <Header wide />
      <main className="wt-page">
        <Link href="/" className="mk-back">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M19 12H5M11 6l-6 6 6 6" /></svg>
          New question
        </Link>
        <Watch data={data} />
      </main>
    </>
  );
}
