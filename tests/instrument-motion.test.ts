import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// "Cinema belongs to the Stage. Silence belongs to the Instrument."
//
// W1 moved colour, type, radius and elevation into CI. It stopped short of
// motion — which is exactly why, three waves later, the nine disposition
// buttons still cascaded in over two thirds of a second at the end of every
// call, the live call bar still slid 24px up the screen, and a 72px-blurred
// green orb still breathed behind the contact's face for forty minutes at a
// time. Every one of those was in the design document. None of them was in a
// test, and this repo has no ESLint config at all.
//
// The rule, verbatim from the phase:
//
//   Instrument — the queue table and every data grid, the live call bar,
//   dispositions, notes, the lead record, call history, briefings, all forms,
//   all filters, admin, and every number a rep reads. No gradients, no glow, no
//   blur behind text, no shadow above level 2, no motion that translates or
//   scales, no decorative colour. Only the 90ms curve, only on colour and
//   opacity — which WCAG 2.3.3 explicitly excludes from its definition of
//   motion.
//
// (The source document also lists "wrap-up" as a Stage surface while listing
// "dispositions" as Instrument. Dispositions ARE wrap-up's content, and they
// are named explicitly, so they are policed here. A rep files 150 of them a
// day; that is not a place for a stagger.)
//
// Source-level, in the idiom of tests/token-discipline.test.ts.
// ─────────────────────────────────────────────────────────────────────────────

const ROOT = resolve(__dirname, "..");

/** Comments are prose. A comment recording what a line USED to be is the
 *  documentation this codebase runs on — flagging it teaches people to delete
 *  the explanation instead of the offence. */
function stripComments(source: string): string {
  return source
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(?<!:)\/\/.*$/gm, "");
}

/**
 * The Instrument. Every one of these is a surface a rep works ON — reading a
 * number, filing an outcome, filtering a list — rather than a surface they
 * arrive at.
 */
const INSTRUMENT = [
  // The dialer's working surfaces.
  "src/components/dialer/call-cockpit.tsx",
  "src/components/dialer/outcome-grid.tsx",
  "src/components/dialer/dial-pad.tsx",
  "src/components/dialer/qualify-panel.tsx",
  "src/components/dialer/wrapup-panel.tsx",
  "src/components/dialer/parallel-lanes.tsx",
  "src/components/dialer/dialer-floor.tsx",
  "src/components/dialer/global-call-bar.tsx",
  "src/components/dialer/caller-id-picker.tsx",
  "src/components/dialer/teleprompter.tsx",
  // Primitives that render inside them, or inside a grid.
  "src/components/ui/lane-card.tsx",
  "src/components/ui/data-table.tsx",
  "src/components/ui/toast.tsx",
  "src/components/ui/button.tsx",
  "src/components/ui/input.tsx",
  "src/components/ui/select-menu.tsx",
  "src/components/ui/filter-chip.tsx",
  "src/components/ui/badge.tsx",
  // The data surfaces.
  "src/components/leads/leads-table.tsx",
  "src/components/shared/page-header.tsx",
];

const FILES = INSTRUMENT.map((path) => ({
  path,
  code: stripComments(readFileSync(resolve(ROOT, path), "utf8")),
}));

it("the Instrument list has no stale entries", () => {
  // A file that was renamed away silently stops being policed.
  const tracked = new Set(
    execSync('git ls-files --cached --others --exclude-standard "src/**/*.tsx" "src/**/*.ts"', {
      cwd: ROOT,
      encoding: "utf8",
    })
      .split("\n")
      .filter(Boolean),
  );
  const missing = INSTRUMENT.filter((p) => !tracked.has(p));
  expect(missing, missing.join("\n")).toEqual([]);
});

