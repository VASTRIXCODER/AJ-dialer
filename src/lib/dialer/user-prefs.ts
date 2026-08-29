// ─────────────────────────────────────────────────────────────────────────────
// Per-USER dialer preferences — PURE parsing (no I/O, client- & server-safe).
//
// These are personal workflow defaults (does MY dialer auto-advance, do I start
// at full parallel), not org policy — org policy lives in organizations.settings
// and wins where the two overlap (a 1-line org never parallel-dials whatever a
// rep prefers; an AI-booted session ignores the parallel default).
//
// Storage is the profile's `preferences` JSONB under the `dialerPrefs` key
// (written via POST /api/profile from the Settings page, read server-side in
// the (app) layout) — so the prefs follow the user across devices and are
// resolved before first paint, with no hydration dance.
// ─────────────────────────────────────────────────────────────────────────────

export interface DialerUserPrefs {
  /** Auto-start the next call after a disposition files. */
  autoDialNext: boolean;
  /** Open manual sessions at the org's full parallel line count. */
  parallelDefault: boolean;
}

export const DEFAULT_DIALER_USER_PREFS: DialerUserPrefs = {
  autoDialNext: false,
  parallelDefault: false,
};

/** The `dialerPrefs` node of a profile's preferences JSONB, sanitized. */
export function parseDialerUserPrefs(preferences: unknown): DialerUserPrefs {
  const node = (preferences as { dialerPrefs?: unknown } | null | undefined)
    ?.dialerPrefs as Partial<DialerUserPrefs> | undefined;
  return {
    autoDialNext: node?.autoDialNext === true,
    parallelDefault: node?.parallelDefault === true,
  };
}
