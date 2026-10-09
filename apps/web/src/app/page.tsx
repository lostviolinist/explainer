import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { AskForm } from "./AskForm";
import { db, schema } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function Home() {
  const recent = await db
    .select({ id: schema.projects.id, question: schema.projects.question })
    .from(schema.projects)
    .where(eq(schema.projects.stage, "done"))
    .orderBy(desc(schema.projects.createdAt))
    .limit(6);
  return (
    <main>
      <h1>What do you want to <span className="grad">understand</span>?</h1>
      <p className="sub">Type a topic or a question. In about ten minutes you get a short animated explainer, researched and sourced, and you can watch it being made.</p>
      <AskForm />
      {recent.length > 0 && (
        <div className="recent">
          <div className="eyebrow">Recently explained</div>
          <div className="chips">
            {recent.map((p) => (
              <Link key={p.id} href={`/p/${p.id}`}>{p.question}</Link>
            ))}
          </div>
        </div>
      )}
    </main>
  );
}
