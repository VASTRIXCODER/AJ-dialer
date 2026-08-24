import "server-only";

import { normalizePhone } from "../utils";
import { truePeopleSearchUrl } from "./people-search-url";
import {
  isWhitepagesConfigured,
  truePeopleSearchScrape,
  whitepagesConfigProblem,
  whitepagesReverseSearch,
  whitepagesUrl,
} from "./whitepages";

// ─────────────────────────────────────────────────────────────────────────────
// Reverse search (skip trace) — name and/or address → phone number.
//
// A thin provider layer: pick whichever source the org has, and the dialer
// treats them identically. Two kinds sit behind one interface:
//
//   • CONTRACTED APIs — Ekata (which is where Whitepages' own data is sold,
//     under Mastercard), Endato, BatchData. Keyed, billed, reliable.
//   • whitepages — reads the public site directly and has Claude pull the
//     numbers out of the page (see ./whitepages.ts). No account needed, and
//     no infrastructure in its default form. It is also the one that can be
//     BLOCKED, because the site forbids automated access and enforces it.
//
// The blocked case is why ReverseSearchResult carries `pageState` rather than
// just an empty array: on a dialer, "blocked" reported as "no results" reads
// as "this person has no listed number", and the feature rots unnoticed.
//
// SHAPE DRIFT: each adapter below builds its request from the vendor's
// published API docs (auth headers and body shape must be exact or the call
// 401s). RESPONSE parsing deliberately does NOT trust one documented JSON
// path — harvestPhones() walks whatever comes back looking for phone-shaped
// values. Skip-trace payloads vary by plan tier and endpoint version, and a
// hardcoded path that silently misses is the same invisible-failure trap as
// the scraper. Get the auth right; be generous about the reply.
//
// COMPLIANCE: this module only LOOKS UP. It deliberately does not decide what
// is callable — the API route scrubs results against the org's DNC list before
// they ever reach the UI, because a number sourced from a data broker has not
// been consented to the way a number a homeowner typed into a form has.
// ─────────────────────────────────────────────────────────────────────────────

export type ReverseSearchProvider =
  | "ekata"
  | "endato"
  | "batchdata"
  | "whitepages"
  | "truepeoplesearch";

/** The two scraped (browser/HTTP + Claude) providers, as opposed to the keyed
 *  API vendors. They share the same config: an optional worker, plus a Claude
 *  key for the extraction. */
const SCRAPED: ReverseSearchProvider[] = ["whitepages", "truepeoplesearch"];

const PROVIDER = (process.env.REVERSE_SEARCH_PROVIDER ?? "").trim().toLowerCase();
const API_KEY = (process.env.REVERSE_SEARCH_API_KEY ?? "").trim();
const API_SECRET = (process.env.REVERSE_SEARCH_API_SECRET ?? "").trim();

/** Vendors whose adapter needs a second credential (a user/password pair). */
const NEEDS_SECRET: ReverseSearchProvider[] = ["endato"];

function activeProvider(): ReverseSearchProvider | null {
  // The scraped providers have no API key of their own — they need a Claude key
  // (and optionally a scrape worker), checked in ./whitepages.ts.
  if ((SCRAPED as string[]).includes(PROVIDER)) {
    return isWhitepagesConfigured() ? (PROVIDER as ReverseSearchProvider) : null;
  }
  if (PROVIDER !== "ekata" && PROVIDER !== "endato" && PROVIDER !== "batchdata") {
    return null;
  }
  if (!API_KEY) return null;
  if (NEEDS_SECRET.includes(PROVIDER) && !API_SECRET) return null;
  return PROVIDER;
}

/**
 * Why the configured provider isn't usable, in words that name the exact env
 * var to set. Null when nothing is configured at all (the demo path is then
 * correct and expected) or when everything is in place.
 *
 * This exists because "no lookup provider is configured" is the same message
 * whether you set nothing or set REVERSE_SEARCH_PROVIDER and forgot one
 * credential — and the second case looks like the feature is broken. Half-
 * configured has to say which half.
 */
