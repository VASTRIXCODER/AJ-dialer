import "server-only";

// ─────────────────────────────────────────────────────────────────────────────
// Lightweight best-effort rate limiter.
//
// This is an in-memory fixed-window counter, so it throttles a burst hitting a
// single warm serverless instance rather than enforcing a global quota. It is a
// cheap backstop against abuse of expensive routes (AI/Claude spend, CSV import
// parsing), NOT a hard distributed limit — pair it with the auth gates on those
// routes. A distributed limiter (Vercel Firewall / Upstash) is the follow-up.
// ─────────────────────────────────────────────────────────────────────────────

type Window = { count: number; resetAt: number };
const buckets = new Map<string, Window>();

/** Occasionally sweep expired windows so the map can't grow without bound. */
function sweep(now: number) {
  if (buckets.size < 5000) return;
  for (const [k, w] of buckets) {
    if (now >= w.resetAt) buckets.delete(k);
  }
}

export interface RateResult {
  ok: boolean;
  /** Seconds until the window resets (for a Retry-After header). */
  retryAfter: number;
}

/**
 * Consume one unit from the `key` bucket. Returns ok:false once `limit` requests
 * have been made within `windowMs`.
 */
export function rateLimit(key: string, limit: number, windowMs: number): RateResult {
  const now = Date.now();
  const w = buckets.get(key);
  if (!w || now >= w.resetAt) {
    sweep(now);
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfter: 0 };
  }
  if (w.count >= limit) {
    return { ok: false, retryAfter: Math.max(1, Math.ceil((w.resetAt - now) / 1000)) };
  }
  w.count += 1;
  return { ok: true, retryAfter: 0 };
}

/** Best-effort client IP from the proxy headers, for keying anonymous callers. */
export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for") ?? "";
  return fwd.split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown";
}
