import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The Twilio Node SDK is server-only; keep it out of the client bundle.
  serverExternalPackages: ["twilio"],
};

export default nextConfig;
