# Phase 2 — Requirements traceability

Statuses: **Done** · **Partial** · **Blocked** · **Deferred** · **Not started**.
Never promoted merely because a screen exists (phase_two.md §2). Sections map
to docs/phase_two.md; evidence = file paths / tests. Last updated: 2026-08-29
(Phase 2 H slice, commit cbd90ce).

## Pre-flight (this session, outside the numbered workstreams)

| Requirement (user-directed) | Status | Evidence |
|---|---|---|
| Import Studio reachable from /leads | Done | src/app/(app)/leads/page.tsx (header Import button, leads.import-gated) |
| Every admin configuration works or is honestly gone | Done | commit "VICC re-integration A" + review-fix commit; tests/org-config-wiring.test.ts |
| AI dialing re-enabled for VICC, org-configurable, per-rep toggles | Done | live flag flip (aiDialer=true, defaultMode=manual); admin-console.tsx per-rep Bot toggle; org-settings-form.tsx Enable button |
| Closer-notes slot (under construction) on the power dialer | Done | dialer-client.tsx right column; DialerLayout.closerNotes toggle |
| AI summaries appointment-only, both channels | Done | ai-call-finalize.ts; analyze-call.ts includeSummary; api/calls/route.ts |
| AI disposition for manual dialing (actionable, org-taxonomy) | Done | api/ai/wrapup-suggest; services.ts getWrapupSuggestion; call-summary.tsx; wrapup-panel.tsx |

## P2.0 — Readiness & baseline

| Item | Status | Evidence |
|---|---|---|
| Current-state / Phase 1 readiness audit | Done | docs/phase-2/current-state-and-phase-1-readiness.md |
| Traceability matrix | Done (this file, maintained per slice) | — |
| Provider capability inventory | Done | docs/phase-2/channel-and-provider-capabilities.md |
| Metric glossary (definitions ahead of code) | Done (definitions only — nothing computed) | docs/phase-2/metric-glossary.md |
| AI schemas & evaluation plan | Done (plan; evaluation harness Not started) | docs/phase-2/ai-schemas-and-evaluation.md |
| Operations runbook | Done (engine sections live with this slice) | docs/phase-2/operations-runbook.md |
| Funnel/data-quality baseline measurements | Not started | — |

## P2.1 — Opportunity & orchestration foundation (§4–§6)

| Item | Status | Evidence |
|---|---|---|
| Opportunity model + events (audit, immutable) | **Done** — applied to the live DB 2026-08-29 (verified counts in migration-and-rollback.md) | supabase/schema.sql PART 37 |
| One-open-per-lead uniqueness policy | Done (in DDL) | partial unique index `opportunities_one_open_per_lead` |
| Sales lifecycle state machine (sold/DNC/regress gates) | Done | src/lib/opportunities/stage-machine.ts; tests/opportunity-stage.test.ts (exhaustive matrix) |
| Operational work state + leak detector | Done — `app_pipeline_leaks` consumed by the Command Center (true count + sample) | PART 37; db/command-center.ts; app/(app)/command |
| Work items (dedupe, claim RPC) | Partial — dial claims now reserve/release the matching call items (TTL lease) and My Day lists the rep's open items; `app_claim_work_items` itself has no UI consumer yet | PART 37; db/opportunities.ts reserveCallWorkItems; api/dialer/claim+release; db/my-day.ts |
| Signals (dedupe, seen-count, TTL) | Done — dashboard Hot signals card, /api/signals (ack/dismiss), My Day, Command Center count, dialer WhyNow card | PART 37; api/signals; components/dashboard/hot-queue.tsx; db/my-day.ts |
| Touch model | **Partial by design** — `touches_v` view over call_records; table lands with the first message channel | PART 37; design doc §2 |
| Playbook definitions: versioned, validated, human-publish-only | Partial — contract + strict validator + 3 seed templates; publish API & Studio are P2.10 | orchestration/definition.ts, templates.ts; tests/playbook-definition.test.ts |
| Orchestration engine: deterministic, idempotent, kill-switched | **Done (code) / NOT RUNNING (operationally)** — the full loop is now exercised end-to-end by tests/orchestration-pipeline.test.ts against an in-memory PostgREST fake that enforces the real UNIQUE constraints: activation → step execution → work items/signals/next actions → stop rules → all four kill switches. Escalate still lands as a signal, not an email (no outbox templates). **In production the engine has never executed: the orchestrate pg_cron job is not scheduled and no org has the master switch on.** Admin → Playbooks now says so rather than failing silently. | orchestration/engine.ts, events.ts, plan.ts; api/cron/orchestrate; PART 38 heartbeat |
| Per-opportunity execution locks | Partial — CAS on current_step + single-tick bound; pg_advisory_xact_lock deferred until multi-worker ticks exist | engine.ts |
| Phase 1 → opportunity sync hooks | Done (fire-and-forget, never-throw, no-ops without PART 37) | opportunities/sync.ts; records.ts (both channels) |
| Backfill from Phase 1 data | **Done** — 37,645 opportunities = 37,645 eligible leads, 1:1, all backfilled-flagged (2026-08-29) | schema.sql PART 37; migration-and-rollback.md |
| Counter/parity reconcile for opportunities | Not started (P2.2 — rides reconcile-data) | — |

