# Phase 2 — Operations Runbook (§21 / §26)

What actually runs today, how to stop it, and how to recover it. Grounded in the
live production topology: prod branch `claude/wizardly-cerf-m8c620` auto-deploys
to Vercel; Cloudflare fronts the www host; crons live in Supabase pg_cron —
**never** `vercel.json` (a per-minute cron there fails the whole Hobby deploy;
it froze production for 13 days once).

Honesty marker: the orchestration engine, playbook tables, and the orchestrate
tick are DESIGNED (docs/phase-2/opportunity-domain-and-state-machines.md §5) but
not merged. Those sections are tagged **lands with P2.1 code**. Everything else
below is running in production now.

## 1. Scheduled jobs (`supabase/cron.sql` — the source of record)

| Job | Schedule | Endpoint | Does |
|---|---|---|---|
| `auto-dial` | `* * * * *` | `/api/cron/auto-dial` | Unattended AI calling for orgs whose automation window is open |
| `reconcile-ai` | `* * * * *` | `/api/cron/reconcile-ai` | Backstop: every AI call reaches a terminal state; max-talk watchdog; drains the notification outbox on the same tick |
| `reconcile-data` | `*/15 * * * *` | `/api/cron/reconcile-data` | Repairs `leads.attempt_count` drift, synthesizes missing call_record projections, logs metric drift to `audit_log` (scheduled by hand 2026-08-28) |
| `orchestrate` | `* * * * *` (planned) | `/api/cron/orchestrate` | Engine tick — **lands with P2.1 code** |

Plumbing: pg_cron calls `public.app_fire_cron(path)`, which reads two Supabase
Vault secrets (`cron_secret`, `cron_base_url`) and fires `net.http_post` with
`Authorization: Bearer $CRON_SECRET` — the same header Vercel Cron would send.
It raises loudly when Vault is unseeded, so misconfiguration shows as FAILED
runs in `cron.job_run_details` instead of silent 401s. Base URL is deliberately
the Vercel host, not www — Cloudflare can fail independently.

Seed / rotate (SQL editor; never returns the secret):

    select public.app_set_cron_secret('<CRON_SECRET from Vercel>',
                                      'https://aiatworkdialer.vercel.app');

Diagnostics (copy-paste from `supabase/cron.sql`): `cron.job` (is it scheduled),
`cron.job_run_details` (did it fire), `net._http_response` (what came back).
**401** = Vault secret drifted from Vercel's `CRON_SECRET`; **503** =
`CRON_SECRET` missing in Vercel entirely.

Adding the orchestrate tick (**lands with P2.1 code**): deploy the endpoint
FIRST, then `select cron.schedule('orchestrate', '* * * * *', $job$ select
public.app_fire_cron('/api/cron/orchestrate') $job$);` — same endpoint-before-
schedule rule reconcile-data followed, or it 404s every minute. Rollback is one
`cron.unschedule('orchestrate')`.

## 2. Kill-switch inventory (widest → narrowest)

| Switch | Scope | Where | Status |
|---|---|---|---|
| Maintenance mode | Whole app, all non-superadmins | Superadmin `/console` → `app_settings.maintenance` (`src/lib/db/app-control.ts`; gate in `src/app/(app)/layout.tsx`) | Built |
| `app_settings.orchestration_paused` | All orchestration, every org | SQL update; checked FIRST in every tick | **lands with P2.1 code** |
| `settings.orchestration.enabled` | One org's orchestration; **default OFF** — no org auto-orchestrates unexpectedly | Org settings | **lands with P2.1 code** |
| Playbook `status='paused'` | One playbook, all its instances | Playbook API (Studio UI is P2.10) | **lands with P2.1 code** |
| `settings.automation.enabled` | One org's unattended auto-dial | Admin → automation window (`src/lib/dialer/schedule.ts` `isAutoDialActive`) | Built |
| `settings.features.aiDialer` / `aiAgent` | One org's AI dialing features | Admin / org builder (`src/lib/org/settings.ts`) | Built |
| `settings.dialing.reservations` | Lease-based dial claims → legacy slicing | Org settings; rollback is a settings flip, not a deploy | Built |
| Provider circuit breaker | AI dialing after repeated provider failures | Automatic (`src/lib/ai-call-breaker.ts`) — not a manual switch | Built |

Rule of thumb during an incident: maintenance mode is the sledgehammer (kills
rep dialing too); prefer the narrowest switch that stops the bleeding.

## 3. Max-talk watchdog

`enforceMaxTalkTime()` in `src/lib/ai-call-reconcile.ts` runs on every
reconcile-ai tick, BEFORE the outbox drain (an overrun should end now, not
after a 45s backlog page-through — `src/app/api/cron/reconcile-ai/route.ts`).
It lists connected live AI conversations and force-ends any past the org's
`ai.maxTalkMin` ceiling. Enforcement lag ≤ ~60s past the configured ceiling.
No-op when Twilio/admin creds are absent (demo-safe).

## 4. Telemetry (`src/lib/telemetry.ts` → `ops_metrics`)

`count()` / `timing()` are buffered, fire-and-forget, never throw into a call
path; without a service role they degrade to console lines. Accepted caveat: a
frozen lambda can lose up to 1s of buffered counters — trend data, not billing.

