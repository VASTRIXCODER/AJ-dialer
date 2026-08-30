import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// A page shows the shape of what is coming.
//
// The rule the design system states: a spinner is for an action IN PLACE — a
// button that is saving. Anything that replaces a whole page, panel or grid
// uses a skeleton, because a centred dot tells a rep nothing about what is
// about to appear and the layout jumps when it does.
//
// Two ways this was being broken. Six authenticated routes awaited server data
// with no sibling loading.tsx, so navigating to them left the PREVIOUS screen
// frozen on the display until the query returned. And eight components replaced
// an entire region with a spinner — the superadmin Console replaced its whole
// <main>.
// ─────────────────────────────────────────────────────────────────────────────

const ROOT = resolve(__dirname, "..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

function files(glob: string): string[] {
  return execSync(`git ls-files --cached --others --exclude-standard "${glob}"`, {
    cwd: ROOT,
    encoding: "utf8",
  })
    .split("\n")
    .filter(Boolean);
}

describe("every route that waits has a skeleton", () => {
  it("a page.tsx that awaits server data has a sibling loading.tsx", () => {
    const missing = files("src/app/**/page.tsx").filter((p) => {
      const source = read(p);
      // Only server components that actually await something can suspend.
      if (source.includes('"use client"')) return false;
      if (!/export default async function/.test(source)) return false;
      if (!/\bawait\b/.test(source)) return false;
      return !existsSync(resolve(ROOT, dirname(p), "loading.tsx"));
    });
    expect(
      missing,
      `These routes await data with nothing on screen:\n${missing.join("\n")}`,
    ).toEqual([]);
  });
});

describe("a spinner is for an action, not for a page", () => {
  // Regions that used to collapse to a centred dot. Each is now a skeleton
  // that mirrors the geometry of what lands.
  const FIXED = [
    "src/components/superadmin/super-console.tsx",
    "src/components/superadmin/super-orgs.tsx",
    "src/components/reports/call-history.tsx",
    "src/components/dialer/booked-leads-panel.tsx",
  ];

  it("none of them centres a spinner in an empty region any more", () => {
    const offenders: string[] = [];
    for (const path of FIXED) {
      const source = read(path);
      // The tell: a flex-centred container whose only content is the spinner,
      // sized in `py-8`/`py-16`/`py-20` — a reserved void.
      for (const m of source.matchAll(
        /className="[^"]*items-center justify-center[^"]*\bpy-(?:8|16|20)\b[^"]*"[\s\S]{0,200}?animate-spin/g,
      )) {
        offenders.push(`${path}: ${m[0].slice(0, 60)}…`);
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("each renders a skeleton instead", () => {
    for (const path of FIXED) {
      expect(read(path), `${path} has no skeleton`).toMatch(/Skeleton/);
    }
  });
});
