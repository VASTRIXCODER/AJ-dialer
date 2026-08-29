# Phase 2 — QA evidence

Per-slice log; append, never rewrite. Companion to requirements-traceability.md.

## Slice S1+S2 — 2026-08-29 (pre-flight + P2.1 foundation)

**Gates:** `npx tsc --noEmit` clean · `npm test` **74 files / 860 tests green**
· `npm run build` passes (all routes). (`npm run lint` remains unusable —
Phase 1 known limitation; gates are vitest + tsc + build.)

**New test files this slice:**
- `tests/org-config-wiring.test.ts` — resurrected-control logic: defaultMode
  sanitization, 0-default pacing knobs (stored dead values never wake),
  advisory-hours predicate (lead-tz, overnight wrap, degenerate-config
  never-blocks), accent hex→HSL + scoped CSS, dialer user prefs parsing,
  vocabulary tagline precedence, ElevenLabs voice override allow-list
  (fail-closed), talkTimeLimitMin new-key rule.
- `tests/opportunity-stage.test.ts` — exhaustive transition matrix:
  forward-free / regress-human-only / sold-trusted-only / DNC-leaves-by-human;
  leads.status mapping LOCKSTEP with the PART 37 backfill CASE.
- `tests/playbook-definition.test.ts` — seed templates publish clean; RESERVED
  kinds fail publish; unknown events vs vocabulary events; stop-rule
  always-enforced pair; firstTrippedStopRule precedence + opt-in rails;
  waitUntil determinism incl. local-time next-occurrence.
- `tests/artifact-override.test.ts` (updated) — do_not_call pinned in
  mergeAiDispositionPolicy.

**Adversarial review evidence (commit 3ee0184):** 4-lens find → 2-refuter
verify workflow; 20 raw findings, 17 confirmed, 3 refuted. All 17 fixed in the
follow-up commit, notably:
- CRITICAL stale `aiModeRef`: manual-default boot still AI-launched on Start.
- Fabricated `no_answer` records for hour-blocked parallel legs (server per-leg
  refusals + client undialed-set + claim release).
- Legacy `To` TwiML branch removed (DNC/hours/policy bypass via console).
- Cross-tenant intervene fallback fail-closed (durable org-ownership check).
- Primary-agent raw "default" voice override; talkTimeLimitMin key rename;
  due-callback bypass restored in the claim route (two-phase claim).

**Live-DB changes verified this session:**
- VICC flags read back after update: `aiDialer=true`, `defaultMode=manual`.
- PART 37: **APPLIED 2026-08-29** (user-authorized; first attempt failed on a
  text/uuid COALESCE — `leads.assigned_rep_id` is TEXT — fixed with a
  pattern-guarded cast, fed back to schema.sql, re-applied clean). Post-apply
  verification: 37,645 opportunities = 37,645 eligible leads (1:1, all
  `backfilled`); 37,433 open / 212 closed; stage mix new 33,795 · attempting
  2,167 · assigned 1,320 · dnc_suppressed 112 · lost 100 · contacted 69 ·
  nurture 58 · appointment_booked 20 · interested 4; orchestration_paused
  false; all 1,595 assigned_rep_id values matched the UUID pattern (0 bad).

**Not yet evidenced (honest):** any Phase 2 UI, engine behavior against real
tables (unit-tested pure planning only), backfill row counts, orchestrate
cron execution, opportunity parity.

## Slice S5 — 2026-08-29 (queue-fidelity review cycle + P2.6-lite)

**Gates:** tsc clean · 76 files / 878 tests green · build passes.

**Adversarial review of 1c5a611** (4 lenses × 2 refuters): 18 raw findings,
16 confirmed (~11 distinct), 2 refuted. All fixed:
- CRITICAL: auto-dial's lap refetch swapped a builder session for the default
  pool queue (off-list dialing resurrected through auto-dial) — the lap now
  honors the session contract: strict+no-refill ENDS auto-dial with the honest
  message; refill announces the swap.
- Double cursor advance (claim-advance + advanceQueue) skipped ~parallel leads
  per round and halved laps — advanceQueue now consumes the claim-advance
  flag; lap wrap is recorded at claim time; override rounds reset the flags.
- Due-callback bypass was dead in strict mode — the claim route now pre-claims
  dueIds ∩ leadIds with the knobs off.
- 200-id window + a second-window probe fixes the false "list finished" on
  large sessions with an ineligible head window.
- Suspended supervisors could read org books through the admin-client paths
  (session builder AND the pre-existing getDialQueue) — both now check
  profiles.disabled and fail closed.
- loadSession resets the cursor and clears stale campaign/group/my-leads
  filters; BOTH "Load leads" doors open the SessionBuilder; the builder now
  uses the Modal primitive (dialog role, focus trap, Escape, reduced-motion),
  renders org vocabulary (no solar copy for non-solar tenants), refuses an
  empty disposition selection instead of silently loading defaults, and uses
  groupLabel()/leadGroupLabels for group chips (incl. "Miscellaneous").

**P2.6-lite shipped:** /api/signals (org-fenced list/acknowledge/dismiss;
reps see own-opportunity signals, supervisors the org) + the dashboard Hot
signals card (severity-first, self-explaining rows, renders nothing when
clear).
