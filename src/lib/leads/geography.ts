import type { GeoLeadGroup } from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// Lead geography classification — PURE module (client- & server-safe).
//
// Deterministic city/zip → region matching. This is the single source of truth
// for BOTH the non-AI fallback (src/lib/ai/simulate.ts) and the anchor data
// embedded in the AI classification prompt (src/lib/ai/geo-classify.ts), so the
// model's fuzzy judgment and the deterministic fallback never drift into two
// different taxonomies.
//
// These lists are a starting definition — edit them as the team's actual
// service areas become clearer. Fresno is deliberately its own bucket even
// though it's a California city (see `classifyGeography`'s ordering).
// ─────────────────────────────────────────────────────────────────────────────

export interface RegionDef {
  group: GeoLeadGroup;
  label: string;
  state: "CA" | "TX";
  /** Normalized (lowercase, trimmed) city names in this metro. */
  cities: string[];
  /** 3-digit ZIP prefixes covering this metro. */
  zipPrefixes: string[];
}

export const REGIONS: RegionDef[] = [
  {
    group: "fresno",
    label: "Fresno Metro",
    state: "CA",
    cities: [
      "fresno", "clovis", "sanger", "selma", "kerman", "reedley", "fowler",
      "parlier", "kingsburg", "firebaugh", "mendota", "orange cove",
      "san joaquin", "coalinga", "huron",
    ],
    zipPrefixes: ["936", "937"],
  },
  {
    group: "houston",
    label: "Houston Metro",
    state: "TX",
    cities: [
      "houston", "sugar land", "pearland", "katy", "pasadena", "baytown",
      "league city", "missouri city", "spring", "cypress", "humble",
      "tomball", "conroe", "friendswood", "the woodlands",
    ],
    zipPrefixes: ["770", "771", "772", "773", "774", "775"],
  },
  {
    group: "dallas",
    label: "Dallas Metro",
    state: "TX",
    cities: [
      "dallas", "irving", "garland", "mesquite", "richardson", "plano",
      "carrollton", "addison", "university park", "highland park",
      "farmers branch", "desoto", "duncanville", "cedar hill", "grand prairie",
    ],
    zipPrefixes: ["750", "751", "752", "753"],
  },
];

function normalizeCity(city?: string): string {
  return (city ?? "").trim().toLowerCase().replace(/[^a-z\s]/g, "").replace(/\s+/g, " ");
}

function normalizeState(state?: string): "CA" | "TX" | null {
  const s = (state ?? "").trim().toLowerCase();
  if (s === "ca" || s === "california") return "CA";
  if (s === "tx" || s === "texas") return "TX";
  return null;
}

function zip3(zip?: string): string | null {
  const digits = (zip ?? "").replace(/\D/g, "");
  return digits.length >= 3 ? digits.slice(0, 3) : null;
}

/**
 * Classify a lead's geography deterministically. Order matters:
 *   1. ZIP prefix match (most reliable — free text city names vary a lot).
 *   2. Fresno city-name carve-out (checked before the CA catch-all, since
 *      Fresno leads would otherwise fall into "california").
 *   3. Houston/Dallas city-name match.
 *   4. California catch-all — any remaining CA lead.
 *   5. null — "unsorted": doesn't clearly belong to any of the 4 regions.
 */
export function classifyGeography(input: {
  city?: string;
  state?: string;
  zip?: string;
}): GeoLeadGroup | null {
  const z = zip3(input.zip);
  const city = normalizeCity(input.city);
  const state = normalizeState(input.state);

  if (z) {
    const byZip = REGIONS.find((r) => r.zipPrefixes.includes(z));
    if (byZip) return byZip.group;
  }

  const fresno = REGIONS.find((r) => r.group === "fresno")!;
  if (city && fresno.cities.includes(city) && (!state || state === "CA")) return "fresno";

  for (const r of REGIONS) {
    if (r.group === "fresno") continue;
    if (city && r.cities.includes(city) && (!state || state === r.state)) return r.group;
  }

  if (state === "CA") return "california";
  return null;
}

/** Compact region reference data embedded verbatim in the AI classification
 *  prompt, so the model's judgment stays anchored to this same list. */
export function regionsForPrompt(): string {
  return JSON.stringify(
    REGIONS.map((r) => ({
      group: r.group,
      state: r.state,
      cities: r.cities,
      zipPrefixes: r.zipPrefixes,
    })),
  );
}