export function reverseSearchConfigProblem(): string | null {
  if (!PROVIDER) return null; // nothing set — demo is the intended behaviour
  const known: string[] = ["ekata", "endato", "batchdata", "whitepages", "truepeoplesearch"];
  if (!known.includes(PROVIDER)) {
    return `REVERSE_SEARCH_PROVIDER is "${PROVIDER}", which isn't one of: ${known.join(", ")}.`;
  }
  if ((SCRAPED as string[]).includes(PROVIDER)) return whitepagesConfigProblem(PROVIDER);
  if (!API_KEY) {
    return `REVERSE_SEARCH_PROVIDER is "${PROVIDER}" but REVERSE_SEARCH_API_KEY is empty.`;
  }
  if (NEEDS_SECRET.includes(PROVIDER as ReverseSearchProvider) && !API_SECRET) {
    return `REVERSE_SEARCH_PROVIDER is "${PROVIDER}", which also needs REVERSE_SEARCH_API_SECRET.`;
  }
  return null;
}

/** True when a skip-trace vendor is configured. False ⇒ the demo path. */
export function isReverseSearchConfigured(): boolean {
  return activeProvider() !== null;
}

/** The configured vendor's name, for the UI's "source" badge. */
export function reverseSearchProviderName(): string | null {
  const p = activeProvider();
  return p ? PROVIDER_LABEL[p] : null;
}

const PROVIDER_LABEL: Record<ReverseSearchProvider, string> = {
  ekata: "Ekata",
  endato: "Endato",
  batchdata: "BatchData",
  whitepages: "Whitepages",
  truepeoplesearch: "TruePeopleSearch",
};

export interface ReverseSearchInput {
  firstName?: string | null;
  lastName?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
}

export type LineType = "mobile" | "landline" | "voip" | "unknown";

export interface PhoneCandidate {
  /** E.164, normalized. Never returned unnormalizable. */
  phone: string;
  lineType: LineType;
  /** 0-100 when the vendor scores its matches; null when it doesn't. Never
   *  invented — an absent score shows as "no score", not as a guess. */
  confidence: number | null;
  /** The name the vendor matched this number to, when it says. Lets a rep spot
   *  a wrong-person match before dialing a stranger. */
  matchedName: string | null;
}

export interface ReverseSearchResult {
  candidates: PhoneCandidate[];
  /** "provider" = a real vendor answered. "demo" = nothing configured. */
  source: "provider" | "demo";
  provider: string | null;
  error: string | null;
  /**
   * Why the list is empty, when it is. THE POINT of this field is that
   * "blocked" and "no_results" must never look alike: on a dialer, a bot
   * challenge reported as "no numbers found" reads as "this person has no
   * listing", and the feature rots in production with nobody noticing.
   * API providers only ever answer "results"/"no_results"; the browser-driven
   * Whitepages path is the one that can be blocked or paywalled.
   */
  pageState: "results" | "no_results" | "blocked" | "paywalled";
  /** Short human explanation for a non-"results" state. */
  note: string | null;
  /**
   * The page a human could open to see this themselves. Automation gets
   * blocked; a rep's own browser — real IP, real session, already trusted —
   * does not. So when the automated read fails, handing over the exact URL
   * turns a dead end into one click, which beats any amount of cleverness
   * spent trying to look less like a robot.
   */
  searchUrl: string | null;
}

/** Enough to search on? A bare first name would match half a state. */
export function hasSearchableIdentity(input: ReverseSearchInput): boolean {
  const name = `${input.firstName ?? ""} ${input.lastName ?? ""}`.trim();
  const hasAddress = Boolean(
    (input.address ?? "").trim() &&
      ((input.city ?? "").trim() || (input.zip ?? "").trim()),
  );
  // An address alone is searchable (reverse-address lookup). A name alone is
  // not — it needs at least a city/state/zip to be narrowed to a person.
  const hasLocatedName = Boolean(
    name &&
      ((input.city ?? "").trim() || (input.zip ?? "").trim() || (input.state ?? "").trim()),
  );
  return hasAddress || hasLocatedName;
}

