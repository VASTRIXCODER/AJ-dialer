import { describe, expect, it, vi } from "vitest";

const TARGET = "https://www.truepeoplesearch.com/results?streetaddress=1200+Maple+St&citystatezip=Fresno%2C+CA";

/** Env is read at module load, so each case needs a fresh module registry. */
async function unlockersWith(env: Record<string, string | undefined>) {
  vi.resetModules();
  const prev = { ...process.env };
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  const mod = await import("@/lib/leads/whitepages");
  const out = mod.configuredUnlockers().map((u) => ({ name: u.name, url: u.endpoint(TARGET) }));
  process.env = prev;
  return out;
}

const BASE = {
  SCRAPERAPI_KEY: undefined,
  SCRAPINGBEE_KEY: undefined,
  SCRAPE_API_URL: undefined,
  SCRAPE_API_KEY: undefined,
  SCRAPE_API_PROVIDER: undefined,
};

describe("configuredUnlockers", () => {
  it("is empty when nothing is configured", async () => {
    expect(await unlockersWith(BASE)).toEqual([]);
  });

  it("builds a ScraperAPI endpoint and encodes the target", async () => {
    const [u] = await unlockersWith({ ...BASE, SCRAPERAPI_KEY: "KEY123" });
    expect(u.name).toBe("ScraperAPI");
    expect(u.url).toContain("https://api.scraperapi.com/");
    expect(u.url).toContain("api_key=KEY123");
    expect(u.url).toContain("render=true");
    // The target must be percent-encoded so its own query string doesn't merge
    // into the unlocker's.
    expect(u.url).toContain(`url=${encodeURIComponent(TARGET)}`);
    expect(u.url).not.toContain("streetaddress=1200"); // i.e. not left raw
  });

  it("builds a ScrapingBee endpoint with render_js", async () => {
    const [u] = await unlockersWith({ ...BASE, SCRAPINGBEE_KEY: "BEE" });
    expect(u.name).toBe("ScrapingBee");
    expect(u.url).toContain("https://app.scrapingbee.com/api/v1/");
    expect(u.url).toContain("api_key=BEE");
    expect(u.url).toContain("render_js=true");
  });

  it("configures BOTH for failover, ScraperAPI first", async () => {
    const list = await unlockersWith({ ...BASE, SCRAPERAPI_KEY: "A", SCRAPINGBEE_KEY: "B" });
    expect(list.map((u) => u.name)).toEqual(["ScraperAPI", "ScrapingBee"]);
  });

  it("fills a custom template's {url} and {key} placeholders", async () => {
    const [u] = await unlockersWith({
      ...BASE,
      SCRAPE_API_URL: "https://api.example.com/?token={key}&render=1&url={url}",
      SCRAPE_API_KEY: "T0K",
    });
    expect(u.url).toBe(
      `https://api.example.com/?token=T0K&render=1&url=${encodeURIComponent(TARGET)}`,
    );
  });

  it("honors the legacy single-var form when no named key is set", async () => {
    const bee = await unlockersWith({
      ...BASE,
      SCRAPE_API_KEY: "L",
      SCRAPE_API_PROVIDER: "scrapingbee",
    });
    expect(bee[0].name).toBe("ScrapingBee");
    const scr = await unlockersWith({ ...BASE, SCRAPE_API_KEY: "L" }); // default shape
    expect(scr[0].name).toBe("ScraperAPI");
  });

  it("does not double-count the legacy var when a named key is present", async () => {
    const list = await unlockersWith({ ...BASE, SCRAPERAPI_KEY: "A", SCRAPE_API_KEY: "L" });
    expect(list.map((u) => u.name)).toEqual(["ScraperAPI"]);
  });
});