## P2.2 — Lead intake & speed-to-lead (§7)

| Item | Status | Evidence |
|---|---|---|
| Every new lead → opportunity with honest clocks (first_received/eligible) | Done — fast hook after import chunks + reconcile-data safety net (bounded keyset scan, 30-day window) | orchestration/events.ts processLeadIntake; db/opportunities.ts ensureOpportunitiesForNewLeads; api/leads/import; cron/reconcile-data |
| Condition evaluator (runtime half of the grammar) | Done — FilterSpec discipline (null-as-"", numeric-over-junk = no match, unknown keys = no match) | orchestration/conditions.ts; tests/orchestration-conditions.test.ts |
| Playbook ACTIVATION: event triggers | Done — lead.received / call.completed / opportunity.assigned emitters (org switch + published-listener gated, bounded emits with counted skips) | orchestration/events.ts; opportunities/sync.ts; db/assignments.ts; api/leads/import |
| Playbook ACTIVATION: sweep triggers | Partial — stateless interval gating, 50 candidates/playbook/firing; candidate sources are pragmatic (overdue callbacks vs least-recently-touched), not a general compiler | orchestration/events.ts runOrchestrationSweeps |
| Assignment routing stamps (owner, first_assigned_at, assigned stage) | Done (allocation path) | db/opportunities.ts stampOpportunitiesAssigned; db/assignments.ts |
| Playbook admin (install/publish/pause/retire + org master switch) | Done — Studio-lite; strict validation is the publish gate; all mutations audited | api/playbooks; components/admin/playbooks-panel.tsx |
| Configurable routing policies (territory/skill/round-robin/capacity) | Not started | — |
| SLA escalation beyond the speed-to-lead template | Partial — the template escalates via signals; manager notification templates Not started | orchestration/templates.ts |
| King's intake view (volume, ownership, untouched, SLA drill-down) | Partial — Command Center today strip covers new-lead volume, untouched count and speed-to-first-call; per-source/ownership drill-down Not started | app/(app)/command; db/command-center.ts |
| Speed-to-lead metrics (percentiles) | Partial — median (today, org) on the Command Center with a min-denominator floor; percentile series Not started | db/command-center.ts |

## P2.3 — Outbound opportunity automation (§8)

| Item | Status | Evidence |
|---|---|---|
| Pre-call context / "why this person now" | Done — /api/opportunities/context + the dialer's WhyNow card (stage, urgency line, next action, open work, signals, running playbooks); renders nothing when there's nothing | api/opportunities/context; components/dialer/why-now.tsx; lib/opportunities/why-now.ts; tests/next-action.test.ts |
| Structured post-call extraction | Partial (pre-existing F1 pipeline + wrap-up suggestion; no timeline/commitment extraction schemas) | ai/analyze-call.ts; api/ai/wrapup-suggest |
| Post-call → work item completion | Done — claims reserve the call items behind the claimed leads (TTL lease, released with the claim); the filed disposition completes them | opportunities/sync.ts; db/opportunities.ts reserveCallWorkItems; api/dialer/claim+release |
| Next-action generation on every disposition | Done — deterministic pure mapping (agreed callback/appointment times ride through; closing outcomes clear), stamped on open opportunities only | lib/opportunities/next-action.ts; tests/next-action.test.ts |
| No-answer follow-up sequence | Done (activation-ready) — event emitters + condition evaluator landed in P2.2; runs once an org opts in and the orchestrate cron is scheduled | orchestration/templates.ts, events.ts |
| AI-drafted outreach / messaging steps in §8 | Blocked — no outbound SMS/email channel (see channel-and-provider-capabilities.md) | — |

## P2.4 — AI inbound reception (§9)

**Blocked** (provider wiring): no inbound number routing exists — an inbound
PSTN call currently falls into the outbound TwiML branch (see
channel-and-provider-capabilities.md). Requires inbound agent config +
number webhooks before any code here is honest.

