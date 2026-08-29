# Phase 2 — Opportunity domain & state machines (as designed / as built)

The canonical model for the AI Opportunity Pipeline (docs/phase_two.md §4–§5),
mapped onto the Phase 1 foundation it extends. This document is the authority:
schema (PART 37), the pure TS twins, and every later workstream follow it.

Terminology note: prompt names (Brock/King) are ROLES, not literals — Brock =
the tenant org, King = its manager/owner operators. Nothing tenant-specific is
hardcoded (CLAUDE.md rule; `docs/phase_two.md` §3).

## 1. Design stance

- **Extend, never fork.** `leads` stays the person/contact record and the
  authority for every Phase 1 surface. An **opportunity** is the *pursuit*: the
  ownership, lifecycle, SLA and orchestration state wrapped around a lead.
  Phase 1 screens keep reading `leads.status`; Phase 2 surfaces read the
  opportunity. One-way sync (disposition routing → opportunity) keeps the two
  honest; parity is checked by the reconcile cron, mirroring the dual-write
  pattern Phase 1 used for call_records ⇄ call_attempts.
- **Separate machines, never one overloaded status** (§5). Sales lifecycle,
  operational work state, appointment confirmation, fulfillment and care are
  independent dimensions. P2.1 implements the first two; appointment
  confirmation lands with P2.5 on the existing `appointments` table;
  fulfillment/care tables land with P2.7/P2.8.
- **Events first.** Every transition writes an append-only
  `opportunity_events` row (immutability trigger, like `call_events`) before
  derived state is trusted. Reconstructibility is the §21 audit requirement.
- **Deterministic engine, advisory AI.** The orchestration engine executes
  playbook definitions deterministically (idempotency keys, locks, kill
  switches). AI proposes (signals, extractions, suggestions); the framework
  decides (§6, §20).

## 2. Entities (PART 37, applied to the live DB)

### opportunities
One row per active pursuit. **Uniqueness policy (§4):** at most ONE open
opportunity per (org, lead) — enforced by a partial unique index
(`status != 'closed'`). Repeat/add-on business = close the old one, open a new
row (lineage via `previous_opportunity_id`).

Columns (abridged; see supabase/schema.sql PART 37 for the full DDL):
- identity: `id`, `org_id`, `lead_id`, `previous_opportunity_id`
- attribution: `source`, `original_source`, `campaign_id` (attribution history
  lives in opportunity_events — never overwritten, §7)
- ownership: `owner_id`, `owner_team`, `assignment_reason`, `owner_assigned_at`
  (prior owners = events)
- sales lifecycle: `stage`, `stage_entered_at`
- operational: `op_status` (`open`/`waiting`/`paused`/`closed`),
  `waiting_until`, `paused_reason`, `next_action_kind`, `next_action_due_at`
- priority: `priority` (int, higher = hotter), `priority_reason`, `hot_until`
- clocks (§7 speed-to-lead): `first_received_at`, `eligible_at`,
  `first_assigned_at`, `first_attempted_at`, `first_contacted_at`,
  `last_touched_at`, `closed_at`, `close_reason`
- counters: `attempt_count`, `contact_count` (repaired from canonical touch
  events by reconcile, never trusted blindly)
- orchestration: `active_playbook_id`, `active_playbook_version`
- provenance: `backfilled` (true for rows created by the P2.1 backfill —
  their clocks are approximations from lead timestamps, and reports must be
  able to say so), `created_at`, `updated_at`

### opportunity_events
Append-only audit: `type`, `actor_kind` (`rep`/`ai`/`system`/`manager`),
`actor_id`, `from_stage`, `to_stage`, `detail` jsonb, `created_at`.
UPDATE/DELETE blocked by trigger (`app_opportunity_events_immutable`).

### work_items
All actionable work, human or automated (§4). `type` (open set:
`first_call`, `follow_up_call`, `callback`, `appointment_confirmation`,
`no_show_recovery`, `hot_response`, `review`, `custom`…), `status`
(`pending`/`reserved`/`in_progress`/`waiting`/`completed`/`canceled`/
`skipped`/`expired`/`blocked`/`needs_review`), `owner_id`/`queue`,
`priority`, `reason`, `due_at`, `scheduled_at`, `timezone`, `escalation_at`,
`source_kind`+`source_id` (originating event), `dedupe_key` — **partial unique
on (org_id, dedupe_key) WHERE status in pending/reserved/in_progress/waiting**:
one trigger can never create duplicate live work, however many times a webhook
or cron replays. Claiming uses `app_claim_work_items` (FOR UPDATE SKIP LOCKED,
TTL lease) — the reservation engine's pattern, not a new one.

### signals
Explainable, time-bound urgency facts (§4, §13): `type`, `severity` 1–5,
`confidence`, `evidence` jsonb, `source_kind`/`source_id`, `detected_at`,
`expires_at`, `acknowledged_by/at`, `resolved_at`, `resolution`
(`actioned`/`expired`/`dismissed`/`false_positive`), `dedupe_key` partial
unique while unresolved (repeat detections bump `last_seen_at` + `seen_count`
instead of stacking rows — no permanent priority inflation).

### playbooks / playbook_instances / playbook_executions
- `playbooks`: versioned definitions. `status`:
  `draft`/`published`/`paused`/`retired`; `version` increments on publish;
  `definition` jsonb validated by `src/lib/orchestration/definition.ts`
  (typed triggers, conditions, steps, stop rules, caps). The AI can never
  write this table (§6) — publish requires an authorized human via the API.
- `playbook_instances`: one activation per opportunity. Partial unique
  (`playbook_id`, `opportunity_id`) while active. `status`:
  `active`/`waiting`/`completed`/`stopped`/`failed`; `current_step`,
  `wait_until`, `stopped_reason`.
