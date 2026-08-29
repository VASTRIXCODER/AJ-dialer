// ─────────────────────────────────────────────────────────────────────────────
// Org accent color → design-token override. PURE (client- and server-safe).
//
// The design system's accent utilities read `hsl(var(--accent))` etc., with the
// variables stored as raw HSL triplets ("190 90% 42%") so opacity modifiers
// work. An org's `accent_color` is a hex string an admin picked — this module
// turns it into a scoped CSS override that recolors the accent family in BOTH
// themes (dark gets a lightened variant so chips stay legible on dark surfaces)
// without touching any other token.
// ─────────────────────────────────────────────────────────────────────────────

/** "#0ea5e9" → {h,s,l} (degrees / %). Null for anything that isn't a hex color. */
export function hexToHsl(hex: string): { h: number; s: number; l: number } | null {
  const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(hex.trim());
  if (!m) return null;
  let raw = m[1];
  if (raw.length === 3) raw = raw.split("").map((c) => c + c).join("");
  const r = parseInt(raw.slice(0, 2), 16) / 255;
  const g = parseInt(raw.slice(2, 4), 16) / 255;
  const b = parseInt(raw.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l: Math.round(l * 100) };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
  else if (max === g) h = ((b - r) / d + 2) * 60;
  else h = ((r - g) / d + 4) * 60;
  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
}

/**
 * The scoped stylesheet for an org accent, or "" when the color isn't usable.
 * Applies to any element carrying `data-org-accent` (the app-shell root), so
 * the override never leaks into the auth/hub screens of another workspace.
 */
export function orgAccentCss(accentColor: string | null | undefined): string {
  const hsl = accentColor ? hexToHsl(accentColor) : null;
  if (!hsl) return "";
  const { h, s, l } = hsl;
  // Foreground: white on a dark accent, near-black on a light one.
  const fgLight = l > 62 ? "222 47% 11%" : "0 0% 100%";
  // Dark theme lifts lightness so the accent reads on dark surfaces.
  const lDark = Math.min(72, l + 12);
  const fgDark = lDark > 62 ? "222 60% 6%" : "0 0% 100%";
  return [
    `[data-org-accent]{--accent:${h} ${s}% ${l}%;--accent-foreground:${fgLight};--accent-soft:${h} ${Math.max(30, s - 10)}% 94%;}`,
    `.dark [data-org-accent]{--accent:${h} ${s}% ${lDark}%;--accent-foreground:${fgDark};--accent-soft:${h} ${Math.min(70, s)}% 17%;}`,
  ].join("\n");
}
