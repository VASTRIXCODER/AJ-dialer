# Phase 1 — Current-State Audit

Audited 2026-08-28 against `docs/phase_one.md`. Three parallel deep audits (data layer, dialer/realtime/telephony, product surfaces) verified against the code. Findings are cited as `file:line` at audit time; lines drift as Phase 1 lands — the findings register IDs (F1…) are stable.

## Stack (verified)

| Concern | What actually exists |
|---|---|
| Frontend | Next.js 15.1 App Router, React 19, TypeScript strict, Tailwind v4 (tokens in `src/app/globals.css`) |
| Backend | Next.js route handlers on Vercel **Hobby** (no per-minute crons in `vercel.json` — they fail the deploy; see `docs/CRON.md`) |
| Database | Supabase Postgres 17; one hand-maintained idempotent `supabase/schema.sql` (25 tables, PART 1–21 append-only sections); **no migration tool** |
| AuthN/Z | Supabase Auth; `getViewer()` (`src/lib/org/membership.ts`) + `getScope()`/`canActOn` (`src/lib/db/scope.ts`); RLS reads, service-role writes after app-code checks |
| Multi-tenancy | `organizations` + `organization_members`; `profiles.org_id` = active org; RLS helpers `app_is_active/app_is_org_supervisor/app_active_org/app_is_org_member` |
| Jobs | Supabase pg_cron + pg_net firing `/api/cron/auto-dial` and `/api/cron/reconcile-ai` every minute (`supabase/cron.sql`, previously hand-applied only) |
| Cache | none (in-memory per-lambda maps only) |
| Real-time transport | **NONE** — HTTP polling everywhere (1.5s–30s cadences); one WebSocket exists only in the optional standalone audio relay (`server/media-stream-server.mjs`, unconfigured) |
| Telephony | Twilio Voice JS SDK (browser) + REST; every manual call is a **conference** (`hc-<id>` rooms); AMD; caller-ID rotation `src/lib/dialer/rotation.ts` |
| AI calling | ElevenLabs Conversational AI; optional Twilio bridge mode; post-call webhook (HMAC) |
| AI surfaces | Claude via `src/lib/ai/claude.ts` (structured outputs, capability negotiation, demo fallback) |
| Storage | Twilio-hosted recordings proxied via `/api/twilio/recording/[sid]`; EL audio via `/api/elevenlabs/audio/[id]` |
| Tests | Vitest 2.1.9, node env, pure modules only. Baseline: **21 files / 246 tests, all passing** (2026-08-28). No DB, HTTP, component, or E2E harness |
| Deploy | git push to `claude/wizardly-cerf-m8c620` (the de-facto prod branch) auto-deploys; Cloudflare fronts `www`, machine traffic uses the Vercel host |

## Findings register

### Data integrity

