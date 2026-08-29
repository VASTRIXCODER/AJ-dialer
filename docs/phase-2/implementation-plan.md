# Phase 2 — Implementation plan

Ordered per docs/phase_two.md §24; every workstream stays releasable. The
design authority for the domain is opportunity-domain-and-state-machines.md;
the execution contract is playbook-and-orchestration-contracts.md. This file
tracks decisions + sequencing, not requirements (that's the traceability
matrix).

## Decision register (P2 · D-numbers continue Phase 1's)

- **D30 — Opportunity wraps the lead, never replaces it.** `leads.status`
  stays authoritative for Phase 1 surfaces; one-way sync + 14-day parity
  before any reader cutover. (Phase 1's dual-write discipline, reused.)
- **D31 — Touches start as a view.** No write-path risk for a projection;
  the table lands with the first non-call channel that needs rows of its own.
- **D32 — Engine v0 executes, never activates.** Activation needs event
  emitters + the condition compiler; shipping execution first means the
  exactly-once/kill-switch machinery is proven before any playbook can reach
  a customer. The v0 action allow-list contains zero customer-contact kinds.
- **D33 — Escalations land as signals** until notification templates exist
  (the outbox is email-shaped and trigger-fed; raw rows would dead-letter).
- **D34 — New keys for resurrected dead controls** whenever a stored value
  could surprise (talkTimeLimitMin, maxAttemptsPerLead, redialCooldownMin);
  same-key resurrection only where matching the visible admin value is the
  least-surprise outcome.
- **D35 — Due callbacks bypass pacing knobs in the claim ROUTE** (two-phase
  claim) rather than editing the claim RPC — SQL churn on a live SECURITY
  DEFINER function needs its own migration window; revisit when PART 38
  touches the RPC anyway.
- **D36 — The sold gate is actor-based in the stage machine** (manager /
  system_fulfillment only), enforced before any fulfillment source exists —
  the cheapest possible place to make "never infer Sold" structural.

## Slice log

- **S1 (2026-08-29, shipped):** user-directed pre-flight — admin config truth,
  AI re-integration (VICC live), import entry, closer-notes slot,
  appointment-only summaries, actionable wrap-up AI disposition. Adversarial
  review (17 confirmed findings) fixed in the same session, including one
  critical (stale aiModeRef inverting manual-first boots into AI sessions)
  and the removal of the policy-bypassing legacy `To` TwiML branch.
- **S2 (2026-08-29, shipped):** P2.0 doc set + P2.1 foundation — PART 37
  (repo; live apply pending), stage machine + tests, playbook contract +
  validator + seed templates + tests, engine v0 + orchestrate cron (unscheduled),
  sync hooks both channels, opportunity backfill SQL.

## Next slices (dependency order)

1. **S3 — P2.1 close-out:** apply PART 37 live; verify backfill counts per
   org; opportunity parity check riding reconcile-data; superadmin control for
   orchestration_paused; per-opportunity advisory locks when tick concurrency
   >1.
2. **S4 — P2.2 intake & speed-to-lead:** `lead.received` emitter at every
   intake path (import chunk commit, API, manual add), eligible_at rules,
   routing policies, SLA timers via the engine's sweep trigger + condition
   compiler (the compiler unlocks activation — the D32 gate lifts here),
   King's intake view.
3. **S5 — P2.3 outbound automation:** work-item id threading through the
   dialer queue, `call.completed` emitter → no-answer follow-up activation,
   pre-call "why now" panel, promised-callback protection live.
4. **S6 — P2.6 hot queue + My Day** (signals are already accumulating).
5. **P2.4 / P2.5 / P2.7+** stay gated on providers per the capability doc.

## Standing constraints

- Vercel Hobby: no per-minute vercel.json crons — pg_cron only (docs/CRON.md).
- One ElevenLabs credential set platform-wide; per-org inbound is a P2.4
  prerequisite, not an assumption.
- Every new surface must degrade in demo mode (no Supabase → no-op, never
  crash) — the sync hooks and engine already follow this.
