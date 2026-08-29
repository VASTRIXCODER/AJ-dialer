# Phase 1 — Migration & Rollback

All schema changes are **additive, idempotent PART sections** appended to `supabase/schema.sql`, applied to the live database at each checkpoint (via the Supabase MCP / SQL editor) **before** the code that needs them deploys. Run order = PART order. After any function recreate, run `notify pgrst, 'reload schema';` (PostgREST caches signatures — this has bitten this repo before).

## PART ledger (numbers follow file/apply order; ALL PARTs below are APPLIED to the live DB as of 2026-08-28)

| PART | Contents | Backfill | Rollback |
|---|---|---|---|
| 22 | `ops_metrics` telemetry | none | drop table (the writer is fire-and-forget; absence is tolerated) |
| 23 | `call_attempts`, `call_legs`, `call_events` + append-only trigger + org-member read RLS. Attempts are per-LEAD — a 3X round shares one room across attempts, unique on `(room, lead_id)` | none | `drop table call_events, call_legs, call_attempts cascade;` |
| 24 | `call_records` + `attempt_id`/`client_attempt_id`/`human_connected`/`talk_sec`; duplicate archive to `call_records_dupes` (**233 rows archived in production**: 210 by conversation, 23 by room); partial unique indexes on client key / room / conversation | dedupe | drop the 3 unique indexes; `insert into call_records select * from call_records_dupes on conflict do nothing;` keep archive ≥30 days |
| 25 | `leads` + `attempt_count`/`last_attempt_at`/`next_eligible_at`/`reserved_by`/`reserved_until`; counter backfill from call_records; dial-order index; RPCs `app_claim_dial_leads` / `app_release_dial_leads` / `app_renew_dial_reservations` / `app_mark_lead_attempted` | counters (backfilled) | drop RPCs + index; clearing `reserved_*` restores legacy behavior; kill switch `settings.dialing.reservations=false` |
| 26 | `app_leads_page` recreate: `avgScore` stat removed, `neverDialed` added | none | re-apply the previous function body from git history |
| 27 | `app_metrics_summary`, `app_metrics_hourly` | none | `drop function` |
| 28 | `import_jobs`; `leads` + `import_job_id`/`source_file`/`original_row`/`dialing_preference`/`archived_at`; `app_import_job_bump`; `app_phone_matches` + org+phone10 expression index; `import_mapping_templates`; `lead_events` | none | drop functions/tables/index; lead columns may stay |
| 29 | `app_flt_frag` + `app_filter_leads` (whitelisted FilterSpec compiler) + `app_lead_counts` | none | `drop function` all three |
| 30 | `smart_lists` + per-org seed (4 neutral lists everywhere; high_bill/big_load only for solar-template orgs) | seed | `drop table smart_lists;` |
| 31 | `export_audit` | none | `drop table` |
| 32 | `lead_packs` assignment columns; `assignment_events`; `app_allocate_assignment` + `app_preview_assignment` | none | drop RPCs + assignment_events; `lead_packs` columns defaulted — legacy behavior unaffected |
| 33 | `callbacks` v2 columns; `app_claim_callback` (15-min stale takeover) | none | drop function; columns stay |
| 34 | `campaigns` v2 columns; `leads_org_campaign_idx`; `app_campaign_funnel` | none | drop function/index; columns stay |
| 35 | `app_can_join_org_topic` + RLS policies on `realtime.messages` (broadcast/presence receive; presence-only insert) | none | `drop policy` both; clients degrade to polling automatically |
| 36 | `call_artifacts`, `call_transcript_segments`, `transcript_cursors`, `call_review_queue` | none | drop the four tables |
| — | `supabase/cron.sql`: `app_fire_cron`, `app_set_cron_secret` (transcribed verbatim from the live DB), schedules. Live jobs: auto-dial (1 min), reconcile-ai (1 min), **reconcile-data (15 min — scheduled 2026-08-28)** | none | `select cron.unschedule('reconcile-data');` |

## Checkpoint procedure (every push)

1. `npm test && npx tsc --noEmit && npm run build` — all green. (`npm run lint` is not usable in this repo — next lint was never configured.)
2. Apply the checkpoint's PARTs in order via Supabase MCP; `notify pgrst, 'reload schema';`.
3. Probe: `select` each new table; call each new RPC with harmless args.
4. Update `requirements-traceability.md` + `qa-evidence.md`.
5. Commit + push `claude/wizardly-cerf-m8c620` (auto-deploys); watch the Vercel deploy for success.
6. If the deploy fails: the schema is additive and backward-compatible by construction — the previous build keeps working; fix forward or revert the commit (schema stays).

## Standing rules

- Never delete or reinterpret customer data. Destructive-looking steps (call_records dedupe) archive first, in the same script.
- No stored enum key ever changes (`bills_fine`, `solarPayment`, …). New states live only in new tables.
- Risky behavior cutovers ship behind org settings (`dialing.reservations`) so rollback is a settings flip, not a deploy.
- `vercel.json` must never gain a cron entry (Hobby: the deploy fails). Schedules live in `supabase/cron.sql` only.
