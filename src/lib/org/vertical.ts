// ─────────────────────────────────────────────────────────────────────────────
// Vertical (industry) resolution — PURE module, importable from Client and
// Server Components alike.
//
// The product started as a solar-resolution dialer, so solar vocabulary was
// written straight into shared screens: "Solar payment" fields, a "Solar
// resolution workflow" card, an "Avg solar" stat, a "Solar Resolution" wordmark.
// A tenant selling anything else reads those as someone else's product.
//
// `organizations.dialer_template` already records the vertical (and already
// drives the dashboard's insight panel and the AI agent's script), so it is the
// single lever here rather than a second, competing flag. Anything that is
// meaningless outside solar is hidden or generically relabelled when the org's
// template isn't solar; solar tenants see exactly what they saw before.
// ─────────────────────────────────────────────────────────────────────────────

/** The vertical an org that never picked one falls back to (see membership.ts). */
export const DEFAULT_TEMPLATE = "general";

/**
 * Does this org sell against a solar loan/lease? Only then do the solar-specific
 * fields and copy appear. Absent/unknown templates are treated as NOT solar, so
 * a workspace created without a vertical gets the neutral dialer rather than
 * inheriting someone else's industry.
 */
export function isSolarVertical(dialerTemplate?: string | null): boolean {
  return (dialerTemplate ?? DEFAULT_TEMPLATE).trim().toLowerCase() === "solar";
}

/**
 * Subtitle under the AIATWORK wordmark. Solar workspaces keep the original
 * "Solar Resolution"; everyone else gets their own product name when they've
 * set one, falling back to a vertical-neutral line.
 */
export function brandTagline(
  dialerTemplate?: string | null,
  productName?: string | null,
): string {
  if (isSolarVertical(dialerTemplate)) return "Solar Resolution";
  const name = productName?.trim();
  return name || "Sales Dialer";
}
