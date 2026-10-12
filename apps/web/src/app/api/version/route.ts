import { version } from "@/lib/version";

export const dynamic = "force-dynamic";

/** Which code this site is running: `curl localhost:3000/api/version`. */
export function GET() {
  return Response.json({ sha: version.sha, branch: version.branch, builtAt: version.builtAt, label: version.label });
}
