// ─────────────────────────────────────────────────────────────────────────────
// TruePeopleSearch URL for a lead. PURE — no server-only import, no I/O — so the
// dialer's lead card builds it in the browser and opens the tab with zero server
// round-trip, no API key, and nothing to configure.
//
// TruePeopleSearch over Whitepages for the open-a-tab flow: it shows phone
// numbers for FREE, no login or payment, so a rep who opens the tab actually
// sees the number. Whitepages paywalls them, which makes the manual flow a dead
// end there.
//
// It takes query PARAMS (?streetaddress=&citystatezip=), not path slugs. If the
// site ever renames those, the deep link may land on the site's home page
// instead of results — which is why the card ALSO shows the address with a copy
// button: worst case the rep pastes it into the site's own search box, and the
// feature still works.
// ─────────────────────────────────────────────────────────────────────────────

export interface PeopleSearchInput {
  firstName?: string | null;
  lastName?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
}

const BASE = "https://www.truepeoplesearch.com/results";

/** "City, ST 93710" — TruePeopleSearch's citystatezip field. Empty when there's
 *  no locality at all. */
function cityStateZip(input: PeopleSearchInput): string {
  const cityState = [input.city, input.state]
    .map((s) => (s ?? "").trim())
    .filter(Boolean)
    .join(", ");
  const zip = (input.zip ?? "").trim();
  return [cityState, zip].filter(Boolean).join(" ").trim();
}

/**
 * The TruePeopleSearch results URL for a lead, or null when there isn't enough
 * to search on.
 *
 * Address search is preferred when a street address is present — it lands on
 * the household, where a name search on a common name lands on a list of
 * different people. A bare name with no locality still searches (the site
 * handles it); a locality with no name or street does not, since "everyone in
 * Fresno" isn't a lookup.
 */
export function truePeopleSearchUrl(input: PeopleSearchInput): string | null {
  const csz = cityStateZip(input);
  const street = (input.address ?? "").trim();
  const name = `${input.firstName ?? ""} ${input.lastName ?? ""}`.trim();

  const params = new URLSearchParams();
  if (street && csz) {
    params.set("streetaddress", street);
    params.set("citystatezip", csz);
  } else if (name) {
    params.set("name", name);
    if (csz) params.set("citystatezip", csz);
  } else {
    return null;
  }
  return `${BASE}?${params.toString()}`;
}
