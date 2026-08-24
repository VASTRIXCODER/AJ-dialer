import "server-only";

import { generateJSON, isAIConfigured } from "../ai/claude";
import { normalizePhone } from "../utils";

// ─────────────────────────────────────────────────────────────────────────────
// Whitepages reverse search, by browser + Claude.
//
// Drives a headless Chromium to a Whitepages results page, then hands the
// RENDERED TEXT to Claude to pull the numbers out. Claude does the extraction
// on purpose: CSS selectors against a site you don't control break silently on
// every redesign, whereas "here is a page, find the phone numbers" survives
// them. There is not one selector in this file.
//
// ── Read this before relying on it ───────────────────────────────────────────
// Whitepages actively blocks automated access and its terms forbid it. Expect
// bot challenges, and expect them to get more frequent with volume from one IP.
// The single most important behaviour here is therefore that BEING BLOCKED IS
// REPORTED AS BEING BLOCKED — never as "no number found". On a dialer those two
// are indistinguishable to the user and the second one quietly reads as "this
// person has no listed number", which is how a scraper rots in production
// without anyone noticing. `pageState` carries that distinction all the way to
// the UI.
//
// The supported-API providers (Ekata/Endato/BatchData in ./reverse-search.ts)
// remain available and are what to switch to when this starts getting blocked.
// ─────────────────────────────────────────────────────────────────────────────

const WORKER_URL = (process.env.SCRAPE_WORKER_URL ?? "").trim();
const WORKER_SECRET = (process.env.SCRAPE_SECRET ?? "").trim();

export type PageState = "results" | "no_results" | "blocked" | "paywalled";

export interface ScrapedPage {
  status: number;
  finalUrl: string;
  title: string;
  text: string;
}

export interface WhitepagesInput {
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
 * The Whitepages URL to search.
 *
 * Navigating straight to the canonical results URL rather than typing into the
 * site's search box: it is the same query with far less to go wrong (no input
 * selector, no submit button, no autocomplete dropdown to fight), and one fewer
 * page load to be challenged on.
 *
 * Address search is preferred when there's a street address — it resolves to a
 * specific household, where a name search on "John Smith, Fresno CA" returns a
 * page of different people.
 */
