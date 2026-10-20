import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { watchData } from "@/lib/watch";
import { cleanTitle } from "@/lib/titles";
import { Header, Footer } from "@/app/Header";
import { Watch } from "@/app/Watch";

export const dynamic = "force-dynamic";

async function find(slug: string) {
  const [project] = await db.select().from(schema.projects).where(eq(schema.projects.shareSlug, slug)).limit(1);
  return project && project.stage === "done" ? project : null;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const project = await find((await params).slug);
  return { title: project ? cleanTitle(project.question, project.title) : "Not found" };
}

/** Public share page: the same video, transcript, sources and quiz at one link, with a way to ask your own question. */
export default async function SharePage({ params }: { params: Promise<{ slug: string }> }) {
  const project = await find((await params).slug);
  const data = project && (await watchData(project));
  if (!data) notFound();
  return (
    <>
      <Header wide nav={<Link href="/">Ask a question</Link>} />
      <main className="wt-page">
        <Link href="/" className="mk-back">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M19 12H5M11 6l-6 6 6 6" /></svg>
          Unfold
        </Link>
        <Watch data={data} shared />
      </main>
      <Footer />
    </>
  );
}
