import type { NextConfig } from "next";
import path from "path";

// Thin frontend: the browser calls same-origin `/api/*`, and Next proxies those to the
// NestJS backend's versioned `/v1/*` surface. This preserves the httpOnly-cookie auth
// (the proxy injects `Authorization: Bearer`), keeps login same-origin, and avoids CORS.
// `beforeFiles` runs BEFORE any local `src/app/api/*` handler, so the backend always wins.
const BACKEND_API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

const nextConfig: NextConfig = {
  // Required for the Docker standalone build (Cloud Run).
  output: "standalone",
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
