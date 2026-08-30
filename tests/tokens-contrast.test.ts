import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// The palette is measured, so measure it.
//
// The design system's own diagnosis of the previous build was that it "has a
// good token file and still shipped a red focus ring on a blue button, because
// nothing stopped it." A token file whose contrast is asserted in a comment is
// a token file that drifts. These tests recompute every ratio from
// src/app/globals.css on every run, so a nudged lightness fails the suite
// instead of quietly failing a rep with low vision.
//
// Thresholds come from WCAG 2.2: 4.5:1 for body text (1.4.3), 3:1 for the
// boundary of a control and other non-text essentials (1.4.11).
// ─────────────────────────────────────────────────────────────────────────────

const CSS = readFileSync(resolve(__dirname, "../src/app/globals.css"), "utf8");

/** Every `--name: H S% L%` (or `var(--other)`) inside :root / .dark blocks. */
function readTheme(selector: ":root" | ".dark"): Map<string, string> {
  const out = new Map<string, string>();
  // `.dark .superadmin-theme {` deliberately does not match: the `{` must
  // follow the selector directly, so the scoped console re-tint stays out.
  const blocks = CSS.matchAll(
    new RegExp(`${selector.replace(".", "\\.")}\\s*\\{([^}]*)\\}`, "g"),
  );
  for (const b of blocks) {
    for (const m of b[1].matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/g)) {
      out.set(m[1], m[2].trim());
    }
  }
  return out;
}

const LIGHT = readTheme(":root");
const DARK = new Map([...LIGHT, ...readTheme(".dark")]);

/** Resolves `var(--x)` chains within a theme, then parses `H S% L%`. */
function rgb(name: string, theme: Map<string, string>): [number, number, number] {
  let value = theme.get(name);
  for (let hops = 0; value?.startsWith("var(") && hops < 8; hops++) {
    value = theme.get(value.slice(6, value.indexOf(")")));
  }
  if (!value) throw new Error(`token --${name} is not defined`);
  const parts = value.replace(/%/g, "").split(/\s+/).map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) {
    throw new Error(`token --${name} is not an "H S% L%" triplet: ${value}`);
  }
  const [h, s, l] = [parts[0], parts[1] / 100, parts[2] / 100];
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const t: number[] =
    h < 60 ? [c, x, 0]
    : h < 120 ? [x, c, 0]
    : h < 180 ? [0, c, x]
    : h < 240 ? [0, x, c]
    : h < 300 ? [x, 0, c]
    : [c, 0, x];
  return [t[0] + m, t[1] + m, t[2] + m];
}

