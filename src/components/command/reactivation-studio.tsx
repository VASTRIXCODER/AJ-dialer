"use client";

import { History, Loader2, PhoneCall } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useDialerContextOptional } from "@/components/dialer/dialer-context";
import { useVocabulary } from "@/components/layout/vocabulary";
import { SectionCard } from "@/components/shared/section-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { reactivationSummary, reactivationCohort } from "@/lib/dialer/reactivation";
import type { DialSessionMeta } from "@/lib/dialer/segments";
import type { Lead, LeadStatus } from "@/lib/types";

// ─────────────────────────────────────────────────────────────────────────────
// Reactivation studio (P2.9): aged books, re-entered deliberately. Each cohort
// states its rule and its exclusions; loading one hands the dialer a STRICT,
// no-refill session — a sweep can never wander off its list. Calls only:
// SMS/email re-engagement is provider-blocked and not simulated.
// ─────────────────────────────────────────────────────────────────────────────

interface CohortRow {
  key: string;
  label: string;
  hint: string;
  statuses: LeadStatus[];
  agedDays: number;
  count: number;
}

const LOAD_SIZES = [25, 50, 100];

export function ReactivationStudio() {
  const vocab = useVocabulary();
  const router = useRouter();
  const dialer = useDialerContextOptional();
  const [cohorts, setCohorts] = useState<CohortRow[] | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    fetch("/api/reactivation", { signal: ac.signal })
      .then((r) => (r.ok ? r.json() : { cohorts: [] }))
      .then((j: { cohorts?: CohortRow[] }) => setCohorts(j.cohorts ?? []))
      .catch(() => setCohorts([]));
    return () => ac.abort();
  }, []);

  // Loading state renders NOTHING (no fake zeros); an empty result collapses.
  if (!cohorts || cohorts.every((c) => c.count === 0)) return null;

  // The org's own words where the neutral copy mentions "no need".
  const hintFor = (c: CohortRow) =>
    c.key === "nurture_ripe"
      ? `Said “${vocab.noNeedLabel}” ${c.agedDays}+ days ago. Situations change — one respectful check-in.`
      : c.hint;

  async function load(c: CohortRow, limit: number) {
    if (!dialer) return;
    setLoading(`${c.key}:${limit}`);
    setNote(null);
    try {
      const res = await fetch("/api/reactivation", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cohort: c.key, limit }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        leads?: Lead[];
        count?: number;
        excluded?: { openCallback: number; held: number; badPhone: number };
        error?: string;
      };
      if (!res.ok) {
        setNote(json.error ?? "Couldn't build that list.");
        return;
      }
      const leads = json.leads ?? [];
      if (!leads.length) {
        setNote("Everyone in this cohort is excluded right now (open callbacks, holds, or missing numbers).");
        return;
      }
      const def = reactivationCohort(c.key);
      const meta: DialSessionMeta = {
        statuses: (def?.statuses ?? c.statuses) as LeadStatus[],
        strictOrder: true,
        refill: false,
        summary: def
          ? reactivationSummary(def, leads.length, vocab.leadNounPlural)
          : `Reactivation · ${leads.length} ${vocab.leadNounPlural}`,
      };
      dialer.loadSession(leads, meta);
      const ex = json.excluded;
      const skipped = ex ? ex.openCallback + ex.held + ex.badPhone : 0;
      if (skipped > 0) {
        setNote(
          `Loaded ${leads.length}. Skipped ${skipped}: ${[
            ex!.openCallback ? `${ex!.openCallback} with open callbacks` : null,
            ex!.held ? `${ex!.held} held by a rep` : null,
            ex!.badPhone ? `${ex!.badPhone} without a number` : null,
          ]
            .filter(Boolean)
            .join(", ")}.`,
        );
      }
      router.push("/dialer");
    } catch {
      setNote("Couldn't reach the server.");
    } finally {
      setLoading(null);
    }
  }

  return (
    <SectionCard
      title="Reactivation"
      description={`Aged ${vocab.leadNounPlural}, re-entered deliberately — never anyone on the Do-Not-Call list, with an open callback, or already held. Loads as a strict list.`}
    >
      <ul className="space-y-3">
        {cohorts
          .filter((c) => c.count > 0)
          .map((c) => (
            <li
              key={c.key}
              className="flex flex-wrap items-center gap-3 rounded-xl border border-border/70 bg-muted/30 p-3"
            >
              <History className="h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">
                  {c.label}{" "}
                  <Badge tone="neutral" className="ml-1 align-middle tabular">
                    {c.count}
                  </Badge>
                </p>
                <p className="text-xs text-muted-foreground">{hintFor(c)}</p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                {LOAD_SIZES.map((size) => (
                  <Button
                    key={size}
                    size="sm"
                    variant="outline"
                    className="gap-1 px-2.5"
                    disabled={loading !== null || !dialer}
                    onClick={() => load(c, size)}
                    title={`Load up to ${size} into the dialer as a strict list`}
                  >
                    {loading === `${c.key}:${size}` ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <PhoneCall className="h-3.5 w-3.5" />
                    )}
                    {size}
                  </Button>
                ))}
              </div>
            </li>
          ))}
      </ul>
      {note && <p className="mt-3 text-xs text-muted-foreground">{note}</p>}
    </SectionCard>
  );
}
