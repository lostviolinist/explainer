import type { WebpackOverrideFn } from "@remotion/bundler";

/** Sources use ESM-style `./x.js` specifiers that point at .ts/.tsx files (as in apps/web/next.config.mjs). */
export const webpackOverride: WebpackOverrideFn = (config) => ({
  ...config,
  resolve: {
    ...config.resolve,
    extensionAlias: { ".js": [".ts", ".tsx", ".js"], ".jsx": [".tsx", ".jsx"] },
  },
});
