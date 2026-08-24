// ─────────────────────────────────────────────────────────────────────────────
// The Whitepages search URL for a lead. PURE — no server-only import, no I/O —
// so the dialer's lead card can build it in the browser and open the tab with
// zero server round-trip, no API key, and nothing to configure.
//
// Kept apart from ./whitepages.ts (which drives an automated fetch and needs
// server-only bits) precisely so a Client Component can import THIS without
// dragging the server module — and its Claude/Playwright dependencies — into
// the browser bundle.
// ─────────────────────────────────────────────────────────────────────────────

export interface WhitepagesUrlInput {
  firstName?: string | null;
  lastName?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
}

/** Whitepages' URL slugs: alphanumerics and single hyphens, nothing else. */
function slug(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * The canonical Whitepages results URL for a lead, or null when there isn't
 * enough to search on.
 *
 * Address search is preferred when a street address is present — it resolves to
 * one household, where a name search on "John Smith, Fresno CA" lands on a page
 * of different people. Navigating straight to the results URL (rather than the
 * site's search box) is the same query with less to go wrong.
 */
export function whitepagesSearchUrl(input: WhitepagesUrlInput): string | null {
  const city = slug((input.city ?? "").trim());
  const state = slug((input.state ?? "").trim());
  const locality = city && state ? `${city}-${state}` : city || state;

  const street = slug((input.address ?? "").trim());
  if (street && locality) {
    return `https://www.whitepages.com/address/${street}/${locality}`;
  }

  const name = slug(`${input.firstName ?? ""} ${input.lastName ?? ""}`.trim());
  if (name && locality) {
    return `https://www.whitepages.com/name/${name}/${locality}`;
  }
  if (name) return `https://www.whitepages.com/name/${name}`;
  return null;
}
