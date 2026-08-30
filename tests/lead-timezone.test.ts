import { describe, expect, it } from "vitest";
import {
  LEAD_TIMEZONE_COLUMN_DEFAULT,
  describeLeadClock,
  leadLocalTime,
  resolveLeadTimezone,
  storedLeadTimezone,
  timezoneForAreaCode,
} from "@/lib/dialer/lead-timezone";
import {
  DEFAULT_TIMEZONE,
  ORG_TIMEZONE_COLUMN_DEFAULT,
  orgTimezone,
  storedOrgTimezone,
} from "@/lib/metrics/definitions";

describe("timezoneForAreaCode", () => {
  it("maps the app's target states correctly", () => {
    expect(timezoneForAreaCode("415")).toBe("America/Los_Angeles"); // CA
    expect(timezoneForAreaCode("214")).toBe("America/Chicago"); // TX (Dallas)
    expect(timezoneForAreaCode("713")).toBe("America/Chicago"); // TX (Houston)
    expect(timezoneForAreaCode("915")).toBe("America/Denver"); // TX El Paso (Mountain)
    expect(timezoneForAreaCode("212")).toBe("America/New_York"); // NY
    expect(timezoneForAreaCode("808")).toBe("Pacific/Honolulu"); // HI
  });

  it("returns null for unknown / non-NANP codes", () => {
    expect(timezoneForAreaCode("999")).toBeNull();
    expect(timezoneForAreaCode(null)).toBeNull();
  });
});

