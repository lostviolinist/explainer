/**
 * Server-sent events for the progress view. Polls the DB every 1.5 s and
 * streams new events; closes when the project is done or failed.
 */
import { and, asc, eq, gt } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { toPublic } from "@/lib/public-urls";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const enc = new TextEncoder();
  let since = new Date(0);
  let closed = false;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`));
      while (!closed) {
        const events = await db
          .select()
          .from(schema.progressEvents)
          .where(and(eq(schema.progressEvents.projectId, id), gt(schema.progressEvents.at, since)))
          .orderBy(asc(schema.progressEvents.at));
        for (const e of events) {
          send({ stage: e.stage, message: e.message, fraction: e.fraction, preview: toPublic(e.preview), at: e.at.toISOString() });
          since = e.at;
          if (e.stage === "done" || e.stage === "failed") {
            closed = true;
            break;
          }
        }
        if (!closed) await new Promise((r) => setTimeout(r, 1500));
      }
      controller.close();
    },
    cancel() {
      closed = true;
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" },
  });
}
