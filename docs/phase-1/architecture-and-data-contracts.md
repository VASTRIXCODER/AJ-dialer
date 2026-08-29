# Phase 1 — Architecture & Data Contracts

Target architecture after Phase 1, and the contracts each subsystem may rely on. Companion docs: `call-state-machine.md` (transition rules), `metric-glossary.md` (definitions), `migration-and-rollback.md` (schema sequencing).

## Entity map (new + changed)

```
organizations ─┬─ organization_members (roles, overrides, caller_ids)
               ├─ leads ── custom_fields jsonb · import_job_id · archived_at · dialing_preference
               │     │      attempt_count · last_attempt_at · next_eligible_at
               │     │      reserved_by · reserved_until          ← reservation lives ON the lead
               │     ├─ lead_events        (per-lead audit: status/assignment/dnc/field/note)
               │     └─ lead_packs         (= assignments: status, priority, due_date, dialing_mode,
               │            │               max_attempts, cooldown_hours, ordering, source, filter_snapshot)
               │            └─ assignment_events (audit)
               ├─ import_jobs (+ import_mapping_templates)
               ├─ smart_lists (dynamic saved queries: FilterSpec jsonb + saved view config)
               ├─ campaigns (audience, dialing_policy, caller_ids, retry_policy, disposition_keys, goals)
               ├─ call_attempts ─┬─ call_legs (provider legs)
               │                 └─ call_events (immutable, idempotent)
               ├─ call_records   (reporting projection; + attempt_id, client_attempt_id,
               │                  human_connected, talk_sec; unique on client key/room/conversation)
               ├─ call_artifacts (AI/human summaries etc.; append-only supersede chain)
               ├─ call_transcript_segments (+ transcript_cursors)
               ├─ call_review_queue (needs-review dispositions)
               ├─ appointments · callbacks (+ claim columns) · dnc_numbers
               ├─ export_audit · ops_metrics · audit_log
               └─ realtime: broadcast channel org:{orgId}:floor (RLS on realtime.messages)
```

## Write-path ownership (who may write what)

| Data | Sole writer | Everyone else |
|---|---|---|
| `call_events` | `applyCallEvent()` (service role) | read-only forever (trigger blocks UPDATE/DELETE) |
| `call_attempts.state` + timestamps | `applyCallEvent()` CAS | read |
| `call_attempts.transport_outcome/terminal_reason` | `applyCallEvent()` once (+ sanctioned `attempt.reconciled` upgrade) | never rewritten by rep/AI input |
| `call_attempts.disposition` | `recordDispositionFiled()` (wrap-up / AI policy / review resolution) | — |
| `call_records` | `insertCallRecord` (idempotent via 23505 recovery) + narrow webhook backfills (recording_url, verdict cols, summary) | read |
| `leads.reserved_by/reserved_until` | claim/release/renew RPCs only | read |
| `leads.attempt_count/last_attempt_at/next_eligible_at` | `app_mark_lead_attempted` + reconcile-data repair | read |
| `leads.status` | `routeDisposition` + `updateLead` (guarded) | — |
| `lead_events` / `assignment_events` / `export_audit` | fire-and-forget service-role loggers | read (org-scoped) |
| `call_artifacts` | `analyze-call.ts` (AI rows) + human edits (superseding rows). AI may NEVER supersede a `source='human'` row | read |
| `call_transcript_segments` | transcript relay (live) + post-call webhook (authoritative reconcile) — idempotent on `(conversation_id, turn_index)` | read |
| Broadcast events | `publishOrgEvent()` (service role) only — clients can never forge broadcasts (insert policy allows presence only) | subscribe |

## Contracts

### Eligibility (the twin rule)
`evaluateEligibility(lead, ctx)` in `src/lib/dialer/eligibility.ts` and the WHERE clause of `app_claim_dial_leads` are the same predicate, kept in lockstep by comment convention (the established `app_leads_page` pattern). Evaluated at reservation AND immediately before provider initiation. Precedence: DNC and blocked statuses beat everything, including the callback exception; a due callback bypasses cooldown/max-attempts only.

### Reservation
Claim = single-row CAS with `FOR UPDATE SKIP LOCKED`, TTL 180s, heartbeat renew; expired holds are simply claimable (no sweeper). Kill switch: `organizations.settings.dialing.reservations` (default on). Claims/releases audited as `call_events`.

### FilterSpec
`src/lib/leads/filter-spec.ts` — root op + ≤8 groups × ≤8 conditions, whitelisted field keys + per-type operators. Executors: TS evaluator (tests/demo/preview) and `app_filter_leads` (plpgsql walker; column/op whitelists; every value through `%L`). The same spec object drives: leads table (`?f=`), smart lists, assignment allocation, exports, report drill-downs, campaign audiences. Parity is contract-tested by a shared fixture.

### Dispositions
`call_records.outcome` stores only the canonical 9 `CallOutcome` keys — historical queries and `routeDisposition` never change. Org-specific taxonomy = `DispositionDef[]` in org settings; a custom def carries a `behavior` that maps to a canonical outcome (`BEHAVIOR_TO_OUTCOME`); the chosen def key is stored in `call_records.disposition`. Stored keys never move.

### Metrics
All surfaces consume `src/lib/metrics/service.ts` (backed by `app_metrics_summary`/`app_metrics_hourly`). Definitions live in `src/lib/metrics/definitions.ts` and render as tooltips. Canonical connect = `coalesce(human_connected, outcome ∈ CONNECTED_OUTCOMES)`. Org timezone = `orgTimezone(org)` (fallback America/Chicago); week start = `settings.reporting.weekStart`. Drift is checked by `/api/cron/reconcile-data` and logged to `audit_log`.

### Realtime
One private broadcast channel per org: `org:{orgId}:floor`. Server publishes via stateless HTTP (`publishOrgEvent`) from webhook/store choke points; join authorized by RLS on `realtime.messages` (`app_can_join_org_topic` — active-org membership). Presence via the Realtime presence extension. Merge rule: webhook-driven call state (`live_calls`/attempts) beats self-reported presence; absent presence = offline. Every consumer keeps a slow poll fallback + snapshot refetch on (re)subscribe — demo mode and outages degrade to polling, never to wrong data.

### As-built deltas (vs the original plan)

- **PART numbering** follows file/apply order: 22 ops_metrics … 36 call-intelligence (see migration-and-rollback.md for the authoritative ledger). All applied to the live DB 2026-08-28.
- **Attempts are per-LEAD**: a 3X parallel round shares one `room` across three attempts, unique on `(room, lead_id)`; the status callback URL carries both, which is how webhooks resolve their attempt.
- **Broadcast contract** (E1): events `call.state`, `call.answered`, `transcript.segment`, `leaderboard.delta`, `review.created` on `org:<id>:floor`; the topic validator is LOCKSTEP with `app_can_join_org_topic`.
- **Artifact supersede rule** (F1): edits insert a superseding row; an AI writer skips any kind with an active `source='human'` row — enforcement is in `analyze-call`/`call-artifacts`, tested.
- **`completed` vs `dispositioned`**: the human path's practical terminal state is `dispositioned`; the reconcile-data job may advance old rows to `completed`. Reporting treats both as closed.

### Dual-write & cutover
During Phase 1, events/attempts are written alongside the legacy rows (events first). `call_records` remains authoritative for reporting until the traceability matrix marks the reader cutover done; `reconcile-data` repairs parity drift meanwhile. Exit criteria for full cutover (Phase 2): zero parity discrepancies for 14 consecutive days.
