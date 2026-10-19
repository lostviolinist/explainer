import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import type { RenderResult, ScenePlan, ResearchBrief } from "@explainer/schemas";
import { db, schema } from "@/lib/db";
import { latest } from "@/lib/store";
import { toPublic } from "@/lib/public-urls";

export const dynamic = "force-dynamic";

/** Public share page: the video, transcript and sources at one link. */
export default async function SharePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [project] = await db.select().from(schema.projects).where(eq(schema.projects.shareSlug, slug)).limit(1);
  if (!project || project.stage !== "done") notFound();
  const [render, plan, research] = await Promise.all([
    latest<RenderResult>(project.id, "render"),
    latest<ScenePlan>(project.id, "plan"),
    latest<ResearchBrief>(project.id, "research"),
  ]);
  if (!render) notFound();

  return (
    <main>
      <h1 className="question">{project.question}</h1>
      <video className="player" src={toPublic(render.videoUrl)} controls playsInline preload="metadata" />
      {research && (
        <section className="sources">
          <h2>Sources</h2>
          <ul>{research.sources.map((s) => <li key={s.url}><a href={s.url} target="_blank" rel="noreferrer">{s.title}</a> <span className="small">· {s.domain}</span></li>)}</ul>
        </section>
      )}
      {plan && <details className="transcript"><summary>Transcript</summary>{plan.scenes.map((s) => s.narration).join("\n\n")}</details>}
      <p className="small" style={{ marginTop: 32 }}><a href="/">Ask your own question →</a></p>
    </main>
  );
}
