import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";

/** Env is read at module load, so each case needs a fresh module registry. */
async function problemWith(env: Record<string, string | undefined>) {
  vi.resetModules();
  const prev = { ...process.env };
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  const mod = await import("@/lib/leads/reverse-search");
  const out = mod.reverseSearchConfigProblem();
  process.env = prev;
  return out;
}

const BASE = {
  REVERSE_SEARCH_PROVIDER: undefined,
  REVERSE_SEARCH_API_KEY: undefined,
  REVERSE_SEARCH_API_SECRET: undefined,
  SCRAPE_WORKER_URL: undefined,
  SCRAPE_SECRET: undefined,
  ANTHROPIC_API_KEY: undefined,
  NODE_ENV: "production",
};

describe("reverseSearchConfigProblem", () => {
  it("is silent when nothing is configured (demo is intended)", async () => {
    expect(await problemWith(BASE)).toBeNull();
  });

  it("names an unknown provider value", async () => {
    const p = await problemWith({ ...BASE, REVERSE_SEARCH_PROVIDER: "whitepgaes" });
    expect(p).toMatch(/whitepgaes/);
    expect(p).toMatch(/ekata, endato, batchdata, whitepages/);
  });

  it("names the missing API key for an API provider", async () => {
    const p = await problemWith({ ...BASE, REVERSE_SEARCH_PROVIDER: "ekata" });
    expect(p).toMatch(/REVERSE_SEARCH_API_KEY/);
  });

  it("names the missing secret for Endato specifically", async () => {
    const p = await problemWith({
      ...BASE,
      REVERSE_SEARCH_PROVIDER: "endato",
      REVERSE_SEARCH_API_KEY: "k",
    });
    expect(p).toMatch(/REVERSE_SEARCH_API_SECRET/);
  });

  it("is silent for a fully-configured API provider", async () => {
    expect(
      await problemWith({
        ...BASE,
        REVERSE_SEARCH_PROVIDER: "ekata",
        REVERSE_SEARCH_API_KEY: "k",
      }),
    ).toBeNull();
  });

  it("tells a deployed whitepages setup it needs the worker url", async () => {
    const p = await problemWith({ ...BASE, REVERSE_SEARCH_PROVIDER: "whitepages" });
    expect(p).toMatch(/SCRAPE_WORKER_URL/);
  });

  it("catches worker url set but secret missing — the 401 trap", async () => {
    const p = await problemWith({
      ...BASE,
      REVERSE_SEARCH_PROVIDER: "whitepages",
      SCRAPE_WORKER_URL: "https://w.example.com",
    });
    expect(p).toMatch(/SCRAPE_SECRET/);
    expect(p).toMatch(/401/);
  });

  it("catches a whitepages setup with no Claude key", async () => {
    const p = await problemWith({
      ...BASE,
      REVERSE_SEARCH_PROVIDER: "whitepages",
      SCRAPE_WORKER_URL: "https://w.example.com",
      SCRAPE_SECRET: "s",
    });
    expect(p).toMatch(/ANTHROPIC_API_KEY/);
  });

  it("is silent for a fully-configured whitepages setup", async () => {
    expect(
      await problemWith({
        ...BASE,
        REVERSE_SEARCH_PROVIDER: "whitepages",
        SCRAPE_WORKER_URL: "https://w.example.com",
        SCRAPE_SECRET: "s",
        ANTHROPIC_API_KEY: "sk-ant-x",
      }),
    ).toBeNull();
  });
});
