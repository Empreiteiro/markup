import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native / Node-only packages used by the server-side pipeline must not be
  // bundled — they are required at runtime from node_modules instead.
  serverExternalPackages: [
    "better-sqlite3",
    "playwright",
    "playwright-core",
    "ts-morph",
  ],
};

export default nextConfig;
