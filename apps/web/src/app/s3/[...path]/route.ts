/**
 * Serves the bucket's files to browsers on the site's own origin, streaming
 * from the S3 server with range requests passed through (video seeking).
 * Only the app's own bucket; nothing else on the storage server is reachable.
 */
export const dynamic = "force-dynamic";

const PASS_IN = ["range", "if-none-match", "if-modified-since"];
const PASS_OUT = ["content-type", "content-length", "content-range", "accept-ranges", "etag", "last-modified"];

export async function GET(req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const endpoint = (process.env.S3_ENDPOINT ?? "").replace(/\/$/, "");
  const bucket = process.env.S3_BUCKET ?? "explainer-assets";
  if (!endpoint || path[0] !== bucket || path.some((p) => !p || p === ".." || p === ".")) return new Response("not found", { status: 404 });
  const headers = new Headers();
  for (const h of PASS_IN) {
    const v = req.headers.get(h);
    if (v) headers.set(h, v);
  }
  let upstream: Response;
  try {
    upstream = await fetch(`${endpoint}/${path.map(encodeURIComponent).join("/")}`, { headers, cache: "no-store" });
  } catch {
    return new Response("storage unavailable", { status: 502 });
  }
  const out = new Headers();
  for (const h of PASS_OUT) {
    const v = upstream.headers.get(h);
    if (v) out.set(h, v);
  }
  // Every object is written once under a unique key, so browsers may keep it.
  out.set("cache-control", upstream.ok ? "public, max-age=31536000, immutable" : "no-store");
  return new Response(upstream.status === 204 || upstream.status === 304 ? null : upstream.body, { status: upstream.status, headers: out });
}

export const HEAD = GET;