export function whitepagesUrl(input: WhitepagesInput): string | null {
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

/**
 * Cheap, free block detection that runs before spending a Claude call. Claude
 * re-judges the page itself (it recognises a challenge far more reliably than a
 * keyword list), so this is the fast path, not the authority.
 */
export function looksBlocked(page: ScrapedPage): boolean {
  if (page.status === 403 || page.status === 429 || page.status === 503) return true;
  const haystack = `${page.title}\n${page.text}`.toLowerCase();
  return [
    "press & hold",
    "press and hold",
    "verify you are a human",
    "are you a robot",
    "unusual traffic",
    "access denied",
    "captcha",
    "enable javascript and cookies",
    "checking your browser",
    "request blocked",
  ].some((needle) => haystack.includes(needle));
}

/** Escape hatch for bundlers: `playwright` is an optional peer dep that must
 *  never be traced into the Next build (it isn't installed on Vercel at all).
 *  A plain dynamic import() would be resolved at build time and fail there. */
const hiddenImport = new Function("s", "return import(s)") as (
  s: string,
) => Promise<Record<string, unknown>>;

/** Fetch the page in-process. Dev and self-hosted only — see the worker path. */
async function fetchInProcess(url: string): Promise<ScrapedPage> {
  let chromium: {
    launch: (o: unknown) => Promise<Record<string, (...a: unknown[]) => Promise<unknown>>>;
  };
  try {
    const mod = await hiddenImport("playwright");
    chromium = (mod as { chromium: typeof chromium }).chromium;
    if (!chromium) throw new Error("no chromium export");
  } catch {
    throw new Error(
      "No scrape backend available. Set SCRAPE_WORKER_URL to a running " +
        "server/scrape-server.mjs, or install Playwright locally " +
        "(npm i -D playwright && npx playwright install chromium).",
    );
  }
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const browser: any = await chromium.launch({
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  try {
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      viewport: { width: 1440, height: 900 },
      locale: "en-US",
    });
    const page = await context.newPage();
    const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
    return {
      status: res ? res.status() : 0,
      finalUrl: page.url(),
      title: await page.title().catch(() => ""),
      text: String(await page.evaluate(() => document.body?.innerText ?? "")).slice(0, 40_000),
    };
  } finally {
    await browser.close().catch(() => {});
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

/** Fetch the page via the Render scrape worker — the production path. */
async function fetchViaWorker(url: string): Promise<ScrapedPage> {
  const res = await fetch(`${WORKER_URL.replace(/\/+$/, "")}/scrape`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-scrape-secret": WORKER_SECRET },
    body: JSON.stringify({ url }),
    signal: AbortSignal.timeout(45_000),
  });
  const body = (await res.json().catch(() => ({}))) as Partial<ScrapedPage> & {
    error?: string;
  };
  if (!res.ok) {
    throw new Error(body.error || `Scrape worker returned ${res.status}`);
  }
  return {
    status: Number(body.status ?? 0),
    finalUrl: String(body.finalUrl ?? url),
    title: String(body.title ?? ""),
    text: String(body.text ?? ""),
  };
}

export function isWhitepagesConfigured(): boolean {
  // The worker is the only path that works in a deployed Next app; in-process
  // Playwright is a local convenience, so "configured" means either is possible.
  return Boolean((WORKER_URL && WORKER_SECRET) || process.env.NODE_ENV !== "production");
}

export interface ExtractedPhone {
  phone: string;
  lineType: "mobile" | "landline" | "voip" | "unknown";
  confidence: number | null;
  matchedName: string | null;
}

export interface WhitepagesResult {
  phones: ExtractedPhone[];
  pageState: PageState;
  /** Plain-English note from the extraction pass — shown when nothing landed. */
  note: string | null;
  url: string | null;
}

const EXTRACT_SCHEMA = {
  type: "object",
  properties: {
    pageState: {
      type: "string",
      enum: ["results", "no_results", "blocked", "paywalled"],
      description:
        "blocked = a bot check/CAPTCHA/access-denied page. paywalled = results " +
        "exist but the numbers are hidden behind signup or payment. no_results " +
        "= the page loaded fine and simply lists nobody. results = usable listings.",
    },
    note: {
      type: "string",
      description: "One short sentence on what the page showed. Empty if results.",
    },
    phones: {
      type: "array",
      items: {
        type: "object",
        properties: {
          number: { type: "string", description: "The phone number exactly as printed." },
          lineType: { type: "string", enum: ["mobile", "landline", "voip", "unknown"] },
          name: { type: "string", description: "Person this number is listed under, or empty." },
          confidence: {
            type: "number",
            description:
              "0-100, how confident you are this belongs to the person searched for. " +
              "Lower it when the page lists several people and the match is ambiguous.",
          },
        },
        required: ["number", "lineType", "name", "confidence"],
        additionalProperties: false,
      },
    },
  },
  required: ["pageState", "note", "phones"],
  additionalProperties: false,
} as const;

const SYSTEM = `You read the raw text of a people-search results page and pull out phone numbers.

Rules:
- Only return numbers actually printed on the page. Never guess, complete, or repair a partially masked number (e.g. "(559) 555-••••") — skip it and treat the page as paywalled.
- If the page is a bot check, CAPTCHA, "press & hold", or access-denied screen, set pageState to "blocked" and return no phones. This matters more than finding numbers: a blocked page reported as "no results" is worse than useless.
- If the page loaded but lists nobody matching, use "no_results".
- If listings are visible but their numbers require signup/payment to reveal, use "paywalled".
- Numbers belonging to the site itself (support lines, sales numbers in a footer or nav) are never results.
- Judge confidence against the person asked for: an exact name+address match is high; one of several same-name people is low.`;

/**
 * Look a lead up on Whitepages and extract phone numbers with Claude.
 *
 * Every failure path is reported as a distinct `pageState` rather than as an
 * empty list — see the header note. Throws only when the lookup could not be
 * attempted at all (no backend, no Claude key).
 */
export async function whitepagesReverseSearch(
  input: WhitepagesInput,
): Promise<WhitepagesResult> {
  const url = whitepagesUrl(input);
  if (!url) {
    return { phones: [], pageState: "no_results", note: "Nothing to search on.", url: null };
  }
  if (!isAIConfigured()) {
    throw new Error(
      "Whitepages lookup needs ANTHROPIC_API_KEY — Claude does the extraction.",
    );
  }

  const page = WORKER_URL ? await fetchViaWorker(url) : await fetchInProcess(url);

  // Fast path: don't spend a Claude call on an obvious challenge page.
  if (looksBlocked(page)) {
    return {
      phones: [],
      pageState: "blocked",
      note: "Whitepages served a bot check instead of results.",
      url,
    };
  }
  if (!page.text.trim()) {
    return {
      phones: [],
      pageState: "blocked",
      note: "Whitepages returned an empty page — usually a silent block.",
      url,
    };
  }

  const parsed = await generateJSON<{
    pageState: PageState;
    note: string;
    phones: { number: string; lineType: string; name: string; confidence: number }[];
  }>({
    system: SYSTEM,
    schema: EXTRACT_SCHEMA as unknown as Parameters<typeof generateJSON>[0]["schema"],
    schemaName: "WhitepagesExtraction",
    // Truncated: the useful listings are at the top of the page and the tail is
    // navigation/footer boilerplate that only costs tokens.
    prompt: [
      `Person searched for: ${[input.firstName, input.lastName].filter(Boolean).join(" ") || "(no name)"}`,
      `Address searched: ${[input.address, input.city, input.state, input.zip].filter(Boolean).join(", ") || "(none)"}`,
      `Page title: ${page.title}`,
      `Final URL: ${page.finalUrl}`,
      "",
      "PAGE TEXT:",
      page.text.slice(0, 15_000),
    ].join("\n"),
    maxTokens: 2048,
    effort: "low",
    timeoutMs: 30_000,
  });

  const seen = new Set<string>();
  const phones: ExtractedPhone[] = [];
  for (const p of parsed.phones ?? []) {
    const phone = normalizePhone(String(p.number ?? ""));
    if (!phone || seen.has(phone)) continue;
    seen.add(phone);
    const c = Number(p.confidence);
    phones.push({
      phone,
      lineType:
        p.lineType === "mobile" || p.lineType === "landline" || p.lineType === "voip"
          ? p.lineType
          : "unknown",
      confidence: Number.isFinite(c) ? Math.max(0, Math.min(100, Math.round(c))) : null,
      matchedName: String(p.name ?? "").trim() || null,
    });
  }

  // Trust Claude's read over the phone count: a page it judged "blocked" with a
  // stray footer number in it is still blocked.
  const pageState: PageState =
    parsed.pageState === "blocked" || parsed.pageState === "paywalled"
      ? parsed.pageState
      : phones.length
        ? "results"
        : "no_results";

  return { phones, pageState, note: String(parsed.note ?? "").trim() || null, url };
}
