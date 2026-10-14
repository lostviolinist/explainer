import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import type { RenderResult, ScenePlan, ResearchBrief } from "@explainer/schemas";
import { db, schema } from "@/lib/db";
import { latest } from "@/lib/store";
import { getLiveState } from "@/lib/live";
import { react } from "@/app/actions";
import { PendingButton, PendingNote } from "@/app/pending";
import { Progress } from "./Progress";

export const dynamic = "force-dynamic";

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, id)).limit(1);
  if (!project) notFound();

  const events = await db.select().from(schema.progressEvents).where(eq(schema.progressEvents.projectId, id)).orderBy(asc(schema.progressEvents.at));
  const render = project.stage === "done" ? await latest<RenderResult>(id, "render") : null;

  if (!render) {
    return (
      <main className="wide">
        <p className="back"><Link href="/">← Ask something else</Link></p>
        <h1 className="question">{project.question}</h1>
        <Progress
          projectId={id}
          question={project.question}
          initialLive={await getLiveState(id)}
          initial={events.map((e) => ({ stage: e.stage, message: e.message, fraction: e.fraction, preview: e.preview as any, at: e.at.toISOString() }))}
        />
      </main>
    );
  }

  const [plan, research, live] = await Promise.all([latest<ScenePlan>(id, "plan"), latest<ResearchBrief>(id, "research"), getLiveState(id)]);
  const poster = live.scenes.find((s) => s.stillUrl)?.stillUrl;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";

  return (
    <main>
      <p className="back"><Link href="/">← Ask something else</Link></p>
      <h1 className="question">{project.question}</h1>
      {/* Captions are burned into the video; the .srt is offered as a download. */}
      <video className="player" src={render.videoUrl} poster={poster} controls playsInline preload="metadata" />

      <form action={react} className="reactions">
        <input type="hidden" name="projectId" value={id} />
        <PendingButton className="btn ghost" name="reaction" value="simpler">Simpler</PendingButton>
        <PendingButton className="btn ghost" name="reaction" value="deeper">Deeper</PendingButton>
        <a className="btn ghost" href={`${appUrl}/s/${project.shareSlug}`}>Share</a>
        <a className="btn ghost" href={render.srtUrl} download>Captions (.srt)</a>
        <PendingNote>Setting up a new video — the progress page opens in a moment.</PendingNote>
      </form>
      <form action={react} className="followup">
        <input type="hidden" name="projectId" value={id} />
        <input type="hidden" name="reaction" value="follow-up" />
        <input name="followUp" placeholder="wait, why does…? (ask a follow-up)" maxLength={300} required />
        <PendingButton className="btn">Ask</PendingButton>
      </form>

      {research && (
        <section className="sources">
          <h2>Sources</h2>
          <ul>
            {research.sources.map((s) => (
              <li key={s.url}><a href={s.url} target="_blank" rel="noreferrer">{s.title}</a> <span className="small">· {s.domain}</span></li>
            ))}
          </ul>
        </section>
      )}
      {plan && (
        <details className="transcript">
          <summary>Transcript</summary>
          {plan.scenes.map((s) => s.narration).join("\n\n")}
        </details>
      )}
    </main>
  );
}
