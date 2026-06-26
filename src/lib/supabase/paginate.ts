import "server-only";

// ─────────────────────────────────────────────────────────────────────────────
// Page past PostgREST's row ceiling.
//
// Supabase/PostgREST caps every SELECT at a "max rows" limit (1,000 by default).
// A plain `.select("*")` therefore returns AT MOST 1,000 rows no matter how many
// exist — silently truncating large tables (e.g. a 6,000-lead import shows 1,000).
// `.limit(50000)` does NOT help: the ceiling still applies. The only reliable way
// to read everything is to request successive `.range()` windows until a short
// page comes back.
//
// `build(from, to)` must return a FRESH range-applied query each call (so the same
// filters/order are re-applied per page). Ordering must be deterministic across
// pages — add a unique tiebreaker like `.order("id")` — or rows can shift between
// page boundaries and be duplicated or skipped.
// ─────────────────────────────────────────────────────────────────────────────

const PAGE = 1000; // matches PostgREST's default ceiling; safe per-request window

export async function fetchAllRows<T = Record<string, unknown>>(
  build: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  opts: { max?: number } = {},
): Promise<T[]> {
  // Upper bound so a pathological table never loops forever. Defaults high enough
  // to cover any realistic lead/call volume for a single account/org.
  const max = Math.max(PAGE, opts.max ?? 200_000);
  const out: T[] = [];
  for (let from = 0; from < max; from += PAGE) {
    const to = Math.min(from + PAGE - 1, max - 1);
    const { data, error } = await build(from, to);
    if (error || !data || data.length === 0) break;
    out.push(...data);
    if (data.length < PAGE) break; // short page ⇒ reached the end
  }
  return out;
}
