/**
 * Pictures, clips, voice and videos live in the S3 server, which the app
 * reaches directly (ASSETS_PUBLIC_BASE, http://localhost:9000/… in the Docker
 * stack). Browsers can't: they get the same files through the site itself at
 * /s3/<bucket>/…, so a share link works from any host, a tunnel or a laptop,
 * with nothing to configure. Everything handed to the browser goes through
 * toPublic(); /s3/[...path]/route.ts serves the files.
 */
const internal = (process.env.ASSETS_PUBLIC_BASE ?? "").replace(/\/$/, "");
const bucket = process.env.S3_BUCKET ?? "explainer-assets";
export const PUBLIC_PREFIX = `/s3/${bucket}`;

/** Deep-copies `value`, turning every asset URL into its same-origin /s3/… form. */
export function toPublic<T>(value: T): T {
  if (!internal) return value;
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return v.startsWith(`${internal}/`) ? `${PUBLIC_PREFIX}/${v.slice(internal.length + 1)}` : v;
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk(value) as T;
}
