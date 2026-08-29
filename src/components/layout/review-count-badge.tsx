"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";

// ─────────────────────────────────────────────────────────────────────────────
// The sidebar's open-review count (F1). Deliberately simple: a 60s poll of the
// cheap count endpoint, refreshed opportunistically when the tab regains focus.
// The review.created broadcast reaches surfaces that already hold the org
// channel open (the floor); a nav chip on every page doesn't justify its own
// realtime subscription — a minute of staleness on a badge is fine, a socket
// per sidebar is not.
// ─────────────────────────────────────────────────────────────────────────────

const POLL_MS = 60_000;

export function ReviewCountBadge() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch("/api/review-queue?count=1", { cache: "no-store" });
        if (!res.ok) return; // demo / signed-out / rate-limited → keep quiet
        const j = (await res.json()) as { count?: number };
        if (alive) setCount(Math.max(0, Number(j.count) || 0));
      } catch {
        /* transient — keep the last value */
      }
    };
    load();
    const timer = setInterval(load, POLL_MS);
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => {
      alive = false;
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  if (count <= 0) return null;
  return (
    <Badge
      tone="warning"
      className="relative z-10 px-1.5 py-0 tabular"
      title={`${count} call${count === 1 ? "" : "s"} waiting for review`}
    >
      {count > 99 ? "99+" : count}
    </Badge>
  );
}
