# Phase 1 — Outbound Dialer Transformation: Master Execution Plan

## Context

`docs/phase_one.md` mandates the largest Phase-1 upgrade of ATLAS: turn the current app into a trusted, real-time, customizable outbound-calling command center. Three parallel deep audits of the repo confirmed the spec's suspicions and located everything precisely. The five foundations (trusted data, Lead 360 everywhere, real-time ops, intelligent work distribution, customizable workflows) are all currently missing or partial:

- **No immutable call events, no canonical state machine** — 4 competing state vocabularies; human-call path has a bare non-idempotent `insertCallRecord` that the client outbox replays into **duplicate call records + duplicate appointments** (`src/lib/dialer/disposition-queue.ts`).
- **No reservation/eligibility engine** — supervisors share the whole org pool; owner + assignee both queue the same lead; manual queue is upload-order with a modulo-wrap redial bug; no cooldown/max-attempts outside the AI cron.
- **No shared metrics layer** — ≥7 surfaces compute independently; `DIALABLE` defined 3×, "connect" defined 3 ways; org-tz fallback inconsistent (UTC vs America/Chicago).
- **No realtime** — everything polls (2s–30s); presence is tab-reported (crashed tab shows "Live" 45s).
- **No Lead 360** — nine partial lead renderings, no `/leads/[id]` route.
- **Dead/fake controls** — Admin dispositions editor changes nothing reps see; dialer Record toggle is a no-op; leads-table "Call" button doesn't dial.
- **Security holes** — `/api/twilio/answered` has ZERO auth and can hang up arbitrary calls; `/api/ai/briefing|copilot|summary` unauthenticated; report export lacks formula-injection protection; reps can silently listen to any live call.
- **Headerless-import bug** (VICC's broker lists) — row 1 eaten at two layers (`csv.ts` + `chunk.ts`).

## User decisions (locked)

1. **Deploy cadence**: commit per slice locally; **push to prod branch only at verified checkpoints** (build+tests green, SQL applied first). Branch `claude/wizardly-cerf-m8c620` IS production.
2. **DB migrations**: I apply each new schema PART to the **live Supabase DB via the Supabase MCP** right before pushing the code that needs it. All SQL is idempotent/additive, appended to `supabase/schema.sql` as PART 22+ per house style, with rollback notes.
3. **Rep listen**: **restrict** — remove `monitor.view`/`monitor.listen` from rep defaults in `src/lib/permissions.ts`; per-member overrides remain the escape hatch.

## Full design docs (recover if context is compacted)

- Lead-ops/assignments/campaigns full design: `C:\Users\Owner\AppData\Local\Temp\claude\C--Users-Owner-Downloads-AJ-dialer\7ab409fd-be5d-4564-b50f-22b4cd2a572e\scratchpad\plan-leadops.md`
- Data-foundation full design (JSON, field `[0].text`): `C:\Users\Owner\.claude\projects\C--Users-Owner-Downloads-AJ-dialer\7ab409fd-be5d-4564-b50f-22b4cd2a572e\tool-results\toolu_01QzpJfEm8LxmgNTKJvLYxbZ.json`
- Realtime/dialer/reports design: consolidated below (§ realtime, dialer, floor, intelligence, reports).
- These get committed into `docs/phase-1/implementation-plan.md` (and companions) as the first slice.

---

## Decision register (consolidated — do not re-decide)

| # | Decision |
|---|---|
| D1 | `call_records` stays the reporting projection; new `call_attempts` + `call_legs` + immutable `call_events` become source of truth. **Dual-write, events first**; reader cutover is incremental (metrics RPCs read call_records with new projection columns). |
| D2 | Idempotency key = client-minted `client_attempt_id` (UUID) minted at dial start, carried through the disposition outbox; partial unique indexes on `call_records(org_id,client_attempt_id)`, `(room)`, `(conversation_id)`. On 23505, return existing row id and **skip** `routeDisposition` (kills the duplicate-appointment bug). Pre-index dedupe archives losers to `call_records_dupes` (kept ≥30 days). |
| D3 | Reservation lives ON `leads` (`reserved_by`, `reserved_until`), claimed via SECURITY DEFINER `app_claim_dial_leads` with `FOR UPDATE SKIP LOCKED` (mirrors `app_claim_notifications`). TTL 180s + heartbeat renew; expired holds simply claimable; no cleanup job. Kill-switch: org setting `settings.dialing.reservations` (default ON). |
| D4 | Eligibility written twice deliberately: pure TS `evaluateEligibility` (tests + pre-initiation) and the claim RPC's WHERE — lockstep comments, the established `app_leads_page` twin convention. |
| D5 | New `leads` columns `attempt_count`, `last_attempt_at`, `next_eligible_at` (denormalized, backfilled from `call_records`, repaired by reconcile cron). `last_contacted_at` untouched (means "disposition filed"). |
| D6 | `ai_score` COLUMN stays (dial ordering + per-lead display + export column are validated features); only the **aggregate** "Avg AI score" is removed (leads KPI, `app_leads_page.stats.avgScore`, admin tile, AI-chat context). |
| D7 | Metrics = live SQL aggregates via RPCs (`app_metrics_summary`, `app_metrics_hourly`), NOT aggregate tables. Reconciliation cron compares and logs drift to `audit_log`. |
| D8 | Canonical connect = `human_connected` evidence; projected onto `call_records.human_connected boolean` + `talk_sec int`; readers use `coalesce(human_connected, outcome ∈ CONNECTED_OUTCOMES)` during transition. Voicemail never a connect. |
| D9 | Org timezone unified: `orgTimezone(org)` → `org.timezone || "America/Chicago"`; week start = `settings.reporting.weekStart` (default 1=Mon). |
| D10 | `app_fire_cron` + all pg_cron schedules checked into new `supabase/cron.sql`. |
| D11 | Realtime = **Supabase Realtime private broadcast channels**, one per org (`org:{orgId}:floor`), published server-side from webhook/store choke points via stateless HTTP POST (`src/lib/realtime/publish.ts`). Auth via RLS on `realtime.messages` (`app_can_join_org_topic`). NOT postgres_changes (would need table policies on locked tables), NOT SSE (function burn on Vercel). Presence via Realtime presence extension; webhook-driven `live_calls` beats self-reported status. Polls downgraded to slow fallbacks, never deleted (demo mode + gap repair). |
| D12 | Lead 360 = client drawer (context `Lead360Provider` in `(app)/layout.tsx`, URL-synced `?lead=` via `history.replaceState`) + real RSC route `/leads/[id]` for deep links. NOT intercepting routes (would unmount the live Twilio device). Live-update = `useVisiblePoll` 20s while open + refetch on mutation/focus. |
| D13 | Timeline = TS union in `getLeadTimeline()` over call_records/appointments/callbacks/ai_conversations/`lead_events` (new audit table) — not a SQL view. |
| D14 | Import Studio = full page `/leads/import`, 6-step wizard; transport (chunking, head-to-head parser, caps) unchanged; new `import_jobs` + `leads.import_job_id/source_file/original_row` provenance; rollback deletes only provably-untouched rows; dedupe modes skip/update/create_new via new `app_phone_matches` chunk probe (kills the O(book×chunks) scan). Headerless fix threads `hasHeader` through `csv.ts` + `chunk.ts` + `parse-request.ts` + route. **XLSX deferred honestly** (no lib in deps); TSV via delimiter override. |
| D15 | Typed filters: `FilterSpec` (root op + groups + conditions, fixed depth 2, ≤8×8) with TS evaluator + new RPC `app_filter_leads` (plpgsql walker; column/op whitelists, `%L` values, service-role only). NOT grafted into `app_leads_page`. `?f=` base64url URL param. |
| D16 | Smart Lists 2.0 = `smart_lists` table (dynamic saved queries); legacy 6 hardcoded rules seeded per org (solar-only ones only for solar-template orgs); `p_smart` SQL CASE arms retired after leads table moves to `app_filter_leads`. |
| D17 | Export v2 = POST streaming (`ReadableStream`, pages of 1000, batch enrichment), hard cap 50k rows with pre-count warning; `export_audit` table; new `leads.export` permission (manager+); saved templates in org settings; shared `csvCell` in `src/lib/csv-safety.ts` used by BOTH exports. Background export queue = honestly deferred (no worker on Hobby). |
| D18 | Assignments: **evolve `lead_packs` in place** (status/priority/due_date/dialing_mode/max_attempts/cooldown_hours/ordering/source/filter_snapshot/campaign_id) — no rename/new table. New `assignment_events` audit. One route `/assignments`, role-switched (Center for managers, My Assignments for reps). Allocation via `app_allocate_assignment` (+ preview twin) with never-dialed-first + `FOR UPDATE SKIP LOCKED`. |
| D19 | Callbacks v2: columns (priority/assigned_to/campaign_id/call_record_id/attempt_count/claimed_by/claimed_at/timezone) + `app_claim_callback` (15-min stale takeover). "Missed" = derived view of overdue >24h, not stored. Callback due = cooldown override in eligibility, NEVER DNC override. |
| D20 | Dispositions that work: `DispositionDef {key,label,tone,behavior,enabled,system,sortOrder}`; `BEHAVIOR_TO_OUTCOME` maps behavior → canonical `CallOutcome` (stored keys NEVER move). `call_records.outcome` keeps canonical 9; org-specific choice goes in the existing near-dead `call_records.disposition` column. `resolveOutcomeOptions` reimplemented on top (signature stable). Legacy `{label,tone}[]` settings migrated on read. `do_not_call` cannot be disabled. |
| D21 | Campaigns v2: columns on `campaigns` (description/objective/archived_at/audience/dialing_policy/caller_ids/retry_policy/disposition_keys/goals). `leads.campaign_id` STAYS text (no FK migration on live rows); add `leads_org_campaign_idx`. Funnel via `app_campaign_funnel` — mutually exclusive current-state buckets, each segment drills to `/leads?f=`. Campaign create/edit "Utility provider" literal → resolved core-slot label. |
| D22 | Call intelligence: `call_artifacts` (append-only supersede chain; human rows never overwritten by AI), `call_transcript_segments` (unique conversation_id+turn_index; secs kept), `transcript_cursors` (shared server poll: N supervisors share 1 EL poll, segments fanned out via broadcast), `call_review_queue` (Needs Review lane lives in /callbacks workspace + nav badge). Seek-to-line in call-detail-modal from stored secs. `AiSourceBadge` on all AI-authored content. Disposition policy: `autoApplyMin: 0.8`, `alwaysReview: ["do_not_call"]`, `reviewOnMissingTranscript: true`. |
| D23 | Dialer: explicit `sessionMode: "manual"|"ai"|"parallel"`; `dialer-client.tsx`/`call-stage.tsx` dissolved incrementally into `dialer-shell` + `manual-cockpit` + `ai-session-view` + `parallel-lanes` (engine `use-dialer.ts` kept; queue cursor replaced by claims; device/token/conference/recovery code untouched). Pre-answer mute is REAL (rep leg exists pre-answer; `arming` window queues intent). Dead record toggle → `RecordingIndicator` bound to org policy. Audio device selection via `device.audio` APIs (output picker feature-detected on `setSinkId`). Teleprompter: sections + `{{field}}` interpolation via `resolveLeadFields`, missing-var chips, objection branches, copy-to-notes; never AI content. |
| D24 | Leaderboard v2: configurable points (org settings `leaderboard.points`), calendar-true week/month in org tz (fix rolling-window mislabel), breakdown popover, streaks/personal best, deterministic ties, `leaderboard.delta` broadcast → debounced refetch. Badges/celebrations/penalties deferred honestly. |
| D25 | Reports v2: consume metrics service through the existing `ReportingData` adapter seam; DrillLink serializes FilterSpec to `/leads?f=`/`/recordings?f=`; comparison period; glossary tooltips; last-updated stamp; saved views. |
| D26 | New permissions: `leads.export` (manager+), `assignments.manage` (manager+). Rep defaults lose `monitor.view`/`monitor.listen`. |
| D27 | Telemetry: `src/lib/telemetry.ts` → `ops_metrics` table (buffered, never blocks call paths; console in demo). Counters: realtime.publish_fail, event.lag_ms, reservation.conflict, transcript.poll_latency_ms, ai.parse_fail, webhook.unsigned_accepted, import.row_fail, metric drift. |
| D28 | E2E: minimal Playwright smoke (3 journeys in demo mode: dialer manual→wrapup, floor render+filters, reports drill integrity). Vitest stays the main harness; tenant isolation = route-handler tests with mocked scopes + documented manual RLS checklist (honest: RLS itself not covered by CI). |
| D29 | Every new DB function/table follows house style: idempotent `create ... if not exists`, service-role-only grants via revoke/grant blocks, `notify pgrst, 'reload schema'` after function recreates. Demo mode: every new surface degrades gracefully (`isSupabaseConfigured()` branches). |

## SQL PART allocation (append to `supabase/schema.sql`; apply live via Supabase MCP per slice)

| PART | Contents | Slice |
|---|---|---|
| 22 | `call_attempts`, `call_legs`, `call_events` + immutability trigger + org-member read RLS | B2 |
| 23 | `call_records` +attempt_id/client_attempt_id/human_connected/talk_sec; dupe archive (`call_records_dupes`) then 3 partial unique indexes | B2 |
| 24 | `leads` +attempt_count/last_attempt_at/next_eligible_at/reserved_by/reserved_until; backfill; dial-order index; RPCs `app_claim_dial_leads`/`app_release_dial_leads`/`app_renew_dial_reservations`/`app_mark_lead_attempted` | B3 |
| 25 | `app_leads_page` recreate: drop `avgScore` stat, add `neverDialed` | B4 |
| 26 | `app_metrics_summary`, `app_metrics_hourly` | B4 |
| 27 | `import_jobs`; `leads` +import_job_id/source_file/original_row/dialing_preference/archived_at; `app_import_job_bump`; `app_phone_matches` + phone10 expression index; `import_mapping_templates` | C5 |
| 28 | `app_filter_leads`, `app_lead_counts` | C2 |
| 29 | `smart_lists` + per-org seed (solar rules gated by template) | C3 |
| 30 | `export_audit` | C4 |
| 31 | `lead_packs` assignment columns; `assignment_events`; `lead_events`; `app_allocate_assignment` + `app_preview_assignment` | D1 |
| 32 | `callbacks` v2 columns; `app_claim_callback` | D2 |
| 33 | `campaigns` v2 columns; `leads_org_campaign_idx`; `app_campaign_funnel` | D4 |
| 34 | `app_can_join_org_topic` + RLS policies on `realtime.messages` (broadcast/presence receive; presence-only insert) | E1 |
| 35 | `call_artifacts`, `call_transcript_segments`, `transcript_cursors`, `call_review_queue` | F1 |
| 36 | `ops_metrics` | A2 |
| — | NEW `supabase/cron.sql`: `app_fire_cron`, `app_set_cron_secret`, schedules (auto-dial, reconcile-ai, notifications, **reconcile-data** every 15 min) | A1 |

---

## Execution sequence (slices → checkpoints)

Every slice leaves `npm run build` + `npm test` + `npm run lint` green. Checkpoints = SQL applied via MCP, then push to prod.

### Phase A — Baseline, docs, security (→ CHECKPOINT 1)

**A1. P1.0 baseline + docs skeleton.** Create `docs/phase-1/`: `current-state-audit.md` (the three audits, citable: findings register with file:line), `requirements-traceability.md` (every spec §3–§19 requirement → workstream → status, seeded Not started), `architecture-and-data-contracts.md`, `metric-glossary.md` (stub, generated fully in B4), `call-state-machine.md`, `implementation-plan.md` (this plan + full agent designs), `migration-and-rollback.md`, `qa-evidence.md` (baseline: current test count + build output). Add `supabase/cron.sql`. No behavior change.

**A2. Security hardening pull-forward.**
- `/api/twilio/answered`: require session (`getViewer().user`); body gains `room`; server validates `live_calls` row `id=room.slice(3)` owned by caller OR org+`monitor.intervene`; reject unmatched legs; rate limit. `use-dialer.ts` sends `room`.
- `/api/ai/briefing|copilot|summary`: `getViewer()` auth (demo passes) + `rateLimit` 30/min/user; copilot transcript tagged untrusted.
- `/api/twilio/hold`: org-scope the room via `live_calls` (owner or org+intervene; 404 unknown).
- `/api/twilio/hold-music`: ship `public/hold-music.mp3` (royalty-free), stop serving `demo.twilio.com`.
- `src/lib/twilio.ts` signature valve: `TWILIO_SKIP_SIGNATURE` only outside production (or explicit ACK env); empty-authToken skip only when REST wholly unconfigured; telemetry `webhook.unsigned_accepted`.
- `permissions.ts`: remove `monitor.view`/`monitor.listen` from rep defaults; fix monitor page copy.
- `src/lib/csv-safety.ts` (move `csvCell` etc. from export route) + fix `ExportReportButton` (formula injection + BOM + CRLF).
- `src/lib/telemetry.ts` + PART 36 `ops_metrics`.
- New `ui/toast.tsx` + `use-toast`, `ui/confirm-dialog.tsx`; replace `window.confirm` call sites.
- ElevenLabs webhook: verify 30-min timestamp tolerance is enforced in `verifyWebhookSignature` (it exists — assert with test).
- Tests: `answered-auth`, `ai-routes-auth`, `csv-injection`, `hold-scope`.

### Phase B — Data foundation (→ CHECKPOINT 2)

**B1. Pure modules + tests (no DB, no routes).**
- `src/lib/calls/state-machine.ts`: `AttemptState` (queued→reserved→dialing→ringing→human_connected|voicemail_connected|busy|declined|no_answer|failed|canceled→wrap_up→dispositioned→completed), `STATE_RANK`, `TRANSITIONS`, `decideTransition` (ok/duplicate/stale/invalid + `allowedFrom` CAS lists), `twilioStatusToState` (answeredBy machine_* → voicemail_connected; completed → null), `providerEventFingerprint` (twilio `sid:status:sequence`; EL event id).
- `src/lib/dialer/eligibility.ts`: `LeadSnapshot`, `EligibilityPolicy/Context`, `IneligibleReason` (15 reasons), `evaluateEligibility` (DNC beats everything incl. callback exception), `compareDialOrder` (never-dialed strictly first).
- `src/lib/metrics/definitions.ts` (glossary as code: 9 MetricIds with description/denominator/excludes) + `src/lib/metrics/compute.ts` (summarize/outcomeMix/hourlyBuckets DST-safe/weekRange).
- `src/lib/leads/dialable.ts` (single `DIALABLE_STATUSES`; 3 call sites import it), `src/lib/leads/filter-spec.ts` (types + sanitize + evaluate + encode/decode), `src/lib/leads/sort-keys.ts`, `src/lib/leads/area-code.ts`, `src/lib/dispositions/defs.ts` (D20).
- Tests: `call-state-machine` (exhaustive 14×14), `eligibility` (one case per reason + boundaries), `metrics-definitions` (20-row fixture), `metrics-timezone` (DST spring/fall, week start, year boundary), `filter-spec`, `filter-evaluator` (30 leads × 12 specs parity fixture), `dialable`, `area-code`, `disposition-defs`.

**B2. Canonical events + idempotency (PARTs 22–23).**
- `src/lib/calls/apply-event.ts`: `applyCallEvent` (events-first insert with `on conflict do nothing`; resolve-or-create attempt by conversation_id/room/client id; leg upsert on provider sid; CAS transition per `decideTransition`; terminal stamps `transport_outcome`+`terminal_reason` once). Wrappers `recordDialRequested`, `recordDispositionFiled`.
- Wire dual-write: `/api/twilio/status`, `/api/twilio/amd`, `/api/elevenlabs/webhook`, `ai-dialer.ts` (`placeAiCallForLead`), `/api/twilio/call` (mint room-attempt; human path mints `clientAttemptId` in `use-dialer.ts`), reconcile cron (`attempt.reconciled`; sanctioned not-connected→connected upgrade only).
- `insertCallRecord` idempotency (23505 → return existing id, SKIP routeDisposition); `disposition-queue.ts` stamps `clientAttemptId` before first POST; `completeAIConversation` check-then-insert race closed via unique index.
- Tests: `disposition-idempotency`, extend webhook decision tests.

**B3. Reservation engine (PART 24).**
- `src/lib/db/reservations.ts` (`claimDialLeads` — RPC + per-lead tz-window re-check in TS, releases failures; `releaseDialLeads`; `renewReservations`; `markLeadAttempted`).
- Routes `/api/dialer/claim|release|heartbeat`.
- Auto-dial cron → `claimDialLeads(mode:"ai")`; `buildSession` → filter-spec into claim (DNC scrub fixed by construction); manual/parallel dialer claims behind `settings.dialing.reservations` (default on).
- `getDialQueue` re-contracted to preview-only (docs comment).
- Tests: `reservation-policy` (TS twin of RPC WHERE/ORDER).

**B4. Shared metrics + avgScore removal (PARTs 25–26).**
- `src/lib/metrics/service.ts`; `getReportingData` internals re-pointed (return shape byte-compatible); `getAITodayStats` unified to glossary connect; `orgTimezone()` helper adopted (metrics.ts, records.ts); `apptWhen` formats in org tz.
- Avg-AI-Score removal per D6 (leads KPI → interim "Never dialed" card until C2's counts row; app_leads_page recreate; admin tile; AI-chat context line). Per-lead score/export column stay.
- `reconcile-data` cron route (counter drift repair, attempt/record parity, metric drift → audit_log) + schedule in cron.sql.
- `metric-glossary.md` generated from definitions.

### Phase C — Lead operations (→ CHECKPOINT 3)

**C1. Universal Lead 360.**
- `src/lib/db/lead-360.ts` (`getLeadPanel`), `lead-timeline.ts` (`getLeadTimeline` union, cap 200 + load-older), `lead-events.ts` (`logLeadEvent` hooks in updateLead/assign/DNC/routeDisposition).
- `src/components/leads/lead-360/`: provider (context + `?lead=` URL sync, mounted in `(app)/layout.tsx`), drawer (720px, focus trap, `useVisiblePoll` 20s, loading/empty/error/denied states), content + 9 section components (identity, location with labeled area-code inference, ownership/eligibility reason pills, DNC + audit, custom fields with raw toggle, timeline, notes, recordings, AI summary + provenance).
- `/leads/[id]/page.tsx` RSC deep link; `/api/leads/[id]/panel`.
- Rewire all lead references to `useLead360().open(id)` (leads table row, booked panel, campaigns detail, bills-fine, callbacks, appointments, call archive, command palette — fixes its dead lead result); delete `known-info-dialog.tsx`; `edit-lead-dialog` becomes the Edit form launched from 360 header; fix leads-table dead "Call" button (dials via `/dialer?dial=` or opens 360).
- New primitives needed here: `ui/drawer.tsx`, `ui/timeline.tsx`, `ui/tabs.tsx`, `ui/tooltip.tsx`.
- Tests: `lead-timeline` (merge order, reschedule no-double-count).

**C2. Typed filters + accurate totals (PART 28).**
- `app_filter_leads` (whitelist compiler) + `app_lead_counts`; `src/lib/db/leads-filter.ts` (`getFilteredLeadsPage`); `?f=` param on /leads; `<FilterBuilder>` (`src/components/leads/filter-builder/`) + `<LiveCount>` via `/api/leads/filter/count`; `<LeadCountsRow>` replacing the 4 KPI cards (8 drillable defined tiles); `archived_at` bulk Archive action; `ui/filter-chip.tsx`.
- Tests: parity fixture reuse; `lead-counts-defs`.

**C3. Smart Lists 2.0 (PART 29).** `db/smart-lists.ts` CRUD + validation (missing custom field → warning chip); chips → DB rows (`?smart=` maps legacy keys); save-from-filter dialog; solar-only lists absent for non-solar; retire `p_smart` path once table runs on `app_filter_leads`. Tests: `smart-list-migration` (6 legacy rules → FilterSpec identical membership).

**C4. Export v2 (PART 30).** `export-spec.ts`; streaming POST `/api/leads/export` (cap 50k + truncation warning + pre-count); export dialog (field chooser/reorder/rename/format/templates); `export_audit`; `leads.export` permission; wire from leads/smart lists/packs/campaigns. Legacy GET kept one release. Tests: `export-spec`.

**C5. Import Studio (PART 27).**
- Headerless fix: `hasHeader` through `csv.ts` (`resolveHeaderPlan`, `rowsToLeads` start row, `guessHasHeader`), `chunk.ts`, `parse-request.ts` (`sanitizeColumnPlan`, `dataRowsUnder`), `/api/leads/import` body. Delimiter override (TSV). XLSX = honest "export as CSV" message.
- `import_jobs` + provenance stamping + `app_import_job_bump`; dedupe rewrite via `app_phone_matches` (`src/lib/db/lead-import.ts: writeImportChunk` with skip/update/create_new); DNC-column mapping → rows stored with status `dnc` + `dnc_numbers(source:'import')`; `dialing_preference` mapping.
- Routes: `inspect`, `preview` (dry-run), `jobs` (+`[id]`, `rollback`, `errors` CSV), `templates`.
- `/leads/import` wizard (StepUpload/Mapping/Dedupe/Destination/Run/Report); group tiles hand off via `pending-import.ts`; delete `csv-import.tsx` + `use-csv-upload.ts`.
- Rollback = delete only untouched (`status='new' AND no attempts AND no refs`); merged/worked kept and reported.
- Tests: `csv-headerless` (incl. the exact single-row regression), `csv-delimiter`, `import-dedupe` (idempotent retry), `import-accounting`, `rollback-untouched`.

### Phase D — Assignments & workflows (→ CHECKPOINT 4)

**D1. Assignment Center + My Assignments (PART 31).** `db/assignments.ts` (list w/ progress buckets, preview, allocate, update/pause/reclaim/rebalance, getMyAssignments); `/assignments` route role-switched; AllocateWizard (source: pool/smart list/filter/pack → count vs live eligible → policy → exact exclusion preview → commit); AssignmentTable + detail drawer (audit feed); MyAssignments lanes + Continue → `/dialer?assignment=`; dialer session header shows assignment progress; skip/block reasons from eligibility codes; nav item; `assignments.manage` permission; remove `LeadPacksPanel` from /leads.

**D2. Callbacks v2 (PART 32).** Board rework (Overdue w/ escalation tiers, Due now, Upcoming, Completed, Cancelled, Missed-derived); claim flow (`/api/callbacks/[id]/claim` → dial with `&callback=`; wrap-up completes callback + bumps attempts); reschedule/reassign; Lead 360 links; fix `"Homeowner"` fallback (pipeline.ts:785 → vocab). Cooldown-override flag in eligibility (never DNC). Tests: `callback-lanes`.

**D3. Dispositions live.** Settings migration (legacy rows adopt system keys / become disabled custom); Admin editor (reorder/relabel/enable/add custom with behavior picker; `do_not_call` locked); `resolveOutcomeOptions` rewired; OutcomeGrid takes defs (campaign subset filter); `disposition` passthrough validated server-side into `call_records.disposition`. Tests: `outcome-options` extension.

**D4. Campaign builder v2 (PART 33).** `/campaigns/[id]/edit` builder (identity/audience via smart list or FilterBuilder w/ live count/dialing policy clamped to org limits/caller IDs/retry/scripts+AI/disposition subset/goals/clone); accurate drillable funnel via `app_campaign_funnel`; vocab fix ("Utility provider" → resolved core-slot label); campaign policy consumed by eligibility engine (auto-dial + sessions).

### Phase E — Realtime & dialer (→ CHECKPOINT 5)

**E1. Realtime transport (PART 34).** `src/lib/realtime/publish.ts` (stateless broadcast POST, fire-and-forget, seq, no-op in demo); events `call.state`, `call.answered`, `transcript.segment`, `leaderboard.delta`, `review.created` + presence extension; publishers wired in `human-call-store.ts`, `ai-call-state.ts`/`ai-call-finalize.ts`/`ai-call-reconcile.ts`, `/api/twilio/status`, `records.ts`; `use-org-channel.ts` client hook (singleton per org, setAuth, onResync snapshot pull, health states); poll downgrade table applied (answer poll → 5s fallback + broadcast fast-path; monitors → 30s fallback; presence heartbeat → 60s); presence merge rule (webhook truth > tracked presence > offline); `ui/realtime-health.tsx`. Tests: `realtime-publish`, `floor-merge`, extend `dial-answer`.

**E2. Live Floor v2.** `/api/floor/snapshot` (reconcile throttled to 15s/org); `floor-board/card/filters/detail-panel`; transcript relay `/api/monitor/transcript/[id]?since=` (cursor-gated shared EL poll → segment upserts → broadcast fan-out; 3s only-while-open); `live-transcript-pane` (interim/final styling, delay indicator); stale badges; filters + density; delete `monitor-grid.tsx` + TTS-readback listen; primitives `ui/status-pill.tsx` (THE call-state color/icon/label map), `ui/density-toggle.tsx`, `ui/dropdown-menu.tsx`, `ui/data-table.tsx`.

**E3. Dialer shell + manual cockpit.** `sessionMode` model; `dialer-shell` + `shell-header` (mode Tabs, assignment progress, line readiness, realtime health, kbd overlay); `manual-cockpit` (lead panel, `teleprompter.tsx`, `call-controls`, `audio-device-menu` + `use-dialer-devices.ts`, notes pane w/ AI/human distinction); pre-answer mute (`muteCapability` ready/arming/unsupported; queued intent applied in `attachCallHandlers`; aria-live pill); record toggle → `RecordingIndicator` from org policy; wrap-up panel (campaign disposition rules, 2s draft autosave, Needs-review button); `use-kbd.ts` + `kbd-overlay` (`?`, c/m/h/1-9/n/./Esc); queue → claims; answered broadcast fast-path. Tests: `mute-capability`, `teleprompter-interpolate`, `wrapup-draft`.

**E4. Parallel lanes + AI session view.** `parallel-lanes.tsx` rewrite + `ui/lane-card.tsx` (per-lane lead/location+inferred-number-location/campaign/StatusPill/timer/termination/event pulse; connected-lane focus expansion; compact/expanded; claims prevent dup lead/phone — client guard + telemetry on conflict); `ai-session-view` (agent/script/goal, per-call canonical states, live transcript via broadcast, listen/intervene per permission, delay indicators); dissolve `call-stage.tsx`; session stats reconcile to attempts.

### Phase F — Intelligence & reporting (→ CHECKPOINT 6)

**F1. Call intelligence (PART 35).** `src/lib/ai/schemas.ts` (8 artifact kinds w/ confidence+evidence); `analyze-call.ts` replaces fire-and-forget summary (persists artifacts + confidence + model/prompt version; disposition policy → auto-apply/review); `call_review_queue` + Needs Review lane in /callbacks + nav badge; append-only supersede chain (AI never overwrites human); stop discarding `secs` (extend conversation API + `parseTranscript`); post-call webhook reconciles segments authoritatively; seek-to-line in `call-detail-modal` (audio ref + `onSeek`/`activeSecs`; legacy rows degrade honestly); notes become `{text,source,at}[]` with `AiSourceBadge`. Tests: `transcript-segments` (interim/final idempotency, spec test 19), `artifact-override` (spec 20), `disposition-policy` (spec 21).

**F2. Reports + leaderboard v2.** `report-shell` (range/comparison/tz/saved views/last-updated), `drill-link.tsx` (metric key → FilterSpec via `filterFor()` in metrics service), glossary Tooltips on every metric, MetricCard `definitionKey`+`delta`; leaderboard rewrite (`composeLeaderboard` pure: config points, calendar periods via `zonedWeekKey`/`zonedMonthKey`, breakdown, streaks, personal best, deterministic ties) + admin scoring section + `leaderboard.delta` live refetch. Tests: `leaderboard-scoring` (DST fixtures, idempotency spec 28).

### Phase G — Hardening & release (→ CHECKPOINT 7, final)

- Route-handler tenant-isolation tests (mocked scopes, two fake tenants) + manual RLS checklist in qa-evidence.
- Accessibility pass: focus traps, aria-live call-state announcer, StatusPill contrast check both themes, reduced-motion on teleprompter/lanes/pulses, keyboard reachability.
- Performance: baseline then targets (floor lag ≤2s p95 broadcast; answered→UI ≤1.5s p95; claim ≤400ms p95; reports ≤2.5s @50k) with telemetry-sampled evidence; `scripts/perf-floor.mjs` reducer replay.
- Playwright smoke: `tests/e2e/{dialer-manual,floor,reports-drill}.spec.ts` in demo mode (`@playwright/test` devDependency; CI-optional).
- PII-safe logging sweep; final docs: qa-evidence, migration-and-rollback (exact PART commands + rollback), traceability matrix with Done/Partial/Blocked/Deferred, honest limitations section.

---

## Honest capability limits (recorded in docs, shown in UI)

1. ElevenLabs has no live transcript push — live pane is poll-bound (~3s), labeled; interim style ships dormant.
2. Vercel Hobby: no workers/sub-daily crons — reconciliation piggybacks requests + pg_cron minute ticks; zero-viewer stuck calls reconcile on next view.
3. Pre-answer mute real but "arming" for ~1s; unavailable in demo — capability states shown, never faked.
4. Output device selection needs `setSinkId` (disabled+explained on Safari).
5. Manual-call transcription doesn't exist (no STT wired) — archive says "Recording — no transcript"; segments schema is future-ready.
6. In-memory rate limits are per-instance best-effort (documented).
7. Background export/import queues deferred — synchronous streaming with caps + honest warnings.
8. XLSX import deferred (no vetted lib) — clear UI message.
9. Compliance controls documented as "implemented safeguards" vs "requires customer legal validation" (spec §15).

## Verification (per checkpoint)

1. `npm run lint` + `npm test` + `npm run build` (type-checks all routes).
2. Apply the slice's SQL PARTs via Supabase MCP (`apply_migration`), then `notify pgrst, 'reload schema'`; verify with `list_tables`/probe RPC.
3. `npm run verify:ai` where AI surfaces changed; `scripts/verify-*` where dialer state logic changed.
4. Playwright smoke (demo mode) from Phase E onward.
5. Manual spot-check in the running app (`npm run dev`) for each new surface's loading/empty/error/denied states.
6. Update `docs/phase-1/requirements-traceability.md` + `qa-evidence.md` before each push.
7. Push to `claude/wizardly-cerf-m8c620` (auto-deploys); watch the Vercel deploy for success.

## Top risks & mitigations

1. **`app_filter_leads` dynamic SQL** — whitelist-only columns/ops, `%L` values, service-role grants, TS-parity contract fixture.
2. **Unique-index creation on dirty prod data** — dedupe-to-archive runs first in the same PART; re-runnable; archive kept 30 days.
3. **Reservation UX regression** — TTL+heartbeat+kill-switch setting; claim returns reason counts ("12 on cooldown, 3 reserved by teammates").
4. **Realtime auth on `realtime.messages`** — verify policy behavior on the live project early in E1 (probe with a test client) before wiring consumers; fallback is existing polls (nothing breaks if broadcast fails).
5. **use-dialer.ts refactor** — incremental extraction only; device/conference/recovery engine untouched; each dialer slice keeps `global-call-bar` working.
6. **PostgREST schema cache** after function recreates — `notify pgrst` appended (this bit the repo before).
7. **Prod is live during the build** — checkpoint pushes only after green + SQL applied; every schema change additive; settings kill-switches on the risky cutovers (reservations).
