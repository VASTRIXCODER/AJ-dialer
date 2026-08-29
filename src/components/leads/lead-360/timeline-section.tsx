"use client";

import {
  ArrowRightLeft,
  CalendarCheck,
  Clock,
  Loader2,
  Pencil,
  Phone,
  PhoneOff,
  StickyNote,
  Upload,
  UserPlus,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Timeline, type TimelineDisplayItem } from "@/components/ui/timeline";
import type { TimelineItem, TimelineKind } from "@/lib/db/lead-timeline";

const PAGE = 50;

const KIND_ICON: Record<TimelineKind, LucideIcon> = {
  attempt: Phone,
  status: ArrowRightLeft,
  note: StickyNote,
  callback: Clock,
  appointment: CalendarCheck,
  assignment: UserPlus,
  dnc: PhoneOff,
  field_change: Pencil,
  import: Upload,
};

const KIND_TONE: Record<TimelineKind, TimelineDisplayItem["tone"]> = {
  attempt: "primary",
  status: "accent",
  note: "neutral",
  callback: "warning",
  appointment: "success",
  assignment: "accent",
  dnc: "danger",
  field_change: "neutral",
  import: "neutral",
};

function toDisplay(item: TimelineItem): TimelineDisplayItem {
  return {
    id: item.id,
    at: item.at,
    icon: KIND_ICON[item.kind],
    tone: KIND_TONE[item.kind],
    title: item.title,
    detail: [item.detail, item.actor ? `by ${item.actor}` : null]
      .filter(Boolean)
      .join(" · ") || undefined,
  };
}

/**
 * The merged activity feed + "Load older" paging via the API's `before`
 * cursor. The first page arrives as a prop (server-fetched on the full page,
 * drawer-fetched alongside the panel); older pages append client-side.
 */
export function TimelineSection({
  leadId,
  initial,
}: {
  leadId: string;
  initial: TimelineItem[];
}) {
  const [items, setItems] = useState<TimelineItem[]>(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  // A short first page means there IS nothing older.
  const [exhausted, setExhausted] = useState(initial.length < PAGE);

  // A refetched first page (drawer poll) replaces the head; older pages the
  // user already expanded are re-fetched on demand, not preserved — simplest
  // model that can't duplicate.
  useEffect(() => {
    setItems(initial);
    setExhausted(initial.length < PAGE);
  }, [initial]);

  async function loadOlder() {
    const oldest = items[items.length - 1];
    if (!oldest || loading) return;
    setLoading(true);
    setError(false);
    try {
      const res = await fetch(
        `/api/leads/${encodeURIComponent(leadId)}/panel?before=${encodeURIComponent(oldest.at)}`,
        { cache: "no-store" },
      );
      if (!res.ok) throw new Error("failed");
      const json = (await res.json()) as { timeline?: TimelineItem[] };
      const older = json.timeline ?? [];
      setItems((prev) => {
        const seen = new Set(prev.map((i) => i.id));
        return [...prev, ...older.filter((i) => !seen.has(i.id))];
      });
      if (older.length < PAGE) setExhausted(true);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }

  if (!items.length) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No activity yet — the first call will start this record's history.
      </p>
    );
  }

  return (
    <div>
      <Timeline items={items.map(toDisplay)} />
      <div className="mt-4 flex flex-col items-center gap-2">
        {error && (
          <p className="text-xs font-medium text-danger">
            Couldn't load older activity — try again.
          </p>
        )}
        {!exhausted && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => void loadOlder()}
            disabled={loading}
            className="gap-1.5"
          >
            {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Load older
          </Button>
        )}
      </div>
    </div>
  );
}
