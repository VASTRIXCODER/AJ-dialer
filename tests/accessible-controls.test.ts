import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  campaignStatusConfig,
  leadStatusConfig,
  outcomeConfig,
  repStatusConfig,
  resolveLeadStatusConfig,
  resolveOutcomeConfig,
} from "@/lib/status";

// ─────────────────────────────────────────────────────────────────────────────
// Two ways a control can be unusable while looking fine.
//
// 1. It encodes its state in colour alone. `Badge`'s tones differ only in fill
//    and text colour, and its one shape lever drew the identical 6px dot for
//    every tone — so "Qualified" and "Appointment" (both success), "Callback"
//    and "No need right now" (both warning), and "Wrong number" and "Do not
//    call" (both danger) were distinguishable only by hue, across 61 sites.
//
// 2. It has no name. An icon-only button announces "button" to a screen reader
//    and cannot be addressed at all by voice control. `title=` does not fix
//    that — it is not exposed on touch and is not a reliable accessible name.
//
// Before this file the whole 110-file suite contained exactly one aria
// assertion.
// ─────────────────────────────────────────────────────────────────────────────

const ROOT = resolve(__dirname, "..");

describe("state carries a glyph, not only a hue", () => {
  const MAPS = {
    leadStatusConfig,
    outcomeConfig,
    campaignStatusConfig,
    repStatusConfig,
  };

  it("every state a rep reads has an icon", () => {
    const missing: string[] = [];
    for (const [name, map] of Object.entries(MAPS)) {
      for (const [key, cfg] of Object.entries(map)) {
        if (!cfg.icon) missing.push(`${name}.${key}`);
      }
    }
    expect(missing, missing.join("\n")).toEqual([]);
  });

  it("two states sharing a tone do not share a glyph", () => {
    // This is the actual failure mode. Listing the pairs by tone is what
    // catches "somebody added a fifth warning state and reused a check mark".
    for (const [name, map] of Object.entries(MAPS)) {
      const byTone = new Map<string, unknown[]>();
      for (const cfg of Object.values(map)) {
        const list = byTone.get(cfg.tone) ?? [];
        list.push(cfg.icon);
        byTone.set(cfg.tone, list);
      }
      for (const [tone, icons] of byTone) {
        expect(
          new Set(icons).size,
          `${name}: two "${tone}" states draw the same glyph`,
        ).toBe(icons.length);
      }
    }
  });

  it("the vocabulary resolvers keep the icons", () => {
    // These rebuild the map for a workspace's own wording. Dropping the icon
    // on the way through would silently un-fix every solar/insurance tenant.
    const vocab = { noNeedLabel: "Happy with cover", appointmentNoun: "review" };
    for (const cfg of Object.values(resolveOutcomeConfig(vocab))) {
      expect(cfg.icon).toBeTruthy();
    }
    for (const cfg of Object.values(resolveLeadStatusConfig(vocab))) {
      expect(cfg.icon).toBeTruthy();
    }
  });

  it("an active filter chip differs from an inactive one by more than colour", () => {
    const chip = readFileSync(resolve(ROOT, "src/components/ui/filter-chip.tsx"), "utf8");
    // A check glyph and a weight change — the two states used to be the same
    // radius, padding, weight and ring width, differing in fill alone.
    expect(chip).toMatch(/active \?[\s\S]{0,120}<Check/);
    expect(chip).toMatch(/active \? "font-bold"/);
  });
});

