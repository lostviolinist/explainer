import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import type { RenderResult, ScenePlan, ResearchBrief } from "@explainer/schemas";
import { db, schema } from "@/lib/db";
import { latest } from "@/lib/store";
import { react } from "@/app/actions";
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
      <main>
        <p className="small"><Link href="/">← ask something else</Link></p>
        <h1>{project.question}</h1>
        <Progress
          projectId={id}
          initial={events.map((e) => ({ stage: e.stage, message: e.message, fraction: e.fraction, preview: e.preview as any, at: e.at.toISOString() }))}
        />
      </main>
    );
  }

  const [plan, research] = await Promise.all([latest<ScenePlan>(id, "plan"), latest<ResearchBrief>(id, "research")]);
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";

  return (
    <main>
      <p className="small"><Link href="/">← ask something else</Link></p>
      <h1>{project.question}</h1>
      <video className="player" src={render.videoUrl} controls playsInline>
        <track kind="captions" src={render.srtUrl} srcLang="en" label="English" default />
      </video>

      <form action={react} className="reactions">
        <input type="hidden" name="projectId" value={id} />
        <button className="btn ghost" name="reaction" value="simpler">Simpler</button>
        <button className="btn ghost" name="reaction" value="deeper">Deeper</button>
        <a className="btn ghost" href={`${appUrl}/s/${project.shareSlug}`}>Share</a>
      </form>
      <form action={react} className="followup">
        <input type="hidden" name="projectId" value={id} />
        <input type="hidden" name="reaction" value="follow-up" />
        <input name="followUp" placeholder="wait, why does…? (ask a follow-up)" maxLength={300} required />
        <button className="btn" type="submit">Ask</button>
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