describe("resolveLeadTimezone", () => {
  it("prefers a stored IANA zone", () => {
    expect(resolveLeadTimezone("+14155551234", "America/Denver", "America/Chicago")).toBe(
      "America/Denver",
    );
  });

  it("falls back to the number's area code", () => {
    expect(resolveLeadTimezone("+14155551234", "", "America/Chicago")).toBe(
      "America/Los_Angeles",
    );
    expect(resolveLeadTimezone("+12145550000", null, "America/Chicago")).toBe(
      "America/Chicago",
    );
  });

  it("falls back to the org default for an unknown area code", () => {
    expect(resolveLeadTimezone("+19995550000", "", "America/Chicago")).toBe(
      "America/Chicago",
    );
    expect(resolveLeadTimezone("garbage", "", "America/New_York")).toBe("America/New_York");
  });

  it("does not treat a non-IANA stored value as a zone", () => {
    // "PST" has no slash → not trusted; falls through to area code (CA → Pacific).
    expect(resolveLeadTimezone("+14155551234", "PST", "America/Chicago")).toBe(
      "America/Los_Angeles",
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The clock a rep can actually read.
//
// This resolver has driven server-side TCPA enforcement for a long time and no
// surface in the product ever rendered its answer — so a rep in Phoenix worked
// down a list of New Jersey contacts at what was, to them, a reasonable hour,
// and watched lane after lane cancel with no idea why.
// ─────────────────────────────────────────────────────────────────────────────

describe("leadLocalTime", () => {
  // 2026-08-30T02:30:00Z — 7:30pm on the 29th in California, 10:30pm in NY.
  const at = new Date("2026-08-30T02:30:00.000Z");
  const HOURS = { startHour: 8, endHour: 21, days: [0, 1, 2, 3, 4, 5, 6] };

  it("reports the time where the CONTACT is, not where the rep is", () => {
    expect(leadLocalTime("+14155551234", null, "America/New_York", at)?.time).toBe("7:30 PM");
    expect(leadLocalTime("+12125551234", null, "America/Los_Angeles", at)?.time).toBe(
      "10:30 PM",
    );
  });

  it("flags a contact who is outside the window in their OWN zone", () => {
    // Same instant, same org policy (8am–9pm): fine in California, too late in
    // New York. This is the exact case the dial route refuses and the rep
    // could not see coming.
    expect(leadLocalTime("+14155551234", null, "America/Chicago", at, HOURS)?.outsideWindow).toBe(
      false,
    );
    expect(leadLocalTime("+12125551234", null, "America/Chicago", at, HOURS)?.outsideWindow).toBe(
      true,
    );
  });

  it("says where the zone came from, because an area code is a guess", () => {
    expect(leadLocalTime("+14155551234", "America/Denver", "UTC", at)?.source).toBe("stored");
    expect(leadLocalTime("+14155551234", null, "UTC", at)?.source).toBe("areaCode");
    // 999 is not a real NANP code — nothing to infer from.
    expect(leadLocalTime("+19995551234", null, "America/Chicago", at)?.source).toBe("fallback");
  });

  it("honours an overnight window", () => {
    const overnight = { startHour: 20, endHour: 6 };
    // 10:30pm in New York is inside 8pm–6am.
    expect(
      leadLocalTime("+12125551234", null, "UTC", at, overnight)?.outsideWindow,
    ).toBe(false);
    // 7:30pm in California is not.
    expect(
      leadLocalTime("+14155551234", null, "UTC", at, overnight)?.outsideWindow,
    ).toBe(true);
  });

  it("skips the window check entirely when the workspace has no hours set", () => {
    expect(leadLocalTime("+12125551234", null, "UTC", at, null)?.outsideWindow).toBe(false);
    expect(leadLocalTime("+12125551234", null, "UTC", at)?.outsideWindow).toBe(false);
  });

  it("says nothing rather than showing the rep their own clock", () => {
    // An unusable stored zone. Falling back to the local one would put a
    // confident, wrong time on the row — worse than an empty space.
    expect(leadLocalTime("+14155551234", "Mars/Olympus_Mons", "Mars/Olympus_Mons", at)).toBeNull();
  });

  it("reads as a sentence", () => {
    const inside = leadLocalTime("+14155551234", null, "UTC", at, HOURS)!;
    const outside = leadLocalTime("+12125551234", null, "UTC", at, HOURS)!;
    expect(describeLeadClock(inside)).toBe("7:30 PM their time");
    expect(describeLeadClock(outside)).toBe("10:30 PM their time — outside calling hours");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The column that looked like data.
//
// `leads.timezone` was declared `text default 'America/Los_Angeles'`, and
// src/lib/db/leads.ts re-applied the same default a second time on read. So
// "somebody chose Los Angeles" and "nobody has ever set a zone" were the same
// value at every call site, and every caller trusted it.
//
// Measured against production on 2026-08-30: 37,987 lead rows, zero nulls,
// exactly ONE distinct value. And the book is not Pacific — its largest area
// codes are 334 (Alabama), 817/214/469/972/832/682 (Texas) and 870/479/501
// (Arkansas). Central. So a contact in Dallas at 8:00 PM their time was shown,
// and reasoned about, as 6:00 PM: two hours wrong, in the direction that makes
// an out-of-hours call look fine.
//
// This bit the freshly-shipped lead clock, the Lead 360 "why can't I dial this"
// explanation, and the AI dialer's own calling-hours gate.
// ─────────────────────────────────────────────────────────────────────────────

describe("a schema default is not a stored timezone", () => {
  it("treats the column default as absent", () => {
    expect(storedLeadTimezone(LEAD_TIMEZONE_COLUMN_DEFAULT)).toBeNull();
    expect(storedLeadTimezone(null)).toBeNull();
    expect(storedLeadTimezone(undefined)).toBeNull();
    expect(storedLeadTimezone("")).toBeNull();
    expect(storedLeadTimezone("   ")).toBeNull();
    // Not a zone at all — a stray string is not evidence either.
    expect(storedLeadTimezone("Pacific")).toBeNull();
  });

  it("keeps a zone somebody actually chose", () => {
    expect(storedLeadTimezone("America/New_York")).toBe("America/New_York");
    expect(storedLeadTimezone("  America/Chicago  ")).toBe("America/Chicago");
  });

  it("infers from the area code instead of believing the default", () => {
    // The exact shape of every row in the book: a Texas number carrying the
    // Los Angeles default. Before, this resolved Pacific.
    expect(resolveLeadTimezone("+12145551234", LEAD_TIMEZONE_COLUMN_DEFAULT, "UTC")).toBe(
      "America/Chicago",
    );
    expect(resolveLeadTimezone("+13345551234", LEAD_TIMEZONE_COLUMN_DEFAULT, "UTC")).toBe(
      "America/Chicago",
    );
    // …and an explicitly chosen zone still wins over the area code, which is
    // the whole point of keeping the stored field.
    expect(resolveLeadTimezone("+12145551234", "America/New_York", "UTC")).toBe(
      "America/New_York",
    );
  });

  it("the clock a rep reads is two hours different because of it", () => {
    // 2026-08-30T02:30:00Z. Dallas is 9:30 PM the previous evening; the
    // default would have said 7:30 PM — inside a 8am–9pm window rather than
    // outside it.
    const at = new Date("2026-08-30T02:30:00.000Z");
    const HOURS = { startHour: 8, endHour: 21, days: [0, 1, 2, 3, 4, 5, 6] };
    const clock = leadLocalTime("+12145551234", LEAD_TIMEZONE_COLUMN_DEFAULT, "UTC", at, HOURS)!;
    expect(clock.time).toBe("9:30 PM");
    expect(clock.timezone).toBe("America/Chicago");
    expect(clock.source).toBe("areaCode");
    expect(clock.outsideWindow, "9:30 PM is outside an 8am–9pm window").toBe(true);
  });

  it("the read boundary does not re-apply the default", () => {
    // src/lib/db/leads.ts mapped `r.timezone ?? "America/Los_Angeles"`, so even
    // a NULL column arrived at the UI looking like a chosen zone.
    const readFileSync = require("node:fs").readFileSync as typeof import("node:fs").readFileSync;
    const resolve = require("node:path").resolve as typeof import("node:path").resolve;
    const source = readFileSync(resolve(__dirname, "..", "src/lib/db/leads.ts"), "utf8");
    expect(source).not.toMatch(/r\.timezone as string\) \?\? "America\/Los_Angeles"/);
    expect(source).toMatch(/storedLeadTimezone\(/);
  });

  it("nor does any other consumer of the column", () => {
    // Two more paths read `leads.timezone` raw. One of them WROTE it onward:
    // records.ts copied it to `callbacks.timezone`, a column with no default,
    // where a fabricated zone is indistinguishable from a chosen one — three
    // rows were laundered that way before this test existed, and a backfill
    // cannot tell them apart now. The other handed it to the voice agent,
    // which used it to work out what time it was for the person it had just
    // called.
    const readFileSync = require("node:fs").readFileSync as typeof import("node:fs").readFileSync;
    const resolve = require("node:path").resolve as typeof import("node:path").resolve;
    const src = (p: string) => readFileSync(resolve(__dirname, "..", p), "utf8");

    const records = src("src/lib/db/records.ts");
    expect(records, "callbacks.timezone must not be copied raw").not.toMatch(
      /cbTimezone = l\?\.timezone/,
    );
    expect(records).toMatch(/storedLeadTimezone\(l\?\.timezone/);

    const agent = src("src/lib/ai/agent-context.ts");
    expect(agent, "the voice agent must not be told the default").not.toMatch(
      /timezone: String\(r\.timezone \?\? ""\)/,
    );
    expect(agent).toMatch(/resolveLeadTimezone\(String\(r\.phone/);
  });
});

describe("an organization's timezone is a choice, not a column default", () => {
  it("the default string reads as unset", () => {
    // Measured: ten of eleven workspaces carried America/Los_Angeles without
    // anyone choosing it. The eleventh chose Europe/Stockholm, which is what a
    // real choice looks like.
    expect(storedOrgTimezone(ORG_TIMEZONE_COLUMN_DEFAULT)).toBeNull();
    expect(storedOrgTimezone(null)).toBeNull();
    expect(storedOrgTimezone("  ")).toBeNull();
    expect(storedOrgTimezone("Europe/Stockholm")).toBe("Europe/Stockholm");
  });

  it("so orgTimezone's documented fallback can actually fire", () => {
    // It never had. mapOrg coalesced the column to the same default string, so
    // `org.timezone` was always truthy and America/Chicago was unreachable.
    expect(orgTimezone({ timezone: ORG_TIMEZONE_COLUMN_DEFAULT })).toBe(DEFAULT_TIMEZONE);
    expect(orgTimezone({ timezone: "" })).toBe(DEFAULT_TIMEZONE);
    expect(orgTimezone(null)).toBe(DEFAULT_TIMEZONE);
    expect(orgTimezone({ timezone: "Europe/Stockholm" })).toBe("Europe/Stockholm");
  });

  it("the read boundary does not re-apply it either", () => {
    const readFileSync = require("node:fs").readFileSync as typeof import("node:fs").readFileSync;
    const resolve = require("node:path").resolve as typeof import("node:path").resolve;
    const membership = readFileSync(
      resolve(__dirname, "..", "src/lib/org/membership.ts"),
      "utf8",
    );
    expect(membership).not.toMatch(/timezone: String\(o\.timezone \?\? "America\/Los_Angeles"\)/);
  });

  it("and the fallback zone is spelled in exactly one place", () => {
    // It was inline in fifteen. A fallback that disagrees with itself is how
    // the dashboard and reports drifted apart at midnight.
    const { execFileSync } = require("node:child_process") as typeof import("node:child_process");
    const readFileSync = require("node:fs").readFileSync as typeof import("node:fs").readFileSync;
    const resolve = require("node:path").resolve as typeof import("node:path").resolve;
    const ROOT = resolve(__dirname, "..");
    const files = execFileSync(
      "git",
      ["ls-files", "--cached", "--others", "--exclude-standard", "src"],
      { cwd: ROOT, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
    )
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => /\.tsx?$/.test(l));

    const offenders: string[] = [];
    for (const file of files) {
      if (file === "src/lib/metrics/definitions.ts") continue;
      const code = readFileSync(resolve(ROOT, file), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(?<!:)\/\/.*$/gm, "");
      // A placeholder or an example in a lookup table is fine; a FALLBACK is
      // not. `||` and `??` are how every one of the fifteen was written.
      if (/(?:\|\||\?\?)\s*"America\/Chicago"/.test(code)) offenders.push(file);
    }
    expect(offenders, `Use DEFAULT_TIMEZONE:\n${offenders.join("\n")}`).toEqual([]);
  });
});