- **F1 — No immutable call events.** No `call_events` table; every provider callback is a destructive row UPDATE on `call_records`/`ai_conversations`. Lost CAS races return `"ignored"` and the event is discarded, unauditable. Two ad-hoc parking tables (`pending_recordings`, `pending_call_verdicts`) upsert on `room`.
- **F2 — Human disposition path is not idempotent.** `insertCallRecord` (`src/lib/db/records.ts:213`) is a bare INSERT with no dedupe key; the client outbox (`src/lib/dialer/disposition-queue.ts`) replays any POST whose response was lost → **duplicate `call_records` + duplicate appointments/callbacks** via `routeDisposition`. The AI path, by contrast, is largely idempotent (monotonic CAS in `markAIConversationRinging/Active`, `claimAIConversationUnanswered`, `completeAIConversation`).
- **F3 — Four competing state vocabularies, no state machine for human calls.** `AILiveState` (5, AI only), `live_calls.state` (3, human), `LeadStatus` (9), `CallOutcome` (9), plus a declared-but-never-written `CallDisposition`. `call_records.disposition` is permanently NULL. No `voicemail_connected/declined/wrap_up/dispositioned` states anywhere.
- **F4 — No reservation or eligibility engine.** `getDialQueue` (`src/lib/db/leads.ts:917`): rep scope = owner OR assigned; **supervisor scope = the whole org pool**; order = upload order; the client cursor wrapped modulo (redial). No cooldown/max-attempts/active-call check in the manual path; never-dialed-first only in the AI cron. `buildSession` didn't scrub `dnc_numbers` (status only). Nothing prevents two workers dialing the same lead; the AI cron races interactive dialers.
- **F5 — Metric sprawl.** ≥7 surfaces compute independently (`getReportingData`, `getTeamLeaderboard`, `getAITodayStats`, `computeCampaignStats`, `app_leads_page` stats, `getDialerFloor`, leads KPIs). `DIALABLE` defined 3× (`db/leads.ts:23`, `campaign-stats.ts:12`, `smart-lists.ts:32`); **three different definitions of "connect"**; smart-list rules duplicated TS+SQL; org-tz fallback inconsistent (`"UTC"` in metrics/records vs `"America/Chicago"` in schedule.ts); `apptWhen` formatted in server-local time. No glossary, no tooltips, no reconciliation job.
- **F6 — Average AI Score** (spec §4 orders removal) lived as an aggregate in: `leads/page.tsx` KPI, `app_leads_page` stats SQL, `admin-console.tsx` tile, `/api/ai/chat` prompt context. Per-lead `ai_score` is separately a live dial-queue sort key and export column (retained deliberately — see decision D6).
- **F7 — Scope drift.** `getScope()/canActOn` is the intended authz primitive but ≥8 sites re-implement supervisor detection inline and disagree (`session-builder` owner-only; `getDialQueue` owner-OR-assigned).
- **F8 — Headerless import loses row 1 at two independent layers.** `csv.ts` `rowsToLeads` hard-starts at r=1 and `chunk.ts` lifts `records[0]` as header for every chunk; accounting is self-consistently wrong so `importShortfall` reports balanced books. No import jobs, provenance, rollback, mapping preview, or dedupe strategy choice; dedupe re-read **every org phone per chunk**.
- **F9 — No lead audit history.** `audit_log` covers admin actions only. No lead field/status/assignment/DNC history; `leads.notes` is a single overwritten field.

### Security (fixed in Phase A2 unless noted)

- **S1 — `/api/twilio/answered` had ZERO auth** and would fetch and **hang up arbitrary Twilio calls** by SID.
- **S2 — `/api/ai/briefing`, `/api/ai/copilot`, `/api/ai/summary` unauthenticated** — LLM spend + prompt-injection surfaces.
- **S3 — Reps held `monitor.view`+`monitor.listen` by default** — any rep could silently listen to any teammate's live customer call, while the monitor page's copy claimed supervisors-only.
- **S4 — `/api/twilio/hold`** authenticated but did not org-scope the conference room.
- **S5 — Report export (`ExportReportButton`) had no formula-injection protection** (the leads export did).
- **S6 — Signature-verification escape hatches**: empty `authToken` ⇒ verify returns true; `TWILIO_SKIP_SIGNATURE=true` honored in production.
- **S7 — `/api/twilio/hold-music` served `demo.twilio.com/docs/classic.mp3`** to real customers on hold.
- **S8 (accepted risk, documented)** — in-memory rate limiting is per-instance best-effort; recordings are fetchable org-wide by any org member.

### Realtime / dialer

- **R1 — Everything polls**: AI monitor 2s (each poll triggering server-side Twilio+EL reconciliation), human monitor 2s, presence 5s (tab heartbeat 20s / 45s stale — a crashed tab shows "Live"), floor 5s, answer detection 1.5s, parallel winner watch 4s.
- **R2 — Dead/fake controls**: dialer Record toggle flipped local state while `record:"true"` was hardcoded; leads-table "Call" button linked to bare `/dialer`; command-palette lead results dropped the lead; Admin dispositions editor changed nothing reps see (only the ElevenLabs prompt).
- **R3 — No pre-answer mute, no audio-device selection, no keyboard shortcuts, no teleprompter** (static script card).
- **R4 — Transcript timestamps discarded** (`flattenTranscript`), so audio↔transcript sync was impossible; manual calls are never transcribed (no STT provider — a real capability limit, not a bug).
- **R5 — Parallel safety**: no lead can repeat within one batch (fixed earlier), but nothing deduped by phone across lanes and nothing prevented cross-actor duplicates (no reservation).

