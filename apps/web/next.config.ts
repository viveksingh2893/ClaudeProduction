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
};

export default nextConfig;
