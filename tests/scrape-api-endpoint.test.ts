import { describe, expect, it, vi } from "vitest";

const TARGET = "https://www.truepeoplesearch.com/results?streetaddress=1200+Maple+St&citystatezip=Fresno%2C+CA";

/** Env is read at module load, so each case needs a fresh module registry. */
async function endpointWith(env: Record<string, string | undefined>) {
  vi.resetModules();
  const prev = { ...process.env };
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  const mod = await import("@/lib/leads/whitepages");
  const out = mod.scrapeApiEndpoint(TARGET);
  process.env = prev;
  return out;
}

const BASE = {
  SCRAPE_API_KEY: undefined,
  SCRAPE_API_PROVIDER: undefined,
  SCRAPE_API_URL: undefined,
};

describe("scrapeApiEndpoint", () => {
  it("returns null when no unlocker is configured", async () => {
    expect(await endpointWith(BASE)).toBeNull();
  });

  it("builds a ScraperAPI URL and encodes the target", async () => {
    const url = await endpointWith({
      ...BASE,
      SCRAPE_API_PROVIDER: "scraperapi",
      SCRAPE_API_KEY: "KEY123",
    });
    expect(url).toContain("https://api.scraperapi.com/");
    expect(url).toContain("api_key=KEY123");
    expect(url).toContain("render=true");
    // The target must be percent-encoded so its own query string doesn't merge
    // into the unlocker's.
    expect(url).toContain(`url=${encodeURIComponent(TARGET)}`);
    expect(url).not.toContain("streetaddress=1200"); // i.e. not left raw
  });

  it("defaults to the ScraperAPI shape when a key is set with no provider", async () => {
    const url = await endpointWith({ ...BASE, SCRAPE_API_KEY: "K" });
    expect(url).toContain("api.scraperapi.com");
  });

  it("builds a ScrapingBee URL with render_js", async () => {
    const url = await endpointWith({
      ...BASE,
      SCRAPE_API_PROVIDER: "scrapingbee",
      SCRAPE_API_KEY: "BEE",
    });
    expect(url).toContain("https://app.scrapingbee.com/api/v1/");
    expect(url).toContain("api_key=BEE");
    expect(url).toContain("render_js=true");
  });

  it("fills a custom template's {url} and {key} placeholders", async () => {
    const url = await endpointWith({
      ...BASE,
      SCRAPE_API_URL: "https://api.example.com/?token={key}&render=1&url={url}",
      SCRAPE_API_KEY: "T0K",
    });
    expect(url).toBe(
      `https://api.example.com/?token=T0K&render=1&url=${encodeURIComponent(TARGET)}`,
    );
  });

  it("prefers a custom template over the named presets", async () => {
    const url = await endpointWith({
      ...BASE,
      SCRAPE_API_URL: "https://custom.example/?u={url}",
      SCRAPE_API_PROVIDER: "scraperapi",
      SCRAPE_API_KEY: "K",
    });
    expect(url).toContain("custom.example");
    expect(url).not.toContain("scraperapi");
  });

  it("returns null for an unknown named provider (so it fails loudly, not silently mis-fetches)", async () => {
    const url = await endpointWith({
      ...BASE,
      SCRAPE_API_PROVIDER: "somethingelse",
      SCRAPE_API_KEY: "K",
    });
    expect(url).toBeNull();
  });
});
