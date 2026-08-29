// ─────────────────────────────────────────────────────────────────────────────
// Saved report views — the tiny, typed config a name on the /reports header
// points at. Stored in organizations.settings.reportViews and round-tripped
// through the org-settings PATCH, so like every other settings array it is
// UNTRUSTED on read: sanitizeReportViews whitelists every field, drops anything
// malformed, and caps the list — a hand-edited blob degrades to its valid views
// instead of blanking the reports header.
//
// PURE + isomorphic (no DB, no server-only): imported by mergeSettings, the
// reports Server Component, and the client view picker alike.
// ─────────────────────────────────────────────────────────────────────────────

/** The /reports range presets — must match RANGES on the reports page. */
export const REPORT_RANGE_KEYS = ["today", "7d", "30d", "all"] as const;
export type ReportRangeKey = (typeof REPORT_RANGE_KEYS)[number];

export type ReportCompareKey = "none" | "prev";

export interface ReportViewConfig {
  range: ReportRangeKey;
  /** "prev" = overlay deltas vs the previous same-length period. */
  compare: ReportCompareKey;
}

export interface ReportView {
  id: string;
  name: string;
  config: ReportViewConfig;
}

/** Hard cap — a picker, not a database. */
export const MAX_REPORT_VIEWS = 12;

const MAX_NAME = 60;

/** The /reports URL a view's config resolves to (defaults are omitted). */
export function reportViewHref(config: ReportViewConfig): string {
  const p = new URLSearchParams();
  if (config.range !== "all") p.set("range", config.range);
  if (config.compare === "prev") p.set("compare", "prev");
  const qs = p.toString();
  return qs ? `/reports?${qs}` : "/reports";
}

/**
 * Validate an untrusted stored list into typed views. Invalid rows are DROPPED
 * (never fatal), ids are deduped first-wins, and the list is capped.
 */
export function sanitizeReportViews(raw: unknown): ReportView[] {
  if (!Array.isArray(raw)) return [];
  const out: ReportView[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (out.length >= MAX_REPORT_VIEWS) break;
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const v = item as Record<string, unknown>;
    const id = typeof v.id === "string" ? v.id.slice(0, 64) : "";
    const name = typeof v.name === "string" ? v.name.trim().slice(0, MAX_NAME) : "";
    if (!id || !name || seen.has(id)) continue;
    const cfg =
      v.config && typeof v.config === "object" && !Array.isArray(v.config)
        ? (v.config as Record<string, unknown>)
        : {};
    const range = (REPORT_RANGE_KEYS as readonly string[]).includes(String(cfg.range))
      ? (String(cfg.range) as ReportRangeKey)
      : null;
    if (!range) continue;
    const compare: ReportCompareKey = cfg.compare === "prev" ? "prev" : "none";
    seen.add(id);
    out.push({ id, name, config: { range, compare } });
  }
  return out;
}
