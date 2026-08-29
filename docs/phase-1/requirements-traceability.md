# Phase 1 — Requirements Traceability Matrix

Every major requirement from `docs/phase_one.md` → owning workstream/slice → status → evidence. Statuses: **Done / Partial / Blocked / Deferred / Not started**. Updated before every checkpoint push.

## §3 Canonical domain & events

| Requirement | Slice | Status | Evidence |
|---|---|---|---|
| Immutable idempotent call events (event id, provider id, times, source, payload version) | B2 | **Done** | call_events + applyCallEvent; tests/call-state-machine |
| Provider legs distinct from business attempt | B2 | **Done** | call_attempts + call_legs; (room, lead_id) per-lead attempts |
| One canonical terminal outcome + raw provider reason retained | B2 | **Done** | transport_outcome stamped once + terminal_reason |
| Disposition ≠ transport outcome | B2 + D3 | Not started | |
| Canonical state machine (queued→…→completed), duplicate/out-of-order safe | B1/B2 | **Done** | state-machine.ts (14×14 tested) + CAS in apply-event |
| Reservation/locking prevents concurrent dialing of one lead | B3 | **Partial** | engine + claim routes live; AI cron claims; manual dialer switchover lands in E3 |
| Every state transition auditable | B2 | **Done** | events-first write order; append-only trigger |
| Custom fields preserved with provenance; unknown columns never dropped | C5 (exists partially) | Partial | custom_fields jsonb exists; provenance lands with import_jobs |
| Audit history (leads, assignments, dispositions, DNC, appointments) | C1/D1 | **Done** | lead_events hooks + assignment_events; timeline renders them |
| Saved views / smart lists as first-class data | C3 | **Done** | smart_lists table + builder + seeds |

## §4 Analytics & dashboard sync

| Requirement | Slice | Status | Evidence |
|---|---|---|---|
| Metric glossary + single metrics layer for all surfaces | B4 | **Done** | definitions.ts + app_metrics_summary/hourly; metrics.ts unified; reports consumption completes in F2 |
| Defined: calls today, human connects, connect rate, appts set, avg talk, weekly, outcome mix, hourly, pipeline | B4 | **Done** | live-probed: outcome mix reconciles exactly (11,055+11=11,066) |
| Near-real-time dashboard updates / invalidation | E1 | Not started | |
| Late events repair aggregates; scheduled reconciliation | B4 | **Done** | reconcile-data cron every 15 min (drift → audit_log) |
| Filters: tenant, permission, date/tz, campaign, team, rep, mode | B4/F2 | Not started | |
| Last-updated, filter chips, tz, definition tooltips | F2 | Not started | |
| Deterministic fixture + DST + parity tests | B1/B4 | Not started | |
| **Remove Average AI Score** | B4 | **Done** | aggregate gone (4 sites + app_leads_page); per-lead score retained per D6 |

## §5 Lead 360

| Requirement | Slice | Status | Evidence |
|---|---|---|---|
| One reusable Lead 360 from every surface; stable deep-linkable route | C1 | **Done** | drawer (?lead=) + /leads/[id]; 9 surfaces wired |
| Identity, company, lead-provided vs inferred number location (labeled) | C1 | **Done** | LocationSection labels the area-code inference |
| Source/campaign/pack/owner/eligibility; DNC state + audit | C1 | **Done** | eligibility reason pills via evaluateEligibility |
| All custom fields grouped + raw-value toggle | C1 | **Done** | |
| Chronological activity timeline (attempts, transitions, notes, callbacks, appts, recordings, assignments) | C1 | **Done** | mergeTimeline over 5 sources; reschedule never double-counts (tested) |
| Editable notes; recordings + transcript; AI summary with confidence/override history | C1/F1 | Not started | |
| Context preserved on close; live-updating | C1 | **Done** | history.replaceState ?lead= (no RSC refetch); 20s visible-poll + focus refetch |

## §6 Lead inventory, import, filters, smart lists, export

| Requirement | Slice | Status | Evidence |
|---|---|---|---|
| Accurate drillable lead totals (8 defined counts) | C2 | **Done** | app_lead_counts + LeadCountsRow tiles → ?f= drill |
| Import Studio: guided, resumable, preview + manual mapping correction | C5 | **Done** | /leads/import wizard |
| Mapping templates | C5 | **Done** | import_mapping_templates |
| Dedupe strategies (skip/merge/create) + dry run + idempotent retry | C5 | **Done** | app_phone_matches probe; tests/import-dedupe |
| DNC column detection; imported DNC stored but ineligible | C5 | **Done** | status dnc + dnc_numbers(source import) |
| Dialing-preference mapping (ai/manual/either/none) | C5 | **Done** | leads.dialing_preference |
| Observable import job + rollback + reconciliation report + error file | C5 | **Done** | import_jobs; rollback removes only provably-untouched rows |
| Headerless files import without losing row 1 | C5 | **Done** | fixed at BOTH layers; tests/csv-headerless incl. single-row regression |
| TSV; XLSX | C5 | Not started | XLSX → **Deferred** (no vetted lib) |
| One typed server-side filter system (nested AND/OR, custom fields, attempt/DNC/eligibility fields) | C2 | **Done** | FilterSpec + app_filter_leads (whitelist compiler) + parity fixture |
| Smart Lists 2.0 (dynamic saved queries, sharing, validation) | C3 | **Done** | |
| Flexible export (field chooser, templates, formats, current filter, audit, masking, formula-injection safe) | C4 | **Done** | streaming POST + export_audit + leads.export perm |
| Background generation for large exports | C4 | **Deferred** | no worker on Hobby; synchronous streaming + 50k cap + honest warning |

