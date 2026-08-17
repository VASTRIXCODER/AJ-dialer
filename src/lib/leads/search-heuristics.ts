import type { Lead, LeadStatus } from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// Natural-language lead-search heuristics — STAGE 1 of the two-stage AI search.
//
// The command palette's AI search used to stuff the viewer's entire book into
// one Claude prompt (silently sliced to the first 80 leads, so leads 81..N were
// unsearchable). It now retrieves a bounded candidate set first — via SQL when
// Supabase is configured (searchLeadCandidates in db/leads.ts), via the JS
// matcher below in demo/degraded mode — and Claude only RERANKS those
// candidates.
//
// Deliberately a PURE module (no DB / no server-only), like smart-lists.ts, so
// the same parse drives both the SQL predicates and the in-memory demo filter —
// demo and live agree on what a query means. The keyword/threshold rules mirror
// simulateSearch (src/lib/ai/simulate.ts), the deterministic demo reranker, and
// the $200 "high bill" floor matches the high_bill smart list.
// ─────────────────────────────────────────────────────────────────────────────

export interface ParsedLeadQuery {
  /** Meaningful lexical words (≥3 chars; stopwords and consumed keywords dropped). */
  tokens: string[];
  wantsEV: boolean;
  wantsPool: boolean;
  wantsBattery: boolean;
  /** Inclusive utility-bill floor in USD ("over 200", "$300", "high bill" → 200). */
  minBill: number | null;
  /** Inclusive utility-bill ceiling in USD ("under 150"). */
  maxBill: number | null;
  /** Lead statuses named in the query (new / callback / qualified / appointment / no answer). */
  statuses: LeadStatus[];
  /** "never called" / "uncontacted" / "fresh" — leads with no last_contacted_at. */
  neverCalled: boolean;
}

// Filler that carries no lexical signal — query scaffolding ("show me all the
// leads who…"), grammar words, and billing phrasing already handled by the
// structured bill predicates. Contraction stems (didn/isn/…) cover the pieces
// tokenization leaves behind ("didn't" → "didn", "t").
const STOPWORDS = new Set([
  "the", "and", "for", "with", "who", "whom", "whose", "that", "this", "these",
  "those", "are", "was", "were", "been", "being", "have", "has", "had", "does",
  "did", "all", "any", "but", "not", "out", "our", "your", "you", "they",
  "them", "their", "his", "her", "its", "from", "into", "onto", "than", "then",
  "when", "where", "which", "what", "will", "would", "could", "should", "can",
  "may", "might", "get", "got", "still", "also", "just", "very", "please",
  "like", "want", "wants", "need", "needs", "show", "find", "give", "list",
  "search", "look", "looking", "most", "more", "less", "least", "over",
  "under", "above", "below", "about", "around", "near", "between", "per",
  "month", "monthly", "bill", "bills", "billing", "pay", "pays", "paid",
  "paying", "payment", "payments", "spend", "spending", "cost", "costs",
  "lead", "leads", "homeowner", "homeowners", "people", "folks", "customer",
  "customers", "someone", "anyone", "everyone", "didn", "don", "doesn", "isn",
  "aren", "wasn", "weren", "haven", "hasn", "won", "wouldn", "couldn",
  "shouldn",
]);

// Words a structured predicate already accounts for — as bare tokens they would
// only add lexical noise (e.g. ilike "%pool%" against cities) on top of the
// structured hit, so they're dropped from `tokens`.
const CONSUMED = new Set([
  "evs", "electric", "vehicle", "vehicles", "tesla", "pool", "pools",
  "battery", "batteries", "powerwall", "storage", "callback", "callbacks",
  "booked", "appointment", "appointments", "qualified", "warm", "answer",
  "answered", "unanswered", "voicemail", "called", "never", "uncontacted",
  "contacted", "fresh", "new", "high", "expensive", "overpay", "overpaying",
  "overpaid", "frustrated", "frustrating",
]);

/** A dollar amount that plausibly reads as a monthly bill (2–4 digits, not part of a longer number). */
const AMOUNT = "\\$?\\s*(\\d{2,4})(?!\\d)";
const MIN_RE = new RegExp(`(?:over|above|at least|more than|greater than|>=?)\\s*${AMOUNT}`);
const MAX_RE = new RegExp(`(?:under|below|at most|less than|fewer than|<=?)\\s*${AMOUNT}`);
const BARE_RE = new RegExp(`(?<!\\d)${AMOUNT}`);

