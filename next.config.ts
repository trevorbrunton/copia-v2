import type { NextConfig } from "next";
import path from "node:path";

// Log at build time so we can verify env vars in Vercel build logs
console.log("[build] NEXT_PUBLIC_AVATAR_MODE =", JSON.stringify(process.env.NEXT_PUBLIC_AVATAR_MODE));

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
