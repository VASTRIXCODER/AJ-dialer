# Phase 2 — Migration & rollback

## PART 37 — opportunity & orchestration foundation (P2.1)

**Status: ✅ APPLIED to the live database 2026-08-29** (user-authorized, via
MCP migration `part37_opportunity_orchestration_foundation`). Verified after
apply: 37,645 opportunities = 37,645 eligible (non-archived, org-attached)
leads, all `backfilled=true`; 37,433 open / 212 closed; stage mix new 33,795 ·
attempting 2,167 · assigned 1,320 · dnc_suppressed 112 · lost 100 · contacted
69 · nurture 58 · appointment_booked 20 · interested 4;
`app_settings.orchestration_paused = false`.

One apply-time fix fed back into the repo: `leads.assigned_rep_id` is TEXT
(uuid-valued) while `opportunities.owner_id` is uuid — the backfill's
coalesce now pattern-guards the cast (schema.sql PART 37 matches what ran).

### To re-apply / apply elsewhere (idempotent — safe to re-run)

Run the **PART 37 block** — the tail of `supabase/schema.sql`, from the banner
line `-- PART 37 — OPPORTUNITY & ORCHESTRATION FOUNDATION` to the end of the
file. (The whole `schema.sql` also applies clean, per house rule.)

What it does, in order:
1. Creates `opportunities`, `opportunity_events` (+ append-only trigger),
   `work_items`, `signals`, `playbooks`, `playbook_instances`,
   `playbook_executions` — all RLS org-member read, service-role write.
2. Creates the `touches_v` view (security_invoker) and the
   `app_pipeline_leaks` / `app_claim_work_items` functions.
3. Adds `app_settings.orchestration_paused` (global kill switch, default off).
4. **Backfills one opportunity per non-archived lead** (~37.8k rows at design
   time), `backfilled = true`, stage per the documented mapping. Idempotent via
   a NOT-EXISTS guard (any opportunity for the lead, open or closed — the
   partial unique index alone would not protect closed rows on a re-run).

### On environments WITHOUT PART 37 (fresh/dev DBs)

Everything degrades by design: `syncOpportunityAfterCall` and the engine
catch-and-count, `/api/cron/orchestrate` no-ops, no Phase 1 surface reads the
new tables. The app runs identically to pre-P2.1.

### Rollback

```sql
drop function if exists public.app_claim_work_items(uuid, uuid, int, int, text[], text);
drop function if exists public.app_pipeline_leaks(uuid);
drop view if exists public.touches_v;
drop table if exists public.playbook_executions;
drop table if exists public.playbook_instances;
drop table if exists public.playbooks;
drop table if exists public.signals;
drop table if exists public.work_items;
drop table if exists public.opportunity_events;
drop table if exists public.opportunities;
alter table public.app_settings drop column if exists orchestration_paused;
```
Backfill-only rollback (keep the schema):
`delete from public.opportunities where backfilled;` (events cascade).

## Cron

`/api/cron/orchestrate` ships with this phase but is **deliberately not
scheduled** — a commented `cron.schedule('orchestrate', …)` block sits in
`supabase/cron.sql`. Schedule it only when an org is ready to flip
`settings.orchestration.enabled` on; until then every tick is a no-op.

## Feature flags / kill switches (P2.1 layer)

| Level | Switch | Default |
|---|---|---|
| Global | `app_settings.orchestration_paused` | off (not paused) |
| Org | `settings.orchestration.enabled` | **OFF** — no org orchestrates by surprise |
| Playbook | `playbooks.status = 'paused'` | n/a |
| Opportunity | stop rules (dnc/closed always enforced) | n/a |

## Also changed on the live DB this session (already applied)

- VICC (`orgs.slug = 'donny'`): `features.aiDialer → true`,
  `dialing.defaultMode → "manual"` (idempotent jsonb merge UPDATE).

## Dual-write / cutover discipline

`leads.status` remains the reporting authority. The opportunity sync is
one-way and forward-only; cutover of any reader to `opportunities` follows the
Phase 1 rule: zero parity drift between the two for 14 consecutive days,
verified by the reconcile pass (parity check itself is P2.2 work — see
requirements-traceability.md).
