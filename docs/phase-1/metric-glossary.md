# Phase 1 — Metric Glossary

The single source of definitions. Code twin: `src/lib/metrics/definitions.ts` (every entry below is rendered as the metric's tooltip).

> **This line used to say** that any surface showing a number defined here computes it through `src/lib/metrics/service.ts`. That was never true. `service.ts` had **zero importers** for its whole life, and so did the `app_metrics_hourly` RPC behind it — every shipped number comes from `src/lib/db/metrics.ts` (`getReportingData`) instead. The two implementations were never reconciled, so the sentence promised an agreement nobody had checked. `service.ts` is deleted rather than adopted: adopting it would have meant verifying its SQL against `getReportingData` first, and a third implementation written to unify the other two is the outcome to avoid.
>
> What IS enforced, and by what: the predicates in `definitions.ts` are the one definition of "connected" and "cancelled" (`tests/metric-registry.test.ts` proves the SQL filter and the JS predicate agree over every combination, and `/api/cron/reconcile-data` re-checks them nightly against real rows). Every tile carries a window and a scope, and `tests/zero-rule.test.ts` fails any tile that can render a number it could not compute.

Conventions: all "today"/"this week" windows use the **organization's timezone** (`orgTimezone(org)`, fallback `America/Chicago`) and the org's configured week start (`settings.reporting.weekStart`, default Monday). Date ranges are half-open `[from, to)`.

| Metric | Definition | Denominator | Excludes |
|---|---|---|---|
| **Calls today** | Count of outbound call attempts accepted for dialing during the org's current local day. | — | Test records; pre-provider suppressions (DNC/invalid blocked before dial); canceled reservations that never became an attempt. |
| **Human connects** | Attempts that reached a verified `human_connected` state (`coalesce(call_records.human_connected, outcome ∈ CONNECTED_OUTCOMES)` during the legacy transition). | — | Voicemail (always separate), busy, declined, no-answer, failures. |
| **Connect rate** | Human connects ÷ eligible completed attempts. | Completed outbound attempts in the period, excluding system failures (`failure_kind` set with no outcome) and pre-dial suppressions. | Same everywhere — dashboard, reports, leaderboard, monitor use this one definition. |
| **Appointments set** | Distinct non-cancelled `appointments` rows **created** in the period. Edits/reschedules of an existing appointment never increment it. | — | Cancelled rows; edits. |
| **Avg talk time** | Total human-connected talk seconds ÷ human-connected calls. Uses `talk_sec` (connected→ended) when present; falls back to `duration_sec` for legacy rows. | Human-connected calls only. | Ringing, queue time, voicemail time, wrap-up. |
| **Performance this week** | Daily attempt/connect/appointment series for the org-tz calendar week starting on the configured week start. The exact date range is displayed. | — | — |
| **Outcome mix** | Counts per canonical terminal outcome; mutually exclusive; reconciles to attempts-with-outcome for the same filters. Rows without an outcome are shown as their own bucket, never silently dropped. | — | — |
| **Hourly productivity** | Attempts / human connects / appointments / talk time grouped by **local call-start hour**. DST-safe by construction: buckets are local-hour labels; a 23/25-hour day has fewer/more populated buckets, never double-counts. | — | — |
| **Campaign pipeline** | Mutually exclusive **current-state** buckets per lead (eligible / assigned / attempted / connected / callback / appointment / converted / DNC / exhausted). A lead appears in exactly one bucket; event totals are shown separately from unique-lead counts. Every segment drills to its records. | — | — |

## Lead counts (leads page tiles — each drillable)

Counts are **unique lead rows** (not unique phone numbers), scoped supervisor=org / rep=own+assigned:

- **All active** — not archived, status ≠ `dnc`.
- **Filtered** — the current filter's result total.
- **Dial-eligible** — passes the eligibility predicate right now (status dialable, valid phone, not DNC, not reserved, cooldown/max-attempts clear).
- **Assigned / Unassigned** — has / lacks `assigned_rep_id`.
- **Never dialed** — `attempt_count = 0` and `last_contacted_at is null`, dialable status.
- **Previously attempted** — `attempt_count > 0` or `last_contacted_at` set.
- **DNC / suppressed** — status `dnc` OR number present in `dnc_numbers`.
- **Archived / invalid** — `archived_at` set OR no dialable phone.

## Leaderboard

Points are configurable per org (`settings.leaderboard.points`); every entry shows its breakdown (component × count × points). Periods are **calendar-true** day/week/month in org tz (the pre-Phase-1 "This week/month" labels on rolling 7/30-day windows were wrong and are gone). Ties break deterministically: points → connects → talk time → earliest achieved → user id. Points derive from stored rows, not events — duplicated provider events cannot double-score.

## Deprecations

- **Average AI Score — removed (Phase 1, 2026-08).** The aggregate is gone from the leads KPI row, `app_leads_page` stats, the admin console tile, and the AI copilot context. Per-lead `ai_score` is retained for opt-in dial ordering (`SessionOrder "ai_score"`), per-lead display, and the per-lead export column. Never aggregate it again.
