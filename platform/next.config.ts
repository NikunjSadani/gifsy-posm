import type { NextConfig } from "next";
import path from "path";

// Thin frontend: the browser calls same-origin `/api/*`, and Next proxies those to the
// NestJS backend's versioned `/v1/*` surface. This preserves the httpOnly-cookie auth
// (the proxy injects `Authorization: Bearer`), keeps login same-origin, and avoids CORS.
// `beforeFiles` runs BEFORE any local `src/app/api/*` handler, so the backend always wins.
const BACKEND_API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

// A stable per-build id. The deploy pipeline can pin it via BUILD_ID (e.g. the git SHA);
// otherwise each build gets a fresh timestamp so it always differs from the previous one. It is
// baked into BOTH the client bundle (NEXT_PUBLIC_BUILD_ID) and Next's own asset build id, and the
// live `/version` route echoes it — UpdateNudge compares the two to catch a stale open PWA tab
// after a deploy (online-only; there is no service worker).
const BUILD_ID = process.env.BUILD_ID || `t${Date.now()}`;

const nextConfig: NextConfig = {
  // Required for the Docker standalone build (Cloud Run).
  output: "standalone",
  generateBuildId: () => BUILD_ID,
  async rewrites() {
    return {
      beforeFiles: [
        {
          source: "/api/:path*",
          destination: `${BACKEND_API_URL}/v1/:path*`,
        },
      ],
      afterFiles: [],
      fallback: [],
    };
  },
  // Pin the Turbopack root to this package so Next.js ignores any stray lockfiles
  // higher up in the directory tree.
  turbopack: {
    root: path.resolve(__dirname),
  },
  images: {
    remotePatterns: [
      // GCS — media (recce/install photos), documents, logos.
      {
        protocol: "https",
        hostname: "storage.googleapis.com",
        pathname: "/**",
      },
    ],
  },
  // Expose selected env vars to the client bundle.
  env: {
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_APP_NAME: process.env.NEXT_PUBLIC_APP_NAME,
    NEXT_PUBLIC_BUILD_ID: BUILD_ID,
  },
  // Compress responses.
  compress: true,
  // Strict mode for catching issues early.
  reactStrictMode: true,
  logging: {
    fetches: { fullUrl: false },
  },
};

export default nextConfig;
