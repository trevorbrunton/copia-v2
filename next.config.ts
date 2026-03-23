import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "@aws-sdk/client-bedrock-runtime",
  ],
  async rewrites() {
    return [
      { source: "/api/employees/:path*", destination: "/api/v1/employees/:path*" },
      { source: "/api/alaya-clients/:path*", destination: "/api/v1/alaya-clients/:path*" },
      { source: "/api/visits/:path*", destination: "/api/v1/visits/:path*" },
      { source: "/api/skills/:path*", destination: "/api/v1/skills/:path*" },
      { source: "/api/user/:path*", destination: "/api/v1/user/:path*" },
      { source: "/api/availability/:path*", destination: "/api/v1/availability/:path*" },
      { source: "/api/chat/:path*", destination: "/api/v1/chat/:path*" },
      { source: "/api/roster/:path*", destination: "/api/v1/roster/:path*" },
      { source: "/api/webhooks/:path*", destination: "/api/v1/webhooks/:path*" },
      { source: "/api/dev/:path*", destination: "/api/v1/dev/:path*" },
    ];
  },
};

export default nextConfig;
