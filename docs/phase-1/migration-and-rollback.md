# Phase 1 — Migration & Rollback

All schema changes are **additive, idempotent PART sections** appended to `supabase/schema.sql`, applied to the live database at each checkpoint (via the Supabase MCP / SQL editor) **before** the code that needs them deploys. Run order = PART order. After any function recreate, run `notify pgrst, 'reload schema';` (PostgREST caches signatures — this has bitten this repo before).

## PART ledger

| PART | Contents | Backfill | Rollback |
|---|---|---|---|
| 22 | `call_attempts`, `call_legs`, `call_events` + append-only trigger + org-member read RLS | none | `drop table call_events, call_legs, call_attempts cascade;` (additive; no readers until B2 code) |
| 23 | `call_records` + `attempt_id`/`client_attempt_id`/`human_connected`/`talk_sec`; duplicate archive to `call_records_dupes`; partial unique indexes on client key / room / conversation | dedupe (losers archived, best row kept: non-null outcome, then earliest) | drop the 3 unique indexes; `insert into call_records select * from call_records_dupes on conflict do nothing;` keep archive ≥30 days |
| 24 | `leads` + `attempt_count`/`last_attempt_at`/`next_eligible_at`/`reserved_by`/`reserved_until`; counter backfill from call_records (idempotent `where attempt_count = 0`); dial-order index; RPCs `app_claim_dial_leads` / `app_release_dial_leads` / `app_renew_dial_reservations` / `app_mark_lead_attempted` | counters | drop RPCs + index; columns may stay (harmless) — clearing `reserved_*` alone restores legacy behavior; app-level kill switch `settings.dialing.reservations=false` |
| 25 | `app_leads_page` recreate: `avgScore` stat removed, `neverDialed` added | none | re-apply the previous function body from git history (commit noted at apply time) |
| 26 | `app_metrics_summary`, `app_metrics_hourly` | none | `drop function` |
| 27 | `import_jobs`; `leads` + `import_job_id`/`source_file`/`original_row`/`dialing_preference`/`archived_at`; `app_import_job_bump`; `app_phone_matches` + org+phone10 expression index; `import_mapping_templates` | none | drop functions/tables/index; lead columns may stay |
| 28 | `app_filter_leads`, `app_lead_counts` | none | `drop function` |
| 29 | `smart_lists` + per-org seed (solar-only rules gated to solar-template orgs) | seed | `drop table smart_lists;` (UI falls back to hardcoded lists until C3 completes; after C3, restore from backup) |
| 30 | `export_audit` | none | `drop table` |
| 31 | `lead_packs` assignment columns; `assignment_events`; `lead_events`; `app_allocate_assignment` + `app_preview_assignment` | none | drop new tables/functions; `lead_packs` columns defaulted — legacy behavior unaffected |
| 32 | `callbacks` v2 columns; `app_claim_callback` | none | drop function; columns stay |
| 33 | `campaigns` v2 columns; `leads_org_campaign_idx`; `app_campaign_funnel` | none | drop function/index; columns stay |
| 34 | `app_can_join_org_topic` + RLS policies on `realtime.messages` | none | `drop policy` both; clients degrade to polling automatically |
| 35 | `call_artifacts`, `call_transcript_segments`, `transcript_cursors`, `call_review_queue` | none | drop tables |
| 36 | `ops_metrics` | none | drop table (telemetry writer is fire-and-forget; absence is tolerated) |
| — | `supabase/cron.sql` — `app_fire_cron`/`app_set_cron_secret` (transcribed from the live DB 2026-08-28) + schedules. `reconcile-data` (every 15 min) is scheduled **only at the B4 checkpoint**, after its endpoint deploys | none | `select cron.unschedule('reconcile-data');` |

## Checkpoint procedure (every push)

1. `npm run lint && npm test && npm run build` — all green.
2. Apply the checkpoint's PARTs in order via Supabase MCP; `notify pgrst, 'reload schema';`.
3. Probe: `select` each new table; call each new RPC with harmless args.
4. Update `requirements-traceability.md` + `qa-evidence.md`.
5. Commit + push `claude/wizardly-cerf-m8c620`; watch the Vercel deploy succeed.
6. If the deploy fails: the schema is additive and backward-compatible by construction — the previous build keeps working; fix forward or revert the commit (schema stays).

## Standing rules

- Never delete or reinterpret customer data. Destructive-looking steps (call_records dedupe) archive first, in the same script.
- No stored enum key ever changes (`bills_fine`, `solarPayment`, …). New states live only in new tables.
- Risky behavior cutovers ship behind org settings (`dialing.reservations`) so rollback is a settings flip, not a deploy.
- `vercel.json` must never gain a cron entry (Hobby: the deploy fails). Schedules live in `supabase/cron.sql` only.
