# Phase 1 — Requirements Traceability Matrix

Every major requirement from `docs/phase_one.md` → owning workstream/slice → status → evidence. Statuses: **Done / Partial / Blocked / Deferred / Not started**. Updated before every checkpoint push.

## §3 Canonical domain & events

| Requirement | Slice | Status | Evidence |
|---|---|---|---|
| Immutable idempotent call events (event id, provider id, times, source, payload version) | B2 | **Done** | call_events + applyCallEvent; tests/call-state-machine |
| Provider legs distinct from business attempt | B2 | **Done** | call_attempts + call_legs; (room, lead_id) per-lead attempts |
| One canonical terminal outcome + raw provider reason retained | B2 | **Done** | transport_outcome stamped once + terminal_reason |
| Disposition ≠ transport outcome | B2 + D3 | **Done** | transport_outcome stamped once; disposition key rides call_records.disposition |
| Canonical state machine (queued→…→completed), duplicate/out-of-order safe | B1/B2 | **Done** | state-machine.ts (14×14 tested) + CAS in apply-event |
| Reservation/locking prevents concurrent dialing of one lead | B3+E3 | **Done** | manual dialer claims atomically behind settings.dialing.reservations (default on); AI cron claims |
| Every state transition auditable | B2 | **Done** | events-first write order; append-only trigger |
| Custom fields preserved with provenance; unknown columns never dropped | C5 | **Done** | import_job_id/source_file/original_row on every imported lead |
| Audit history (leads, assignments, dispositions, DNC, appointments) | C1/D1 | **Done** | lead_events hooks + assignment_events; timeline renders them |
| Saved views / smart lists as first-class data | C3 | **Done** | smart_lists table + builder + seeds |

## §4 Analytics & dashboard sync

| Requirement | Slice | Status | Evidence |
|---|---|---|---|
| Metric glossary + single metrics layer for all surfaces | B4 | **Done** | definitions.ts + app_metrics_summary/hourly; metrics.ts unified; reports consumption completes in F2 |
| Defined: calls today, human connects, connect rate, appts set, avg talk, weekly, outcome mix, hourly, pipeline | B4 | **Done** | live-probed: outcome mix reconciles exactly (11,055+11=11,066) |
| Near-real-time dashboard updates / invalidation | E1 | **Partial** | floor/monitor/leaderboard event-driven; dashboard is force-dynamic with Data-as-of stamp (refresh on nav — accepted) |
| Late events repair aggregates; scheduled reconciliation | B4 | **Done** | reconcile-data cron every 15 min (drift → audit_log) |
| Filters: tenant, permission, date/tz, campaign, team, rep, mode | B4/F2 | **Done** | app_metrics_summary params + reports range/compare |
| Last-updated, filter chips, tz, definition tooltips | F2 | **Done** | DataStamp + glossary Tooltips on dashboard + reports |
| Deterministic fixture + DST + parity tests | B1/B4 | **Done** | metrics-definitions/-timezone, leaderboard-scoring DST fixtures, filter parity fixture |
| **Remove Average AI Score** | B4 | **Done** | aggregate gone (4 sites + app_leads_page); per-lead score retained per D6 |

## §5 Lead 360

