import "server-only";

import { generateJSON, isAIConfigured } from "../ai/claude";
import { normalizePhone } from "../utils";
import { truePeopleSearchUrl } from "./people-search-url";
import { whitepagesSearchUrl } from "./whitepages-url";

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

// An "unlocker" / scraping-API service — the reliable way past a people-search
// site's bot protection. It fetches the page from a residential IP with a real
// browser and returns the HTML; Claude still does the extraction. This is what
// makes the automated path actually work, because a plain request from a
// datacenter IP (Vercel) gets challenged every time.
const SCRAPE_API_KEY = (process.env.SCRAPE_API_KEY ?? "").trim();
const SCRAPE_API_PROVIDER = (process.env.SCRAPE_API_PROVIDER ?? "").trim().toLowerCase();
// Escape hatch for any GET-style unlocker not named below: a template where
// {url} is the (encoded) target and {key} the API key,
// e.g. https://api.example.com/?token={key}&render=true&url={url}
const SCRAPE_API_TEMPLATE = (process.env.SCRAPE_API_URL ?? "").trim();

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

// The URL builder lives in ./whitepages-url (pure, client-safe) so the dialer
// card can build the same link in the browser. Aliased to its old name so
// existing server-side importers (and the internal call below) keep working.
export const whitepagesUrl = whitepagesSearchUrl;

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

/** Strip an HTML document down to readable text before it goes to Claude:
 *  script/style bodies are pure token cost, and tags carry nothing the
 *  extraction needs (which is the point of not using selectors). */
function htmlToText(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[ \t ]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
}

/**
 * Fetch the page with a plain HTTP request — THE DEFAULT PATH.
 *
 * No browser, no worker, no extra service to deploy or secret to share: this
 * runs inside the Next app on Vercel like any other route. It sends
 * browser-shaped headers because a bare fetch with no Accept-Language and no
 * UA is refused instantly, and Whitepages server-renders enough of a listing
 * that Claude can usually read it out of the raw HTML.
 *
 * It is more block-prone than a real browser — no JS execution, and a
 * datacenter IP. That's the trade for needing zero infrastructure, and it's
 * why SCRAPE_WORKER_URL exists as an opt-in upgrade rather than a requirement.
 */
async function fetchDirect(url: string): Promise<ScrapedPage> {
  const res = await fetch(url, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "accept-language": "en-US,en;q=0.9",
      "sec-ch-ua": '"Chromium";v="131", "Not_A Brand";v="24"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"macOS"',
      "sec-fetch-dest": "document",
      "sec-fetch-mode": "navigate",
      "sec-fetch-site": "none",
      "upgrade-insecure-requests": "1",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(25_000),
  });
  const html = await res.text().catch(() => "");
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim() ?? "";
  return {
    status: res.status,
    finalUrl: res.url || url,
    title,
    text: htmlToText(html).slice(0, 40_000),
  };
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

/** Build the unlocker request URL for a target page, or null if unconfigured.
 *  Exported for tests. */
export function scrapeApiEndpoint(target: string): string | null {
  const enc = encodeURIComponent(target);
  if (SCRAPE_API_TEMPLATE) {
    return SCRAPE_API_TEMPLATE.replace(/\{url\}/g, enc).replace(
      /\{key\}/g,
      encodeURIComponent(SCRAPE_API_KEY),
    );
  }
  if (!SCRAPE_API_KEY) return null;
  // Named presets for the two most common GET-style unlockers. `render`/
  // `render_js` runs the page's JS so the challenge is actually solved, and a
  // US geo keeps results relevant to a US phone lookup.
  switch (SCRAPE_API_PROVIDER) {
    case "scrapingbee":
      return `https://app.scrapingbee.com/api/v1/?api_key=${SCRAPE_API_KEY}&render_js=true&country_code=us&url=${enc}`;
    case "scraperapi":
    case "": // default shape — ScraperAPI-compatible
      return `https://api.scraperapi.com/?api_key=${SCRAPE_API_KEY}&render=true&country_code=us&url=${enc}`;
    default:
      return null;
  }
}

/**
 * Fetch the page through an unlocker service — the path that actually gets past
 * a people-search site's bot protection (residential IP + real browser +
 * challenge solving, done by the service). Returns the page HTML as text for
 * Claude to read, same shape as the other fetchers.
 */
