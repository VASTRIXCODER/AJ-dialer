import { describe, expect, it } from "vitest";
import { activeNavHref, navGroups } from "@/components/layout/nav";

// ─────────────────────────────────────────────────────────────────────────────
// Exactly one nav item may be the current page.
//
// The sidebar used `pathname === href || pathname.startsWith(href + "/")` per
// item, which lights every ancestor: on /monitor/team both "Live Monitor"
// (/monitor) and "Team Status" (/monitor/team) came out active. Two elements
// carrying aria-current="page" is invalid — a document has one current page —
// so a screen reader announced the rep as being in two places at once.
//
// The regression is only visible when the decision is made across the whole
// candidate list, so that is what these assert.
// ─────────────────────────────────────────────────────────────────────────────

const ALL_HREFS = navGroups.flatMap((g) => g.items.map((i) => i.href));

describe("activeNavHref", () => {
  it("prefers the deeper route when one nav href is a prefix of another", () => {
    const hrefs = ["/monitor", "/monitor/team"];
    expect(activeNavHref("/monitor/team", hrefs)).toBe("/monitor/team");
    expect(activeNavHref("/monitor", hrefs)).toBe("/monitor");
  });

  it("is order-independent — the longest match wins either way round", () => {
    expect(activeNavHref("/monitor/team", ["/monitor", "/monitor/team"])).toBe("/monitor/team");
    expect(activeNavHref("/monitor/team", ["/monitor/team", "/monitor"])).toBe("/monitor/team");
  });

  it("matches on segment boundaries, so /leads never claims /leadsource", () => {
    expect(activeNavHref("/leadsource", ["/leads"])).toBeNull();
    expect(activeNavHref("/leads", ["/leads"])).toBe("/leads");
    expect(activeNavHref("/leads/abc-123", ["/leads"])).toBe("/leads");
  });

  it("returns null when nothing matches", () => {
    expect(activeNavHref("/nowhere", ALL_HREFS)).toBeNull();
  });

  it("only ever matches a root href exactly", () => {
    expect(activeNavHref("/dashboard", ["/"])).toBeNull();
    expect(activeNavHref("/", ["/"])).toBe("/");
  });

  it("still resolves a child when its parent route is hidden by permission", () => {
    // The sidebar passes only the items the viewer can see. A rep without
    // monitor.view loses /monitor but may still hold /monitor/team.
    expect(activeNavHref("/monitor/team", ["/monitor/team"])).toBe("/monitor/team");
  });

  it("names at most one winner for every real route in the nav", () => {
    for (const href of ALL_HREFS) {
      const winner = activeNavHref(href, ALL_HREFS);
      expect(winner).toBe(href);
      // The property that actually failed before: exactly one item is active.
      const active = ALL_HREFS.filter((h) => h === winner);
      expect(active).toHaveLength(1);
    }
  });

  it("resolves a nested path to its own nav entry, not an ancestor", () => {
    // Guards the real /monitor + /monitor/team pair as it exists in the nav,
    // so this keeps working if either route is renamed.
    const nested = ALL_HREFS.filter((h) => ALL_HREFS.some((o) => o !== h && h.startsWith(`${o}/`)));
    for (const href of nested) {
      expect(activeNavHref(href, ALL_HREFS)).toBe(href);
    }
  });
});
