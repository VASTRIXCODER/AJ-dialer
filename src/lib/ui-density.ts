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

/**
 * Table cell padding. Horizontal is a CONSTANT — the whole point of the rule.
 *
 * `data-table.tsx` used to switch `px-4 py-3` ↔ `px-3 py-1.5`, moving every
 * column 4px inward on the way to Compact.
 */
export function cellPadding(density: Density): string {
  return density === "compact" ? "px-4 py-1.5" : "px-4 py-3";
}

/**
 * A row's minimum height, so rows land on a grid instead of being however tall
 * their longest cell happens to be. Never a fixed `h-` — a genuinely tall cell
 * (a wrapped address, a two-line note) must still be allowed to grow; it just
 * cannot make its neighbours look broken by being the only 90px row in a
 * column of 40px ones.
 */
export function rowMinHeight(density: Density): string {
  return density === "compact" ? "min-h-8" : "min-h-10";
}
