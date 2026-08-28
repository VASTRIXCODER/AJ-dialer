# Phase 1 — QA Evidence

Running log of verification evidence per slice. Baseline first; every checkpoint appends.

## Baseline (2026-08-28, before any Phase-1 code)

- `npm test`: **21 files / 246 tests, all passing** (Vitest 2.1.9, node env, pure modules only).
- Coverage of spec-critical behaviors at baseline: idempotent provider events — none; tenant isolation — none; reservation — n/a (didn't exist); metric definitions — none; DST — none. (See current-state-audit.md findings.)
- Live cron state (production Supabase `aiatwork-dialer`): jobs `auto-dial` + `reconcile-ai`, both `* * * * *`, active. `app_fire_cron`/`app_set_cron_secret` transcribed verbatim into `supabase/cron.sql`.
- Known-broken at baseline (fixed during Phase 1, each with a test): duplicate-disposition replay (F2), headerless import row loss (F8), unauthenticated `/api/twilio/answered` (S1), unauthenticated AI routes (S2), report-export formula injection (S5), dead record toggle / dispositions editor / leads-table Call button (R2).

## Slice log

### A1 + A2 — 2026-08-28 (Checkpoint 1)

- Tests added: `csv-injection` (8), `answered-auth` (7), `hold-scope` (6), `ai-routes-auth` (10); `permissions` updated for the rep monitor default change.
- Suite: **25 files / 277 tests** green. Build: pass.
- SQL applied to live DB: PART 22 `ops_metrics` (via migration `phase1_part22_ops_metrics`).
- Security fixes verified by test: `/api/twilio/answered` now session + room-ownership gated (releases NEVER happen unverified); `/api/twilio/hold` org-scoped (404 unknown / 403 foreign); AI routes 401 anonymous + 429 over 30/min; report export runs through the shared formula-injection encoder; half-configured Twilio (SID without auth token) now FAILS CLOSED on webhooks; `TWILIO_SKIP_SIGNATURE` requires an explicit ACK in production.
- Product changes: reps no longer hold `monitor.view`/`monitor.listen` by default (re-grant per member via overrides); hold music is now our own synthesized loop (`public/hold-music.wav`, `scripts/make-hold-music.mjs`) instead of demo.twilio.com; every `window.confirm` replaced with the accessible ConfirmDialog; app-wide Toast provider added.
- Notes: `npm run lint` is not usable in this repo (next lint has never been configured — it prompts interactively). The gate is `npm test` + `npm run build`. PART numbering follows file/apply order: ops_metrics took 22; later PARTs renumber from the plan accordingly.

<!-- Appended per slice:
### <slice id> — <date>
- Tests added: <files, counts>
- Suite: <N files / M tests> green
- Build: pass
- SQL applied: PART <n> (probe results)
- Manual checks: <surface: states verified>
- Notes / limitations:
-->
