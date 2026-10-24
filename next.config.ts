import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Lets a second `next dev` (e.g. an end-to-end run on another port) use its own build dir
  // instead of clobbering the main one: NEXT_DIST_DIR=.next-e2e next dev -p 3114
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
};

export default nextConfig;
