import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Local workspace packages ship TS source, not a pre-built dist — Next
  // needs to transpile them itself.
  transpilePackages: [
    "@kisan4u/ui",
    "@kisan4u/auth",
    "@kisan4u/providers",
    "@kisan4u/validators",
    "@kisan4u/db",
  ],
  experimental: {
    serverActions: {
      // Default is 1 MB — too small for the file uploads this app already
      // does through Server Actions (POS payment-proof screenshots,
      // licence documents capped client-side at 5 MB in
      // licence-document-input.tsx). 10 MB covers those with headroom
      // without raising it so far it stops being a meaningful guard.
      bodySizeLimit: "10mb",
    },
  },
};

export default nextConfig;
