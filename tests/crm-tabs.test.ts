import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// Every CRM view must have BOTH a tab and a panel.
//
// It shipped with four views, four TabPanels and only THREE Tabs — Approvals
// had a panel and no tab. The consequences are not cosmetic: `Tab` implements a
// roving tabindex as `tabIndex={selected ? 0 : -1}`, so when the selected view
// has no tab, EVERY tab gets -1 and the whole strip drops out of the keyboard
// order. The panel's aria-labelledby also points at an id that does not exist,
// and the view is unreachable by clicking at all — only by the primary button
// or a ?view= URL.
//
// A source-level check rather than a render test, because the failure is a
// missing element: there is nothing to query for, and a component test would
// have to know to look for the absence.
// ─────────────────────────────────────────────────────────────────────────────

const SRC = resolve(__dirname, "..", "src", "components", "crm", "crm-workspace.tsx");
const source = readFileSync(SRC, "utf8");

function matches(re: RegExp): string[] {
  return [...source.matchAll(re)].map((m) => m[1]);
}

const declared = /const VIEWS = \[([^\]]+)\] as const/.exec(source)?.[1] ?? "";
const views = [...declared.matchAll(/"([a-z]+)"/g)].map((m) => m[1]);
const tabs = matches(/<Tab value="([a-z]+)"/g);
const panels = matches(/<TabPanel value="([a-z]+)"/g);

describe("the CRM tab strip", () => {
  it("finds the views, tabs and panels to compare", () => {
    // Without this the assertions below could pass by matching nothing.
    expect(views.length).toBeGreaterThan(2);
    expect(tabs.length).toBeGreaterThan(2);
    expect(panels.length).toBeGreaterThan(2);
  });

  it("gives every view a Tab — a panel with no tab strands the keyboard", () => {
    const missing = views.filter((v) => !tabs.includes(v));
    expect(
      missing,
      `views with a panel but no tab: ${missing.join(", ")}. When one of these is ` +
        `selected, no tab is selected, so the roving tabindex gives every tab -1 ` +
        `and the strip leaves the keyboard order entirely.`,
    ).toEqual([]);
  });

  it("gives every view a TabPanel", () => {
    const missing = views.filter((v) => !panels.includes(v));
    expect(missing, `views with a tab but no panel: ${missing.join(", ")}`).toEqual([]);
  });

  it("has no Tab pointing at a view that does not exist", () => {
    const orphans = tabs.filter((t) => !views.includes(t));
    expect(orphans, `tabs for unknown views: ${orphans.join(", ")}`).toEqual([]);
  });

  it("has no TabPanel pointing at a view that does not exist", () => {
    const orphans = panels.filter((p) => !views.includes(p));
    expect(orphans, `panels for unknown views: ${orphans.join(", ")}`).toEqual([]);
  });

  it("keeps the strip within the segmented-control ceiling", () => {
    // The UI spec: beyond four options a switcher becomes a Select rather than
    // a tab strip that wraps.
    expect(views.length).toBeLessThanOrEqual(4);
  });
});
