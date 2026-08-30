import { readFileSync as readFileSyncDnc } from "node:fs";
import { resolve as resolveDnc } from "node:path";
const __dirnameDnc = __dirname;
import { describe, expect, it } from "vitest";
import { dncKey, scrubDnc } from "@/lib/db/dnc";

describe("dncKey", () => {
  it("normalizes to the last 10 digits", () => {
    expect(dncKey("+14155551234")).toBe("4155551234");
    expect(dncKey("(415) 555-1234")).toBe("4155551234");
    expect(dncKey("1-415-555-1234")).toBe("4155551234");
  });

  it("returns '' for anything not dialable", () => {
    expect(dncKey("12345")).toBe("");
    expect(dncKey("")).toBe("");
  });
});

describe("scrubDnc", () => {
  const leads = [{ phone: "+14155551234" }, { phone: "+13105550000" }, { phone: "bad" }];

  it("drops leads whose number is on the suppression set", () => {
    const kept = scrubDnc(leads, new Set(["4155551234"]));
    expect(kept.map((l) => l.phone)).toEqual(["+13105550000", "bad"]);
  });

  it("returns the list unchanged when the set is empty", () => {
    expect(scrubDnc(leads, new Set())).toBe(leads);
  });

  it("keeps un-keyable numbers (a garbled phone isn't a match)", () => {
    const kept = scrubDnc([{ phone: "bad" }], new Set(["4155551234"]));
    expect(kept).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The suppression scrub fails CLOSED.
//
// `getDncDigits` destructured `data` alone and returned `new Set(data ?? [])`
// inside a try/catch. supabase-js does not throw on a failed read — it RESOLVES
// `{ data: null, error }` — so a transient database error produced an EMPTY
// SUPPRESSION SET and the catch never fired.
//
// Twelve callers read that as "nobody has asked us not to call them": the
// manual dial route, the session builder, the import scrub, the export, the
// messaging gate and the orchestration engine among them. One failed read on
// any of those paths meant dialing, importing or messaging straight through the
// entire Do-Not-Call list, silently.
//
// It is the same supabase-js behaviour the zero rule exists for, with the
// consequence turned all the way up: there a number renders as 0, here a
// suppression stops existing.
// ─────────────────────────────────────────────────────────────────────────────

describe("a Do-Not-Call read that fails is not an empty list", () => {
  const ROOT = resolveDnc(__dirnameDnc, "..");
  const readDnc = (p: string) => readFileSyncDnc(resolveDnc(ROOT, p), "utf8");

  it("getDncDigits inspects the error and refuses rather than returning nothing", () => {
    const source = readDnc("src/lib/db/dnc.ts");
    const fn = source.slice(source.indexOf("export async function getDncDigits"));
    const body = fn.slice(0, fn.indexOf("\n}"));
    expect(body, "the error is never read").toMatch(/const \{ data, error \}/);
    expect(body, "an error does not stop it").toMatch(/if \(error\) throw new DncUnavailableError/);
    // The catch that swallowed everything, including a real network failure.
    expect(body, "a catch here turns any failure back into an empty set").not.toMatch(
      /catch\s*\{/,
    );
  });

  it("no reader of the suppression list defaults a failed query to empty", () => {
    // `data ?? []` on a dnc_numbers read is the exact shape of the bug.
    const source = readDnc("src/lib/db/dnc.ts")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(?<!:)\/\/.*$/gm, "");
    for (const m of source.matchAll(/const \{ data \} = await admin[\s\S]{0,200}?dnc_numbers/g)) {
      throw new Error(`A dnc_numbers read ignores its error: ${m[0].slice(0, 80)}`);
    }
  });

  it("the dial route turns the refusal into a sentence, not a stack trace", () => {
    const route = readDnc("src/app/api/twilio/call/route.ts");
    expect(route).toMatch(/Couldn't check the Do-Not-Call list just now, so nothing was dialed/);
    expect(route, "a 503 says try again; a 500 says the request was wrong").toMatch(
      /status: 503/,
    );
  });

  it("demo mode still has no list, rather than an unreadable one", () => {
    const source = readDnc("src/lib/db/dnc.ts");
    const fn = source.slice(source.indexOf("export async function getDncDigits"));
    expect(fn.slice(0, 400)).toMatch(/!isAdminConfigured\(\)\) return new Set\(\)/);
  });

  it("the admin table shows the date it sorts by", () => {
    // created_at was stored, selected, ordered by, exported to CSV — and the
    // one screen that lists suppressions never displayed it.
    const manager = readDnc("src/components/admin/dnc-manager.tsx");
    expect(manager).toMatch(/>Added</);
    expect(manager).toMatch(/relativeTime\(e\.createdAt\)/);
  });
});
