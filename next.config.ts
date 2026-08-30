import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // better-sqlite3 is a native module. It is only reachable from the seed
  // script, never from a rendered page, but Next still needs to be told not to
  // try bundling it if anything ever pulls it in transitively.
  serverExternalPackages: ["better-sqlite3"],

  webpack: (config) => {
    /**
     * `src/core/` uses explicit `.js` extensions on relative imports, which is
     * what Node's ESM resolver requires and what lets `tsx` run the benchmark
     * and the tests directly from TypeScript sources.
     *
     * Webpack does not apply TypeScript's `.js` -> `.ts` rewrite by default,
     * so without this it fails to resolve every core import. The alternative
     * would be dropping the extensions, which would break `npm run bench` --
     * and the benchmark running from a clean clone matters more than the
     * dashboard's build config being untouched.
     */
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
      ".jsx": [".tsx", ".jsx"],
    };
    return config;
  },
};

export default nextConfig;