describe("every icon-only control says what it is", () => {
  /**
   * Buttons whose visible content is entirely glyphs. The heuristic: strip the
   * JSX tags and any expression that cannot produce words, and see whether
   * anything readable is left.
   */
  /**
   * Where a JSX opening tag actually ends.
   *
   * `[^>]*>` does not work: `onClick={() => …}` contains a `>`, so the match
   * stops inside the attribute list and every attribute after it leaks into
   * what the caller thinks is the element's CONTENT. That is not academic —
   * `title={label}` leaking in made the "does this render words" heuristic
   * answer yes for a button whose only visible child was an icon, so an entire
   * class of unnamed controls was invisible to this file. Brace depth is what
   * distinguishes a `>` inside an expression from the one that closes the tag.
   */
  function tagEnd(source: string, from: number): number {
    let depth = 0;
    let quote: string | null = null;
    for (let i = from; i < source.length; i += 1) {
      const c = source[i];
      if (quote) {
        if (c === quote) quote = null;
        continue;
      }
      if (c === '"' || c === "'" || c === "`") quote = c;
      else if (c === "{") depth += 1;
      else if (c === "}") depth -= 1;
      else if (c === ">" && depth === 0) return i;
    }
    return -1;
  }

  function iconOnlyButtons(source: string): string[] {
    const out: string[] = [];
    for (const open of source.matchAll(/<button\b/g)) {
      const start = open.index!;
      const gt = tagEnd(source, start);
      if (gt < 0) continue;
      const close = source.indexOf("</button>", gt);
      if (close < 0) continue;
      const block = source.slice(start, close + "</button>".length);
      const inner = source.slice(gt + 1, close);
      // Only the OPENING tag can name the control; the content is what decides
      // whether it needs one.
      const openTag = source.slice(start, gt + 1);
      if (source.slice(start, gt).includes("<button", 1)) continue; // nested, skip
      void openTag;
      // A label inside `className="hidden sm:inline"` is display:none below the
      // breakpoint, which takes it out of the accessibility tree — so on a
      // phone the control is an icon with no name at all. Words that appear
      // ONLY in a hidden span therefore do not count as a name, and that
      // exclusion has to happen BEFORE the checks below or `{label}` inside one
      // satisfies them. Five appointments controls were built exactly this way.
      const shown = inner.replace(
        /<span[^>]*className="[^"]*\bhidden\b[\s\S]*?<\/span>/g,
        " ",
      );
      const withoutTags = shown.replace(/<[^>]*>/g, " ");
      // An expression renders words when it names a label-ish binding, when it
      // contains a quoted string with letters in it, or when it is a bare value
      // — `{open ? "Hide" : "Show"}` and `{col.label}` and `{n}` all put
      // something readable on screen; `{on ? <Pause/> : <Play/>}` does not,
      // because everything it can produce is an element.
      const wordy =
        /\{[^{}]*\b(label|title|name|text|children|count|Label)\b[^{}]*\}/.test(withoutTags) ||
        /\{[\s\S]*?["'`][^"'`]*[A-Za-z]{2}[^"'`]*["'`][\s\S]*?\}/.test(withoutTags) ||
        [...withoutTags.matchAll(/\{([^{}]*)\}/g)].some(
          (e) => !e[1].includes("<") && /[A-Za-z0-9]/.test(e[1]),
        );
      const visible = withoutTags.replace(/\{[\s\S]*?\}/g, " ").replace(/\s+/g, " ").trim();
      if (wordy || visible.length > 0) continue;
      // Anything left renders no words at all. That includes the Settings
      // page's Switch, whose only child was a decorative <span> — a lowercase
      // element, so requiring an icon COMPONENT here would have missed the
      // control on every preference row in the product.
      out.push(block);
    }
    return out;
  }

  function hasName(block: string): boolean {
    return (
      /aria-label=/.test(block) ||
      /aria-labelledby=/.test(block) ||
      /sr-only/.test(block) ||
      // A `<Tooltip>` wrapper is not enough on its own, but an aria-hidden
      // glyph beside an sr-only span is — covered above.
      false
    );
  }

  // EVERY component. This was a six-directory allowlist, which is how five
  // controls in the appointments workspace — the segmented view switcher, the
  // save-view button, the new-appointment button, and the approve/open pair on
  // a review row — sat there unnamed while this test passed: it was not
  // looking at them.
  const FILES = execSync(
    'git ls-files --cached --others --exclude-standard "src/components/**/*.tsx"',
    { cwd: ROOT, encoding: "utf8" },
  )
    .split("\n")
    .filter(Boolean);

  it("has files to check", () => {
    expect(FILES.length).toBeGreaterThan(30);
  });

  it("no icon-only button is nameless", () => {
    const offenders: string[] = [];
    for (const path of FILES) {
      const source = readFileSync(resolve(ROOT, path), "utf8");
      for (const block of iconOnlyButtons(source)) {
        if (!hasName(block)) {
          offenders.push(`${path}: ${block.replace(/\s+/g, " ").slice(0, 110)}…`);
        }
      }
    }
    expect(
      offenders,
      `Icon-only buttons with no accessible name (title= is not one):\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});