describe("an Instrument surface does not move", () => {
  /** Runs `pattern` over every Instrument file and reports every hit. */
  function sweep(pattern: RegExp, why: string) {
    const offenders: string[] = [];
    for (const { path, code } of FILES) {
      for (const m of code.matchAll(new RegExp(pattern.source, "g"))) {
        offenders.push(`${path}: ${m[0].trim().slice(0, 70)} — ${why}`);
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  }

  it("nothing lifts or shrinks under the pointer", () => {
    sweep(/whileHover|whileTap/, "hover/tap motion");
    sweep(/active:scale-|group-hover:scale-|hover:scale-|hover:-translate/, "a transform on interaction");
  });

  // The one legitimate transform on the Instrument: a switch whose knob
  // travels. The movement IS the control's state — freezing it would leave two
  // visually identical positions. Everything else that reached for
  // `transition-transform` was a disclosure caret, and those swap their glyph
  // instead of rotating it.
  const TRANSFORM_ALLOWED: Record<string, string> = {
    "src/components/dialer/call-cockpit.tsx": "the auto-dial switch knob — the travel is the state",
  };

  it("the only transform left is a switch knob, and it is declared", () => {
    const offenders: string[] = [];
    for (const { path, code } of FILES) {
      if (/transition-transform/.test(code) && !TRANSFORM_ALLOWED[path]) {
        offenders.push(`${path}: transitions a transform with no stated reason`);
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
    const stale = Object.keys(TRANSFORM_ALLOWED).filter(
      (p) => !FILES.some((f) => f.path === p && /transition-transform/.test(f.code)),
    );
    expect(stale, `${stale.join("\n")} — no longer needs the exception`).toEqual([]);
  });

  it("nothing translates, scales or rotates on entry", () => {
    // Framer props: `y: 10`, `scale: 0.97`, `x: -8`, `rotate: -12`.
    sweep(/\b(?:x|y|scale|rotate):\s*-?[\d.]+/, "a transform in a motion prop");
  });

  it("nothing pings", () => {
    // `animate-ping` is a scale(2) transform, and it is always next to a number.
    sweep(/animate-ping/, "a scale(2) transform");
  });

  it("nothing keeps a decorative animation running for the length of a call", () => {
    sweep(/glow-orb|animate-glow-pulse|animate-pulse-ring|animate-float|animate-aurora/, "permanent decoration");
  });
});

describe("an Instrument surface stays flat", () => {
  function sweep(pattern: RegExp, why: string) {
    const offenders: string[] = [];
    for (const { path, code } of FILES) {
      for (const m of code.matchAll(new RegExp(pattern.source, "g"))) {
        offenders.push(`${path}: ${m[0].trim().slice(0, 70)} — ${why}`);
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  }

  it("no shadow above level 2", () => {
    sweep(/shadow-lift|shadow-3\b/, "elevation 3 on a working surface");
  });

  it("no blur behind a control's own text", () => {
    sweep(/backdrop-blur/, "the page showing through the thing being read");
  });

  it("no gradient", () => {
    sweep(/bg-gradient-|text-gradient-/, "decorative colour");
  });

  it("no arbitrary coloured halo outside the elevation ladder", () => {
    sweep(/shadow-\[[^\]]*hsl\(/, "a hand-rolled glow");
  });
});

describe("colour and opacity move on the 90ms curve", () => {
  it("no long transition on a control a rep uses repeatedly", () => {
    // The state curve is 90ms. `duration-200`/`300`/`500` on a button a rep
    // presses 150 times a day reads as lag, not as polish.
    const offenders: string[] = [];
    for (const { path, code } of FILES) {
      for (const m of code.matchAll(/duration-(\d{3,})\b/g)) {
        if (Number(m[1]) > 150) offenders.push(`${path}: ${m[0]}`);
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});

describe("the page itself does not rise into place", () => {
  it("PageContainer does not apply the Stage reveal to every screen", () => {
    // 44 files render through PageContainer. With `page-reveal` on it, every
    // route change replayed a 600ms staggered translateY over whatever the rep
    // was reading.
    const container = FILES.find((f) => f.path === "src/components/shared/page-header.tsx");
    expect(container).toBeDefined();
    expect(container!.code).not.toMatch(/page-reveal/);
  });

  it("the global button base does not scale on press", () => {
    // Every button in the product resolves through buttonVariants, which made
    // this one class the largest single source of motion on the Instrument.
    const button = FILES.find((f) => f.path === "src/components/ui/button.tsx");
    expect(button).toBeDefined();
    expect(button!.code).not.toMatch(/active:scale/);
  });
});
