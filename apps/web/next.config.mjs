import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/** @type {import('next').NextConfig} */
const NODE_ONLY = ["@remotion/bundler", "@remotion/renderer", "@remotion/lambda", "@remotion/lambda/client", "esbuild", "postgres"];

/**
 * Which code this build is: the git commit and branch, read from .git at build
 * time (the Docker context carries .git/HEAD and refs for this), plus when it
 * was built. Shown in the page footer and at /api/version, so you can tell
 * whether a running site is the latest code.
 */
function version() {
  const git = resolve(process.cwd(), "../../.git");
  let sha = process.env.GIT_SHA ?? "unknown";
  let branch = process.env.GIT_BRANCH ?? "";
  try {
    const head = readFileSync(resolve(git, "HEAD"), "utf8").trim();
    const ref = head.startsWith("ref: ") ? head.slice(5) : null;
    if (ref) {
      branch = ref.replace(/^refs\/heads\//, "");
      const loose = resolve(git, ref);
      if (existsSync(loose)) sha = readFileSync(loose, "utf8").trim();
      else {
        const packed = existsSync(resolve(git, "packed-refs")) ? readFileSync(resolve(git, "packed-refs"), "utf8") : "";
        sha = packed.split("\n").find((l) => l.endsWith(` ${ref}`))?.split(" ")[0] ?? sha;
      }
    } else sha = head;
  } catch {
    /* no .git: keep the env/unknown values */
  }
  return { sha: sha.slice(0, 7), branch, builtAt: new Date().toISOString() };
}
const v = version();

const config = {
  env: { NEXT_PUBLIC_VERSION: JSON.stringify(v) },
  transpilePackages: ["@explainer/schemas", "@explainer/hedra", "@explainer/pipeline", "@explainer/render"],
  serverExternalPackages: NODE_ONLY,
  experimental: { serverActions: { bodySizeLimit: "2mb" } },
  webpack: (cfg, { isServer }) => {
    // Workspace packages use ESM-style `./x.js` specifiers that point at .ts/.tsx sources.
    cfg.resolve.extensionAlias = { ".js": [".ts", ".tsx", ".js"], ".jsx": [".tsx", ".jsx"] };
    if (isServer) {
      // The Remotion renderer (and its esbuild) are loaded at runtime on the worker, never bundled.
      cfg.externals = [...(Array.isArray(cfg.externals) ? cfg.externals : [cfg.externals]), ...NODE_ONLY];
    }
    return cfg;
  },
};
export default config;
