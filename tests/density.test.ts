import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { cellPadding, parseDensityPreference, rowMinHeight } from "@/lib/ui-density";

// ─────────────────────────────────────────────────────────────────────────────
// Display density is ONE setting, and it is a VERTICAL one.
//
// src/app/globals.css states the contract verbatim:
//
//   "Cell padding is 16px at every density. Density changes row height and
//    vertical padding — never font size, never horizontal padding."
//
// Both halves were broken. There were three unrelated densities — the dialer's
// parallel lanes, the monitor's floor board and the appointments workspace,
// each remembering its own answer in its own place — and /leads, the biggest
// grid in the product, had no control at all. Meanwhile three surfaces moved
// horizontal padding or re-typeset their text on the way to Compact, so
// tightening the rows also shifted every column sideways and shrank the words.
// ─────────────────────────────────────────────────────────────────────────────

const ROOT = resolve(__dirname, "..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

function sourceFiles(): string[] {
  return execSync('git ls-files --cached --others --exclude-standard "src/**/*.tsx" "src/**/*.ts"', {
    cwd: ROOT,
    encoding: "utf8",
  })
    .split("\n")
    .filter(Boolean);
}

/** Comments are prose. This file's own subject appears in several of them. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(?<!:)\/\/.*$/gm, "");
}

const FILES = sourceFiles().map((path) => {
  const raw = read(path);
  return { path, text: raw, code: stripComments(raw) };
});

/**
 * Components whose `compact` prop is a VARIANT, not the density setting.
 *
 * The dial pad's compact form is the one mounted inside a live call: smaller
 * keys, and a digit sized to fit them. That is a different component shape, not
 * a display preference, and nothing routes the workspace density into it.
 */
const NOT_DENSITY: Record<string, string> = {
  "src/components/dialer/dial-pad.tsx": "compact = the in-call keypad, a variant",
};

describe("density changes the vertical rhythm and nothing else", () => {
  /**
   * Every `<condition> ? "…" : "…"` whose condition mentions density. Both
   * branches are class strings; the rule is about what differs between them.
   */
  function densityTernaries(text: string): { cond: string; a: string; b: string }[] {
    const out: { cond: string; a: string; b: string }[] = [];
    for (const m of text.matchAll(
      /([A-Za-z_.\]\[" =]*(?:compact|density)[A-Za-z_.\]\[" =]*)\?\s*"([^"]*)"\s*:\s*"([^"]*)"/gi,
    )) {
      out.push({ cond: m[1].trim(), a: m[2], b: m[3] });
    }
    return out;
  }

  it("no density ternary moves horizontal padding", () => {
    const offenders: string[] = [];
    for (const { path, code } of FILES) {
      if (NOT_DENSITY[path]) continue;
      for (const t of densityTernaries(code)) {
        const hx = (s: string) => (s.match(/\b(?:px|pl|pr|p)-[\d.]+/g) ?? []).join(",");
        // `p-*` sets all four sides, so it moves the horizontal padding too.
        if (hx(t.a) !== hx(t.b)) {
          offenders.push(`${path}: "${t.a}" vs "${t.b}"`);
        }
      }
    }
    expect(
      offenders,
      `Density must not shift columns sideways:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("no density ternary re-typesets the text", () => {
    const offenders: string[] = [];
    for (const { path, code } of FILES) {
      if (NOT_DENSITY[path]) continue;
      for (const t of densityTernaries(code)) {
        const type = (s: string) =>
          (s.match(/\btext-(?:xs|sm|base|lg|xl|\[[^\]]+\])/g) ?? []).join(",");
        if (type(t.a) !== type(t.b)) {
          offenders.push(`${path}: "${t.a}" vs "${t.b}"`);
        }
      }
    }
    expect(
      offenders,
      `Compact must not shrink the words — that is the moment there are MORE of them:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("the shared helpers obey their own rule", () => {
    expect(cellPadding("compact")).toBe("px-4 py-1.5");
    expect(cellPadding("comfortable")).toBe("px-4 py-3");
    const hx = (s: string) => s.match(/px-[\d.]+/)?.[0];
    expect(hx(cellPadding("compact"))).toBe(hx(cellPadding("comfortable")));
    // A minimum, never a fixed height: a tall cell must still be able to grow.
    for (const d of ["compact", "comfortable"] as const) {
      expect(rowMinHeight(d)).toMatch(/^min-h-/);
    }
  });
});

describe("there is exactly one density setting", () => {
  it("the per-surface localStorage pattern is gone", () => {
    // `useStoredDensity(storageKey)` is what made three surfaces disagree.
    const offenders = FILES.filter((f) => /useStoredDensity/.test(f.code)).map((f) => f.path);
    expect(offenders, offenders.join("\n")).toEqual([]);
    const keys = FILES.filter((f) => /["'][\w:]*density[\w:]*["']\s*[,)]/i.test(f.code))
      .map((f) => f.path)
      .filter((p) => p !== "src/components/layout/density.tsx");
    expect(keys, `Per-surface density storage keys:\n${keys.join("\n")}`).toEqual([]);
  });

  it("the shell carries it, seeded server-side", () => {
    // Seeded from the profile so the FIRST paint is already at the rep's
    // density — not comfortable-then-flash.
    expect(read("src/components/layout/app-shell.tsx")).toMatch(/<DensityProvider initial=\{density\}>/);
    expect(read("src/app/(app)/layout.tsx")).toMatch(
      /density=\{parseDensityPreference\(uiPreferences\)\}/,
    );
  });

  it("reads a stored preference, and refuses a malformed one", () => {
    expect(parseDensityPreference({ density: "compact" })).toBe("compact");
    expect(parseDensityPreference({ density: "comfortable" })).toBe("comfortable");
    // Null, not a default: the provider distinguishes "never chose" from
    // "chose comfortable", because only the former consults localStorage.
    expect(parseDensityPreference({})).toBeNull();
    expect(parseDensityPreference(null)).toBeNull();
    expect(parseDensityPreference({ density: "cosy" })).toBeNull();
    expect(parseDensityPreference("compact")).toBeNull();
  });

  it("every grid that has rows obeys it", () => {
    // The two generic tables plus the biggest hand-rolled one. A grid that
    // hardcodes its padding is a grid the setting cannot reach — which is
    // exactly what /leads was.
    for (const path of ["src/components/ui/data-table.tsx", "src/components/leads/leads-table.tsx"]) {
      const text = read(path);
      expect(text, `${path} does not use the shared padding`).toMatch(/cellPadding\(/);
      expect(text, `${path} still hardcodes a cell padding`).not.toMatch(/"px-4 py-3"/);
    }
  });
});