| Requirement | Slice | Status | Evidence |
|---|---|---|---|
| One reusable Lead 360 from every surface; stable deep-linkable route | C1 | **Done** | drawer (?lead=) + /leads/[id]; 9 surfaces wired |
| Identity, company, lead-provided vs inferred number location (labeled) | C1 | **Done** | LocationSection labels the area-code inference |
| Source/campaign/pack/owner/eligibility; DNC state + audit | C1 | **Done** | eligibility reason pills via evaluateEligibility |
| All custom fields grouped + raw-value toggle | C1 | **Done** | |
| Chronological activity timeline (attempts, transitions, notes, callbacks, appts, recordings, assignments) | C1 | **Done** | mergeTimeline over 5 sources; reschedule never double-counts (tested) |
| Editable notes; recordings + transcript; AI summary with confidence/override history | C1/F1 | **Done** | call_artifacts supersede chain + AiSourceBadge + seek-to-line |
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
| TSV; XLSX | C5 | **Partial** | TSV Done (delimiter override); XLSX **Deferred** (no vetted lib — honest UI message) |
| One typed server-side filter system (nested AND/OR, custom fields, attempt/DNC/eligibility fields) | C2 | **Done** | FilterSpec + app_filter_leads (whitelist compiler) + parity fixture |
| Smart Lists 2.0 (dynamic saved queries, sharing, validation) | C3 | **Done** | |
| Flexible export (field chooser, templates, formats, current filter, audit, masking, formula-injection safe) | C4 | **Done** | streaming POST + export_audit + leads.export perm |
| Background generation for large exports | C4 | **Deferred** | no worker on Hobby; synchronous streaming + 50k cap + honest warning |

## §7 Assignments & eligibility

| Requirement | Slice | Status | Evidence |
|---|---|---|---|
| Packs become assignments (status/priority/due/mode/policy) | D1 | **Done** | lead_packs evolved in place + assignment_events |
| Manager Assignment Center (capacity, allocate N, preview exclusions, rebalance/reclaim, audit) | D1 | **Done** | /assignments + AllocateWizard exact-exclusion preview |
| Rep My Assignments (lanes, continue, skip reasons, follow-up queues) | D1 | **Done** | lanes + Continue → scoped dialer |
| Disposition-driven routing configurable & deterministic | D3 | **Done** | behavior → canonical outcome via BEHAVIOR_TO_OUTCOME; routeDisposition untouched |
| One concurrency-safe eligibility engine for manual/AI/parallel | B3/E3 | **Done** | app_claim_dial_leads + TS twin (LOCKSTEP) across all three modes |
| Never-dialed-first default; retry only via rule/callback/override | B3/E3 | **Done** | claim ORDER BY; callback bypasses cooldown only, never DNC |
| Atomic reservation + idempotent call creation | B2/B3 | **Done** | FOR UPDATE SKIP LOCKED + client_attempt_id unique keys |

## §8 Dialer & Live Floor

| Requirement | Slice | Status | Evidence |
|---|---|---|---|
| Shared dialer shell (mode, progress, readiness, state+elapsed, next-up, history, realtime health, kbd, wrap-up) | E3 | **Done** | |
| Manual cockpit: click-to-call, teleprompter, keypad, timer, audio device selection | E3 | **Done** | output picker feature-detected (setSinkId) |
| Pre-answer mute, honest capability handling | E3 | **Done** | real (conference leg pre-answer); arming intent queue; unsupported in demo |
| AI dialer view (agent/script, AI state, live transcript, monitor/intervene, delay indicators) | E4 | **Done** | |
| Parallel multi-lane workspace; no duplicate lead/phone across lanes | E4 | **Done** | claims prevent lead dupes; client phone-dedupe guard |
| Live floor: accurate presence, filters, density, detail panel, stale indicators, no guessed status | E2 | **Done** | webhook truth beats self-reported presence (tested merge rule) |
| Real-time channel (authenticated, tenant-scoped, reconnect/backoff, gap repair; no aggressive polling) | E1 | **Done** | private org broadcast channel; polls downgraded to fallbacks |
| Call history rows complete + Lead 360 access | E3 | **Done** | |
| Pre-call talking points from verified data only; post-call notes with provenance | F1 | **Done** | teleprompter never invents; artifacts carry model/prompt provenance |

## §9–§10 Status workflows, appointments, callbacks

