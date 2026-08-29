-- Phase 1 observability snippet pack — run in the Supabase SQL editor.
-- ops_metrics is trend data written by src/lib/telemetry.ts (fire-and-forget).
-- Companion doc: docs/phase-1/performance-baseline.md

-- 1. Timing percentiles (last 7 days)
select metric,
       percentile_cont(0.5)  within group (order by value) as p50,
       percentile_cont(0.95) within group (order by value) as p95,
       max(value) as max, count(*) as n
from public.ops_metrics
where at > now() - interval '7 days'
  and metric like '%_ms'
group by metric order by metric;

-- 2. Counter daily trend (last 14 days)
select date_trunc('day', at) as day, metric, sum(value) as total
from public.ops_metrics
where at > now() - interval '14 days'
group by 1, 2 order by 1 desc, 3 desc;

-- 3. Health red flags — all of these should be zero or near-zero
select metric, sum(value) as total_7d
from public.ops_metrics
where at > now() - interval '7 days'
  and metric in ('webhook.unsigned_accepted', 'event.apply_fail',
                 'realtime.publish_fail', 'reservation.claim_fail',
                 'reconcile.metric_drift', 'import.probe_failed')
group by metric order by 2 desc;

-- 4. Canonical machine health: refused (late/dup) events are NORMAL in small
--    numbers; a spike means a webhook path regressed.
select date_trunc('hour', at) as hour,
       sum(value) filter (where metric = 'event.stale')    as stale,
       sum(value) filter (where metric = 'event.cas_lost') as cas_lost
from public.ops_metrics
where at > now() - interval '48 hours'
group by 1 order by 1 desc limit 48;

-- 5. Attempt lifecycle distribution (should be overwhelmingly dispositioned/terminal)
select state, channel, count(*)
from public.call_attempts
where created_at > now() - interval '7 days'
group by 1, 2 order by 3 desc;

-- 6. Reconciler repair volume — sustained non-zero counter repairs = drift source
select date_trunc('day', at) as day,
       sum(value) filter (where metric = 'reconcile.counter_repairs')   as counter_repairs,
       sum(value) filter (where metric = 'reconcile.stuck_reconciled')  as stuck_reconciled,
       sum(value) filter (where metric = 'reconcile.metric_drift')      as metric_drift
from public.ops_metrics
where at > now() - interval '14 days'
group by 1 order by 1 desc;
