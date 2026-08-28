# Phase 1 — Canonical Call State Machine

One explicit, validated state machine for every call attempt, replacing four scattered vocabularies. Implemented as a pure transition table in `src/lib/calls/state-machine.ts`, enforced by the single ingester `src/lib/calls/apply-event.ts`, persisted in `call_attempts` / `call_legs` / immutable `call_events` (schema.sql PART 22).

## Concepts

- **Attempt** (`call_attempts`) — the business-level decision to dial one lead once. Exactly one canonical terminal transport outcome; carries the business disposition once filed. `call_records` remains the reporting projection of an attempt.
- **Leg** (`call_legs`) — a provider call leg. Parallel dialing creates several legs per attempt round; transfers/bridges create rep/agent legs. Legs carry raw provider status; they never ARE the attempt state.
- **Event** (`call_events`) — immutable, append-only (trigger-blocked UPDATE/DELETE even for service role). Fields: source, canonical event_type, provider_event_id (dedupe fingerprint), event_time (provider clock), ingested_at (our clock), payload + payload_version.

## States

```
queued → reserved → dialing → ringing ─┬→ human_connected ────┐
                                       ├→ voicemail_connected ┤
                                       ├→ busy                ├→ wrap_up → dispositioned → completed
                                       ├→ declined            │      (wrap_up optional; terminal
                                       ├→ no_answer           │       states may go straight to
                                       ├→ failed              │       dispositioned/completed)
                                       └→ canceled ───────────┘
```

Rank order (monotonic): queued 0 · reserved 1 · dialing 2 · ringing 3 · human_connected / voicemail_connected 4 (equal-rank alternates — first CAS wins) · busy / declined / no_answer / failed / canceled 5 (transport-terminal alternates) · wrap_up 6 · dispositioned 7 · completed 8.

## Rules (enforced, tested)

1. **Idempotent**: duplicate events die at the `call_events (source, provider_event_id)` unique index before any state logic runs. Twilio fingerprint = `CallSid:CallStatus:SequenceNumber`; ElevenLabs = the webhook's own event id.
2. **Out-of-order-safe**: `decideTransition(current, incoming)` returns `duplicate` (same state), `stale` (lower/equal rank arriving late), or `ok` with the exact `allowedFrom` list the SQL CAS guard uses (`update … where state in (allowedFrom)`). A lost CAS is reported, never thrown.
3. **Timestamps fill once**: `<state>_at = coalesce(<state>_at, now())` — a late duplicate can never reset `connected_at` (the rule `records.ts` already applied to AI calls, now table-driven).
4. **One sanctioned upgrade**: `attempt.reconciled` (source `cron`/webhook late-truth) may rewrite a **non-connected** terminal verdict to a connected one — the existing `completeAIConversation` "no_answer → connected when the transcript proves a human talked" correction, formalized. Nothing else moves a terminal state.
5. **Legs ≠ attempt**: a leg's `completed` status maps to **no** attempt transition (`twilioStatusToState → null`) — a leg ending is not a verdict. Customer-leg `in-progress` maps to `human_connected` or `voicemail_connected` by `AnsweredBy` (`machine_*` ⇒ voicemail).
6. **Transport vs business**: `transport_outcome` + `terminal_reason` (raw provider words) are stamped exactly once and are never rewritten by rep input or AI analysis; `disposition` (a `CallOutcome` key) is filed separately at wrap-up. Enrich, never rewrite.
7. **Reservation events are auditable**: claims/releases/expiry are recorded as `call_events` with `source='app'`.
8. **Every transition is auditable**: the event row that caused it precedes it (events-first write order; a crash after the event insert is repaired forward by the reconciler).

## Provider mapping

| Provider signal | Canonical event | Target state |
|---|---|---|
| Twilio `initiated` (customer leg) | `leg.initiated` | dialing |
| Twilio `ringing` | `leg.ringing` | ringing |
| Twilio `in-progress` / `answered`, AnsweredBy human/unknown | `leg.answered` | human_connected |
| Twilio `in-progress`, AnsweredBy `machine_*` (or AMD callback) | `leg.machine_detected` | voicemail_connected |
| Twilio `busy` | `leg.busy` | busy |
| Twilio `no-answer` | `leg.no_answer` | no_answer |
| Twilio `failed` | `leg.failed` | failed |
| Twilio `canceled` | `leg.canceled` | canceled |
| Twilio `completed` | `leg.completed` | (leg end only — no attempt transition) |
| EL `post_call_transcription` | `attempt.completed` (+`disposition.filed` when it files an outcome) | completed (may upgrade per rule 4) |
| Rep wrap-up opens | `wrap.started` | wrap_up |
| Disposition saved | `disposition.filed` | dispositioned |
| Reconciler force-finalize | `attempt.reconciled` | completed |

## Where it's enforced

- `applyCallEvent()` (`src/lib/calls/apply-event.ts`) — the ONE write path: insert event (on conflict do nothing ⇒ duplicate short-circuit) → resolve/create attempt (upsert by conversation_id / room / client_attempt_id) → upsert leg by provider SID → CAS transition → terminal stamps. Best-effort: catches, logs, never throws into a webhook.
- Wired from: `/api/twilio/status`, `/api/twilio/amd`, `/api/elevenlabs/webhook`, `placeAiCallForLead`, `/api/twilio/call`, the wrap-up/disposition path, and `/api/cron/reconcile-ai` (+`reconcile-data`).
- Legacy writes (`live_calls`, `ai_conversations` CAS, `call_records`) continue during the dual-write phase; `call_records` gains idempotency keys (`client_attempt_id` / `room` / `conversation_id` partial unique indexes) so the projection cannot duplicate either.

## UI consumption

`StatusPill` (`src/components/ui/status-pill.tsx`) is the single state→{color, icon, label} map — never color-only. Surfaces show state-start time, elapsed duration, last-event time, and stale/reconnecting indicators fed by event `ingested_at` vs now.