async function fetchViaScrapeApi(url: string): Promise<ScrapedPage> {
  const endpoint = scrapeApiEndpoint(url);
  if (!endpoint) {
    throw new Error(
      "SCRAPE_API_KEY is set but no provider matched — set SCRAPE_API_PROVIDER " +
        "to scraperapi or scrapingbee, or SCRAPE_API_URL to a {url}/{key} template.",
    );
  }
  // Unlockers can take 20-40s on a hard target (they may retry with heavier
  // methods), so the timeout is generous.
  const res = await fetch(endpoint, { signal: AbortSignal.timeout(70_000) });
  const html = await res.text().catch(() => "");
  if (!res.ok) {
    throw new Error(`Unlocker returned ${res.status} ${res.statusText}`);
  }
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim() ?? "";
  return {
    status: res.status,
    finalUrl: url,
    title,
    text: htmlToText(html).slice(0, 40_000),
  };
}

export function isWhitepagesConfigured(): boolean {
  // The worker is the only path that works in a deployed Next app; in-process
  // Playwright is a local convenience, so "configured" means either is possible.
  return whitepagesConfigProblem() === null;
}

/**
 * What's missing for the browser-driven path, naming the exact variable.
 * Returns null when it's ready to run.
 *
 * The ordering matters: report the thing you'd fix FIRST. Someone who set
 * SCRAPE_WORKER_URL and forgot SCRAPE_SECRET needs to hear about the secret,
 * not a generic "not configured".
 */
export function whitepagesConfigProblem(provider = "whitepages"): string | null {
  // The worker is OPTIONAL. With no SCRAPE_WORKER_URL the direct-fetch path
  // runs, which needs nothing beyond a Claude key — so the only setup for a
  // scraped provider is the one variable naming it, plus the key you already
  // have. `provider` only shapes the message, not the logic (both scraped
  // providers share the same scrape config).
  if (WORKER_URL && !WORKER_SECRET) {
    return (
      "SCRAPE_WORKER_URL is set but SCRAPE_SECRET is empty — the worker will " +
      "reject every request with 401. Set both, or unset SCRAPE_WORKER_URL to " +
      "use the built-in direct lookup instead."
    );
  }
  if (!isAIConfigured()) {
    return `REVERSE_SEARCH_PROVIDER=${provider} needs ANTHROPIC_API_KEY — Claude does the extraction from the page.`;
  }
  return null;
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
 * Fetch one people-search results page and have Claude pull the numbers out.
 * The engine behind every scraped provider — pass the URL and a display name
 * for the site; the fetch, block detection and extraction are identical across
 * them, only the URL differs. Whitepages and TruePeopleSearch are thin wrappers.
 *
 * Every failure path is reported as a distinct `pageState` rather than an empty
 * list — see the header note. Throws only when the lookup could not be
 * attempted at all (no Claude key).
 */
async function scrapeAndExtract(
  url: string | null,
  site: string,
  input: WhitepagesInput,
): Promise<WhitepagesResult> {
  if (!url) {
    return { phones: [], pageState: "no_results", note: "Nothing to search on.", url: null };
  }
  if (!isAIConfigured()) {
    throw new Error(`${site} lookup needs ANTHROPIC_API_KEY — Claude does the extraction.`);
  }

  // Precedence, most-likely-to-get-through first:
  //   1. unlocker API (residential IP + real browser + challenge solving)
  //   2. own scrape worker (a real browser, but a datacenter IP)
  //   3. direct fetch (no browser, datacenter IP — blocked by protected sites)
  const page = SCRAPE_API_KEY || SCRAPE_API_TEMPLATE
    ? await fetchViaScrapeApi(url)
    : WORKER_URL
      ? await fetchViaWorker(url)
      : await fetchDirect(url);

  // Fast path: don't spend a Claude call on an obvious challenge page.
  if (looksBlocked(page)) {
    return { phones: [], pageState: "blocked", note: `${site} served a bot check instead of results.`, url };
  }
  if (!page.text.trim()) {
    return {
      phones: [],
      pageState: "blocked",
      note: `${site} returned an empty page — usually a silent block.`,
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
    schemaName: "PeopleSearchExtraction",
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

/** Whitepages, via the shared scrape engine. Numbers are often paywalled here —
 *  prefer truePeopleSearchScrape, whose numbers are free and so actually land. */
export function whitepagesReverseSearch(input: WhitepagesInput): Promise<WhitepagesResult> {
  return scrapeAndExtract(whitepagesSearchUrl(input), "Whitepages", input);
}

/** TruePeopleSearch, via the shared scrape engine. The one to reach for: it
 *  prints phone numbers for free, so the extraction has something to find. */
export function truePeopleSearchScrape(input: WhitepagesInput): Promise<WhitepagesResult> {
  return scrapeAndExtract(truePeopleSearchUrl(input), "TruePeopleSearch", input);
}
