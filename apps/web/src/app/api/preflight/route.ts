import { preflight } from "@/lib/preflight";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const refresh = new URL(req.url).searchParams.has("refresh");
  return Response.json({ checks: await preflight(refresh) });
}
