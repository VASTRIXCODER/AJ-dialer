# Phase 2 — Requirements traceability

Statuses: **Done** · **Partial** · **Blocked** · **Deferred** · **Not started**.
Never promoted merely because a screen exists (phase_two.md §2). Sections map
to docs/phase_two.md; evidence = file paths / tests. Last updated: 2026-08-29
(P2.1 slice).

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
| Operational work state + leak detector | Partial — `app_pipeline_leaks` shipped; no UI/metric consumes it | PART 37 |
| Work items (dedupe, claim RPC) | Partial — table + `app_claim_work_items`; no rep-facing queue UI yet (P2.2/P2.6) | PART 37; db/opportunities.ts |
| Signals (dedupe, seen-count, TTL) | Partial — table + engine writes escalation signals; no hot queue UI (P2.6) | PART 37; orchestration/engine.ts |
| Touch model | **Partial by design** — `touches_v` view over call_records; table lands with the first message channel | PART 37; design doc §2 |
| Playbook definitions: versioned, validated, human-publish-only | Partial — contract + strict validator + 3 seed templates; publish API & Studio are P2.10 | orchestration/definition.ts, templates.ts; tests/playbook-definition.test.ts |
| Orchestration engine: deterministic, idempotent, kill-switched | **Partial** — v0 executes existing instances (wake/stop-rules/allow-list steps, exactly-once via UNIQUE key); NO activation path yet (event emitters + condition compiler are P2.2/P2.3); escalate lands as a signal, not an email | orchestration/engine.ts, plan.ts; api/cron/orchestrate |
| Per-opportunity execution locks | Partial — CAS on current_step + single-tick bound; pg_advisory_xact_lock deferred until multi-worker ticks exist | engine.ts |
| Phase 1 → opportunity sync hooks | Done (fire-and-forget, never-throw, no-ops without PART 37) | opportunities/sync.ts; records.ts (both channels) |
| Backfill from Phase 1 data | **Done** — 37,645 opportunities = 37,645 eligible leads, 1:1, all backfilled-flagged (2026-08-29) | schema.sql PART 37; migration-and-rollback.md |
| Counter/parity reconcile for opportunities | Not started (P2.2 — rides reconcile-data) | — |

## P2.2 — Lead intake & speed-to-lead (§7)

All items **Not started**. Clock columns exist on `opportunities` (PART 37);
nothing stamps `eligible_at`, no routing, no SLA timers, no intake view.

## P2.3 — Outbound opportunity automation (§8)

| Item | Status | Evidence |
|---|---|---|
| Pre-call context / "why this person now" | Not started | — |
| Structured post-call extraction | Partial (pre-existing F1 pipeline + new wrap-up suggestion; no timeline/commitment extraction schemas) | ai/analyze-call.ts; api/ai/wrapup-suggest |
| Post-call → work item completion | Done (loose lead-match v0; id-threading is the P2.3 upgrade) | opportunities/sync.ts completeCallWorkItems |
| No-answer follow-up sequence | Partial — seed template validates; cannot ACTIVATE until event emitters land | orchestration/templates.ts |
| Everything else in §8 | Not started | — |

## P2.4 — AI inbound reception (§9)

**Blocked** (provider wiring): no inbound number routing exists — an inbound
PSTN call currently falls into the outbound TwiML branch (see
channel-and-provider-capabilities.md). Requires inbound agent config +
number webhooks before any code here is honest.

## P2.5 — Appointment protection & no-show recovery (§10–§11)

**Not started.** SMS is send-incapable today (STOP-webhook only), so the
confirmation channel itself is Blocked until messaging lands.

## P2.6 — Rep assistant & hot opportunities (§12–§13)

**Not started.** The signals table (P2.1) is the landing zone for the hot
queue; escalation signals already accumulate there once orchestration runs.

## P2.7 — Sold/install mirror (§14)

**Blocked** on naming a trusted external source. The stage machine already
hard-gates `sold` to manager/system_fulfillment actors (tested).

## P2.8 — Post-install lifecycle (§15) · P2.9 — Reactivation (§16)

**Not started.** (Reactivation's eligibility engine will reuse the claim
RPC + FilterSpec grammar per the contracts doc.)

## P2.10 — Command Center & Playbook Studio (§17–§18)

**Not started.** The validator's error strings are written operator-facing so
the Studio can surface them verbatim.

## P2.11 — Hardening & release readiness

Per-slice testing only so far: 74 files / 860 tests green at this slice
(tests/opportunity-stage.test.ts, tests/playbook-definition.test.ts,
tests/org-config-wiring.test.ts new). Full regression/e2e/perf/a11y for
Phase 2 surfaces: Not started.

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
