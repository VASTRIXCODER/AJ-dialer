// ─────────────────────────────────────────────────────────────────────────────
// Display density — ONE setting, for the whole workspace.
//
// It used to be three unrelated toggles, each remembering its own answer in its
// own localStorage key: the dialer's parallel lanes, the monitor's floor board,
// and a fourth copy in the appointments workspace that went through server
// preferences instead. A rep who set one to Compact found the others unchanged,
// and /leads — the biggest grid in the product — had no density control at all.
//
// This is the pure half: the stored shape and the class strings. The provider
// that carries it is src/components/layout/density.tsx.
//
// THE CONTRACT, quoted from src/app/globals.css:
//
//   "Cell padding is 16px at every density. Density changes row height and
//    vertical padding — never font size, never horizontal padding."
//
// The reason is legibility, not taste. Shrinking the type on a dense grid makes
// the numbers harder to read at exactly the moment there are more of them; and
// moving the horizontal padding re-flows every column sideways, so a manager
// flipping to Compact loses the position of everything they were reading.
// Density is a VERTICAL setting.
// ─────────────────────────────────────────────────────────────────────────────

export type Density = "compact" | "comfortable";

export const DEFAULT_DENSITY: Density = "comfortable";

export function isDensity(v: unknown): v is Density {
  return v === "compact" || v === "comfortable";
}

/** The viewer's stored density (`profiles.preferences.density`), or null. */
export function parseDensityPreference(preferences: unknown): Density | null {
  const node = (preferences as { density?: unknown } | null | undefined)?.density;
  return isDensity(node) ? node : null;
}

// ── A warning about the numbers below ────────────────────────────────────────
//
// W1 replaced Tailwind's spacing scale with the product's own, in globals.css's
// `@theme inline` block. The step names therefore do NOT mean what they mean in
// stock Tailwind:
//
//     px-4 = 12px      px-5 = 16px      py-2 = 4px      py-3 = 8px
//     min-h-7 = 32px   min-h-8 = 40px
//
// Two consequences worth having in front of you before editing this file.
//
// First, `px-4` is 12px — so the "cell padding is 16px at every density" rule
// was never actually met: every table in the product was at 12px, comfortable
// included, while the token file's own comment said 16. The constant below is
// `px-5`.
//
// Second, FRACTIONAL steps are not on this scale at all. Tailwind falls back to
// its default 0.25rem base for them, so `py-1.5` is 6px while `py-2` is 4px —
// the half step is LARGER than the whole one above it. Everything here uses
// integer steps only, and tests/density.test.ts resolves each of them against
// the declared tokens so these comments cannot quietly go stale.

/**
 * Table cell padding — the ONE string every `<td>` and `<th>` in the product
 * uses.
 *
 * It takes no argument, and that is the point. The density-taking version below
 * needed `useDensity()`, so only the two components that called it were ever
 * affected: the other EIGHT tables were hardcoded at five different paddings,
 * three of them with no left padding at all, and two of those eight are SERVER
 * components that cannot call a hook. Reading the density from a CSS variable
 * on <html> reaches every one of them, at any depth, with no prop.
 *
 * Horizontal is a CONSTANT — the whole point of the rule. `data-table.tsx` used
 * to switch `px-4 py-3` ↔ `px-3 py-1.5`, moving every column inward on the way
 * to Compact (and landing on 6px vertical, which is MORE than the 4px `py-2` it
 * looks smaller than).
 */
export const CELL = "px-5 py-[var(--cell-py)]";

/**
 * A row's minimum height, from the same variable.
 *
 * A MINIMUM, never a fixed `h-`: a genuinely tall cell (a wrapped address, a
 * two-line note) must still be allowed to grow. It just cannot make its
 * neighbours look broken by being the only 90px row in a column of 40px ones.
 */
export const ROW_MIN = "min-h-[var(--row-min-h)]";

// cellPadding(density) and rowMinHeight(density) are gone rather than
// deprecated. A function that still exports gets imported again, and the whole
// point of this change is that there is exactly ONE cell padding in the
// product and nothing has to be given the density to use it.
