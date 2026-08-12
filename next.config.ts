import type { NextConfig } from "next";

// Baseline security headers applied to every response. Deliberately conservative:
// no Content-Security-Policy yet (the Twilio Voice SDK, Supabase realtime and the
// live-audio paths need a carefully-tested policy — tracked as a follow-up), and
// microphone is ALLOWED for same-origin because the browser dialer needs it.
const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=()" },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Don't advertise the framework.
  poweredByHeader: false,
  // The Twilio Node SDK is server-only; keep it out of the client bundle.
  serverExternalPackages: ["twilio"],
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
