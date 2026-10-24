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
    // Keep visited/prefetched pages for 30 s so going back and forth between pages is instant. Server actions
    // and realtime notifications call revalidatePath/router.refresh, which clear this cache, so new problems,
    // submissions and feedback still show up straight away.
    staleTimes: { dynamic: 30, static: 180 },
  },
};

export default nextConfig;
