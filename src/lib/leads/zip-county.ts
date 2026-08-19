import "server-only";

import zipCountyData from "./zip-county-data.json";

// ─────────────────────────────────────────────────────────────────────────────
// Deterministic ZIP → county lookup — SERVER-ONLY.
//
// Unlike geography.ts (city/ZIP-prefix → metro, a handful of hand-maintained
// regions), county is a real geographic fact with ~3,100 possible values, so
// it's computed from an actual crosswalk rather than approximated with rules.
// AI classification (classify-leads.ts) was deliberately NOT extended to cover
// this: a model guessing at county-line accuracy for an arbitrary ZIP is worse
// than a real dataset, and county doesn't need the model's judgment the way
// "which of this org's own named buckets" does — a ZIP either maps to a county
// or it doesn't.
//
// Source: a 5-digit-ZIP → county/state crosswalk derived from Census ZCTA data
// (github.com/scpike/us-state-county-zip, itself sourced from the Census
// Bureau — 2000-vintage ZCTA boundaries). County lines are essentially static
// in the US, so this stays accurate for the overwhelming majority of ZIPs
// despite its age; the gap is PO-box-only ZIPs and a handful introduced since
// 2000, neither of which the Census ZCTA product covers even today. 31,913 of
// roughly 41,000 active US ZIPs are present — every one of them a real,
// deliverable, residential-or-mixed ZIP (the kind a lead's address actually
// has), which is why this is a materially complete match for real lead data
// despite the numeric gap.
//
// A ZIP with no entry returns null — never a guess. Callers must treat that as
// "county unknown," the same honest-unsorted posture the rest of this app
// takes toward anything it can't confidently place (see classify-leads.ts's
// own "null over a guess" reasoning).
// ─────────────────────────────────────────────────────────────────────────────

const DATA = zipCountyData as Record<string, string>;

export interface CountyMatch {
  /** Bare county name, e.g. "Fresno" — never includes the word "County". */
  county: string;
  /** 2-letter USPS state code. */
  state: string;
}

/** Best-effort county for a US ZIP code. Accepts loosely-formatted input
 *  (ZIP+4, stray whitespace) — only the first 5 digits are ever used. */
export function countyForZip(zip: string | null | undefined): CountyMatch | null {
  const digits = String(zip ?? "").replace(/\D/g, "");
  if (digits.length < 5) return null;
  const entry = DATA[digits.slice(0, 5)];
  if (!entry) return null;
  const bar = entry.indexOf("|");
  if (bar < 0) return null;
  const county = entry.slice(0, bar);
  const state = entry.slice(bar + 1);
  return county && state ? { county, state } : null;
}

/** How many US ZIPs this lookup covers — surfaced in the Admin/backfill UI so
 *  "some leads didn't get a county" reads as an expected, documented gap
 *  rather than a bug report. */
export const ZIP_COUNTY_COVERAGE = Object.keys(DATA).length;
