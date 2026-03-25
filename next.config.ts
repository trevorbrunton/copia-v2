import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      { source: "/api/user/:path*", destination: "/api/v1/user/:path*" },
      { source: "/api/demo/:path*", destination: "/api/v1/demo/:path*" },
    ];
  },
  // Transpile LiveAvatar SDK so Turbopack can handle the large livekit-client dependency
  transpilePackages: ["@heygen/liveavatar-web-sdk", "livekit-client"],
};

export default nextConfig;
