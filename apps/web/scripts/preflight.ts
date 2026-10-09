/** Terminal version of the home page's setup check:  pnpm --filter @explainer/web preflight */
import { runPreflight } from "../src/lib/preflight";

const checks = await runPreflight();
const mark = { ok: "✓", warn: "!", fail: "✗" } as const;
for (const c of checks) {
  console.log(`${mark[c.status]} ${c.name}: ${c.detail}`);
  if (c.status !== "ok" && c.fix) console.log(`    ${c.fix}`);
}
process.exit(checks.some((c) => c.status === "fail") ? 1 : 0);