| Requirement | Slice | Status | Evidence |
|---|---|---|---|
| Distinct visual/semantic transport outcomes; webhook-authoritative | E2/E3 | **Done** | StatusPill icon+label, never color alone |
| Required/default disposition per campaign; autosaved wrap-up drafts | E3 | **Done** | campaign disposition subsets + draft autosave |
| Needs-review routing for uncertainty | F1 | **Done** | call_review_queue + lane on /callbacks |
| Appointments: views, tz clarity, conflict detection, reliable counts | exists / F2 parity | Partial | workspace exists; conflict detection Deferred |
| Callback workspace (lanes, claim/reservation, reschedule/reassign, escalation, cooldown-override policy, never DNC) | D2 | **Done** | app_claim_callback 15-min takeover |

## §11 Transcripts, recordings, AI review

| Requirement | Slice | Status | Evidence |
|---|---|---|---|
| Immutable transcript segments w/ timestamps, interim/final handling | F1 | **Done** | call_transcript_segments unique (conversation, turn); interim style ships dormant (EL sends final only) |
| Live streaming during supported calls | E2 | **Done** (poll-bound) | shared relay: N supervisors, ONE provider poll; labeled "updates every few seconds" |
| Synchronized playback + transcript highlighting (seek-to-line) | F1 | **Done** | legacy rows degrade honestly (no secs → no affordance) |
| Structured intelligence schemas (summary/facts/objections/commitments/flags/disposition+confidence+evidence) | F1 | **Done** | 7 kinds, evidence = transcript turn indices |
| Confidence thresholds, auto-apply policy, review queue, override with audit | F1 | **Done** | ai.dispositionPolicy; AI never supersedes human (tested) |
| Manual-call transcription | — | **Blocked** | no STT provider wired; UI states it honestly |

## §12–§13 Campaigns, reports, leaderboard

| Requirement | Slice | Status | Evidence |
|---|---|---|---|
| Campaign builder (audience, policy, windows, caller IDs, retry, scripts, taxonomy subset, goals, clone) | D4 | **Done** | /campaigns/[id]/edit |
| Event-derived drillable pipeline without double-counting | D4 | **Done** | app_campaign_funnel mutually-exclusive buckets, every stage → /leads?f= |
| Report center: same metrics/filters, drill-down, comparison, saved views, tooltips, last-updated | F2 | **Done** | archive lacks a filter grammar → those drills honestly not linked |
| Leaderboard: configurable points, calendar periods, breakdown, streaks, ties, near-real-time, idempotent | F2 | **Done** | appointmentKept excluded (no kept signal); badges/celebrations **Deferred** |

## §14–§16 Customization, security, UX

| Requirement | Slice | Status | Evidence |
|---|---|---|---|
| Custom dispositions with routing actions that actually work | D3 | **Done** | the dead Admin editor now drives the rep grid |
| Server-enforced permissions incl. new leads.export / assignments.manage | A2/C4/D1 | **Done** | route-level checks + per-member overrides |
| Strict tenant isolation verified | G | **Done** (route layer) | tests/tenant-isolation + A2 suites; RLS = manual SQL checklist in qa-evidence (CI cannot reach RLS) |
| Webhook signature verification without prod escape hatches | A2 | **Done** | half-configured fails closed; skip needs explicit prod ACK |
| Formula-injection prevention everywhere | A2 | **Done** | shared csv-safety in every exporter |
| Rate limiting on AI/export routes | A2 | **Done** (per-instance) | distributed limiter **Deferred**, documented |
| PII-safe logs | G | **Done** | grep audit clean — id-based logging throughout |
| Telemetry (event lag, reservation conflicts, drift, import failures) | A2/G | **Done** | ops_metrics + counters wired; SQL snippet pack in performance-baseline.md |
| WCAG-conscious keyboard/focus/contrast/reduced-motion/announcements | G | **Done** | aria-live announcer, focus traps, icon+label pills, reduced-motion gates, focusable tooltips |
| Reusable primitives (StatusPill, FilterChip, Timeline, LaneCard, DataTable, Toast, ConfirmDialog…) | C1/E2 | **Done** | 13 new primitives in src/components/ui |

## §18 Minimum acceptance tests — tracked in `qa-evidence.md` per slice.

## §19 Performance — baseline + targets recorded in `qa-evidence.md` (Phase G).
