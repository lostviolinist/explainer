import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { ask } from "./actions";
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
      <h1>What do you want to understand?</h1>
      <p className="sub">Type a topic or a question. You get a short animated explainer with sources, in about ten minutes.</p>
      <form action={ask} className="ask">
        <input name="question" placeholder="why do leaves change colour in autumn?" autoFocus required minLength={3} maxLength={500} />
        <button type="submit">Explain it</button>
      </form>
      {recent.length > 0 && (
        <div className="recent">
          Recently explained
          <div>
            {recent.map((p) => (
              <Link key={p.id} href={`/p/${p.id}`}>{p.question}</Link>
            ))}
          </div>
        </div>
      )}
    </main>
  );
}
