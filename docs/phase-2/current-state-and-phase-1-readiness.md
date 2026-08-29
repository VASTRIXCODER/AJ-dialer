# Phase 2 — Current State & Phase 1 Readiness (P2.0 baseline)

The readiness audit required by `docs/phase_two.md` §2/§24 (P2.0). Companion docs:
`opportunity-domain-and-state-machines.md` (the P2.1 design authority — nothing below
contradicts it), `docs/phase-1/requirements-traceability.md` (honest Phase 1 status),
`docs/phase-1/architecture-and-data-contracts.md` (the contracts Phase 2 extends).

Terminology: Brock/King are ROLES (tenant org / manager-owner operators), never literals.
No tenant-specific labels are hardcoded anywhere (CLAUDE.md; `docs/phase_two.md` §3).

## 1. What Phase 1 actually delivered

The trusted operational foundation Phase 2 assumes, per the traceability matrix:

- **Canonical call domain** — immutable idempotent `call_events`, per-lead `call_attempts`
  (+ `call_legs`), 14×14-tested state machine, transport outcome ≠ disposition
  (`src/lib/db/records.ts`, `docs/phase-1/call-state-machine.md`).
- **One eligibility/reservation engine** for manual/AI/parallel — `app_claim_dial_leads`
  + TS twin in lockstep (`src/lib/dialer/eligibility.ts`); DNC beats everything;
  callback bypasses cooldown only. FOR UPDATE SKIP LOCKED claims, TTL 180s.
- **Lead 360 everywhere** (drawer + `/leads/[id]`, 9 surfaces), Import Studio with
  dedupe/rollback/headerless fix, typed FilterSpec driving leads/smart lists/
  assignments/exports/drill-downs, export v2 with audit + injection safety.
- **Assignments** (packs→assignments + Assignment Center + My Assignments),
  **campaigns** with event-derived funnels, **live floor** on an authenticated
  per-org broadcast channel, **callback claims** with escalation.
- **Call intelligence** — 7 structured artifact kinds with confidence + transcript-turn
  evidence, supersede chains (AI never supersedes human), review queue, searchable
  call archive (`src/lib/db/call-archive.ts`).
- **One metrics layer** — `src/lib/metrics/definitions.ts` + `app_metrics_summary`/
  `app_metrics_hourly` consumed by dashboard/reports/leaderboard; drift repaired by
  reconcile-data; DST/parity fixture-tested.
- **Hardening** — tenant-isolation tests, webhook verification that fails closed,
  PII-safe logs, `ops_metrics` telemetry, WCAG-conscious UI. Suite ≥200 tests.

**Honest Partial/Deferred/Blocked carried into Phase 2** (traceability matrix):

| Item | Status | Phase 2 impact |
|---|---|---|
| Manual-call transcription | **Blocked** — no STT provider | P2.3 extraction is AI-channel-only until wired |
| XLSX import | Deferred (no vetted lib) | P2.2 intake inherits CSV/TSV only |
| Background export worker | Deferred (Hobby: no workers) | large reactivation exports stay synchronous+capped |
| Appointment conflict detection | Deferred | P2.5 must build it, not assume it |
| Dashboard live invalidation | Partial (refresh-on-nav, Data-as-of stamp) | acceptable for Command Center v0 |
| Distributed rate limiter | Deferred (per-instance only) | orchestration caps must be DB-enforced, not limiter-enforced |
| Leaderboard `appointmentKept` | excluded — no kept/show signal | P2.5 show tracking finally supplies it |
| call_records → call_attempts reader cutover | **Not done** — dual-write, records authoritative | cutover criterion: zero parity drift 14 consecutive days |

## 2. Live production baseline (as of 2026-08-29)

Prod = branch `claude/wizardly-cerf-m8c620` on Vercel, fronted by Cloudflare.
Supabase is the live DB; PARTs 22–36 all applied.

- **11 organizations** (tenants), **~37.8k leads**, **~33.4k call_records**.
- **162 call_attempts** since dual-write began — the events-first pipeline is young;
  `call_records` remains the reporting authority (see cutover criterion above).
- **151 appointments**, **218 callbacks** — small enough that P2.5 backfill is trivial,
  large enough that reschedule lineage must not double-count.
- **Crons run in Supabase pg_cron, never `vercel.json`** (a per-minute vercel cron
  FAILS Hobby deploys — it silently froze prod for 13 days once): `auto-dial` and
  `reconcile-ai` every minute, `reconcile-data` every 15 min, hitting
  `src/app/api/cron/{auto-dial,reconcile-ai,reconcile-data}/route.ts` with `CRON_SECRET`.
  The P2.1 `/api/cron/orchestrate` tick rides the same mechanism.
- Data-quality note: ~37.8k leads vs ~33.4k call_records with 151 appointments booked
  is the funnel Phase 2 exists to fix — most volume never becomes owned, protected work.

## 3. Write-path ownership Phase 2 MUST preserve

The full table is in `docs/phase-1/architecture-and-data-contracts.md`. Non-negotiables
for every Phase 2 writer (orchestration engine included):

- `call_events` append-only; `call_attempts.state/transport_outcome` written only by
  `applyCallEvent()` — webhooks stay authoritative for raw comms outcomes (§2 of the
  prompt). Orchestration reacts to outcomes; it never writes them.
- `leads.status` written only by `routeDisposition` + guarded `updateLead`. The
  opportunity sync (`design authority §6`) is one-way FROM disposition routing —
  Phase 2 never adds a second writer to lead status.
- Reservations via claim/release/renew RPCs only; counters repaired by reconcile,
  never trusted blindly. New Phase 2 counters (opportunities) follow the same rule.