// ── Response harvesting ──────────────────────────────────────────────────────

const PHONE_KEY = /(phone|tel|mobile|cell|caller|contact_?number|^number$)/i;
const TYPE_KEY = /(line_?type|phone_?type|^type$)/i;
const SCORE_KEY = /(confidence|match_?score|^score$|reputation_?level)/i;
const NAME_KEY = /(^name$|full_?name|person_?name|owner_?name)/i;

function toLineType(v: unknown): LineType {
  const s = String(v ?? "").toLowerCase();
  if (!s) return "unknown";
  if (s.includes("mobile") || s.includes("cell") || s.includes("wireless")) return "mobile";
  if (s.includes("voip") || s.includes("nonfixedvoip")) return "voip";
  if (s.includes("land") || s.includes("fixed") || s.includes("residential")) return "landline";
  return "unknown";
}

function toConfidence(v: unknown): number | null {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  // Vendors score 0-1 or 0-100 depending on the field; normalize to 0-100.
  const scaled = n > 0 && n <= 1 ? n * 100 : n;
  if (scaled < 0 || scaled > 100) return null;
  return Math.round(scaled);
}

/**
 * Pull phone candidates out of an arbitrary vendor JSON payload.
 *
 * Two passes, deliberately in this order:
 *   1. Values under a phone-ish KEY ("phone", "phoneNumber", "line", …). This
 *      is the trustworthy pass — the key tells us it's a phone.
 *   2. Only if pass 1 found nothing: any string that BOTH normalizes to a
 *      valid NANP number AND is punctuated like a phone ("+1 559-555-0143"),
 *      so a bare 10-digit account id can't be mistaken for a number to dial.
 *
 * Metadata (line type, score, matched name) is read from the phone's SIBLING
 * keys — in every vendor shape seen, a phone object carries its own type and
 * score alongside the number.
 */
export function harvestPhones(payload: unknown): PhoneCandidate[] {
  const found = new Map<string, PhoneCandidate>();

  const record = (
    raw: unknown,
    siblings: Record<string, unknown> | null,
    inheritedName: string | null,
  ) => {
    const phone = normalizePhone(String(raw ?? ""));
    if (!phone) return;
    if (found.has(phone)) return;
    let lineType: LineType = "unknown";
    let confidence: number | null = null;
    let matchedName: string | null = inheritedName;
    if (siblings) {
      for (const [k, v] of Object.entries(siblings)) {
        if (v && typeof v === "object") continue;
        if (lineType === "unknown" && TYPE_KEY.test(k)) lineType = toLineType(v);
        if (confidence === null && SCORE_KEY.test(k)) confidence = toConfidence(v);
        if (!matchedName && NAME_KEY.test(k) && typeof v === "string" && v.trim()) {
          matchedName = v.trim();
        }
      }
    }
    found.set(phone, { phone, lineType, confidence, matchedName });
  };

  // A name at any level is inherited by phones nested beneath it, so
  // { name: "Jane Doe", phones: [{ number: … }] } attributes correctly.
  const walk = (node: unknown, keyed: boolean, nameCtx: string | null) => {
    if (node === null || node === undefined) return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item, keyed, nameCtx);
      return;
    }
    if (typeof node === "object") {
      const obj = node as Record<string, unknown>;
      let localName = nameCtx;
      for (const [k, v] of Object.entries(obj)) {
        if (NAME_KEY.test(k) && typeof v === "string" && v.trim()) localName = v.trim();
        // A name can also be an object: { name: { first, last } }.
        if (NAME_KEY.test(k) && v && typeof v === "object" && !Array.isArray(v)) {
          const parts = Object.values(v as Record<string, unknown>)
            .filter((x): x is string => typeof x === "string" && x.trim().length > 0);
          if (parts.length) localName = parts.join(" ").trim();
        }
      }
      for (const [k, v] of Object.entries(obj)) {
        if (v && typeof v === "object") {
          // Descend. A phone-ish key marks everything under it as phone data.
          walk(v, keyed || PHONE_KEY.test(k), localName);
        } else if (keyed || PHONE_KEY.test(k)) {
          record(v, obj, localName);
        }
      }
      return;
    }
    // A scalar reached under a phone-ish key (e.g. phones: ["559…"]).
    if (keyed) record(node, null, nameCtx);
  };

  walk(payload, false, null);
  if (found.size) return [...found.values()];

  // Pass 2 — nothing sat under a phone-ish key. Sweep for punctuated numbers
  // only, so a plain 10-digit identifier is never mistaken for a phone.
  const sweep = (node: unknown) => {
    if (node === null || node === undefined) return;
    if (Array.isArray(node)) return node.forEach(sweep);
    if (typeof node === "object") return Object.values(node).forEach(sweep);
    if (typeof node !== "string") return;
    if (!/[+()\-.\s]/.test(node)) return; // must LOOK like a phone, not just parse as one
    const phone = normalizePhone(node);
    if (phone && !found.has(phone)) {
      found.set(phone, { phone, lineType: "unknown", confidence: null, matchedName: null });
    }
  };
  sweep(payload);
  return [...found.values()];
}