## §7 Assignments & eligibility

| Requirement | Slice | Status | Evidence |
|---|---|---|---|
| Packs become assignments (status/priority/due/mode/policy) | D1 | Not started | |
| Manager Assignment Center (capacity, allocate N, preview exclusions, rebalance/reclaim, audit) | D1 | Not started | |
| Rep My Assignments (lanes, continue, skip reasons, follow-up queues) | D1 | Not started | |
| Disposition-driven routing configurable & deterministic | D3 | Not started | |
| One concurrency-safe eligibility engine for manual/AI/parallel | B3 | Not started | |
| Never-dialed-first default; retry only via rule/callback/override | B3 | Not started | |
| Atomic reservation + idempotent call creation | B2/B3 | Not started | |

## §8 Dialer & Live Floor

| Requirement | Slice | Status | Evidence |
|---|---|---|---|
| Shared dialer shell (mode, progress, readiness, state+elapsed, next-up, history, realtime health, kbd, wrap-up) | E3 | Not started | |
| Manual cockpit: click-to-call, teleprompter, keypad, timer, audio device selection | E3 | Not started | |
| Pre-answer mute, honest capability handling | E3 | Not started | |
| AI dialer view (agent/script, AI state, live transcript, monitor/intervene, delay indicators) | E4 | Not started | |
| Parallel multi-lane workspace; no duplicate lead/phone across lanes | E4 | Not started | |
| Live floor: accurate presence, filters, density, detail panel, stale indicators, no guessed status | E2 | Not started | |
| Real-time channel (authenticated, tenant-scoped, reconnect/backoff, gap repair; no aggressive polling) | E1 | Not started | |
| Call history rows complete + Lead 360 access | E3 | Not started | |
| Pre-call talking points from verified data only; post-call notes with provenance | F1 | Not started | |

## §9–§10 Status workflows, appointments, callbacks

| Requirement | Slice | Status | Evidence |
|---|---|---|---|
| Distinct visual/semantic transport outcomes; webhook-authoritative | E3 (StatusPill) | Not started | |
| Required/default disposition per campaign; autosaved wrap-up drafts | E3 | Not started | |
| Needs-review routing for uncertainty | F1 | Not started | |
| Appointments: views, tz clarity, conflict detection, reliable counts | exists / F2 parity | Partial | workspace exists; conflict detection Deferred |
| Callback workspace (lanes, claim/reservation, reschedule/reassign, escalation, cooldown-override policy, never DNC) | D2 | Not started | |

## §11 Transcripts, recordings, AI review

| Requirement | Slice | Status | Evidence |
|---|---|---|---|
| Immutable transcript segments w/ timestamps, interim/final handling | F1 | Not started | |
| Live streaming during supported calls | E2 (relay) | Not started | poll-bound ~3s — capability limit |
| Synchronized playback + transcript highlighting (seek-to-line) | F1 | Not started | |
| Structured intelligence schemas (summary/facts/objections/commitments/flags/disposition+confidence+evidence) | F1 | Not started | |
| Confidence thresholds, auto-apply policy, review queue, override with audit | F1 | Not started | |
| Manual-call transcription | — | **Blocked** | no STT provider wired; UI states it honestly |

## §12–§13 Campaigns, reports, leaderboard

| Requirement | Slice | Status | Evidence |
|---|---|---|---|
| Campaign builder (audience, policy, windows, caller IDs, retry, scripts, taxonomy subset, goals, clone) | D4 | Not started | |
| Event-derived drillable pipeline without double-counting | D4 | Not started | |
| Report center: same metrics/filters, drill-down, comparison, saved views, tooltips, last-updated | F2 | Not started | |
| Leaderboard: configurable points, calendar periods, breakdown, streaks, ties, near-real-time, idempotent | F2 | Not started | badges/celebrations **Deferred** |

## §14–§16 Customization, security, UX

| Requirement | Slice | Status | Evidence |
|---|---|---|---|
| Custom dispositions with routing actions that actually work | D3 | Not started | dead control F/R2 |
| Server-enforced permissions incl. new leads.export / assignments.manage | A2/C4/D1 | Not started | |
| Strict tenant isolation verified | G | Not started | |
| Webhook signature verification without prod escape hatches | A2 | Not started | |
| Formula-injection prevention everywhere | A2 | Not started | |
| Rate limiting on AI/export routes | A2 | Not started | |
| PII-safe logs | G | Not started | |
| Telemetry (event lag, reservation conflicts, drift, import failures) | A2/G | Not started | |
| WCAG-conscious keyboard/focus/contrast/reduced-motion/announcements | G | Not started | |
| Reusable primitives (StatusPill, FilterChip, Timeline, LaneCard, DataTable, Toast, ConfirmDialog…) | C1/E2 | Not started | |

## §18 Minimum acceptance tests — tracked in `qa-evidence.md` per slice.

## §19 Performance — baseline + targets recorded in `qa-evidence.md` (Phase G).
