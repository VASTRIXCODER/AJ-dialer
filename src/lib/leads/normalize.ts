import type { ParsedLead } from "./csv";

// ─────────────────────────────────────────────────────────────────────────────
// Deterministic reformatting of an extracted lead.
//
// Column MAPPING answers "which column is the city?" — this answers "and is the
// value in it usable?". Customer CSVs arrive as broker exports and spreadsheet
// round-trips, so the same field shows up as "CALIFORNIA", "california", "Calif."
// and "CA"; ZIP 01001 arrives as 1001 because Excel treated it as a number; and
// whole files come through SHOUTING because that's how the source system stored
// them. None of that is a parsing failure — every row imports either way — but it
// is what makes a rep's screen read as junk and what makes city/county grouping
// split one place into four buckets.
//
// Runs on EVERY import (header-mapped or AI-mapped) once the mapping is known,
// which is exactly why it doesn't need a model: the field's identity is already
// established, so the rules are decidable in code. Pure, so it's unit-testable
// and identical on the client and the server.
//
// THE SAFETY RULE, applied to every text field: only re-case a value that is
// UNIFORMLY cased (all upper or all lower). Anything already mixed-case was
// deliberately typed that way — "LaSalle", "McDonald", "de la Cruz" — and gets
// left exactly as it is. Reformatting must never destroy information.
// ─────────────────────────────────────────────────────────────────────────────

/** Full state / territory name → USPS code. Keys are lowercased at lookup. */
const STATE_CODES: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA",
  colorado: "CO", connecticut: "CT", delaware: "DE", florida: "FL", georgia: "GA",
  hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA",
  kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD",
  massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS",
  missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV",
  "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY",
  "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK",
  oregon: "OR", pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC",
  "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT",
  virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI",
  wyoming: "WY", "district of columbia": "DC", "washington dc": "DC",
  "puerto rico": "PR", guam: "GU", "virgin islands": "VI", "american samoa": "AS",
  "northern mariana islands": "MP",
};

/** Every valid USPS code, so a real 2-letter state is never "corrected". */
const STATE_ABBRS = new Set(Object.values(STATE_CODES));

/** Street tokens that are wrong in Title Case — "123 NE 4th St", not "123 Ne 4th St". */
const KEEP_UPPER = new Set([
  "N", "S", "E", "W", "NE", "NW", "SE", "SW", "NORTH", "SOUTH", "EAST", "WEST",
  "PO", "POB", "US", "SR", "FM", "CR", "RR", "HC", "USA",
]);

/**
 * Values that MEAN empty. Exports write a placeholder where a field is missing
 * rather than leaving the cell blank, and storing it verbatim turns "we don't
 * know this homeowner's city" into a homeowner who lives in a city called "N/A" —
 * which then gets its own city pack, its own county bucket, and its own line on a
 * report. Matched only as the WHOLE value, so a real "Nome, AK" is untouched.
 */
const PLACEHOLDERS = new Set([
  "-", "--", "---", "n/a", "n\\a", "na", "none", "null", "nil", "unknown", "?",
]);

const isPlaceholder = (v: string) => PLACEHOLDERS.has(v.trim().toLowerCase());

/** The value, or "" when it's a stand-in for one that was never filled in. */
export function blankIfPlaceholder(value: string): string {
  const v = (value ?? "").trim();
  return isPlaceholder(v) ? "" : v;
}

/** Is this value uniformly cased (so re-casing can't destroy deliberate casing)? */
function isUniformCase(v: string): boolean {
  const hasLetters = /[a-z]/i.test(v);
  return hasLetters && (v === v.toUpperCase() || v === v.toLowerCase());
}

/**
 * Title-case one word, honouring the two separators that carry real casing:
 * apostrophes ("o'brien" → "O'Brien") and hyphens ("smith-jones" → "Smith-Jones").
 */
function titleWord(word: string): string {
  return word
    .split(/(['’-])/)
    .map((part, i) =>
      i % 2 === 1 // the separator itself
        ? part
        : part.charAt(0).toUpperCase() + part.slice(1).toLowerCase(),
    )
    .join("");
}

/** Title-case a uniformly-cased phrase; leave anything mixed-case untouched. */
export function titleCase(value: string, keepUpper?: Set<string>): string {
  const v = value.trim();
  if (!v || !isUniformCase(v)) return v;
  return v
    .split(/\s+/)
    .map((w) => (keepUpper?.has(w.toUpperCase()) ? w.toUpperCase() : titleWord(w)))
    .join(" ");
}

/**
 * Resolve a state to its USPS code. Handles full names, "Calif."-style trailing
 * dots, and codes that arrived lowercase. A value that resolves to nothing is
 * returned trimmed rather than blanked — never lose what the customer sent.
 */
export function normalizeState(value: string): string {
  const raw = value.trim();
  if (!raw) return "";
  const upper = raw.toUpperCase();
  if (upper.length === 2 && STATE_ABBRS.has(upper)) return upper;
  const key = raw.toLowerCase().replace(/\./g, "").replace(/\s+/g, " ").trim();
  return STATE_CODES[key] ?? raw;
}

/**
 * Restore a ZIP that lost its leading zeros to a spreadsheet's number formatting
 * — "1001" is Agawam MA 01001, not a 4-digit ZIP. ZIP+4 keeps its suffix; a
 * non-numeric value (a Canadian postcode, say) is left alone.
 */
export function normalizeZip(value: string): string {
  const raw = value.trim();
  if (!raw) return "";
  const plus4 = /^(\d{1,5})-(\d{4})$/.exec(raw);
  if (plus4) return `${plus4[1].padStart(5, "0")}-${plus4[2]}`;
  if (/^\d{1,5}$/.test(raw)) return raw.padStart(5, "0");
  return raw;
}

/** A person's name, cased for a dialer card rather than for a mainframe. */
export function normalizeName(value: string): string {
  return titleCase(value);
}

/** A street address, title-cased but with directionals and "PO" left uppercase. */
export function normalizeAddress(value: string): string {
  return titleCase(value, KEEP_UPPER);
}

/**
 * Reformat one extracted lead in place-safe fashion (returns a new object).
 * Only touches fields whose identity the mapping already established; the
 * free-text carriers (notes) and the typed customFields spillover are left
 * verbatim, because we don't know what they mean.
 */
export function normalizeParsedLead<T extends ParsedLead>(lead: T): T {
  const out: T = { ...lead };
  // Placeholders first: "N/A" is not a name to title-case or a state to resolve,
  // it's a blank the source system wrote a character into.
  out.firstName = normalizeName(blankIfPlaceholder(out.firstName ?? ""));
  out.lastName = normalizeName(blankIfPlaceholder(out.lastName ?? ""));
  out.email = blankIfPlaceholder(out.email ?? "").toLowerCase() || undefined;
  out.address = normalizeAddress(blankIfPlaceholder(out.address ?? "")) || undefined;
  out.city = titleCase(blankIfPlaceholder(out.city ?? "")) || undefined;
  out.state = normalizeState(blankIfPlaceholder(out.state ?? "")) || undefined;
  out.zip = normalizeZip(blankIfPlaceholder(out.zip ?? "")) || undefined;
  out.utilityProvider =
    titleCase(blankIfPlaceholder(out.utilityProvider ?? "")) || undefined;
  out.solarProvider =
    titleCase(blankIfPlaceholder(out.solarProvider ?? "")) || undefined;
  return out;
}

export function normalizeParsedLeads<T extends ParsedLead>(leads: T[]): T[] {
  return leads.map(normalizeParsedLead);
}
