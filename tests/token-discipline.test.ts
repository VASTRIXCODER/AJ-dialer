import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// The rule that stops the drift.
//
// The previous build had a perfectly good token file and still shipped a red
// focus ring on a blue button, 50 text classes below the legibility floor and
// 57 opacity modifiers on ink tokens. Nothing stopped any of it, because the
// rules lived in a document rather than in CI.
//
// Enforcement is source-level rather than an ESLint plugin because the repo
// has no ESLint config at all (`next lint` prompts to create one), and a rule
// nobody runs is the same as no rule. These run with `npm test`.
// ─────────────────────────────────────────────────────────────────────────────

const ROOT = resolve(__dirname, "..");

function sourceFiles(): string[] {
  return execSync('git ls-files "src/**/*.tsx" "src/**/*.ts"', {
    cwd: ROOT,
    encoding: "utf8",
  })
    .split("\n")
    .filter(Boolean);
}

/**
 * Comments are prose, not code. A comment that records the value it replaced —
 * "it was hardcoded rgba(255,255,255,0.4)" — is documentation, and a linter
 * that flags it teaches people to delete the explanation instead of the
 * offence. The `(?<!:)` guard keeps `https://` from being read as a comment.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(?<!:)\/\/.*$/gm, "");
}

const FILES = sourceFiles().map((path) => {
  const raw = readFileSync(resolve(ROOT, path), "utf8");
  return { path, text: raw, code: stripComments(raw) };
});

/** file -> why a raw hex is legitimate there. Colour that is DATA, not design. */
const HEX_ALLOWED: Record<string, string> = {
  "src/components/admin/org-settings-form.tsx": "default for the tenant brand-colour picker",
  "src/components/campaigns/campaigns-view.tsx": "default for the tenant brand-colour picker",
  "src/components/campaigns/campaign-builder.tsx": "default for the tenant brand-colour picker",
  "src/components/hub/hub-view.tsx": "defaults for the workspace brand-colour picker",
  "src/components/superadmin/super-orgs.tsx": "defaults for the tenant brand-colour picker",
  "src/components/auth/auth-form.tsx": "the Google logo SVG, whose colours are Google's to set",
  "src/components/ui/avatar.tsx": "computed black-or-white pick over a derived monogram colour",
};

describe("no text below the legibility floor", () => {
  it("11px is the floor — 10px and 9px do not exist", () => {
    const offenders: string[] = [];
    for (const { path, text } of FILES) {
      for (const m of text.matchAll(/text-\[(\d+(?:\.\d+)?)px\]/g)) {
        if (Number(m[1]) < 11) offenders.push(`${path}: ${m[0]}`);
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});

describe("no opacity modifier on an ink token", () => {
  it("quieter text takes the next token down, which has a measured ratio", () => {
    // `text-muted-foreground/60` has no measured contrast ratio — it is a
    // colour nobody checked. The ink scale has exactly three steps and each
    // one is verified in tests/tokens-contrast.test.ts.
    const offenders: string[] = [];
    for (const { path, text } of FILES) {
      for (const m of text.matchAll(
        /\btext-(?:foreground|muted-foreground|ink|ink-2|ink-3|card-foreground|popover-foreground)\/\d+/g,
      )) {
        offenders.push(`${path}: ${m[0]}`);
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});

describe("no raw colour outside the token system", () => {
  it("hex literals appear only where the colour is data, with a stated reason", () => {
    const offenders: string[] = [];
    for (const { path, code } of FILES) {
      if (!path.startsWith("src/components/")) continue;
      const hits = [...code.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0]);
      if (hits.length && !HEX_ALLOWED[path]) {
        offenders.push(`${path}: ${hits.join(", ")}`);
      }
    }
    expect(
      offenders,
      `Raw hex in a component. Use a token, or add the file to HEX_ALLOWED with a reason:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("the allowlist has no stale entries", () => {
    // An allowlist that outlives its reason is how exceptions become the rule.
    const stale = Object.keys(HEX_ALLOWED).filter((path) => {
      const f = FILES.find((x) => x.path === path);
      return !f || !/#[0-9a-fA-F]{3,8}\b/.test(f.code);
    });
    expect(stale, `No longer needed in HEX_ALLOWED:\n${stale.join("\n")}`).toEqual([]);
  });

  it("no arbitrary rgb()/rgba() colour in a component", () => {
    const offenders: string[] = [];
    for (const { path, code } of FILES) {
      if (!path.startsWith("src/components/")) continue;
      for (const m of code.matchAll(/\brgba?\(\s*\d/g)) offenders.push(`${path}: ${m[0]}…`);
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});

describe("cinema stays on the Stage", () => {
  // "Depth, glass, volumetric light and orchestrated motion go on the shell,
  // the sign-in, the org picker, the idle and empty states, and the moment a
  // call connects. Everything a rep reads stays flat, dense and still."
  const STAGE_ALLOWED = [
    "src/components/layout/ambient-background.tsx", // the field itself
    "src/app/page.tsx", // marketing landing
    "src/components/marketing/", // marketing surfaces
    "src/components/dialer/call-cockpit.tsx", // the live-call signal ring (W3)
  ];

  it("the ambient field is not mounted behind the working app", () => {
    const shell = FILES.find((f) => f.path === "src/components/layout/app-shell.tsx");
    expect(shell).toBeDefined();
    expect(shell!.text).not.toMatch(/<AmbientBackground\b/);
  });

  it("no decorative glow or drifting mesh on Instrument surfaces", () => {
    const offenders: string[] = [];
    for (const { path, text } of FILES) {
      if (STAGE_ALLOWED.some((p) => path.startsWith(p))) continue;
      for (const m of text.matchAll(/\b(glow-orb|bg-aurora|bg-mesh|animate-aurora|animate-float)\b/g)) {
        offenders.push(`${path}: ${m[1]}`);
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});