// ── Vendor adapters ──────────────────────────────────────────────────────────
// Each returns the raw parsed JSON; harvestPhones does the extraction.

const TIMEOUT_MS = 15_000;

async function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
): Promise<unknown> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
    if (!res.ok) {
      throw new Error(`${res.status} ${res.statusText}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function getJson(url: string, headers: Record<string, string> = {}): Promise<unknown> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers, signal: ctl.signal });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** Ekata (Mastercard) — the supported home of Whitepages' own data. */
async function queryEkata(input: ReverseSearchInput): Promise<unknown> {
  const qs = new URLSearchParams({ api_key: API_KEY, country_code: "US" });
  if (input.address) qs.set("street_line_1", input.address);
  if (input.city) qs.set("city", input.city);
  if (input.state) qs.set("state_code", input.state);
  if (input.zip) qs.set("postal_code", input.zip);
  return getJson(`https://api.ekata.com/3.0/reverse_address?${qs.toString()}`);
}

/** Endato (formerly Enformion) — name + address contact enrichment. */
async function queryEndato(input: ReverseSearchInput): Promise<unknown> {
  return postJson(
    "https://devapi.endato.com/Contact/Enrich",
    {
      "galaxy-ap-name": API_KEY,
      "galaxy-ap-password": API_SECRET,
      "galaxy-search-type": "DevAPIContactEnrich",
    },
    {
      FirstName: input.firstName ?? "",
      LastName: input.lastName ?? "",
      Address: {
        addressLine1: input.address ?? "",
        addressLine2: [input.city, input.state, input.zip].filter(Boolean).join(", "),
      },
    },
  );
}

/** BatchData — property-address-centric skip trace. */
async function queryBatchData(input: ReverseSearchInput): Promise<unknown> {
  return postJson(
    "https://api.batchdata.com/api/v1/property/skip-trace",
    { authorization: `Bearer ${API_KEY}` },
    {
      requests: [
        {
          propertyAddress: {
            street: input.address ?? "",
            city: input.city ?? "",
            state: input.state ?? "",
            zip: input.zip ?? "",
          },
          ...(input.firstName || input.lastName
            ? { name: { first: input.firstName ?? "", last: input.lastName ?? "" } }
            : {}),
        },
      ],
    },
  );
}

/**
 * Deterministic stand-in for demo mode, using the 555-0100..0199 block the
 * NANP reserves for fiction — so a demo result can never route to a real
 * person even if something downstream tried to dial it. Derived from the
 * lead's own details so the same lead always "finds" the same number and the
 * UI is stable to click through.
 */
function demoCandidates(input: ReverseSearchInput): PhoneCandidate[] {
  const seed = `${input.firstName ?? ""}${input.lastName ?? ""}${input.address ?? ""}${input.zip ?? ""}`;
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (Math.imul(h, 31) + seed.charCodeAt(i)) >>> 0;
  // 213 is a real area code but 555-01xx within it is reserved for fiction, so
  // the result reads as a plausible LA number while being unroutable.
  const areaCode = "213";
  const line = 100 + (h % 100);
  const name = `${input.firstName ?? ""} ${input.lastName ?? ""}`.trim() || null;
  return [
    {
      phone: `+1${areaCode}5550${line}`,
      lineType: h % 2 === 0 ? "mobile" : "landline",
      confidence: 70 + (h % 25),
      matchedName: name,
    },
  ];
}

/** Hard cap on what one search returns — a skip trace on a common name can
 *  come back with dozens of numbers, and a rep is choosing one to dial. */
const MAX_CANDIDATES = 8;

/**
 * Look up phone numbers for a lead's name/address.
 *
 * Never throws: a vendor outage, a bad key or an unexpected payload all come
 * back as an empty candidate list with `error` set, because the caller is an
 * interactive button on the dialer and a 500 there reads as "the dialer is
 * broken" rather than "that lookup didn't find anything".
 */
export async function reverseSearch(
  input: ReverseSearchInput,
): Promise<ReverseSearchResult> {
  const provider = activeProvider();
  if (!provider) {
    return {
      candidates: demoCandidates(input).slice(0, MAX_CANDIDATES),
      source: "demo",
      provider: null,
      error: null,
      pageState: "results",
      note: null,
      searchUrl: null,
    };
  }

  // The scraped paths have their own result shape (they can be blocked or
  // paywalled, which no API provider can be), so they return separately rather
  // than being squeezed through harvestPhones.
  if ((SCRAPED as string[]).includes(provider)) {
    const label = PROVIDER_LABEL[provider];
    try {
      const wp =
        provider === "truepeoplesearch"
          ? await truePeopleSearchScrape(input)
          : await whitepagesReverseSearch(input);
      return {
        candidates: wp.phones.slice(0, MAX_CANDIDATES),
        source: "provider",
        provider: label,
        error: null,
        pageState: wp.pageState,
        note: wp.note,
        searchUrl: wp.url,
      };
    } catch (e) {
      return {
        candidates: [],
        source: "provider",
        provider: label,
        error: e instanceof Error ? `${label} lookup failed: ${e.message}` : `${label} lookup failed.`,
        pageState: "no_results",
        note: null,
        searchUrl:
          provider === "truepeoplesearch" ? truePeopleSearchUrl(input) : whitepagesUrl(input),
      };
    }
  }

  try {
    const payload =
      provider === "ekata"
        ? await queryEkata(input)
        : provider === "endato"
          ? await queryEndato(input)
          : await queryBatchData(input);

    const candidates = harvestPhones(payload)
      // Highest-confidence first; a scored match beats an unscored one, and
      // mobiles beat landlines at equal confidence (a homeowner answers their
      // cell). Stable otherwise, so vendor order survives as the tiebreak.
      .sort((a, b) => {
        const ca = a.confidence ?? -1;
        const cb = b.confidence ?? -1;
        if (cb !== ca) return cb - ca;
        const rank = (t: LineType) => (t === "mobile" ? 0 : t === "unknown" ? 1 : 2);
        return rank(a.lineType) - rank(b.lineType);
      })
      .slice(0, MAX_CANDIDATES);

    return {
      candidates,
      source: "provider",
      provider: PROVIDER_LABEL[provider],
      error: null,
      pageState: candidates.length ? "results" : "no_results",
      note: null,
      searchUrl: null,
    };
  } catch (e) {
    return {
      candidates: [],
      source: "provider",
      provider: PROVIDER_LABEL[provider],
      error:
        e instanceof Error
          ? `${PROVIDER_LABEL[provider]} lookup failed: ${e.message}`
          : `${PROVIDER_LABEL[provider]} lookup failed.`,
      pageState: "no_results",
      note: null,
      searchUrl: null,
    };
  }
}