## P2.5 — Appointment protection & no-show recovery (§10–§11)

**Not started.** SMS is send-incapable today (STOP-webhook only), so the
confirmation channel itself is Blocked until messaging lands.

## P2.6 — Rep assistant & hot opportunities (§12–§13)

| Item | Status | Evidence |
|---|---|---|
| Hot queue (signals surfaced, ack/dismiss, self-explaining) | Done | api/signals; components/dashboard/hot-queue.tsx |
| My Day page (start-here queues, appointments, assignment progress) | Done — personal by design; "no time set" callbacks are counted as unscheduled, never due | app/(app)/today; db/my-day.ts |
| "Who should I call next?" | Done — deterministic ladder (overdue callback → hot signal → due work item → callback later today) hard-filtered against DNC list + status, archived, missing/short numbers, another rep's hold, and the org calling window in the lead's timezone | db/my-day.ts (whoNext) |
| End-of-day summary | Done — "you · today · org time" readout (dials, conversations, appointments, talk time) | app/(app)/today |
| In-call whisper/live coach | Not started (distinct from the existing copilot surfaces) | — |

## P2.7 — Sold/install mirror (§14)

**Blocked** on naming a trusted external source. The stage machine already
hard-gates `sold` to manager/system_fulfillment actors (tested).

## P2.8 — Post-install lifecycle (§15)

**Blocked** — depends on P2.7's trusted fulfillment source and an outbound
message channel; neither exists.

## P2.9 — Reactivation (§16)

| Item | Status | Evidence |
|---|---|---|
| Rule-based cohorts (aged, explainable, DNC-impossible) | Done — gone-quiet 30d / no-need 60d / never-called 45d; attempt caps; statuses can never include a blocked segment (tested) | lib/dialer/reactivation.ts; tests/reactivation.test.ts |
| Hard exclusions (open callback, held lead, bad number) | Done — with honest skip accounting surfaced to the operator | db/reactivation.ts; components/command/reactivation-studio.tsx |
| Load as a strict dial session | Done — materialised via buildSession({leadIds}) (re-fences scope/org, blocks DNC status, scrubs numbers, preserves order); loads strict/no-refill | api/reactivation; dialer-context loadSession |
| Control groups / experiment measurement | Not started | — |
| Multi-channel re-engagement (SMS/email) | Blocked — no outbound message channel; not simulated | channel-and-provider-capabilities.md |

## P2.10 — Command Center & Playbook Studio (§17–§18)

| Item | Status | Evidence |
|---|---|---|
| Today strip (org · today, labeled scope/window) | Done — dials, conversations, appointments, leads worked, new leads, speed-to-first-call median (min-denominator floor → "not enough data") | app/(app)/command; db/command-center.ts |
| Needs-attention queues (each count a door) | Done — overdue/unscheduled callbacks, untouched new, hot signals; empty ones collapse | app/(app)/command |
| Pipeline-leak queue | Done — app_pipeline_leaks true count + sample with owner/stage/last-touch | db/command-center.ts |
| Rep performance (today) | Done — a table, not a podium | app/(app)/command |
| Playbook oversight | Partial — status + live instance counts on /command; publish/pause/retire Studio-lite in Admin; a visual drag-drop Studio is Deferred (the validator's operator-facing errors are its foundation) | components/admin/playbooks-panel.tsx |

## P2.11 — Hardening & release readiness

78 files / 896 tests green at this slice (new: tests/next-action.test.ts,
tests/reactivation.test.ts). Adversarial review (4 find-lenses × 2 refuters
per finding) run on every substantial commit — see qa-evidence.md for the
per-cycle confirmed/fixed counts. Remaining: e2e/perf/a11y sweeps for the
Phase 2 surfaces and the opportunity-parity check riding reconcile-data.

## Cross-cutting honesty notes

- PART 37 was applied to the live DB 2026-08-29 (user-authorized) with one
  apply-time fix fed back to the repo: the backfill's assigned_rep_id cast is
  pattern-guarded (the column is TEXT on leads). Fresh/dev environments
  without PART 37 remain no-op-safe (suite green either way).
- The engine's `escalate` writes signals, not notifications (outbox is
  email-shaped + trigger-fed; wiring lands with P2.2 templates).
- `waitUntil`'s local-time resolution is minute-precision and can shift ±1h
  across a DST boundary (documented in plan.ts).
- Global kill switch v0 is the `app_settings.orchestration_paused` column
  (superadmin console control: Not started — SQL-flip only for now).