function luminance(name: string, theme: Map<string, string>): number {
  const [r, g, b] = rgb(name, theme).map((v) =>
    v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string, theme: Map<string, string>): number {
  const [hi, lo] = [luminance(a, theme), luminance(b, theme)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** CIE L*a*b*, for judging whether two colours look like different colours. */
function lab(name: string, theme: Map<string, string>): [number, number, number] {
  const [r, g, b] = rgb(name, theme).map((v) =>
    v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4,
  );
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const x = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047);
  const y = f(0.2126 * r + 0.7152 * g + 0.0722 * b);
  const z = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

function deltaE(a: string, b: string, theme: Map<string, string>): number {
  const [l1, a1, b1] = lab(a, theme);
  const [l2, a2, b2] = lab(b, theme);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

const THEMES: [string, Map<string, string>][] = [
  ["light", LIGHT],
  ["dark", DARK],
];

/** The planes text is allowed to land on. surface-4 is deliberately absent. */
const TEXT_SURFACES = ["surface-void", "surface-1", "surface-2", "surface-3"];

describe("token palette · body text (WCAG 1.4.3, 4.5:1)", () => {
  for (const [themeName, theme] of THEMES) {
    for (const ink of ["ink", "ink-2", "ink-3"]) {
      for (const surface of TEXT_SURFACES) {
        it(`${themeName}: --${ink} on --${surface}`, () => {
          expect(contrast(ink, surface, theme)).toBeGreaterThanOrEqual(4.5);
        });
      }
    }
  }
});

describe("token palette · accent and signals as text (4.5:1)", () => {
  for (const [themeName, theme] of THEMES) {
    for (const token of ["accent", "signal-live", "signal-ring", "signal-stop"]) {
      for (const surface of ["surface-1", "surface-2", "surface-3"]) {
        it(`${themeName}: --${token} on --${surface}`, () => {
          expect(contrast(token, surface, theme)).toBeGreaterThanOrEqual(4.5);
        });
      }
    }
  }
});

describe("token palette · non-text contrast (WCAG 1.4.11, 3:1)", () => {
  for (const [themeName, theme] of THEMES) {
    for (const line of ["line-strong", "line-active"]) {
      for (const surface of ["surface-1", "surface-2"]) {
        it(`${themeName}: --${line} on --${surface}`, () => {
          expect(contrast(line, surface, theme)).toBeGreaterThanOrEqual(3);
        });
      }
    }
    // An input's border is what identifies it as a control, so it is not
    // decorative. The old value measured about 1.3:1 in light mode.
    it(`${themeName}: --input resolves to a border that meets 3:1`, () => {
      expect(contrast("input", "surface-1", theme)).toBeGreaterThanOrEqual(3);
    });
  }
});

describe("token palette · text drawn on a filled accent or signal", () => {
  for (const [themeName, theme] of THEMES) {
    for (const fill of ["accent", "signal-live", "signal-ring", "signal-stop"]) {
      it(`${themeName}: --on-fill on --${fill}`, () => {
        expect(contrast("on-fill", fill, theme)).toBeGreaterThanOrEqual(4.5);
      });
    }
  }
});

describe("token palette · structural invariants", () => {
  it("surface-4 is exempt from the text floor, and that is deliberate", () => {
    // Documents the reason surface-4 is missing from TEXT_SURFACES: --ink-3
    // genuinely does not reach 4.5:1 on it. If a future palette change makes
    // it pass, this test fails and the plane can be promoted on purpose
    // rather than by accident.
    for (const [, theme] of THEMES) {
      expect(contrast("ink-3", "surface-4", theme)).toBeLessThan(4.5);
    }
  });

  it("the elevation ramp steps in one direction and every plane is distinct", () => {
    for (const [themeName, theme] of THEMES) {
      // surface-1 through surface-4 are the elevation ramp and must be ordered.
      // surface-void is deliberately NOT in that sequence: in light mode the
      // app ground is faintly grey and cards are pure white, so the ground sits
      // *below* surface-1 while the ramp above it runs the other way. Asserting
      // one monotonic order across all five would encode a light-mode bug.
      const ramp = ["surface-1", "surface-2", "surface-3", "surface-4"].map((p) =>
        luminance(p, theme),
      );
      const monotonic =
        ramp.every((v, i) => i === 0 || v >= ramp[i - 1]) ||
        ramp.every((v, i) => i === 0 || v <= ramp[i - 1]);
      expect(monotonic, `${themeName}: surface-1..4 must step in one direction`).toBe(true);

      // Separation comes from the tonal step first, so the steps must be real.
      const all = ["surface-void", ...["surface-1", "surface-2", "surface-3", "surface-4"]];
      const unique = new Set(all.map((p) => luminance(p, theme).toFixed(4)));
      expect(unique.size, `${themeName}: all five planes must differ`).toBe(all.length);

      // Every adjacent step must be perceptible, including the ground -> card
      // step. Measured perceptually, not by raw luminance: near-black tokens
      // differ by a couple of thousandths of a luminance unit and are still
      // plainly different greys. ΔE76 of 2.3 is the just-noticeable difference,
      // so 2 is the floor for "this step does some work". Measured today:
      // 2.6 to 4.9 across both themes.
      for (const [lower, upper] of [
        ["surface-void", "surface-1"],
        ["surface-1", "surface-2"],
        ["surface-2", "surface-3"],
        ["surface-3", "surface-4"],
      ]) {
        expect(
          deltaE(lower, upper, theme),
          `${themeName}: --${lower} -> --${upper} is not a perceptible step`,
        ).toBeGreaterThan(2);
      }
    }
  });

  it("the six chart slots are mutually distinguishable", () => {
    // Perceptual distance, not luminance: chart-2 (green) and chart-3 (brown)
    // sit within 0.002 of each other in luminance and are still obviously
    // different colours. CIE ΔE76 over 15 is comfortably "not the same swatch".
    for (const [themeName, theme] of THEMES) {
      const slots = [1, 2, 3, 4, 5, 6].map((n) => `chart-${n}`);
      for (let i = 0; i < slots.length; i++) {
        for (let j = i + 1; j < slots.length; j++) {
          expect(
            deltaE(slots[i], slots[j], theme),
            `${themeName}: ${slots[i]} vs ${slots[j]}`,
          ).toBeGreaterThan(15);
        }
      }
    }
  });

  it("every token the aliases point at actually exists in both themes", () => {
    const aliases = [
      "background", "surface", "surface-muted", "card", "popover", "muted",
      "secondary", "foreground", "card-foreground", "popover-foreground",
      "secondary-foreground", "muted-foreground", "primary", "primary-foreground",
      "primary-soft", "accent-foreground", "accent-soft", "success",
      "success-foreground", "warning", "warning-foreground", "danger",
      "danger-foreground", "border", "input", "ring", "glow",
    ];
    for (const [themeName, theme] of THEMES) {
      for (const a of aliases) {
        expect(() => rgb(a, theme), `${themeName}: --${a}`).not.toThrow();
      }
    }
  });
});
