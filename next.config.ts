import type { NextConfig } from "next";

// Every page is per-user and authenticated, so nothing is statically cached.
// (cacheComponents / partialPrefetching from the scaffold are intentionally off.)
const nextConfig: NextConfig = {
  serverExternalPackages: ["unpdf"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  experimental: {
    serverActions: { bodySizeLimit: "16mb" },
  },
};

export default nextConfig;
