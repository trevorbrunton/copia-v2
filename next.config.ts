import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      { source: "/api/user/:path*", destination: "/api/v1/user/:path*" },
    ];
  },
};

export default nextConfig;
