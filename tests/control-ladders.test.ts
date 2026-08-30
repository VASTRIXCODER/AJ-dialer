import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// A size ladder has to ascend, and a tap target has to be big enough to tap.
//
// globals.css redefines Tailwind's spacing scale — `--spacing-9: 48px`,
// `--spacing-10: 64px` — and stops at 10. Steps past it silently fall back to
// Tailwind's 0.25rem base, so the scale is non-monotonic exactly where nobody
// looks: `h-10` is 64px and `h-11` is 44px. Fractional steps are never on the
// custom scale at all, so `h-3.5` (14px) is LARGER than `h-4` (12px).
//
// Every ladder written in scale steps came out inverted:
//
//   Button  sm h-9 = 48px  ·  md h-11 = 44px  ·  lg h-12 = 48px  ·  icon h-10 = 64px
//   Avatar  xs 32  ·  sm 48  ·  md 64  ·  lg h-12 = 48px
//
// So a small button was taller than a medium one, an icon button was the
// largest control in the product, and the leaderboard podium's first place was
// the same size as second and third.
//
// The fix is the five-line hole in the scale and the two ladders — NOT the 734
// call sites, which are a large visual-regression surface bought for nothing.
// This file resolves what the ladders actually compile to and fails if either
// stops ascending.
// ─────────────────────────────────────────────────────────────────────────────

