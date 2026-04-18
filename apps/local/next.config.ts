import path from "path";
import type { NextConfig } from "next";
import { getAllowedDevOrigins, getConfiguredBoardBaseUrl } from "./lib/app-config";

const nextConfig: NextConfig = {
  output: "standalone",
  allowedDevOrigins: getAllowedDevOrigins(),
  serverExternalPackages: ["node-pty"],
  turbopack: {
    root: path.resolve(__dirname, "..", ".."),
  },
  
  // Security headers
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "X-DNS-Prefetch-Control",
            value: "on",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "X-Frame-Options",
            value: "SAMEORIGIN",
          },
          {
            key: "X-XSS-Protection",
            value: "1; mode=block",
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
      {
        // CSP for pages (more restrictive)
        source: "/((?!api).*)",
        headers: [
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.googletagmanager.com https://us-assets.i.posthog.com", // Next.js needs unsafe-eval in dev
              "style-src 'self' 'unsafe-inline'",
              `connect-src 'self' ${getConfiguredBoardBaseUrl()} https://api.github.com https://www.google-analytics.com https://us.i.posthog.com https://us-assets.i.posthog.com`,
              "img-src 'self' data: https:",
              "font-src 'self' data:",
              "frame-ancestors 'self'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join("; "),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
