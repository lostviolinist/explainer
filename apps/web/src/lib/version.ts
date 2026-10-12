/**
 * Which code is running: stamped into the build by next.config.mjs (git commit,
 * branch, build time). `git log -1` on the machine you deployed from should show
 * the same commit; if not, the site is serving an older build.
 */
type Version = { sha: string; branch: string; builtAt: string };

const parsed: Version = (() => {
  try {
    return JSON.parse(process.env.NEXT_PUBLIC_VERSION ?? "") as Version;
  } catch {
    return { sha: "unknown", branch: "", builtAt: "" };
  }
})();

const when = parsed.builtAt ? new Date(parsed.builtAt).toUTCString().replace(/:\d\d GMT$/, " UTC") : "unknown time";

export const version = {
  ...parsed,
  /** e.g. "build 722dfff (main) · 12 Oct 2026 19:10 UTC" */
  label: `build ${parsed.sha}${parsed.branch ? ` (${parsed.branch})` : ""} · ${when}`,
};
