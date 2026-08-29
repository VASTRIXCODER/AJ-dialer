# Phase 2 — Playbook definition & orchestration execution contracts

The precise jsonb contract for `playbooks.definition` and the execution semantics
around it, elaborating `opportunity-domain-and-state-machines.md` §2/§5 (the
design authority) and `docs/phase_two.md` §6/§18. **Status: contract spec — the
build targets (`src/lib/orchestration/definition.ts` validator,
`src/lib/orchestration/engine.ts`, `src/lib/orchestration/templates.ts`, schema
PART 37) are P2.1 work and are NOT yet in the repo.** Nothing below is claimed
as shipped. Brock/King are roles (tenant org / manager), never literals.

## 1. Non-negotiables (inherited, restated)

- **Deterministic engine, advisory AI.** AI may propose; only the engine
  executes, and **AI may never write the `playbooks` table** — publish requires
  an authorized human through the API (design doc §2 "playbooks").
- **Definitions are data, never code.** No template strings that reach SQL, no
  eval, no raw predicates. Conditions reuse the FilterSpec philosophy proven in
  `src/lib/leads/filter-spec.ts`: whitelisted keys, per-type comparator
  whitelist, size caps, sanitize-and-DROP (a half-corrupt definition degrades,
  it does not error into a blank screen) — but a **publish** validation is
  strict: anything that would be dropped *fails* publish. Drop-semantics apply
  only to reading already-stored definitions.
- **A published playbook may never promise what the engine can't do.** Reserved
  step kinds validate-fail until their workstream lands (§4).

## 2. Top-level definition shape (`schemaVersion: 1`)

```jsonc
{
  "schemaVersion": 1,
  "key": "speed_to_lead",            // stable slug, unique per org
  "name": "Speed to lead",           // display, org-editable
  "trigger": Trigger,                // exactly one (§3)
  "eligibility": ConditionGroup,     // typed, §5 — evaluated at activation AND before every step
  "steps": [Step, ...],              // ordered, 1..30; ids unique (§4)
  "stop": StopPolicy,                // §7 — required; publish fails without ≥1 stop rule
  "caps": FrequencyCaps,             // §8 — optional, defaults apply
  "reentry": { "allow": false, "cooldownHours": 0 },  // may one opportunity run this playbook again after completion?
  "routing": { "queue": "string?", "escalateTo": "owner|managers|queue" } // defaults for escalate steps
}
```

`playbooks` row: `status` `draft`→`published`→`paused`/`retired`; `version`
increments on every publish; the published `definition` is immutable —
edits happen on a draft copy. `playbook_executions.playbook_version` stamps the
exact version used for every action (prompt §4 "Playbook definition").

## 3. Triggers — three kinds, one per playbook

| kind | shape | semantics | v0 status |
|---|---|---|---|
| `event` | `{ "kind": "event", "event": "<name>", "filter": ConditionGroup? }` | Activates an instance when the canonical event fires for an opportunity | v0 |
| `schedule` | `{ "kind": "schedule", "cron": "0 9 * * *", "timezone": "org" }` | Activates for every currently-eligible opportunity at the tick | v0 |
| `sweep` | `{ "kind": "sweep", "intervalMinutes": 15 }` | Periodic eligibility sweep: eligibility IS the trigger (e.g. "overdue callback exists") | v0 |

Event vocabulary (validator whitelist; emitters land with their workstreams):
`lead.received`, `opportunity.assigned`, `call.completed` (P2.1 sync hooks),
`message.received` (P2.3+), `appointment.booked` / `appointment.unconfirmed` /
`appointment.no_show` (P2.5), `inbound.callback` (P2.4), `sale.recorded` /
`install.stage_changed` / `installed` (P2.7), `customer.issue` (P2.8). An event
name whose emitter hasn't landed still validates (it just never fires); a
*step kind* without its workstream does not (§4) — events are inert, actions are not.

