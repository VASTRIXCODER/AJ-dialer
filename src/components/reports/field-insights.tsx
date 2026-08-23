import { fieldIcon } from "@/lib/leads/field-icons";
import type { LeadFieldDef } from "@/lib/leads/field-schema";
import type { MetricSummary } from "@/lib/types";
import { formatCurrency } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────────────────
// Book-wide insight panel for the Reports page.
//
// This replaces a hard-coded "Utility-bill insights" card that read
// "Avg bill / Avg solar / Total cost" over "qualified homeowners", plus EV, Pool
// and Battery ownership. Those are the same five typed columns every vertical
// stores — an insurance org's "Current premium", a recruiter's "Desired pay",
// a real-estate team's "Pre-approved" — so the NUMBERS were always right and
// only the words were somebody else's.
//
// The panel now renders whatever the org's schema actually exposes, under the
// org's own labels, and reports nothing at all when the org has hidden every
// one of these slots (rather than inventing a solar panel for them).
// ─────────────────────────────────────────────────────────────────────────────

/** Which MetricSummary aggregate belongs to which core slot. */
const MONEY_SLOTS = [
  { key: "utilityBill", metric: "avgUtilityBill" },
  { key: "solarPayment", metric: "avgSolarPayment" },
] as const;

const SHARE_SLOTS = [
  { key: "hasEV", metric: "evOwnership" },
  { key: "hasPool", metric: "poolOwnership" },
  { key: "hasBattery", metric: "batteryOwnership" },
] as const;

export interface FieldInsight {
  key: string;
  label: string;
  kind: "money" | "share";
  value: number;
}

/**
 * The insights this org can actually show, in schema order. Exported so the page
 * can decide between this panel and the generic funnel one without duplicating
 * the "is there anything to show?" rule.
 */
export function resolveFieldInsights(
  fields: LeadFieldDef[],
  metrics: MetricSummary,
): FieldInsight[] {
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const out: FieldInsight[] = [];
  for (const slot of MONEY_SLOTS) {
    const def = byKey.get(slot.key);
    // A slot the org hid, or one nobody has ever filled in, is not an insight —
    // a row of "$0" reads as a finding rather than as an absence of data.
    if (!def || !def.showInTable) continue;
    const value = metrics[slot.metric];
    if (!value) continue;
    out.push({ key: slot.key, label: def.label, kind: "money", value });
  }
  for (const slot of SHARE_SLOTS) {
    const def = byKey.get(slot.key);
    if (!def) continue;
    out.push({
      key: slot.key,
      label: def.label,
      kind: "share",
      value: metrics[slot.metric] ?? 0,
    });
  }
  return out;
}

/** Strip a trailing unit hint — "Utility bill ($/mo)" → "Utility bill". */
function bare(label: string): string {
  return label.replace(/\s*\([^)]*\)\s*$/, "").trim() || label;
}

export function FieldInsights({
  insights,
  /** Shown under the money tiles when the org tracks two money slots. */
  combinedLabel,
}: {
  insights: FieldInsight[];
  combinedLabel?: string;
}) {
  const money = insights.filter((i) => i.kind === "money");
  const shares = insights.filter((i) => i.kind === "share");
  // Two money slots is the only case where a total means something: with one,
  // the "total" would just echo the tile beside it.
  const total =
    money.length > 1 ? money.reduce((sum, i) => sum + i.value, 0) : null;

  return (
    <div className="space-y-4">
      {money.length > 0 && (
        <div
          className="grid gap-2 text-center"
          style={{ gridTemplateColumns: `repeat(${money.length + (total ? 1 : 0)}, minmax(0,1fr))` }}
        >
          {money.map((i) => (
            <div key={i.key} className="rounded-xl bg-muted p-3">
              <p className="text-lg font-bold tabular">{formatCurrency(i.value)}</p>
              <p className="text-[10px] text-muted-foreground">{bare(i.label)}</p>
            </div>
          ))}
          {total != null && (
            <div className="rounded-xl bg-primary-soft p-3">
              <p className="text-lg font-bold tabular text-primary">
                {formatCurrency(total)}
              </p>
              <p className="text-[10px] text-muted-foreground">
                {combinedLabel ?? "Combined"}
              </p>
            </div>
          )}
        </div>
      )}

      {shares.length > 0 && (
        <div className="space-y-3 pt-1">
          {shares.map((i) => {
            const Icon = fieldIcon({ label: i.label, type: "boolean" });
            return (
              <div key={i.key} className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-soft text-accent">
                  <Icon className="h-4 w-4" />
                </div>
                <span className="flex-1 text-sm text-muted-foreground">
                  {bare(i.label)}
                </span>
                <span className="text-sm font-bold tabular">{i.value}%</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
