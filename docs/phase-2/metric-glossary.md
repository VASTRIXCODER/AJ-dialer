# Phase 2 — Metric Glossary

Extends `docs/phase-1/metric-glossary.md` — the nine Phase 1 metrics (Calls today, Human
connects, Connect rate, Appointments set, Avg talk time, Performance this week, Outcome mix,
Hourly productivity, Campaign pipeline) are **not redefined here**; Phase 2 references them.
Per `docs/phase_two.md` §23 there is ONE analytics pipeline: these definitions will be added to
`src/lib/metrics/definitions.ts` and computed through `src/lib/metrics/service.ts` — never
independently per widget. Domain shapes come from the design authority,
`docs/phase-2/opportunity-domain-and-state-machines.md` — this document never contradicts it.

**Status: NOT IMPLEMENTED.** Every metric below is a definition landing ahead of code, exactly
as Phase 1's glossary did. Nothing here exists in `definitions.ts`, the service, or any UI yet.
The only shipped substrate is the P2.1 domain (opportunities, opportunity_events, work_items,
signals, `touches_v`, `app_pipeline_leaks` — supabase/schema.sql PART 37).

## Conventions (inherited + Phase 2 additions)

- Timezone / week start / half-open `[from, to)` ranges: identical to Phase 1 (`orgTimezone(org)`,
  `settings.reporting.weekStart`).
- **Population** default: OPEN opportunities of the org (at most one open per (org, lead) —
  partial unique index). **Unique entity key** default: `opportunity_id`; appointment metrics key
  on `appointment_id`; work metrics on `work_item_id`.
- **Event time, not ingestion time**, everywhere: the business timestamp on the row
  (opportunity clock columns, `opportunity_events.created_at`, appointment state-change events,
  `signals.detected_at`), never "when we processed it". Late events self-heal because flows are
  computed from stored rows at query time; a §23 reconciliation job repairs any materialized
  aggregates when late/corrected events arrive.
- **Stock vs flow** is a mandatory label on every card. Flow = events inside the selected period
  (trend/comparison valid). Stock = current state as of a displayed freshness timestamp
  (trend valid only as sampled snapshots; never summed across days). A stock and a flow of the
  same noun are always two separately-labeled cards, never one number.
- **Backfilled rows** (`opportunities.backfilled = true`): clocks are approximations from lead
  timestamps — excluded from all speed-to-lead percentiles and flagged in drill-downs.
- **Drill-down contract**: every card resolves to a filtered list of its underlying rows through
  the same service call with the same filters — dashboard count, report total, notification
  count, and drill-down row count must be equal (§23 acceptance).

## Command-strip metrics (§17) — all Not implemented

| Metric | Type | Key | Numerator / rule | Denominator | Drill-down |
|---|---|---|---|---|---|
| **Leads Worked** | Flow | opportunity_id | Distinct open opportunities with ≥1 qualifying outbound touch **initiated** in the period (`touches_v`, direction outbound, accepted attempt — same exclusions as Phase 1 "Calls today"). Total touch attempts is a separate, clearly-labeled companion number, never merged. | — | Opportunity list with the period's touches |
| **Contacts** | Flow | opportunity_id | Distinct opportunities with a verified human connection (Phase 1 `human_connected` rule) or a qualifying two-way reply (when messaging channels exist — P2.3/P2.5) in the period. Voicemail and delivery receipts never count. | — | Opportunity list with the connecting touch |
| **Appointments Set** | Flow | appointment_id | Phase 1 definition verbatim (anti-inflation rule): distinct non-cancelled `appointments` rows **created** in period; edits/reschedules never increment. | — | Appointment list |
| **Confirmed** | Flow | appointment_id | Distinct appointments whose confirmation machine (P2.5, on the existing `appointments` table) **entered Confirmed** in the period. Re-confirmation after a reschedule counts once per confirmation cycle, keyed on the state-change event. | — | Appointments + confirming event |
| **Currently Confirmed** | **Stock** | appointment_id | Appointments in Confirmed state now, start time inside the displayed upcoming window, as of the freshness timestamp. Separate card from Confirmed (flow) — never substituted. | — | Upcoming confirmed appointments |
| **At Risk** | **Stock**, rule-versioned | appointment_id | Current upcoming appointments matching a **published** risk rule as of freshness time. The rule is versioned; the card and drill-down display the rule version, and trend comparisons across a rule change are flagged invalid rather than shown silently. | — | At-risk appointments + matched rule + evidence |
| **No Shows** | Flow | appointment_id | Appointments **newly declared** No Show in the period under the org's grace/source policy. Event time = declaration time, not appointment start time. | — | No-show appointments + declaring actor/policy |
| **Recovered** | Flow | recovery instance id | No-show recovery instances that produced a new valid appointment in the period. **Recovered Shows** is a separate number: counted only when the recovery appointment later **completes**, attributed to the completion period — a recovery is never claimed as a show at booking time. | — | Recovery instances → new appointment |
| **Sales** | Flow | opportunity_id | Distinct opportunities entering trusted `sold` in the period. Trusted source ONLY: the stage machine (`src/lib/opportunities/stage-machine.ts`) permits `sold` from actor_kind manager/system-fulfillment — never AI, never conversation text (design doc §3). | — | Sold opportunities + the sold event |
| **Installs** | Flow | customer/opportunity id | Distinct customers entering trusted Installed milestone in the period, mirrored from the authorized sold-to-install feed (P2.7). No inferred installs. | — | Installed customers + milestone event |
| **Hot Opportunities** | **Stock** | opportunity_id | Open opportunities with ≥1 active hot signal (`signals`: unresolved, unexpired) as of freshness time, each with an explainable reason (severity, evidence). **Newly Detected** is the separate flow twin: first detections (`detected_at` in period); repeat detections bump `seen_count` on the deduped row and never re-count. | — | Hot queue with signal evidence |