Activation dedupe: partial unique on (`playbook_id`, `opportunity_id`) while the
instance is active — sweeps and event replays cannot stack instances. Re-running
after completion is governed by `reentry` (default: never).

## 4. Steps — v0 allow-list vs RESERVED kinds

Execute kinds (v0 — the complete allow-list):

- `create_work_item` — `{ "type": "first_call|follow_up_call|callback|hot_response|review|custom", "reason": "slug", "dueInMinutes": n | "dueAtLocalTime": "HH:MM", "priority": 0-100, "queue"?: string }`. The engine sets `work_items.dedupe_key = <instanceId>:<stepId>` so replays can't duplicate live work (design doc §2 "work_items").
- `set_next_action` — `{ "kind": "slug", "dueInMinutes"| "dueInDays": n }` → stamps `opportunities.next_action_kind/next_action_due_at`.
- `escalate` — `{ "to": "owner|managers|queue", "reason": "slug" }` → notification outbox row; never a customer contact.
- `stop` — end the instance with `stopped_reason`.

Control constructs (v0): `wait` — `{ "kind": "wait", "for": { "minutes"|"hours"|"days": n } | { "untilLocalTime": "HH:MM", "timezone": "lead" } }`. Sets instance `status='waiting'`, `wait_until`; the tick wakes it. `untilLocalTime` resolves in the **lead's timezone** (falling back to org tz), per prompt §6 "delays relative to events in the local timezone".

RESERVED kinds — the validator **rejects the definition at publish** until the
owning workstream ships the kind behind consent/quiet-hour/frequency policy:
`send_sms` (P2.3/P2.5), `place_ai_call` (P2.3), `send_email` (future),
`branch` and `wait_for_event` (P2.3 — v0 is linear; conditionality comes from
stop rules evaluated between steps, see §7 and the templates), `propose_stage`
(P2.3 review flow). This is the "cannot promise what the engine can't safely
do" rule made mechanical.

Approval gates: any execute step may set `"requiresApproval": true`. The engine
then creates a `review` work item carrying the frozen action payload instead of
executing; an authorized human's approval executes it **under the original
idempotency key**, so approve-twice is still once.

## 5. Condition grammar (eligibility + trigger filters)

`ConditionGroup = { "all": [Cond|Group] } | { "any": [Cond|Group] }` — nested
AND/OR exactly like FilterSpec, max depth 3, max 32 conditions.
`Cond = { "key": "<whitelisted>", "cmp": "<FilterCmp>", "value": ? }` reusing
the comparator set and per-type rules of `src/lib/leads/filter-spec.ts`
(eq/in/contains/gt/between/within_days/older_than_days/is_true/…, null-as-""
for text, numeric-cmp-over-non-numeric matches nothing).

Key whitelist (typed; unknown keys fail publish):

- `opportunity.*`: `stage`, `op_status`, `priority`, `owner_id`, `campaign_id`,
  `source`, `attempt_count`, `contact_count`, `next_action_due_at`,
  `last_touched_at`, `hot_until`, `created_at`
- `lead.*`: the existing `FilterFieldKey` set (`dnc`, `phone_valid`, `timezone`,
  `state`, `lead_group`, custom fields via `custom.<key>`, …) — one grammar,
  not a second one
- `derived.*` (computed by the engine, no SQL from the definition):
  `minutes_since_last_touch`, `callback_overdue_minutes`,
  `next_action_overdue_minutes`, `open_work_item_types` (array)
- `touch.*` (event-trigger filters only): `outcome`, `direction`, `channel`

No raw SQL anywhere: the compiler maps whitelisted keys to known columns/
expressions, values are bound parameters, mirroring the FilterSpec → SQL parity
discipline (`tests/filter-evaluator.test.ts` is the precedent to copy).

## 6. Execution: idempotency, locks, retry

