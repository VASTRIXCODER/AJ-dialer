// ─────────────────────────────────────────────────────────────────────────────
// Per-org display-label overrides for the fixed lead-group "dropboxes".
//
// The group KEYS (fresno / houston / dallas / california / manual) and the
// geo-classifier are GLOBAL and shared by every org — renaming them would move
// the labels for all tenants and desync the city-based classifier. An org can
// instead override only what those buckets are CALLED in its own UI (e.g. a
// Texas tenant showing "San Antonio" where the underlying key is still "fresno").
//
// Display-only: overrides never touch stored `lead_group` values, imports, or
// classification — purely how the bucket is labeled on screen for that org.
// ─────────────────────────────────────────────────────────────────────────────

/** Replace a group's default label with the org's override for that key, if set. */
export function applyLabelOverride(
  key: string,
  defaultLabel: string,
  overrides?: Record<string, string> | null,
): string {
  const o = overrides?.[key];
  return o && o.trim() ? o.trim() : defaultLabel;
}
