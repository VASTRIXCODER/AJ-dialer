import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CELL, ROW_MIN, parseDensityPreference } from "@/lib/ui-density";

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

  // ── The scale these class names actually resolve on ──────────────────────
  //
  // W1 replaced Tailwind's spacing scale with the product's own, so a step name
  // does NOT mean what it means in stock Tailwind: `px-4` is 12px here, not
  // 16px. That is not a detail — it means the "cell padding is 16px at every
  // density" rule was never met, because every table was on `px-4`.
  //
  // Fractional steps are worse: they are not on the custom scale at all, so
  // Tailwind falls back to its 0.25rem base and `py-1.5` (6px) comes out LARGER
  // than `py-2` (4px). This block resolves the helpers against the declared
  // tokens so nobody has to remember any of it.
  const CSS = read("src/app/globals.css");
  const SCALE = new Map<string, number>(
    [...CSS.matchAll(/--spacing-(\d+):\s*(\d+)px;/g)].map((m) => [m[1], Number(m[2])]),
  );

  /** Pixels for one utility, or null when it is off the scale entirely. */
  function px(cls: string): number | null {
    const step = cls.match(/-(\d+(?:\.\d+)?)$/)?.[1];
    if (!step) return null;
    return SCALE.get(step) ?? null;
  }

  it("the token file really does redefine the scale", () => {
    // If this ever stops being true the numbers below are wrong, loudly.
    expect(SCALE.get("4"), "--spacing-4").toBe(12);
    expect(SCALE.get("5"), "--spacing-5").toBe(16);
    expect(SCALE.get("3"), "--spacing-3").toBe(8);
    expect(SCALE.get("2"), "--spacing-2").toBe(4);
  });

  it("cell padding is 16px horizontally, and it does not vary", () => {
    // The rule, quoted at the top of this file, in pixels rather than in class
    // names — which is the only form of it that can actually be checked. The
    // horizontal step is a literal in CELL, so it cannot vary by construction.
    const horizontal = CELL.split(" ").find((c) => c.startsWith("px-"))!;
    expect(px(horizontal), horizontal).toBe(16);
    expect(CELL, "horizontal padding must not read the density variable").not.toMatch(
      /px-\[var\(/,
    );
  });

  it("the vertical step is the ONE variable, declared at both densities", () => {
    // Density now travels as a CSS variable on <html data-density>, not as a
    // prop — because two of the product's ten tables are server components and
    // could not be given one. That is what left eight of them hardcoded.
    expect(CELL).toMatch(/py-\[var\(--cell-py\)\]/);
    const root = CSS.match(/:root\s*\{[\s\S]*?--cell-py:\s*(\d+)px;/);
    const compact = CSS.match(/\[data-density="compact"\]\s*\{[\s\S]*?--cell-py:\s*(\d+)px;/);
    expect(root, "--cell-py is not declared on :root").toBeTruthy();
    expect(compact, '--cell-py is not declared for [data-density="compact"]').toBeTruthy();
    expect(Number(compact![1]), "compact is not tighter").toBeLessThan(Number(root![1]));
  });

  it("rows have a minimum, never a fixed height", () => {
    expect(ROW_MIN).toMatch(/^min-h-/);
    expect(ROW_MIN).toMatch(/min-h-\[var\(--row-min-h\)\]/);
    const root = CSS.match(/:root\s*\{[\s\S]*?--row-min-h:\s*(\d+)px;/);
    const compact = CSS.match(/\[data-density="compact"\]\s*\{[\s\S]*?--row-min-h:\s*(\d+)px;/);
    expect(root, "--row-min-h is not declared on :root").toBeTruthy();
    expect(compact).toBeTruthy();
    expect(Number(compact![1])).toBeLessThan(Number(root![1]));
    // A row minimum that exceeds a comfortable row is not a minimum, it is a
    // fixed height wearing a different name.
    expect(Number(root![1])).toBeLessThanOrEqual(48);
  });

  it("the provider mirrors the setting onto the document", () => {
    // Without this the CSS variable never changes and every table is stuck at
    // comfortable — which is the whole mechanism, so it is worth pinning.
    expect(read("src/components/layout/density.tsx")).toMatch(
      /document\.documentElement\.dataset\.density = density/,
    );
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

  it("EVERY table in the product obeys it", () => {
    // Checked per CELL rather than per file: what matters is that each
    // individual <td> and <th> is on the shared constant. A file-level "does
    // it mention CELL anywhere" test would pass a table that had migrated
    // nine cells out of ten.
    //
    // Not an allowlist any more, either. Eight of the ten tables in the
    // product were hardcoded at five different paddings — three with no left
    // padding at all — while the setting quietly applied to the other two.
    const offenders: string[] = [];
    const CELL_RE = /<t[dh]\s+className=(?:"([^"]*)"|\{([\s\S]{0,300}?)\}>)/g;
    for (const { path, code } of FILES) {
      if (path === "src/lib/ui-density.ts") continue;
      for (const m of code.matchAll(CELL_RE)) {
        const expr = m[1] ?? m[2] ?? "";
        if (!expr.includes("CELL")) {
          offenders.push(path + ": " + expr.replace(/\s+/g, " ").trim().slice(0, 70));
        }
      }
    }
    expect(offenders, "Use cn(CELL, ...) from @/lib/ui-density: " + offenders.join(" | ")).toEqual(
      [],
    );
  });
});
