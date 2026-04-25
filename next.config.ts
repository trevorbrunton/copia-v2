import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Pin workspace root to this project so Turbopack doesn't walk up and try to
  // watch the entire home directory (sibling Next.js projects confuse auto-detection).
  turbopack: {
    root: path.resolve(__dirname),
  },
  outputFileTracingRoot: path.resolve(__dirname),
  async rewrites() {
    return [
      { source: "/api/user/:path*", destination: "/api/v1/user/:path*" },
      { source: "/api/demo/:path*", destination: "/api/v1/demo/:path*" },
    ];
  },
};

export default nextConfig;
