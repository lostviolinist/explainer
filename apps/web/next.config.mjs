/** @type {import('next').NextConfig} */
const NODE_ONLY = ["@remotion/bundler", "@remotion/renderer", "@remotion/lambda", "@remotion/lambda/client", "esbuild", "postgres"];

const config = {
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
