# Phase 1 — Performance Baseline & Targets

The spec (§19) asks for a measured baseline before final thresholds. This platform runs on Vercel Hobby (no APM, no load rig), so the honest measurement strategy is **production-sampled telemetry**: counters and timings accrue in `ops_metrics` (PART 22) from real traffic, and the SQL pack below reads them. Targets are stated as targets; evidence accrues continuously.

## Wired telemetry (as-built, grep-verified)

| Metric | Meaning |
|---|---|
| `realtime.publish_fail` | A broadcast POST failed/timed out (consumers fall back to polls) |
| `event.stale` / `event.cas_lost` / `event.apply_fail` / `event.leg_write_fail` | Canonical state-machine health: late/duplicate events refused, CAS races, ingest failures |
| `reservation.claim_fail` | Claim RPC errors (not empty results) |
| `answered.unverified_read` | Answer polls that ran read-only because room ownership couldn't be verified (start/end races) |
| `webhook.unsigned_accepted` | Unsigned webhook accepted via the emergency valve — should be **zero** in production |
| `reconcile.counter_repairs` / `reconcile.stuck_reconciled` / `reconcile.metric_drift` | The 15-min reconcile-data job's repair volume — sustained non-zero drift warrants investigation |
| `transcript.relay_segments` | Live transcript segments fanned out per relay poll |
| `floor.ai_reconcile` (count) / `floor.snapshot_ms` (timing) | Floor snapshot cost + how often the throttled provider reconcile actually runs |
| `import.job_created` / `import.probe_failed` / `import.rolled_back` | Import Studio operational volume |
| `leads.bulk_archive`, `smart_lists.*` | Bulk-action volumes |

## Targets (production-sampled evidence accrues in ops_metrics)

| Path | Target | Notes |
|---|---|---|
| Floor event lag (webhook → card update) | ≤ 2s p95 via broadcast; ≤ 35s worst-case poll fallback | payload `at` vs client receive; sampled |
| Answer detection (pickup → rep UI "live") | ≤ 1.5s p95 via `call.answered` broadcast; ≤ 5s poll fallback | was a fixed 1.5s poll for everyone |
| Claim-next (`app_claim_dial_leads`) | ≤ 400ms p95 | single-row CAS on an indexed order |
| Live transcript segment latency | ≤ 4s p95 | poll-bound (~3s relay cadence) — provider has no push; cannot beat the poll and the UI says so |
| Reports first render @ ~50k call rows | ≤ 2.5s | SQL aggregates replaced the 50k-row JS pass for the shared metrics |
| Import throughput | ≥ 4,000 rows/chunk sustained | one indexed phone probe per chunk replaced the O(book×chunks) scan |

## Reading the numbers — `scripts/perf-report.sql`

Run the snippet pack in the Supabase SQL editor (see the file). Percentiles for timings:

```sql
select metric,
       percentile_cont(0.5)  within group (order by value) as p50,
       percentile_cont(0.95) within group (order by value) as p95,
       count(*) as n
from public.ops_metrics
where at > now() - interval '7 days'
  and metric in ('floor.snapshot_ms')
group by metric;
```

Counter daily trend:

```sql
select date_trunc('day', at) as day, metric, sum(value)
from public.ops_metrics
where at > now() - interval '14 days'
group by 1, 2 order by 1 desc, 3 desc;
```

## What is deliberately NOT built

- No synthetic load rig (Hobby has no environment for one); no external APM. `ops_metrics` + these queries are the observability story until volume earns more.
- A 30-day retention sweep for `ops_metrics` can be added to the reconcile-data cron when volume warrants; rows are trend data and disposable.