const ROOT = resolve(__dirname, "..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

/** The project's redefined spacing scale, straight from the token file. */
const SCALE = new Map<string, number>(
  [...read("src/app/globals.css").matchAll(/--spacing-(\d+):\s*(\d+)px;/g)].map((m) => [
    m[1],
    Number(m[2]),
  ]),
);

/**
 * Pixels for one height utility.
 *
 * `h-[44px]` is literal. `h-9` resolves against the redefined scale. A step off
 * the scale falls back to Tailwind's 0.25rem base, which is the trap.
 */
function heightPx(cls: string): number | null {
  const literal = cls.match(/^h-\[(\d+)px\]$/);
  if (literal) return Number(literal[1]);
  const step = cls.match(/^h-(\d+(?:\.\d+)?)$/)?.[1];
  if (!step) return null;
  const named = SCALE.get(step);
  return named ?? Math.round(Number(step) * 4);
}

/** The first height utility in a class string. */
const firstHeight = (classes: string): number | null => {
  for (const c of classes.split(/\s+/)) {
    const px = heightPx(c);
    if (px !== null) return px;
  }
  return null;
};

describe("the token scale is what the ladders are measured against", () => {
  it("globals.css really does redefine it", () => {
    // If this stops being true, every number below is wrong — loudly.
    expect(SCALE.get("9"), "--spacing-9").toBe(48);
    expect(SCALE.get("10"), "--spacing-10").toBe(64);
    expect(SCALE.get("11"), "the scale still stops at 10").toBeUndefined();
  });

  it("and the step past the end really is smaller than the step before it", () => {
    // The whole reason the ladders below use literal pixels.
    expect(heightPx("h-10")).toBe(64);
    expect(heightPx("h-11")).toBe(44);
    expect(heightPx("h-11")).toBeLessThan(heightPx("h-10")!);
  });
});

describe("Button", () => {
  const src = read("src/components/ui/button.tsx");
  const block = src.slice(src.indexOf("const sizes"), src.indexOf("export function buttonVariants"));
  const sizeOf = (key: string) => {
    const line = block.match(new RegExp(`\\b${key}:\\s*"([^"]+)"`))?.[1];
    expect(line, `Button size "${key}" not found`).toBeTruthy();
    return firstHeight(line!);
  };

  it("sm < md < lg", () => {
    const [sm, md, lg] = [sizeOf("sm"), sizeOf("md"), sizeOf("lg")];
    expect(sm, `sm=${sm} md=${md}`).toBeLessThan(md!);
    expect(md, `md=${md} lg=${lg}`).toBeLessThan(lg!);
  });

  it("an icon button is not the biggest control in the product", () => {
    // It was 64px, taller than lg — because `h-10` is 64px here.
    expect(sizeOf("icon")).toBeLessThanOrEqual(sizeOf("lg")!);
  });

  it("every rung is a tap target", () => {
    for (const key of ["sm", "md", "lg", "icon"]) {
      expect(sizeOf(key), `Button ${key}`).toBeGreaterThanOrEqual(40);
    }
  });

  it("Input matches Button md, because they sit next to each other", () => {
    const input = read("src/components/ui/input.tsx");
    // On the <input> only — `base` is shared with Textarea.
    expect(input).toMatch(/<input[\s\S]{0,200}h-\[44px\]/);
    expect(sizeOf("md")).toBe(44);
  });
});

describe("Avatar", () => {
  const src = read("src/components/ui/avatar.tsx");
  const block = src.slice(src.indexOf("const sizes"), src.indexOf("const style"));
  const sizeOf = (key: string) => {
    const line = block.match(new RegExp(`\\b${key}:\\s*"([^"]+)"`))?.[1];
    expect(line, `Avatar size "${key}" not found`).toBeTruthy();
    return firstHeight(line!);
  };

  it("xs < sm < md < lg", () => {
    const ladder = ["xs", "sm", "md", "lg"].map(sizeOf);
    for (let i = 1; i < ladder.length; i += 1) {
      expect(
        ladder[i],
        `Avatar ${["xs", "sm", "md", "lg"][i]}=${ladder[i]} is not larger than the rung below (${ladder[i - 1]})`,
      ).toBeGreaterThan(ladder[i - 1]!);
    }
  });
});

describe("nothing you are meant to tick is smaller than you can tick", () => {
  function sourceFiles(): string[] {
    return execFileSync(
      "git",
      ["ls-files", "--cached", "--others", "--exclude-standard", "src"],
      { cwd: ROOT, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
    )
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.endsWith(".tsx"));
  }

  it("no checkbox or radio renders below 22px", () => {
    // The worst of them was a 12px checkbox inside a table row whose own click
    // handler navigates — so a miss by four pixels opened a different screen.
    // Two more were consent controls: the signup terms box, and the campaign
    // compliance certification.
    const offenders: string[] = [];
    for (const file of sourceFiles()) {
      const lines = read(file).split("\n");
      for (let i = 0; i < lines.length; i += 1) {
        if (!/type="(checkbox|radio)"/.test(lines[i])) continue;
        const window = lines.slice(i, i + 8).join(" ");
        // A visually-hidden input drives a styled control (a switch); the
        // target is the thing next to it, not the input.
        if (/sr-only/.test(window)) continue;
        const h = window.match(/\bh-(\[\d+px\]|[\d.]+)/)?.[0];
        const px = h ? heightPx(h) : null;
        if (px !== null && px < 22) {
          offenders.push(`${file}:${i + 1} — ${h} = ${px}px`);
        }
      }
    }
    expect(offenders, "Too small to hit:\n" + offenders.join("\n")).toEqual([]);
  });
});

describe("a clickable row can be reached without a mouse", () => {
  // A <tr onClick> with no tabIndex and no key handler is a control only a
  // mouse can operate — and in both of these the row was the ONLY route to what
  // it opens.
  const ROWS: [string, string][] = [
    ["src/components/ui/data-table.tsx", "the Live Floor list"],
    ["src/components/leads/leads-table.tsx", "Lead 360"],
  ];

  for (const [file, what] of ROWS) {
    it(`${file} (${what})`, () => {
      const src = read(file);
      expect(src).toMatch(/tabIndex=\{0\}|tabIndex: 0/);
      expect(src).toMatch(/onKeyDown/);
      // …and the handler must not swallow keys aimed at a control INSIDE the
      // row, or typing in a cell's input would open the modal.
      expect(src).toMatch(/e\.target !== e\.currentTarget/);
    });
  }

  it("the reports table has a real button, not a <span> that says View", () => {
    const src = read("src/components/reports/recent-calls.tsx");
    expect(src).not.toMatch(/<span[^>]*>\s*View →\s*<\/span>/);
    expect(src).toMatch(/<button[\s\S]{0,800}View →/);
    // The row's own onClick must not fire as well.
    expect(src).toMatch(/stopPropagation/);
  });
});
