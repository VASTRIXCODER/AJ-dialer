import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { Z } from "@/lib/z-layers";

// ─────────────────────────────────────────────────────────────────────────────
// One overlay implementation, one z ladder.
//
// Modal and Drawer each carried a byte-identical 55-line focus trap. Two copies
// of an accessibility contract is one copy that will fall behind, and a fix
// would have had to be made twice.
//
// The z values were written inline at each call site and had drifted to
// 30, 40, 50, 80, 90, 91, 100, 101, 130, 130, 140, 200 — with `confirm-dialog`
// and the menu primitives both on 130, so a Select opened inside a confirmation
// dialog could paint behind the dialog it belonged to. Ties are the bug.
// ─────────────────────────────────────────────────────────────────────────────

const ROOT = resolve(__dirname, "..");
const FILES = execSync('git ls-files --cached --others --exclude-standard "src/**/*.tsx" "src/**/*.ts"', {
  cwd: ROOT,
  encoding: "utf8",
})
  .split("\n")
  .filter(Boolean)
  .map((path) => ({ path, text: readFileSync(resolve(ROOT, path), "utf8") }));

describe("the z ladder", () => {
  it("is strictly increasing, with no two rungs on the same value", () => {
    const entries = Object.entries(Z);
    const values = entries.map(([, v]) => v);
    expect(new Set(values).size, `duplicate rung: ${JSON.stringify(Z)}`).toBe(values.length);
    for (let i = 1; i < values.length; i++) {
      expect(
        values[i],
        `${entries[i][0]} (${values[i]}) must sit above ${entries[i - 1][0]} (${values[i - 1]})`,
      ).toBeGreaterThan(values[i - 1]);
    }
  });

  it("puts a menu above a confirmation, which is above an overlay", () => {
    // The specific ordering the old 130/130 tie broke: a Select is opened from
    // inside a dialog and has to clear it.
    expect(Z.popover).toBeGreaterThan(Z.confirm);
    expect(Z.confirm).toBeGreaterThan(Z.overlay);
    // A toast reports on what just happened, including inside a dialog.
    expect(Z.toast).toBeGreaterThan(Z.popover);
    // Nothing is allowed to cover a tooltip, which blocks nothing.
    expect(Z.tooltip).toBeGreaterThan(Z.toast);
  });

  it("no component invents its own stacking level", () => {
    // Local stacking inside a card (0, 1, 10, 20) is fine — those never
    // compete with the app-level ladder. Anything above that is a rung and
    // belongs in z-layers.ts.
    const LOCAL = new Set([0, 1, 10, 20]);
    const offenders: string[] = [];
    for (const { path, text } of FILES) {
      if (path.endsWith("z-layers.ts")) continue;
      // The marketing site is a standalone page with its own stacking context.
      if (path.startsWith("src/components/marketing/") || path === "src/app/page.tsx") continue;
      for (const m of text.matchAll(/\bz-\[(\d+)\]|\bz-(\d+)\b/g)) {
        const n = Number(m[1] ?? m[2]);
        if (!LOCAL.has(n)) offenders.push(`${path}: ${m[0]}`);
      }
      for (const m of text.matchAll(/zIndex:\s*(\d+)/g)) {
        if (!LOCAL.has(Number(m[1]))) offenders.push(`${path}: zIndex: ${m[1]}`);
      }
    }
    expect(
      offenders,
      `Use a rung from src/lib/z-layers.ts:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});

describe("the overlay primitive", () => {
  it("only one file implements the focus trap", () => {
    const owners = FILES.filter(({ text }) => text.includes("FOCUSABLE =")).map((f) => f.path);
    expect(owners).toEqual(["src/components/ui/overlay.tsx"]);
  });

  it("Modal and Drawer delegate rather than reimplement", () => {
    for (const p of ["src/components/ui/modal.tsx", "src/components/ui/drawer.tsx"]) {
      const f = FILES.find((x) => x.path === p);
      expect(f, `${p} is missing`).toBeDefined();
      expect(f!.text, `${p} must use Overlay`).toMatch(/from "\.\/overlay"/);
      // The tells of a hand-rolled trap.
      expect(f!.text, `${p} reimplements the trap`).not.toMatch(/querySelectorAll/);
      expect(f!.text, `${p} reimplements the scroll lock`).not.toMatch(/document\.body\.style/);
      expect(f!.text, `${p} reimplements Escape`).not.toMatch(/"Escape"/);
    }
  });

  it("every dialog panel is opaque", () => {
    // A scrim is translucent because what it covers is still there. A panel
    // carries text and must never be.
    for (const p of ["src/components/ui/modal.tsx", "src/components/ui/drawer.tsx"]) {
      const f = FILES.find((x) => x.path === p)!;
      const panel = f.text.match(/panelClassName=\{cn\(([\s\S]*?)\)\}/)?.[1] ?? "";
      // `-` is a word boundary, so guard against matching inside surface-glass,
      // which is the OPAQUE content plane and exactly what a panel should use.
      expect(panel, `${p} panel must not be glass`).not.toMatch(/(?<!surface-)\bglass\b/);
      expect(panel, `${p} panel needs an opaque surface`).toMatch(/surface-glass|bg-card|bg-surface/);
    }
  });
});