Every card additionally shows: definition tooltip (rendered from `definitions.ts`), date range +
timezone, freshness, active filters, and trend only where the stock/flow label makes it valid.
No hard-coded numbers anywhere (§17).

## Speed-to-lead (§7) — Not implemented

Clock columns already exist on `opportunities` (P2.1): `first_received_at` → `eligible_at` →
`first_assigned_at` → `first_attempted_at` → `first_contacted_at`.

- **Cohort (population)**: opportunities becoming **eligible** in the period (event-time cohort;
  a late-arriving first contact updates that cohort's stat — reconciliation, not a new cohort).
- **Stats**: p50/p90 **percentiles, never means**, per interval: received→eligible (measured
  separately — the SLA clock starts at `eligible_at`, §7), eligible→assigned, assigned→first
  attempt, attempt→first contact, and eligible→first attempt (the headline SLA).
- Sliceable by source/campaign/rep/team; SLA thresholds are org-configured per
  source/campaign/priority. Ownership changes never reset clocks (§7).
- Excludes: `backfilled` rows (approximated clocks); opportunities whose clock is recorded as
  delayed/not-applicable with reason (§7 intake rule).
- Drill-down: opportunity list with each clock value and the breaching interval highlighted.

## Follow-Up Completion % (§17 rep performance) — Not implemented

- **Numerator**: due follow-up `work_items` (types `follow_up_call`, `callback`,
  `no_show_recovery`, `appointment_confirmation`) completed within their allowed window in the
  period, completion recorded by the sync hook matching the originating open item — duplicate
  calls and administrative edits never complete work twice (the `dedupe_key` partial unique
  makes duplicate live items impossible to create at all).
- **Denominator**: follow-up work items **due** (`due_at` in period).
- **Documented exclusions**: items auto-voided because the opportunity closed, went DNC, or the
  appointment cancelled before `due_at`; `skipped` requires a recorded reason and still counts
  against the rep unless policy-voided; `expired` counts against.
- Key: `work_item_id`. Flow. Drill-down: due-work list with completion timestamps and window.

The full rep row (Calls | Contacts | Appointments | Confirmed | Shows | Sales | Follow-Up
Completion %) reuses the definitions above scoped to the rep — no rep-local recalculation.

## Untouched / SLA breach (§7, §17 leaks) — Not implemented

- **Untouched** — Stock, opportunity_id: open, eligible opportunities with
  `first_attempted_at IS NULL`, as of freshness time. Drill: untouched queue ordered by age.
- **SLA breach** — Stock: the untouched subset past its configured threshold (per
  source/campaign/priority); "approaching" is a separately-labeled band, never merged into
  breach. Drill: same queue filtered to breaches, showing threshold, elapsed, owner, escalation
  history.

## Pipeline leak count (§17, design doc §4) — Not implemented (function shipped, metric not wired)

- **Contract**: `app_pipeline_leaks(org)` (live in PART 37) returns exactly the open
  opportunities satisfying NONE of: future `next_action_due_at`; an open/reserved work item;
  `op_status='waiting'` with `waiting_until`; `op_status='paused'` with reason. Stock,
  opportunity_id, as-of freshness time.
- **Acceptance** (§17/§25): the count contains no opportunity with a valid next action,
  intentional pause, or closure — zero false positives is the test, not a goal.
- The metric-service wrapper, card, and drill-down (leak queue with severity, oldest age,
  owner/team, expected action, SLA) are all Not implemented; only the SQL function exists.

## Sequencing note

Definitions above deliberately reference machines that land in later workstreams (confirmation
P2.5, no-show recovery P2.6, sold/install P2.7, hot detection P2.4, messaging P2.3). A metric
must not ship before its trusted source does — shipping a card computed from an untrusted proxy
would violate §23 and the Phase 1 precedent (Appointments set waited for canonical rows).
`leads.status` remains the reporting authority until the §27 parity criterion (design doc §8);
until cutover, Phase 2 opportunity metrics are additive surfaces, never replacements.