- `call_artifacts`: AI never supersedes `source='human'`. Extends to every Phase 2
  AI proposal — proposals are rows, humans decide (prompt §20 authority boundaries).
- Broadcasts only via `publishOrgEvent()`; all writes service-role AFTER app-code
  auth (`getViewer`/`getScope`, `src/lib/db/scope.ts`); reads via RLS.
- New Phase 2 state gets the same discipline: append-only `opportunity_events`
  before derived state, dedupe-keyed `work_items`, UNIQUE `idempotency_key` on
  `playbook_executions` (design authority §2, §5).

## 4. Known limitations that constrain Phase 2

1. **No SMS/messaging provider wired.** Twilio Messaging exists at the account level
   but no send path, webhook, STOP handling, or templates are in the repo. Every
   SMS-dependent requirement (§10 confirmations, §11 recovery messages, §19 channel
   layer) is **Blocked on provider wiring** — call + in-app channels only until then.
2. **No STT for manual calls.** Structured extraction (§8 post-call) runs only where
   transcripts exist: ElevenLabs AI calls. Manual-call extraction stays honest-blocked.
3. **Vercel Hobby.** No per-minute `vercel.json` crons (deploy-failing), no background
   workers, per-instance rate limiting. All timers/sweeps ride pg_cron → HTTP routes;
   orchestration throughput is bounded by tick frequency + route timeout budget.
4. **Single-tenant ElevenLabs credentials** (env-level agent + keys). AI outbound works
   for the configured tenant; per-org AI agents and AI inbound reception need per-org
   credential storage first. ElevenLabs messaging webhook still 404s (2026-08-12).
5. **No calendar/CRM/contracting/fulfillment integration exists.** There is no trusted
   external Sold/Install source connected — §14's mirror has nothing to mirror yet.
6. **Twilio creds are Vercel-sensitive** (unpullable): inbound-number webhook changes
   require the Twilio Console or user-pasted creds — a manual step for P2.4.
7. Everything must keep degrading to demo mode when creds are absent (CLAUDE.md).

## 5. Readiness verdict by workstream

Statuses: **Ready** (can start now, no external dependency) · **Ready-partial**
(startable with a scoped subset; remainder blocked) · **Blocked** (needs provider,
credential, or a King/tenant decision first).

| WS | Scope | Verdict | Basis |
|---|---|---|---|
| P2.1 | Opportunity/touch/work-item/signal/playbook contracts, state machines, backfill, engine v0 | **Ready — first build item** | Design authority complete. Pure DB + TS + pg_cron tick; zero provider needs. NOT YET BUILT: as of this baseline no PART 37 DDL, no `src/lib/opportunities/` or `src/lib/orchestration/` in the tree. |
| P2.2 | Intake, dedupe, routing, speed-to-lead SLA | **Ready** (after P2.1) | Import Studio + `app_phone_matches` dedupe + assignment engine exist; SLA timers ride pg_cron; notifications in-app (SMS notify blocked, limitation 1). |
| P2.3 | Pre-call context, post-call extraction, next actions, no-answer sequences, callback protection | **Ready-partial** | Call-channel automation + AI-call extraction ready (F1 artifacts). Manual-call extraction blocked (limitation 2); SMS steps blocked (limitation 1) — the definition validator must keep rejecting them (design authority §5). |
| P2.4 | AI inbound reception, recognition, routing, transfer | **Blocked** (build-behind-flag possible) | Needs per-org ElevenLabs creds + Twilio inbound number webhooks (limitations 4, 6). Data model, caller matching, and routing logic can be built and demo-tested now; live answer cannot. |
| P2.5 | Appointment protection + no-show recovery | **Ready-partial** | State model, risk reasons, briefs, no-show detection, call-channel recovery: ready on existing `appointments` (151 rows to backfill). SMS confirm/remind/reply-parse blocked (limitation 1). |
| P2.6 | My Day, "who's next", hot signals | **Ready** (after P2.1) | Deterministic queries over P2.1 tables + existing eligibility engine; Claude configured (`src/lib/ai/claude.ts`, verified via `npm run verify:ai`). |
| P2.7 | Sold/install mirror, Install Watch | **Blocked on source decision** | No trusted external source exists (limitation 5). The authorized-manual-update adapter + mirror tables can start; anything else needs King to name the source of truth. |
| P2.8 | Post-install lifecycle | **Blocked** (chain) | Triggers only from a trusted Installed milestone (P2.7); review/referral sends also need limitation 1 resolved. |
| P2.9 | Reactivation Studio | **Ready-partial** (after P2.1) | Eligibility/exclusion engine + cohort snapshots + call-channel sequences: ready (FilterSpec + eligibility twin reuse). SMS mix + lift holdouts on tiny cohorts: later. |
| P2.10 | Command Center + Playbook Studio | **Ready** (after P2.1; sequence late per §24) | Extends `src/lib/metrics/service.ts` + existing report center; Studio publishes to the P2.1 `playbooks` contract. No provider needs. |
| P2.11 | Hardening & release readiness | Sequenced last | Inherits Phase 1's test/QA scaffolding (`docs/phase-1/qa-evidence.md`). |

**Net:** P2.1 → P2.2 → P2.3/P2.5 (call + in-app subsets) → P2.6 → P2.9/P2.10 are
executable today with no new credentials. P2.4 needs ElevenLabs/Twilio inbound setup,
P2.7/P2.8 need a named trusted fulfillment source, and every SMS touchpoint across
P2.3/P2.5/P2.8/P2.9 waits on a messaging provider — capability-gated and labeled
honestly in the UI until then, never simulated (prompt §2).
