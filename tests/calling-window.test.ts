import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { isWithinOrgHours } from "@/lib/dialer/schedule";
import { resolveLeadTimezone } from "@/lib/dialer/lead-timezone";

// ─────────────────────────────────────────────────────────────────────────────
// Calling hours follow the CALLED PARTY's clock. That is the whole point, and
// it is the one rule in this product that four different places had four
// different answers to:
//
//   twilio/call/route.ts      resolveLeadTimezone(phone, null, orgTz)   ✓ area code
//   elevenlabs/call/route.ts  resolveLeadTimezone(phone, lead.tz, org)  ✗ poisoned by a column default
//   my-day.ts                 s(lead.timezone) || orgTz                 ✗ never consulted the area code
//   eligibility.ts            resolveLeadTimezone(phone, lead.tz, …)    ✗ same column default
//
// All four now go through `resolveLeadTimezone`, and that function ignores the
// value `leads.timezone` carries by default (see storedLeadTimezone). This file
// is what stops a fifth resolution appearing.
// ─────────────────────────────────────────────────────────────────────────────

const ROOT = resolve(__dirname, "..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(?<!:)\/\/.*$/gm, "");

describe("one resolution of 'what time is it where they are'", () => {
  /** Files that decide, or explain, whether a contact may be called now. */
  const DECIDERS = [
    "src/app/api/twilio/call/route.ts",
    "src/app/api/elevenlabs/call/route.ts",
    "src/lib/db/my-day.ts",
    "src/lib/dialer/eligibility.ts",
    "src/lib/db/reservations.ts",
    "src/components/dialer/session-builder.tsx",
  ];

  it("every window decision resolves the zone through the one helper", () => {
    const offenders = DECIDERS.filter(
      (p) => !/resolveLeadTimezone\(/.test(stripComments(read(p))),
    );
    expect(
      offenders,
      "These decide whether a contact may be called and do not use " +
        "resolveLeadTimezone:\n" + offenders.join("\n"),
    ).toEqual([]);
  });

  it("nothing hand-rolls the fallback the helper already owns", () => {
    // `lead.timezone || orgTz` is the shape my-day.ts had: it looks like a
    // reasonable default and silently skips the area-code table, which is the
    // only real evidence the product has about where a number is.
    const offenders: string[] = [];
    for (const p of DECIDERS) {
      const code = stripComments(read(p));
      for (const m of code.matchAll(/\btimezone\)?\s*\|\|\s*\w*[Tt]z\b/g)) {
        offenders.push(`${p}: ${m[0]}`);
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("the claim RPC really has no window predicate, as its route now says", () => {
    // The route comment used to assert the claim enforced the calling window.
    // It does not — and a future reader trusting that would ship a dial path
    // with no window check at all.
    const sql = readFileSync(resolve(ROOT, "supabase/schema.sql"), "utf8");
    const start = sql.indexOf("function public.app_claim_dial_leads");
    expect(start, "app_claim_dial_leads not found").toBeGreaterThan(-1);
    const body = sql.slice(start, start + 4000);
    expect(body, "the claim scrubs DNC").toMatch(/dnc_numbers/);
    expect(body, "if the claim gained a window predicate, update the route comment")
      .not.toMatch(/start_hour|end_hour|calling_window/);

    const route = read("src/app/api/dialer/claim/route.ts");
    expect(route, "the route still claims the window is enforced in the claim").not.toMatch(
      /DNC and the calling window are enforced inside the\s*\n?\s*\/\/\s*claim/,
    );
  });
});

describe("a refused lane says which rule refused it", () => {
  it("the dial route sends a per-leg reason", () => {
    const route = read("src/app/api/twilio/call/route.ts");
    expect(route).toMatch(/Outside this contact's calling hours/);
  });

  it("the engine keeps it instead of dropping it", () => {
    // `data.calls` was mapped down to { leadId, sid } and the error discarded,
    // so a lane refused by policy looked exactly like one released because
    // another line answered.
    const engine = read("src/lib/use-dialer.ts");
    expect(engine).toMatch(/refusals\.set\(c\.leadId, c\.error\)/);
    expect(engine).toMatch(/refusal: refusals\.get\(ln\.lead\.id\)/);
    expect(engine).toMatch(/refusal\?: string/);
  });

  it("the lane renders it above the generic wording", () => {
    const lane = read("src/lib/dialer/lane-state.ts");
    expect(lane).toMatch(/if \(opts\.refusal\) return opts\.refusal;/);
  });
});

describe("a rep is told before they start, not one cancelled lane at a time", () => {
  it("the session builder counts what is out of window", () => {
    const builder = read("src/components/dialer/session-builder.tsx");
    expect(builder).toMatch(/outOfWindow/);
    expect(builder).toMatch(/outside their calling hours right now/);
    // Same expression the dial route uses, so the preflight and the refusal
    // cannot disagree.
    expect(builder).toMatch(/isWithinOrgHours\(/);
    expect(builder).toMatch(/resolveLeadTimezone\(/);
  });

  it("and the count is right for a real book", () => {
    // The shape that matters: Central-time contacts at 9:30pm their time,
    // against an 8am–9pm window. Before the timezone fix these resolved
    // Pacific and every one of them read as 7:30pm — inside the window.
    const at = new Date("2026-08-30T02:30:00.000Z");
    const HOURS = { startHour: 8, endHour: 21, days: [0, 1, 2, 3, 4, 5, 6] };
    const dallas = resolveLeadTimezone("+12145551234", undefined, "UTC");
    expect(dallas).toBe("America/Chicago");
    expect(isWithinOrgHours(at, HOURS, dallas)).toBe(false);

    const la = resolveLeadTimezone("+13105551234", undefined, "UTC");
    expect(la).toBe("America/Los_Angeles");
    expect(isWithinOrgHours(at, HOURS, la)).toBe(true);
  });
});

describe("the recommendation and the dialer agree about whose clock", () => {
  it("My Day judges its pick in the contact's zone", () => {
    const myDay = stripComments(read("src/lib/db/my-day.ts"));
    expect(myDay).toMatch(/resolveLeadTimezone\(\s*phone/);
  });

  it("and /today's copy says whose hours it means", () => {
    // It said "outside calling hours", which reads as the office's.
    expect(read("src/app/(app)/today/page.tsx")).toMatch(/their OWN local calling hours/);
  });

  it("no other file resolves a calling window on its own", () => {
    // A sixth copy would pass every test above.
    const files = execSync(
      'git ls-files --cached --others --exclude-standard "src/**/*.ts" "src/**/*.tsx"',
      { cwd: ROOT, encoding: "utf8" },
    )
      .split("\n")
      .filter(Boolean);
    const ALLOWED = new Set([
      ...DECIDERS_FOR_SCAN,
      "src/lib/dialer/schedule.ts", // the window predicate itself
      "src/lib/dialer/lead-timezone.ts", // the resolver itself
      "src/components/dialer/dialer-client.tsx", // the org-clock banner, advisory
      "src/lib/campaign-policy.ts", // campaign windows, a different setting
      "src/app/api/cron/auto-dial/route.ts", // automation windows, a different setting
      "src/lib/messaging/send-gate.ts", // SMS quiet hours, a different setting
    ]);
    const offenders = files.filter((p) => {
      if (ALLOWED.has(p)) return false;
      return /isWithinOrgHours\(|isWithinCallingWindow\(/.test(stripComments(read(p)));
    });
    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});

/** Kept separate so the allowlist above can reference it. */
const DECIDERS_FOR_SCAN = [
  "src/app/api/twilio/call/route.ts",
  "src/app/api/elevenlabs/call/route.ts",
  "src/lib/db/my-day.ts",
  "src/lib/dialer/eligibility.ts",
  "src/lib/db/reservations.ts",
  "src/components/dialer/session-builder.tsx",
];
