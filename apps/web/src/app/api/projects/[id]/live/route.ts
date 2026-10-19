import { getLiveState } from "@/lib/live";
import { toPublic } from "@/lib/public-urls";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return Response.json(toPublic(await getLiveState(id)));
}