Read with `scripts/perf-report.sql` (Supabase SQL editor): timing percentiles,
daily counter trends, and the red-flag query — `webhook.unsigned_accepted`,
`event.apply_fail`, `realtime.publish_fail`, `reservation.claim_fail`,
`reconcile.metric_drift`, `import.probe_failed` should all be ~zero. A spike in
`event.stale`/`event.cas_lost` means a webhook path regressed (small numbers
are normal). Sustained `reconcile.counter_repairs` means a drift source exists.

Phase 2 additions (**lands with P2.1 code**): `orchestrate.*` counters — tick
duration, steps executed, stop-rule blocks, retries, dead-letters, lock
contention — same table, same snippet-pack pattern; no dashboard until the
volume earns one.

## 5. Dead-letter & replay — playbook_executions (**lands with P2.1 code**)

As designed (design authority §5): every step execution inserts into
`playbook_executions` with a UNIQUE `idempotency_key`
(`instance:step:scheduled_at`) — the exactly-once gate. Transient failures
retry with backoff on the execution row; terminal failures mark the instance
`status='failed'` and surface in the ops/pipeline-leaks queue (§17 "automation
failures or dead-letter items").

Replay procedure (operator, SQL until Studio ships in P2.10):
1. Find them: `select * from playbook_instances where status='failed'` (join
   `playbook_executions` for the failing step + error).
2. Fix the cause (provider creds, bad template, policy block).
3. Requeue: set the instance back to `active` with the correct `current_step`
   and a fresh `wait_until`. The next tick executes it under a NEW
   idempotency key (new `scheduled_at`) — never delete or reuse execution rows;
   the table is append-only audit.
4. If the step already half-ran on the provider side, resolve manually and
   advance `current_step` past it instead — never force a duplicate send.

## 6. Enforced calling hours & the escape hatch

`settings.hours` acts two ways (`src/lib/dialer/schedule.ts`
`isWithinOrgHours`): **advisory** (dialer shows an outside-hours banner) or
**enforced** (`hours.enforced` — call routes refuse the dial). Enforced
defaults OFF (`src/lib/org/settings.ts`). Degenerate configs never block:
equal start/end or non-finite hours read as "always open", empty days = every
day — a half-saved blob must not brick a floor.

Escape hatch: Admin → un-check enforced. Takes effect on the next dial — no
deploy, no restart. Note the auto-dialer separately checks each LEAD's own
timezone (`isWithinCallingWindow` — TCPA governs the called party's local
time); un-enforcing org hours does not bypass that.

## 7. Incident playbooks

### 7.1 Provider quota exhaustion (breaker + halt)
Symptoms: batches return `halted: true`, `haltReason: "provider_quota_exceeded"`.
Behavior (built, `src/lib/ai-dialer.ts` + `src/lib/ai-call-finalize.ts`):
quota is checked BEFORE dialing; the first call that comes back out-of-credits
trips the breaker so a running 1,500-call batch stops itself instead of burning
leads. Response: top up the ElevenLabs balance (or wait for the reset shown in
the halt message). The breaker half-opens on its own and arms a single probe
call — verify one AI call completes, then resume the batch. No manual reset.

### 7.2 Webhook silence (reconcile backstop)
Symptoms: AI calls stuck non-terminal; no `POST /api/elevenlabs/webhook`
arrivals. Backstop (built): reconcile-ai polls every minute and force-resolves
stuck conversations (`reconcileStuckConversations`, 45s budget with
`moreRemaining` continuation) — no call stays live forever even with a dead
webhook. Response: confirm the webhook URL + `ELEVENLABS_WEBHOOK_SECRET` in the
ElevenLabs dashboard; the backstop buys time but transcripts arrive late, so
fix the webhook, don't live on the reconciler.

### 7.3 Orchestration runaway (**lands with P2.1 code**)
Wrong-action symptoms → stop in this order, narrowest that works:
1. Pause the offending playbook (`status='paused'`).
2. Org: `settings.orchestration.enabled=false`.
3. Global: `app_settings.orchestration_paused=true` — one UPDATE; the next
   tick no-ops (kill switches are checked before any work).
In-flight executions finish or fail; nothing new starts. The audit trail
survives by construction — `playbook_executions` and `opportunity_events` are
append-only — so the post-mortem is a per-opportunity execution timeline, and
§25's kill-switch acceptance test ("prevents new actions while preserving
audit") is the regression gate for re-enable.

### 7.4 Cron freeze
No `cron.job_run_details` rows → pg_cron/pg_net issue (Supabase status).
Rows FAILING with 401 → rotate via `app_set_cron_secret` (secret drifted).
Deploys failing → check nobody added a cron to `vercel.json` (standing rule:
schedules live in `supabase/cron.sql` only).

## 8. PII-safe logging (release requirement, §21)

Ids only — `leadId`, `callSid`, `conversationId`, `orgId` — never names,
phone numbers, or transcript text in `console.*`, error messages, or
`ops_metrics` tags. Phase 1 verified this by grep audit over `src/app/api` +
`src/lib` (zero hits — docs/phase-1/qa-evidence.md); every Phase 2 checkpoint
re-runs that audit before commit. Telemetry tags are structured metadata, not
content; the engine logs step/instance/opportunity ids, never message bodies.