### Product surfaces

- **P1 — No Lead 360**: nine partial lead renderings (`edit-lead-dialog`, `dialer/lead-panel`, `known-info-dialog`, `qualify-panel`, `booked-leads-panel`, `call-detail-modal`, `sort-preview-review`, campaign lead table, bills-fine table); no `/leads/[id]` route.
- **P2 — Packs ≠ assignments**: packs cut only at import; manager UI = one collapsed card with a select; reps see nothing pack-shaped; progress computed on read only.
- **P3 — Campaigns are labels**: name/color/utility_provider/scripts; no audience/schedule/pacing/retry/goals; "Utility provider" hardcoded on a vertical-neutral surface.
- **P4 — Callbacks**: recently gained due dates; still a static 3-lane read-only board; no claim/priority/reassign/missed/escalation. `pipeline.ts` hardcoded "Homeowner".
- **P5 — Smart lists**: 6 hardcoded rules (2 solar-only shown to every vertical), duplicated in SQL.
- **P6 — Exports**: leads export ignored active filters, no field chooser/templates; report export vulnerable (S5).
- **P7 — Reports/dashboard**: no drill-down anywhere, no comparison, no tooltips, no last-updated; leaderboard formula hardcoded; "This week/month" labels on rolling 7/30-day windows.
- **P8 — Appointments** is the most mature surface (4 views, drag-reschedule, floating wall-clock invariant, notification outbox) but filters client-side over ≤5000 rows and has no campaign link/conflict detection.
- **P9 — Missing primitives**: no StatusPill/FilterChip/Tabs/Tooltip/DropdownMenu/Drawer/DataTable/Timeline/Toast/ConfirmDialog (`window.confirm` in use).

## Data-flow maps (pre-Phase-1)

- **Import**: drop CSV on group tile → client chunking (`chunk.ts`) → `POST /api/leads/import` (perm, rate limit, cert gate, DNC scrub) → deterministic `csv.ts` vs Claude `parse-leads.ts` head-to-head (`scoreParse`, AI wins at 1.02) → `insertLeads` (skip-only dedupe by org-wide phone scan) → custom-field defs merged into org settings.
- **Manual dial**: client fetches `/api/leads/queue` once → slices cursor → `POST /api/twilio/call` (DNC scrub, ≤3 legs, caller-ID rotation) REST-dials leads into conference → browser `device.connect` joins → 1.5s poll `/api/twilio/answered` → webhooks `/api/twilio/status|amd` update `live_calls` + park verdicts/recordings → wrap-up POST `/api/calls` → `insertCallRecord` + `routeDisposition` (status update + appointment/callback rows).
- **AI dial**: `/api/elevenlabs/call` or auto-dial cron → `placeAiCallForLead` (DNC, breaker, quota preflight, override policy) → EL outbound (optionally bridged through a Twilio conference) → Twilio callbacks drive the AI CAS state machine → EL post-call webhook (`completeAIConversation`) writes transcript/summary/outcome → reconcile cron backstops stuck rows.
- **Reporting**: every surface pages `call_records` through `fetchPaged` (50k cap) and aggregates in JS.

## What was preserved on purpose

Working auth + tenant isolation model, the conference dial engine and its recovery paths (`use-dialer.ts`), the head-to-head import parser and chunk transport, the appointments floating wall-clock invariant, the vocabulary system, stored enum keys (`bills_fine` etc. never move), demo-mode graceful degradation, and the pg_cron scheduling architecture.
