// ─────────────────────────────────────────────────────────────────────────────
// Reverse-search scrape worker.
//
// Runs a headless Chromium, fetches one people-search result page, and returns
// its rendered text. That's ALL it does — it never parses phone numbers. The
// Next app hands the text to Claude for extraction (see
// src/lib/leads/whitepages.ts), so when the site reshuffles its markup there is
// no selector here to break.
//
// WHY THIS IS A SEPARATE SERVICE:
//   • Vercel can't run it. A headless Chromium doesn't fit a serverless
//     function's bundle and has no persistent process to live in, so the Next
//     app calls out to this instead.
//   • It is deliberately NOT bolted onto media-stream-server.mjs. That relay
//     carries live call audio; launching Chromium in the same process would put
//     browser GC pauses and ~300MB memory spikes in the path of someone's call.
//
// Run:  SCRAPE_SECRET=... PORT=8788 node server/scrape-server.mjs
// Needs: npm i playwright && npx playwright install --with-deps chromium
// ─────────────────────────────────────────────────────────────────────────────

import http from "node:http";

const SECRET = process.env.SCRAPE_SECRET || "";
if (!SECRET) {
  console.error("[scrape] SCRAPE_SECRET is required");
  process.exit(1);
}
const PORT = Number(process.env.PORT) || 8788;
/** Browser work is memory-heavy; more than a couple at once OOMs a small dyno. */
const MAX_CONCURRENT = Number(process.env.SCRAPE_CONCURRENCY) || 2;
const NAV_TIMEOUT_MS = 30_000;
const PROXY_URL =
  process.env.SCRAPE_PROXY_URL || process.env.HTTPS_PROXY || process.env.https_proxy || "";

let chromium = null;
let browser = null;
let inFlight = 0;

async function getBrowser() {
  if (!chromium) ({ chromium } = await import("playwright"));
  // One browser for the process, a fresh CONTEXT per request. Reusing the
  // browser avoids a ~1s launch per lookup; not reusing the context keeps
  // cookies from one lookup out of the next.
  if (!browser || !browser.isConnected()) {
    browser = await chromium.launch({
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
      // Escape hatch for images that already ship a Chromium (and for the
      // version skew you hit when Playwright is upgraded without re-running
      // `playwright install` — the launch error names a build number rather
      // than anything actionable).
      ...(process.env.SCRAPE_CHROMIUM_PATH
        ? { executablePath: process.env.SCRAPE_CHROMIUM_PATH }
        : {}),
      // Chromium ignores HTTPS_PROXY unless told, which matters twice over
      // here: egress-restricted hosts need it to reach anything at all, and a
      // people-search site starts refusing a datacenter IP well before it
      // refuses a residential one. Point this at a rotating proxy if lookups
      // begin coming back blocked.
      ...(PROXY_URL ? { proxy: { server: PROXY_URL } } : {}),
    });
  }
  return browser;
}

/**
 * Fetch one page and return its rendered text.
 *
 * Deliberately reports the HTTP status and the final URL alongside the text:
 * the caller needs to tell "the site served a bot check" apart from "this
 * person genuinely has no listing", and a redirect to a challenge page is the
 * clearest signal of the former.
 */
async function fetchPage(url) {
  const b = await getBrowser();
  const context = await b.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    viewport: { width: 1440, height: 900 },
    locale: "en-US",
    timezoneId: "America/Los_Angeles",
  });
  try {
    const page = await context.newPage();
    const res = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: NAV_TIMEOUT_MS,
    });
    // Give client-rendered results a moment, but never hang on a page whose
    // network never settles (ad/telemetry beacons keep many of these busy).
    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
    const text = await page.evaluate(() => document.body?.innerText ?? "");
    return {
      status: res ? res.status() : 0,
      finalUrl: page.url(),
      title: await page.title().catch(() => ""),
      text: String(text).slice(0, 40_000),
    };
  } finally {
    await context.close().catch(() => {});
  }
}

function json(res, code, body) {
  const payload = JSON.stringify(body);
  res.writeHead(code, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

const server = http.createServer((req, res) => {
  if (req.url === "/health" || req.url === "/") {
    return json(res, 200, { ok: true, inFlight, browser: Boolean(browser) });
  }
  if (req.method !== "POST" || !req.url.startsWith("/scrape")) {
    return json(res, 404, { error: "Not found" });
  }
  // Constant-length compare isn't warranted here (the secret is compared once
  // per request against a header, not brute-forceable at HTTP speed), but the
  // check must come before any work is done.
  if ((req.headers["x-scrape-secret"] || "") !== SECRET) {
    return json(res, 401, { error: "Unauthorized" });
  }
  if (inFlight >= MAX_CONCURRENT) {
    res.setHeader("Retry-After", "5");
    return json(res, 429, { error: "Scrape worker is busy" });
  }

  let raw = "";
  req.on("data", (c) => {
    raw += c;
    if (raw.length > 8192) req.destroy();
  });
  req.on("end", async () => {
    let url;
    try {
      url = new URL(String(JSON.parse(raw).url || ""));
    } catch {
      return json(res, 400, { error: "A valid absolute url is required" });
    }
    if (url.protocol !== "https:") {
      return json(res, 400, { error: "Only https urls are allowed" });
    }
    inFlight++;
    try {
      json(res, 200, await fetchPage(url.toString()));
    } catch (e) {
      json(res, 502, { error: e?.message || "Scrape failed" });
    } finally {
      inFlight--;
    }
  });
});

server.listen(PORT, () => {
  console.log(`[scrape] listening on :${PORT} (concurrency ${MAX_CONCURRENT})`);
});

for (const sig of ["SIGTERM", "SIGINT"]) {
  process.on(sig, async () => {
    await browser?.close().catch(() => {});
    process.exit(0);
  });
}