- **Idempotency key** = `` `${instanceId}:${stepId}:${scheduledAtIso}` `` where
  `scheduled_at` is the step's *computed* due time (derived from instance
  state, never `now()`, so retries reproduce it). UNIQUE on
  `playbook_executions.idempotency_key` is the exactly-once gate: insert first,
  act only if the insert won (design doc §5.3).
- **Per-opportunity lock**: `pg_advisory_xact_lock(hashtext(opportunity_id))`
  around each step — two tick workers can't race one opportunity; also the
  prompt's "per-opportunity execution locks".
- **Tick** (`/api/cron/orchestrate`, CRON_SECRET, scheduled from Supabase
  pg_cron like the Phase 1 crons in `supabase/cron.sql`): kill switches → wake
  `wait_until <= now()` → evaluate stop rules → execute due steps.
- **Retry/backoff**: transient failure → `attempts+1`,
  `next_retry_at = now() + 1min·2^attempts` (cap 1h), max 5 attempts, then the
  execution is terminal-failed and the instance is `failed` (ops failure
  queue). Policy blocks (DNC, closed opportunity, cap hit) are **not** retried
  — they resolve as `stopped`/`skipped`, distinct from failure.
- **Compensation**: reassignment (when `stopOnReassign`), suppression,
  appointment reschedule, or playbook pause cancels pending waits and open
  playbook-created work items for that instance.

## 7. Stop rules — evaluated before EVERY action

`StopPolicy = { "rules": [slug…], "maxAttempts": n?, "stopOnReassign": bool }`.
Rule slugs (validator whitelist): `contacted`, `attempted`, `replied`,
`callback_set`, `callback_completed`, `appointment_booked`, `sold`,
`dnc_or_opt_out` (always enforced even if omitted), `complaint`, `open_issue`,
`opportunity_closed` (always enforced), `manager_pause`. Because v0 is linear,
**stop rules are the branching mechanism**: "escalate only if still untouched"
= wait step + `attempted` stop rule (see template 1).

## 8. Frequency caps

`FrequencyCaps = { "touchesPerDay": n, "touchesPer7Days": n, "perChannel": { "call": {…}, "sms": {…} } }`.
Counted against **canonical touches** (`touches_v`), not against intents — a
failed send doesn't burn the cap, a rep's manual call does. Caps are per
opportunity across ALL playbooks (org-level policy floor), with per-playbook
tightening only. Cap hit ⇒ step `skipped` with reason, never queued-forever.

## 9. Versioning, publish, rollback

- `draft` → validate (strict) → simulate (P2.10 UI; API-level dry-run in P2.1:
  evaluate eligibility + step plan against sampled opportunities, zero writes)
  → `publish` (authorized human, `playbooks.publish` permission; version++).
- Running instances keep the version they started on; new activations use the
  latest published version. **Rollback** = republish a retained prior
  definition as a new version (history is never rewritten; every execution
  keeps its true `playbook_version`).
- `paused` stops new activations AND freezes ticks for existing instances;
  `retired` additionally stops instances (with `stopped_reason='retired'`).
- Immutable audit: publish/pause/retire/rollback each write an audit event with
  actor — the §21 requirement.

## 10. Kill-switch hierarchy (checked in this order, every tick)

1. Global: `app_settings.orchestration_paused` (superadmin).
2. Org: `settings.orchestration.enabled` — **default OFF**; no org ever
   auto-orchestrates by surprise.
3. Playbook: `status = 'paused'`.
4. Opportunity: stop rules (§7) — DNC/opt-out, closed, paused-with-reason,
   manager pause.

A tripped switch stops *new actions*; in-flight state and the audit trail are
preserved (prompt §25 "Kill switch prevents new actions while preserving…").

## 11. P2.1 seed templates (`src/lib/orchestration/templates.ts` — planned)

Configurable starting points, not hard-coded behavior (prompt §18). Ship as
validated JSON the org can clone into a draft.