/** Parse a natural-language lead query into structured predicates + lexical tokens. */
export function parseLeadQuery(query: string): ParsedLeadQuery {
  const q = query.toLowerCase();

  // \bev\b (not includes("ev")) so "never called" doesn't read as an EV query.
  const wantsEV = /\bevs?\b|electric vehicle|tesla/.test(q);
  const wantsPool = /\bpools?\b/.test(q);
  const wantsBattery = /batter(?:y|ies)|powerwall|storage/.test(q);

  // Bill thresholds: an explicit direction word wins; a bare "$300" reads as a
  // floor (simulateSearch treats its threshold as >=). "High bill" language
  // implies the high_bill smart list's $200 floor only when no explicit number
  // was given — "high bills over 350" keeps 350.
  let minBill: number | null = null;
  let maxBill: number | null = null;
  const minHit = MIN_RE.exec(q);
  const maxHit = MAX_RE.exec(q);
  if (minHit) minBill = Number(minHit[1]);
  if (maxHit) maxBill = Number(maxHit[1]);
  if (!minHit && !maxHit) {
    const bare = BARE_RE.exec(q);
    if (bare) minBill = Number(bare[1]);
  }
  if (
    minBill === null &&
    maxBill === null &&
    /high bill|expensive bill|overpay|frustrat/.test(q)
  ) {
    minBill = 200;
  }

  const statuses: LeadStatus[] = [];
  if (/\bnew\b/.test(q)) statuses.push("new");
  if (/call ?backs?\b/.test(q)) statuses.push("callback");
  if (/qualified|\bwarm\b/.test(q)) statuses.push("qualified");
  if (/appointments?|booked/.test(q)) statuses.push("appointment");
  if (/no[- ]answer|n[o']t answer|unanswered/.test(q)) statuses.push("no_answer");

  const neverCalled =
    /never (?:been )?called|never contacted|uncontacted|\bfresh\b|haven'?t (?:been )?called/.test(q);

  const tokens = q
    .split(/[^a-z0-9]+/)
    .filter(
      (w) =>
        w.length >= 3 &&
        !/^\d+$/.test(w) &&
        !STOPWORDS.has(w) &&
        !CONSUMED.has(w),
    )
    // Dedupe while preserving order.
    .filter((w, i, a) => a.indexOf(w) === i);

  return { tokens, wantsEV, wantsPool, wantsBattery, minBill, maxBill, statuses, neverCalled };
}

/** Did the query express any structured (non-lexical) predicate? */
export function hasStructuredPredicates(p: ParsedLeadQuery): boolean {
  return (
    p.wantsEV ||
    p.wantsPool ||
    p.wantsBattery ||
    p.minBill !== null ||
    p.maxBill !== null ||
    p.statuses.length > 0 ||
    p.neverCalled
  );
}

/** Every structured predicate the query expressed holds for this lead (AND). */
function structuredHolds(l: Lead, p: ParsedLeadQuery): boolean {
  if (p.wantsEV && !l.hasEV) return false;
  if (p.wantsPool && !l.hasPool) return false;
  if (p.wantsBattery && !l.hasBattery) return false;
  // Bill bounds require a known bill — a NULL utility_bill fails a SQL gte/lte
  // comparison, and the JS mirror must agree.
  if (p.minBill !== null && !(l.utilityBill != null && l.utilityBill >= p.minBill)) return false;
  if (p.maxBill !== null && !(l.utilityBill != null && l.utilityBill <= p.maxBill)) return false;
  if (p.statuses.length && !p.statuses.includes(l.status)) return false;
  if (p.neverCalled && l.lastContactedAt) return false;
  return true;
}

/** Any lexical token appears in the lead's text fields (OR). */
function tokensHit(l: Lead, tokens: string[]): boolean {
  const hay = (
    `${l.firstName} ${l.lastName} ${l.city} ${l.state} ` +
    `${l.utilityProvider} ${l.solarProvider} ${l.notes ?? ""}`
  ).toLowerCase();
  return tokens.some((t) => hay.includes(t));
}

/**
 * The JS twin of the SQL candidate retrieval — used for the demo book and the
 * degraded no-service-key path. Structured predicates and lexical tokens are
 * UNIONED, never AND-required: "homeowners overpaying with an EV" has almost no
 * lexical surface, so a lexical miss must not veto a structured hit (and vice
 * versa). A query that parses to nothing at all matches everything — the caller
 * caps at the candidate limit, preserving the old first-N behavior.
 */
export function leadMatchesParsedQuery(l: Lead, p: ParsedLeadQuery): boolean {
  const structured = hasStructuredPredicates(p);
  if (structured && structuredHolds(l, p)) return true;
  if (p.tokens.length) return tokensHit(l, p.tokens);
  return !structured;
}
