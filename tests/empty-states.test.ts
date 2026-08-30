import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// An empty panel collapses. It does not reserve its populated height.
//
// A 340px box containing one centred sentence pushes everything below it off
// the fold in order to announce that there is nothing there. The empty state
// of a section should cost almost no space; the empty state of a whole SCREEN
// is allowed to be generous, because the emptiness is the screen.
// ─────────────────────────────────────────────────────────────────────────────

const ROOT = resolve(__dirname, "..");
const SRC = readFileSync(resolve(ROOT, "src/components/shared/empty-state.tsx"), "utf8");

const ROUTE_FILES = execSync(
  'git ls-files --cached --others --exclude-standard "src/app/**/*.tsx"',
  { cwd: ROOT, encoding: "utf8" },
)
  .split("\n")
  .filter((f) => f && f.endsWith("page.tsx"))
  .map((path) => ({ path, text: readFileSync(resolve(ROOT, path), "utf8") }));

describe("empty states", () => {
  it("defaults to the collapsing variant", () => {
    // The quiet one is the default on purpose: an empty state added without
    // thinking about which kind it is should take up as little room as it can.
    expect(SRC).toMatch(/variant\s*=\s*"panel"/);
  });

  it("the panel variant reserves no height", () => {
    const panelBranch = SRC.slice(
      SRC.indexOf('if (variant === "panel")'),
      SRC.indexOf("return (", SRC.lastIndexOf("  return (")),
    );
    expect(panelBranch, "the collapsing variant must not use a Card").not.toMatch(/<Card/);
    for (const pad of ["py-16", "py-12", "py-10", "py-8", "min-h-"]) {
      expect(panelBranch, `panel variant should not reserve height (${pad})`).not.toContain(pad);
    }
  });

  it("every screen-level empty state says so", () => {
    // An EmptyState in a route file is the whole screen — a permission gate or
    // a "nothing here yet". Left on the default it would render as one thin
    // line stranded at the top of an otherwise blank page.
    const offenders: string[] = [];
    for (const { path, text } of ROUTE_FILES) {
      for (const m of text.matchAll(/<EmptyState\b([\s\S]{0,120})/g)) {
        if (!/variant="page"/.test(m[1])) offenders.push(`${path}: ${m[1].trim().slice(0, 60)}…`);
      }
    }
    expect(
      offenders,
      `These fill a whole route and need variant="page":\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});