**1 — Speed-to-lead** (escalation only fires if still untouched, via `attempted` stop rule):
```json
{ "schemaVersion": 1, "key": "speed_to_lead",
  "trigger": { "kind": "event", "event": "lead.received" },
  "eligibility": { "all": [
    { "key": "opportunity.stage", "cmp": "in", "value": ["new", "assigned"] },
    { "key": "lead.dnc", "cmp": "is_false" } ] },
  "steps": [
    { "id": "first_touch", "kind": "create_work_item", "type": "first_call", "reason": "speed_to_lead", "dueInMinutes": 5, "priority": 90 },
    { "id": "grace", "kind": "wait", "for": { "minutes": 15 } },
    { "id": "alert", "kind": "escalate", "to": "managers", "reason": "speed_to_lead_breach" } ],
  "stop": { "rules": ["attempted", "dnc_or_opt_out", "opportunity_closed", "manager_pause"], "stopOnReassign": false } }
```

**2 — No-answer follow-up** (multi-touch, capped, lead-local timing):
```json
{ "schemaVersion": 1, "key": "no_answer_follow_up",
  "trigger": { "kind": "event", "event": "call.completed",
    "filter": { "all": [ { "key": "touch.outcome", "cmp": "in", "value": ["no_answer", "busy", "voicemail"] } ] } },
  "eligibility": { "all": [
    { "key": "opportunity.stage", "cmp": "in", "value": ["attempting", "contacted"] },
    { "key": "opportunity.attempt_count", "cmp": "lt", "value": 6 } ] },
  "steps": [
    { "id": "w1", "kind": "wait", "for": { "untilLocalTime": "10:00", "timezone": "lead" } },
    { "id": "t1", "kind": "create_work_item", "type": "follow_up_call", "reason": "no_answer_retry", "priority": 60 },
    { "id": "w2", "kind": "wait", "for": { "days": 2 } },
    { "id": "t2", "kind": "create_work_item", "type": "follow_up_call", "reason": "no_answer_retry", "priority": 50 },
    { "id": "park", "kind": "set_next_action", "next": { "kind": "nurture_review", "dueInDays": 30 } } ],
  "stop": { "rules": ["contacted", "callback_set", "appointment_booked", "dnc_or_opt_out", "opportunity_closed", "manager_pause"], "maxAttempts": 4 },
  "caps": { "touchesPerDay": 1, "touchesPer7Days": 3 },
  "reentry": { "allow": true, "cooldownHours": 72 } }
```

**3 — Promised-callback protection** (sweep; eligibility IS the trigger):
```json
{ "schemaVersion": 1, "key": "promised_callback_protection",
  "trigger": { "kind": "sweep", "intervalMinutes": 15 },
  "eligibility": { "all": [ { "key": "derived.callback_overdue_minutes", "cmp": "gte", "value": 10 } ] },
  "steps": [
    { "id": "nudge_owner", "kind": "escalate", "to": "owner", "reason": "promised_callback_overdue" },
    { "id": "grace", "kind": "wait", "for": { "minutes": 60 } },
    { "id": "hot", "kind": "create_work_item", "type": "hot_response", "reason": "callback_breach", "queue": "hot", "priority": 95 },
    { "id": "alert", "kind": "escalate", "to": "managers", "reason": "callback_breach" } ],
  "stop": { "rules": ["callback_completed", "contacted", "dnc_or_opt_out", "opportunity_closed", "manager_pause"] },
  "reentry": { "allow": true, "cooldownHours": 24 } }
```

## 12. Honest status

Everything in this document is contract, not shipped code: schema PART 37, the
validator, engine, templates, `/api/cron/orchestrate`, and the dry-run API are
the P2.1 build; the FilterSpec grammar and pg_cron/CRON_SECRET patterns cited
are the Phase 1 code being reused. When P2.1 lands, this file and the domain
doc must be updated together — the validator is the executable form of §2–§8
and any divergence is a bug in one of the two.
