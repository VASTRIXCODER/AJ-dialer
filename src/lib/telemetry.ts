import "server-only";

import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";

// ─────────────────────────────────────────────────────────────────────────────
// Service-level telemetry — event lag, reservation conflicts, webhook anomalies,
// import failures, metric drift. Writes are buffered and fire-and-forget: a
// telemetry failure must never slow or break a call path. Without a service
// role (demo / single process) counters degrade to structured console lines.
//
// Storage: the `ops_metrics` table (schema.sql PART 36) — service-role only.
// Reading is a SQL exercise for now (snippets in docs/phase-1/qa-evidence.md);
// no dashboard until the volume earns one.
//
// Serverless caveat (accepted): a frozen lambda can lose up to FLUSH_MS of
// buffered counters. Ops counters are trend data, not billing data.
// ─────────────────────────────────────────────────────────────────────────────

interface PendingMetric {
  at: string;
  org_id: string | null;
  metric: string;
  value: number;
  tags: Record<string, unknown> | null;
}

const FLUSH_MS = 1_000;
const FLUSH_AT = 20;

let queue: PendingMetric[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

async function flush(): Promise<void> {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (!queue.length) return;
  const batch = queue;
  queue = [];
  if (!isAdminConfigured()) {
    for (const m of batch) {
      console.log(`[telemetry] ${m.metric}=${m.value}`, m.tags ?? "");
    }
    return;
  }
  try {
    await createAdminClient().from("ops_metrics").insert(batch);
  } catch {
    /* dropped — telemetry never throws into a caller */
  }
}

function enqueue(m: PendingMetric): void {
  queue.push(m);
  if (queue.length >= FLUSH_AT) {
    void flush();
    return;
  }
  if (!timer) {
    timer = setTimeout(() => void flush(), FLUSH_MS);
    // Never keep a process alive just to ship counters.
    (timer as { unref?: () => void }).unref?.();
  }
}

/** Count an occurrence (default 1). Never throws, never blocks. */
export function count(
  metric: string,
  n = 1,
  tags?: { orgId?: string | null } & Record<string, unknown>,
): void {
  const { orgId, ...rest } = tags ?? {};
  enqueue({
    at: new Date().toISOString(),
    org_id: orgId ?? null,
    metric,
    value: n,
    tags: Object.keys(rest).length ? rest : null,
  });
}

/** Record a duration in milliseconds. Never throws, never blocks. */
export function timing(
  metric: string,
  ms: number,
  tags?: { orgId?: string | null } & Record<string, unknown>,
): void {
  if (!Number.isFinite(ms) || ms < 0) return;
  count(metric, Math.round(ms), tags);
}