- `playbook_executions`: append-only step log. `idempotency_key` UNIQUE —
  the exactly-once business-semantics guarantee (§6): a retried tick that
  re-executes a step hits the conflict and does nothing.

### touches — deliberately a VIEW in P2.1
`touches_v` projects the channel-neutral touch shape (§4) over
`call_records` (direction `outbound`, channel from `channel`+`dial_mode`,
provider ids, timestamps, outcome, actor). The *table* arrives when the first
non-call channel (SMS, P2.3/P2.5) needs write-path rows. Honest status:
Partial — a view can't carry consent-decision or work-item linkage columns.

## 3. Sales lifecycle machine (`src/lib/opportunities/stage-machine.ts`)

Canonical stages and ranks (adapted names per §5, existing terminology kept):

```
new(0) → assigned(1) → attempting(2) → contacted(3) → interested(4)
      → appointment_booked(5) → appointment_completed(6) → sold(7)
```

Alternate/holding: `nurture`, `lost`, `invalid`, `dnc_suppressed`,
`exhausted`, `duplicate`, `disqualified` (terminal-ish; rank −1).

Rules (pure module, exhaustively tested in tests/opportunity-stage.test.ts):
- Forward moves always allowed; backward moves only via an explicit
  human/manager action (`allowRegress`) — a late webhook can never demote.
- `sold` requires `actor_kind` `manager`/`system-fulfillment` — **never** AI,
  never conversation text alone (§5 "Do not infer Sold").
- `dnc_suppressed` is reachable from anywhere and only leaves via a human.
- Every transition records prior stage, new stage, actor, reason, evidence
  ref in `opportunity_events`.

Mapping from Phase 1 `leads.status` (used by sync + backfill):

| leads.status | stage | notes |
|---|---|---|
| new | new (or assigned when assigned_rep_id set) | |
| no_answer | attempting | attempted, never reached |
| contacted | contacted | |
| callback | contacted | + a `callback` work item carries the promise |
| qualified | interested | |
| appointment | appointment_booked | |
| bills_fine | nurture | "not now" is a holding outcome, not a loss |
| not_interested | lost | |
| dnc | dnc_suppressed | |

## 4. Operational work state (§5) — derived, then leak-detected

Every OPEN opportunity must satisfy one of: future `next_action_due_at`;
an open/reserved work item; `op_status='waiting'` with `waiting_until`;
`op_status='paused'` with a reason; else it is a **leak**.
`app_pipeline_leaks(org)` returns exactly the violators — the §17 "no valid
next action" queue and acceptance test ("Pipeline leak count contains no
opportunities with valid next action/intentional pause/closure").

## 5. Orchestration engine v0 (`src/lib/orchestration/engine.ts`)

Deterministic, observable, safe-by-construction (§6). One tick
(`/api/cron/orchestrate`, CRON_SECRET, rides pg_cron):

1. **Kill switches first**: global `app_settings.orchestration_paused`, org
   `settings.orchestration.enabled` (default OFF — no org auto-orchestrates
   unexpectedly), playbook `status='paused'`.
2. **Wake waiting instances** whose `wait_until` passed.
3. **Execute due steps** under a per-opportunity advisory lock
   (`pg_advisory_xact_lock(hashtext(opportunity_id))`) with an
   `idempotency_key` = `instance:step:scheduled_at` — the UNIQUE insert into
   playbook_executions is the exactly-once gate; only then does the action run.
4. **Stop rules** before every action: DNC/opt-out, closed/paused opportunity,
   ownership change (when `stopOnReassign`), max attempts, frequency caps.
5. **Action allow-list v0**: `create_work_item`, `set_next_action`,
   `escalate` (notification outbox), `stop`. Channel actions (calls, SMS)
   are NOT executable in P2.1 — the definition validator rejects them, so a
   published playbook cannot promise what the engine can't safely do yet.
   They unlock with their workstreams (P2.3/P2.5), each behind consent/quiet
   -hour policy checks.
6. Failures: retry with backoff columns on the execution row; terminal
   failures mark the instance `failed` and surface in the ops queue.

## 6. Sync hooks (Phase 1 write paths → opportunity)

`src/lib/opportunities/sync.ts`, called fire-and-forget from
`insertCallRecord` / `completeAIConversation` post-routing (same idempotent,
never-throws contract as analyzeCall):
- stamp `first_attempted_at`/`first_contacted_at`/`last_touched_at`,
  bump counters;
- advance stage per the §3 mapping (forward-only);
- complete the originating open `work_item` (matched by lead + open call-type
  item), never duplicating on outbox replay (the 23505 no-op path skips the
  hook exactly like it skips routing).

## 7. Backfill (idempotent; ran against the live DB)

One `insert … select … on conflict do nothing` per org creates an
opportunity for every non-archived lead (37.8k rows at time of writing),
`backfilled = true`, stage per the §3 mapping, clocks approximated:
`first_received_at = leads.created_at`, `last_touched_at =
leads.last_attempt_at`, `attempt_count = leads.attempt_count`. Rollback =
`delete from opportunities where backfilled` (plus dependent events) — safe
because no Phase 1 surface reads the table.

## 8. What P2.1 explicitly does NOT do (honest scope)

- No touch TABLE (view only, §2), no message/email channels.
- No inbound reception, appointment-protection, no-show, fulfillment,
  care, or reactivation entities (their workstreams own their DDL).
- No Playbook Studio UI (P2.10) — definitions are API/seed-only; templates
  ship as validated JSON in `src/lib/orchestration/templates.ts`.
- The engine executes only the v0 action allow-list above.
- `leads.status` remains the reporting authority until the §27 parity
  criterion (zero drift across the sync for 14 consecutive days) — the same
  dual-write cutover discipline Phase 1 used.
