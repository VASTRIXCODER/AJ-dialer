Master Build Prompt — Outbound Dialer Phase 1 Transformation

Paste this prompt into Claude Code while it is opened at the root of the existing outbound-dialer repository. Do not paste it into the separate ndr-agentic-ai project or any other repository.

You are the principal product engineer, product designer, data architect, real-time systems engineer, and QA lead responsible for the largest Phase 1 upgrade of this outbound dialer.

Your job is not to create a superficial redesign or a collection of disconnected mock screens. Your job is to inspect the existing repository, understand the actual architecture and product behavior, then turn the current application into a reliable, real-time, highly customizable outbound-calling command center for administrators, managers, and sales representatives.

The result must feel dramatically more advanced while remaining coherent, fast, accurate, testable, secure, and maintainable. Every number, status, chart, filter, lead card, assignment, call outcome, and report must derive from a defined source of truth. Every visible control must work. Do not fake live data, ship dead buttons, hard-code production metrics, or label an incomplete capability as complete.

This is Phase 1 of a three-phase product transformation. Build Phase 1 completely and lay clean extension points for Phases 2 and 3, but do not invent or implement their unknown requirements.

1. Mission and required outcomes

Transform the product around five connected foundations:

Trusted data: dashboard metrics, call status, lead counts, campaign pipelines, leaderboards, and reports must reconcile to the same canonical data and definitions.

Lead 360 everywhere: a user must be able to open the same complete, current lead record from any relevant surface without losing context.

Real-time dialing operations: the live floor, manual dialer, AI dialer, and parallel dialer must accurately show what is happening now, including timestamps, call state, lead context, live transcription where supported, and graceful recovery from stale or out-of-order events.

Intelligent work distribution: lead packs must become true rep assignments and work queues, with safe eligibility rules that prioritize fresh, undialed leads and prevent accidental repeated dialing.

Customizable workflows: organizations must be able to configure fields, views, dispositions, campaigns, routing, assignments, dashboards, exports, and gamification without breaking data integrity.

2. Operating rules

Before changing code, inspect the repository and document what actually exists:

Identify the frontend, backend, database, authentication, authorization, multi-tenancy model, job system, cache, real-time transport, telephony provider, AI provider, storage, analytics logic, test setup, and deployment model.

Trace the current data flow for imports, lead selection, dialing, provider webhooks, transcripts, recordings, dispositions, appointments, callbacks, dashboards, reports, and exports.

Find duplicated calculations, mocked values, stale polling, race conditions, schema gaps, inconsistent state names, incomplete buttons, and provider capabilities the UI claims but the backend does not support.

Preserve working authentication, tenant isolation, integrations, routes, and production behavior unless a deliberate migration is required.

Modify only this outbound-dialer repository. Do not touch ndr-agentic-ai, the separate AI-dialer learning project, or unrelated repositories.

Create or update these repository documents before or alongside implementation:

docs/phase-1/current-state-audit.md

docs/phase-1/requirements-traceability.md

docs/phase-1/architecture-and-data-contracts.md

docs/phase-1/metric-glossary.md

docs/phase-1/call-state-machine.md

docs/phase-1/implementation-plan.md

docs/phase-1/migration-and-rollback.md

docs/phase-1/qa-evidence.md

Do not stop after writing a plan. After the audit, proceed through implementation in safe vertical slices unless there is a true destructive ambiguity, missing credential, provider limitation, or product decision that cannot be inferred safely.

Use the existing stack and conventions where sound. Avoid a wholesale rewrite merely to use a preferred framework. Introduce abstractions only where they solve a demonstrated problem. Use backward-compatible migrations, feature flags for risky cutovers, and rollback instructions. Never delete or silently reinterpret existing customer data.

For every slice:

Define the user behavior and data contract.

Implement the database/backend logic first where data integrity is involved.

Implement the real UI and all states: loading, empty, success, partial, stale, permission-denied, and error.

Add automated tests.

Run migrations, type checks, linting, unit tests, integration tests, and relevant end-to-end tests.

Verify the feature with seeded test data that includes edge cases.

Record evidence and remaining limitations in docs/phase-1/qa-evidence.md.

If a requested experience depends on a capability the current telephony or AI provider does not offer, do not simulate it as production functionality. Build a provider adapter and honest capability detection, implement what is supported, disable unsupported controls with a useful explanation, and record the exact blocker.

3. Canonical domain and event foundation

Do not create parallel sources of truth for each screen. Reconcile the existing schema to a canonical domain model. Reuse existing entities when possible and migrate safely. Exact table and class names should follow the repository’s conventions, but the model must cover:

organizations/workspaces and their timezone, locale, retention, compliance, and feature settings;

users, reps, managers, teams, roles, permissions, and presence;

leads, normalized phone numbers, contact/company/location fields, arbitrary custom fields, tags, source, owner, campaign membership, routing preference, consent/DNC state, and import provenance;

imports, source files, row-level results, mapping templates, validation errors, duplicates, and rollback status;

campaigns, stages, schedules, scripts, dialing modes, pacing, attempt policies, assignment rules, and goals;

packs/assignments, assignees, priority, order, due dates, status, progress, and eligibility snapshots;

call attempts, provider call legs, dialer mode, timestamps, duration components, final outcome, final disposition, and termination reason;

immutable call events with an event ID, provider event ID, event time, ingestion time, source, payload version, and idempotency protection;

recordings, transcript segments, speaker labels, summaries, reviews, notes, and AI evidence/confidence;

appointments, callbacks, reminders, owners, timezone, status, and links to the originating lead/call/campaign;

saved views/smart lists, filter definitions, displayed columns, sorting, sharing, and permissions;

metric definitions/aggregates where needed, plus reconciliation checkpoints;

audit history for changes to leads, assignments, dispositions, DNC status, appointments, campaigns, and AI/manual overrides.

Store normalized first-class fields for behavior the system must query reliably. Preserve every other imported field in a typed or safely serialized custom_fields structure, along with original header names and import provenance. Do not discard an unknown column.

Call-state machine

Replace scattered status logic with one explicit, validated state machine. Map provider-specific events into canonical states such as:

queued → reserved → dialing → ringing → human_connected | voicemail_connected | busy | declined | no_answer | failed | canceled → in_progress/wrap_up where applicable → dispositioned → completed

Adjust the exact transitions to the provider, but enforce these principles:

Events are idempotent and safe when duplicated, delayed, or received out of order.

Provider call legs and the business-level call attempt are distinct when parallel dialing or transfers create multiple legs.

A call has exactly one canonical terminal outcome, while retaining the raw provider reason.

A disposition is a business classification and must not be confused with a transport outcome.

The UI can show last updated, event latency, reconnecting, and stale-state warnings.

Reservation/locking prevents two workers or reps from dialing the same lead concurrently.

Every state transition is auditable.

4. Accurate analytics and dashboard synchronization

Create a metric glossary and a single reusable metrics service/query layer consumed by the dashboard, weekly graphs, leaderboards, campaign pipeline, and reports. Do not let each component calculate metrics independently.

At minimum, define and implement:

Calls today: count of outbound call attempts accepted for dialing during the organization’s current local day. Exclude test records, pre-provider suppressions, and canceled reservations that never became an attempt. Make the definition visible in a tooltip.

Human connects: attempts that reached a verified human-connected state. Keep voicemail separate.

Connect rate: human connects divided by completed outbound attempts eligible for the denominator. Document exclusions such as pre-dial suppression and provider setup failure; apply the same definition everywhere.

Appointments set: distinct appointment records created from calls in the selected period. Show confirmed appointments separately when the data model supports it. Avoid double-counting edits to one appointment.

Average talk time: total human-connected talk seconds divided by human-connected calls. Do not include ringing, queue time, voicemail time, or post-call wrap-up.

Performance this week: use the organization’s timezone and configurable start-of-week; expose the exact date range.

Outcome mix: mutually exclusive canonical terminal outcomes whose displayed counts reconcile to completed attempts for the same filters.

Hourly productivity: attempts, human connects, appointments, and productive talk time grouped by local call-start hour; handle daylight-saving transitions correctly.

Campaign pipeline: unique leads/calls/appointments by clearly defined stage, without double-counting; every segment must drill down to its records.

Requirements:

Dashboard cards and charts update in near real time from canonical events or a reliable invalidation mechanism.

Late provider events repair earlier aggregates.

A scheduled reconciliation job compares aggregates with source records and repairs drift safely.

Every metric supports tenant, permission, date/timezone, campaign, team, rep, dialer mode, and relevant lead filters.

Display last updated, active filter chips, timezone, and metric-definition tooltips.

Add deterministic fixture tests with known totals, boundary-time tests, daylight-saving tests, and parity tests proving that dashboard, report, and drill-down counts match.

Remove Average AI Score from the dashboard and all dependent UI. Migrate or retain old data safely if another validated feature still needs it; otherwise document deprecation.

5. Universal Lead 360 experience

Build one reusable Lead 360 drawer/modal/page that can be opened from the dashboard, leads table, dialer, live floor, rep assignments, campaigns, appointments, callbacks, recordings, transcripts, reports, and leaderboards wherever a lead is referenced.

It must present, based on role permissions:

identity and contact details;

company and job information;

lead-provided city/state/timezone and a clearly labeled phone-number location when only an area-code inference is available—never present an inferred number location as the person’s exact physical location;

source, campaign, tags, list/pack/assignment, rep owner, dialing mode preference, priority, and current eligibility;

DNC/consent/suppression state with source, reason, timestamp, and audit history;

all imported custom fields, automatically grouped and cleanly formatted, with an option to view original field names/raw values;

a chronological activity timeline containing every attempt, status transition, disposition, note, callback, appointment, recording, transcript, summary, review, assignment change, and important field change;

editable notes, generated pre-call talking points, post-call closing notes, tasks, callbacks, and appointments;

recordings with synchronized transcript where permitted;

AI call summary/review with confidence, evidence links, and human override history;

data provenance and freshness where useful.

Use a stable lead ID and deep-linkable route. Preserve the user’s current page, filters, and scroll position when the card closes. Update it live if the lead changes elsewhere. Do not duplicate separate lead-card implementations across tabs.

6. Lead inventory, importing, sorting, filtering, smart lists, and exporting

Accurate lead totals

Replace ambiguous Total Leads with trustworthy, drillable counts where appropriate:

all accessible active leads;

current filtered results;

currently dial-eligible leads;

assigned/unassigned;

never dialed;

previously attempted;

DNC/suppressed;

archived/invalid.

Define whether totals represent unique lead IDs, unique callable phone numbers, or campaign memberships. Label them clearly and test each count.

Import Studio

Create a guided, resumable import studio for common spreadsheet/flat-file formats already supportable in the stack, including at minimum CSV and TSV and XLSX when a safe existing library can support it. Accept arbitrary columns and large files through streaming or background jobs rather than loading everything in the browser.

Flow:

Upload and safely inspect the file, delimiter, encoding, headers, row count, and sample values.

Auto-map recognizable fields using names and sample types, but require a preview and allow manual correction.

Let users save and reuse mapping templates.

Map standard fields, create typed custom fields for everything else, and never silently drop a column.

Normalize phone numbers where possible while preserving the original value and country assumptions.

Detect duplicates using configurable strategies such as normalized phone, external ID, email, and selected compound keys.

Let the user choose skip, merge/update, or create-new behavior with a dry-run summary.

Detect DNC/suppression columns and common truthy values. Preview how they map. Imported DNC leads must remain stored and reportable but be ineligible for all dialing unless an authorized, audited process legally removes the suppression.

Map an optional dialing preference: AI, manual, either, or not eligible.

Choose campaign, tags, owner/team, assignment strategy, and initial pack during import.

Show row-level validation errors and allow downloading a correction file.

Run the import as an observable job with progress, counts, cancel/retry behavior, and an authorized rollback that reverses only the effects of that import.

Produce a final reconciliation: created, updated, skipped, duplicates, suppressed, invalid, and failed.

Protect against formula injection in exported CSVs, unsafe file types, oversized uploads, tenant leakage, and raw error exposure.

Filters and sorting

Build one typed server-side filter/query system used by lead tables, smart lists, assignment selection, exports, reports, and campaign targeting. It must support:

standard and custom fields;

disposition and call outcome;

AI/manual/either dialing preference;

never dialed, last attempt, attempt count, last connected, and next eligible time;

DNC/suppression and callable eligibility;

owner, team, campaign, pack, assignment status, source, import, tags, location, timezone, and date ranges;

appointments and callbacks;

nested AND/OR groups with field-appropriate operators;

multi-column sorting with explicit null handling and stable pagination.

Show active filters, result count, clear-all, and an understandable empty state. Filters must produce the same record set in the table, bulk actions, pack assignment, report drill-down, and export.

Smart Lists 2.0

Turn smart lists into dynamic saved queries, not copied lead collections. Include:

visual rule builder with nested AND/OR logic;

live preview and count;

saved columns, sorting, and density;

owner, sharing scope, permissions, favorites, duplication, description, and last edited information;

automatic refresh from current lead/call data;

optional campaign/assignment use with a frozen eligibility snapshot at execution time so active jobs do not change unpredictably;

validation when a referenced custom field or disposition changes;

audit/version history for shared operational lists.

Flexible CSV export

Allow export of the current result set, selected rows, a smart list, a pack, a campaign, or a report drill-down. Include:

field chooser covering standard fields, custom fields, latest outcome/disposition, assignment, campaign, call aggregates, appointment/callback data, and permitted AI insights;

drag-to-order columns and rename export headers;

saved export templates;

configurable delimiter, encoding, date/time format, timezone, and null representation;

preview and exact estimated row count;

background generation for large exports with status and retry;

permission-aware masking/exclusion of sensitive fields and an export audit event.

7. Packs become assignments and rep work queues

Correct the product concept: a pack is primarily a controlled group of leads assigned to a rep or team for execution, not an arbitrary split of the lead database.

Create an Assignment Center for managers and a My Assignments workspace for reps.

Manager capabilities:

select a rep/team and view capacity, active calls, workload, pace, progress, overdue work, and recent outcomes;

use a quantity slider or exact count input to allocate a number of eligible leads;

drag individual leads, selected groups, smart-list results, or packs onto a rep;

choose ordering, priority, campaign, due date, dialing mode, max attempts, cooldown, and reassignment behavior;

preview eligibility, DNC exclusions, duplicates, conflicts, and resulting workload before committing;

rebalance, pause, reclaim, or reassign remaining leads with a full audit trail;

see real-time pack progress: total, untouched, reserved, attempted, connected, callback, appointment, completed, suppressed, and failed.

Rep capabilities:

see active, upcoming, paused, overdue, and completed assignments;

open any lead in Lead 360;

start, pause, resume, or continue the next eligible lead from an assignment;

understand why a lead is skipped or blocked;

retain progress safely across sessions;

access disposition-driven follow-up queues such as callbacks, appointments, nurture, needs-review, DNC, and completed.

Disposition-driven routing must be configurable and deterministic. For example, a callback disposition should create/update a callback and route the lead into the callback queue, while a DNC disposition should immediately suppress future dialing. Do not physically duplicate the lead merely to place it in multiple operational views.

Prevent repeated dialing

Build one concurrency-safe eligibility engine for manual, AI, and parallel dialing. Before reservation and immediately before provider initiation, it must evaluate:

tenant and campaign membership;

normalized phone validity;

global and campaign DNC/suppression;

allowed local calling window and organization policy;

assignment ownership and status;

active reservation or active call;

previous attempts, outcome, max-attempt policy, and cooldown;

scheduled callback exceptions;

campaign completion/removal;

dialing-mode compatibility.

Default queues must prioritize never-dialed eligible leads before previously attempted leads. A previously attempted lead should reappear only when a configured retry rule, scheduled callback, manager override, or follow-up workflow makes it eligible. Use atomic reservation with expiration and idempotent call creation so concurrent workers cannot dial the same lead.

8. Power Dialer and Live Floor redesign

Create a responsive, premium operations interface with excellent information hierarchy. Favor a modern command-center aesthetic, purposeful motion, high-contrast status colors, compact density controls, and excellent accessibility. Make it visually striking without sacrificing scanability or turning operational data into decorative chart noise. Use design tokens and reusable components; support the product’s existing theme and light/dark modes if present.

Shared dialer shell

The dialer should always show:

current mode: Manual, AI, or Parallel;

assignment/campaign and progress;

provider/line readiness;

current lead or active lead lanes;

canonical call state with state-start time and elapsed duration;

exact lead-provided location and separately labeled number-location inference;

next eligible lead(s) with full compact lead context;

recent call history with outcome, disposition, timings, rep/agent, and Lead 360 access;

persistent connection/realtime health;

keyboard shortcuts and accessible controls;

post-call wrap-up and required disposition flow.

Manual dialer view

Provide a focused single-lead cockpit with click-to-call, pre-call talking points, live teleprompter, notes, keypad where supported, call timer, audio device selection, and clear controls. The mute control must be available before answer, must show unmistakable muted/unmuted state, and must remain consistent through connection when technically supported. Disable or explain unavailable provider controls rather than faking them.

The live teleprompter must:

combine the campaign script with approved lead fields;

highlight variables and missing data honestly;

support section navigation, adjustable text size/speed, pause, manual scrolling, quick objection branches, and manager-configured content;

never invent facts about the lead;

allow the rep to copy a verified detail into notes.

AI dialer view

Show information relevant to an automated call rather than reusing the manual layout blindly:

AI agent/script/version and campaign goal;

current call state and AI action state;

live streaming transcript with speaker labels and timestamps;

monitor/listen control when provider and permissions allow it;

detected intent, objections, key facts, compliance flags, and disposition confidence as evidence arrives;

safe intervention/takeover/terminate controls only when actually supported and authorized;

an explicit indicator when transcript, audio, or model analysis is delayed or unavailable.

Parallel dialer view

Build a distinct multi-lane visual workspace rather than stretching the single-call screen. Each active lane must have its own lead card, location, campaign, state, timer, retry/termination reason, and live event pulse. Include:

configurable concurrency within provider/account limits;

a clear overview of dialing, ringing, voicemail, human-connected, failed, and completed lanes;

prominent focus on a human-connected lane;

safe provider-specific behavior for canceling or resolving other active legs when required;

no duplicate lead or phone active in two lanes;

smooth but purposeful transitions and reduced-motion support;

compact and expanded lane views;

aggregate session stats that reconcile with call attempts, not decorative counters.

Live Floor

Give managers an accurate, real-time view of every relevant rep and AI agent:

presence: offline, available, paused, wrap-up, dialing, ringing, connected, callback, error;

current lead, campaign, pack/assignment, dialer mode, call state, state duration, session pace, and last event time;

filters for team, rep, campaign, mode, state, and stale/error status;

list/grid density options and a detail panel;

capability- and permission-controlled listening to AI calls;

live transcript as segments arrive, not only after call completion;

clear stale-data and disconnected indicators;

no guessed status based solely on page presence.

Use a real-time channel already present in the stack, or add an appropriate WebSocket/SSE/event-stream mechanism with authenticated tenant-scoped subscriptions, reconnect/backoff, replay or refresh after gaps, and cleanup. Do not poll aggressively or expose cross-tenant events.

Call history and wrap-up

Each call-history item must include lead context, campaign, rep/AI agent, dialer mode, outcome, disposition, start/end time, ring time, human talk time, total duration, recording/transcript availability, summary/review, notes, and Lead 360 access.

For each call:

Generate pre-call talking points only from verified lead/campaign data.

Generate post-call closing notes and a concise summary from the transcript, outcome, and rep-entered facts.

Cite the transcript segments or structured events supporting AI-extracted claims when feasible.

Make generated notes editable and visibly distinguish AI-generated content from human-authored notes.

Save edits, provenance, model/version, confidence, and override history.

Never invent an appointment, promise, objection, identity, or disposition when evidence is missing.

9. Consistent voicemail, connection, decline, failure, and disposition workflows

Create one reusable call-status and post-call workflow across manual, AI, and parallel modes.

Ringing, human connected, voicemail, busy, declined, no answer, provider failure, canceled, and unknown must be visually and semantically distinct.

Provider webhooks are authoritative for transport outcome; rep input and AI analysis can enrich but cannot rewrite raw provider history.

Show a brief reason and recommended next action.

Require or intelligently default a disposition according to campaign rules.

Autosave wrap-up drafts.

Allow authorized correction with reason and audit history.

Route callbacks, appointments, nurture, DNC, retry, and completed outcomes consistently.

If classification is uncertain, route to Needs review rather than claiming certainty.

10. Appointments and callbacks

Appointments

Expand the tab into connected calendar and list experiences:

month, week, day, agenda, and list views;

organization/user timezone clarity;

rep/team/campaign/status/source filters;

search, saved views, bulk actions, and Lead 360 access;

create/edit/reschedule/cancel/complete/no-show flows;

conflict and duplicate detection;

owner, attendees, source call, campaign, notes, meeting method/location, reminders, and audit history;

drag-to-reschedule with confirmation and permission checks;

reliable counts that reconcile to dashboard and reports;

graceful integration status if an external calendar connection exists.

Callbacks

Build a meticulous callback workspace:

due now, upcoming, overdue, completed, canceled, and missed sections;

scheduled time and timezone, owner, priority, reason, source call, campaign, attempt history, and preferred dialing mode;

reminders and escalating overdue indicators;

one-click start when eligible;

reschedule, reassign, complete, cancel, and duplicate protection;

callback reservation so two users cannot execute the same callback;

callbacks override ordinary cooldown only according to explicit policy, never DNC.

11. Live transcripts, recordings, summaries, and AI review

Stream transcript segments during supported calls. Store immutable transcript segments with timestamps, speaker, source, confidence, and revision relationship when a provider corrects interim text. The UI must distinguish interim from final text and remain usable when segments arrive late.

The Recordings & Transcripts area must include:

search across permitted transcript content and lead fields;

filters for date, rep/AI agent, campaign, team, outcome, disposition, duration, review score, and flags;

a result row with lead context and Lead 360 access;

synchronized audio playback and transcript highlighting where possible;

speed control, speaker navigation, key moments, notes, summary, disposition, and review;

retention, redaction, download, and access controls based on organization policy and user permissions;

visible recording/transcription failure state rather than a blank panel.

Generate structured call intelligence with schemas, not free-form blobs:

concise summary;

verified facts captured;

objections and responses;

commitments and next steps;

appointment/callback signals;

compliance or quality flags;

proposed disposition;

confidence and evidence references;

review dimensions and coaching suggestions.

AI disposition cannot honestly be guaranteed to be 100% correct. Build it to be highly reliable and measurable:

use a restricted organization-configured disposition taxonomy;

combine deterministic call events with transcript evidence;

require structured output validation;

apply confidence thresholds;

auto-apply only eligible high-confidence dispositions when policy allows;

send low-confidence, conflicting, missing-transcript, or high-impact cases such as DNC to human review according to policy;

allow manual override with reason and full audit history;

measure agreement, override rate, precision/recall on reviewed samples, coverage, and time-to-review;

never fabricate evidence or silently overwrite a human decision.

12. Campaigns and pipeline

Turn campaigns into complete operational objects, not lightly connected labels.

Campaign builder/settings should support, within current provider capabilities:

identity, description, objective, owner/team, lifecycle status, and archive behavior;

audience from imports, selected leads, filters, or smart lists;

manual, AI, parallel, or mixed dialing policy;

schedule, timezone-aware calling windows, pacing/concurrency, caller IDs/lines, retry and max-attempt policies;

scripts, teleprompter content, AI agent/prompt version, objection branches, required fields, and disposition taxonomy;

assignment/pack strategy, priority, capacity limits, and reassignment;

DNC/consent/suppression enforcement;

goals and funnel stages;

pause/resume with safe handling of already-active calls;

draft validation and a pre-launch readiness checklist;

cloning/versioning with audit history.

The campaign pipeline must be event-derived, accurate, drillable, and mutually understandable. Define stages such as eligible, assigned, attempted, connected, qualified, callback, appointment, converted, DNC/suppressed, exhausted, and failed according to the existing business model. A lead may have history in several stages, but a current-state funnel must not double-count it. Clearly distinguish current unique leads from event totals.

13. Reports and leaderboard

Reports

Create a report center using the same metrics and filters as operational screens:

overview plus reports by rep/team, campaign, lead cohort/source, call outcome/disposition, appointments/callbacks, time/hour, and AI/manual/parallel mode;

configurable date range, timezone, grouping, comparison period, and saved views;

tables and charts with drill-down to exact underlying records;

Lead 360 access from every lead-bearing result;

selected custom lead fields available as dimensions/columns where safe and performant;

metric-definition tooltips and last updated status;

export using the flexible export system;

empty/partial/stale data states;

automated parity tests with dashboard and source records.

Accurate, gamified leaderboard

Build a leaderboard that motivates quality, not spam:

individual and team views;

daily, weekly, monthly, and custom periods in organization timezone;

configurable points for verified human connects, qualified outcomes, kept/confirmed appointments, conversions, quality review, productive talk time, and timely callback completion;

configurable penalties or exclusions for invalid activity, excessive overrides, DNC violations, duplicate calls, and canceled/no-show appointments where appropriate;

ranks, personal-best comparison, streaks, badges, goals, milestones, and celebratory microinteractions;

transparent point breakdown and metric definitions;

role/privacy settings and ties handled deterministically;

real-time or near-real-time updates plus reconciliation;

no points from duplicated provider events or repeated edits.

14. Customization and administration

Make the system highly customizable without scattering hard-coded conditions:

custom lead fields with type, validation, formatting, visibility, and filterability;

configurable lead-card sections and table columns;

dashboard cards/layout and saved views;

custom dispositions with allowed transitions, required follow-up fields, colors, and routing actions;

assignment and retry policies;

campaign templates, scripts, AI agent versions, and teleprompter branches;

leaderboard scoring and goals;

report and export templates;

organization timezone, locale, working hours, calling windows, retention, and role permissions;

clear defaults, preview, validation, versioning, audit history, and safe rollback for consequential settings.

Use role-based access appropriate to admins, managers, reps, QA/reviewers, and read-only/reporting users. Enforce permissions on the server, not only by hiding UI controls.

15. Security, compliance, reliability, and accessibility

Treat these as release requirements:

strict tenant isolation and server-side authorization;

authenticated and signature-verified provider webhooks where supported;

secrets only in approved configuration, never code or logs;

encryption and existing secure-storage patterns for recordings and sensitive data;

configurable DNC, consent, calling-window, recording-consent, retention, redaction, and deletion workflows reviewed against the organization’s applicable legal requirements;

no call initiation when eligibility cannot be established safely;

immutable audit events for high-impact changes;

input validation, rate limiting, export protection, and spreadsheet-formula injection prevention;

PII-safe logs and error messages;

retry/backoff, dead-letter or recovery handling, webhook replay protection, and observable background jobs;

service-level telemetry for event lag, state mismatches, metric drift, import failures, reservation conflicts, transcript latency, and provider errors;

responsive layouts and WCAG-conscious keyboard navigation, focus management, labels, contrast, reduced motion, and screen-reader status announcements.

Do not present this product as legally compliant solely because controls exist. Document which safeguards were implemented and which policies require customer configuration or legal validation.

16. UX quality bar

Every major surface must have deliberate hierarchy, consistent terminology, and an obvious primary action. Create reusable primitives for status pills, metric cards, filter chips, lead summaries, activity timelines, call controls, transcript segments, assignment progress, and empty/error states.

The product should feel:

fast and operational rather than like a static admin template;

information-rich but not crowded;

visually consistent across all tabs;

clear about live versus historical data;

clear about human-entered, provider-reported, inferred, and AI-generated information;

customizable without forcing every user to configure everything;

exciting through meaningful real-time motion, progress, and feedback—not gratuitous animations.

Do not use fake gradient-heavy concept art in place of functional components. Do not hide essential data behind hover-only interactions. Do not rely on color alone for call state. Preserve mobile/tablet usability where the existing product supports it, while optimizing the live floor and parallel dialer for desktop operations.

17. Required delivery sequence

Treat all items below as Phase 1 workstreams, executed in this dependency order:

P1.0 — Audit and baseline

Repository and architecture audit

Current data-flow map

Broken/inconsistent behavior inventory

Baseline tests and screenshots

Requirements traceability matrix

P1.1 — Data contracts and accuracy foundation

Canonical call state/events

Lead/custom-field foundation

Eligibility/reservation service

Metric glossary and shared metric layer

Reconciliation and auditability

P1.2 — Lead operations

Accurate lead totals

Import Studio

Typed filters/sorting

Smart Lists 2.0

Flexible exports

Universal Lead 360

P1.3 — Assignment system

Packs-to-assignments model

Manager Assignment Center

Rep My Assignments workspace

Disposition routing

Never-dialed-first and safe retry behavior

P1.4 — Dialer and live floor

Shared dialer shell and consistent state workflow

Manual and AI mode-specific UX

Parallel multi-lane UX

Live floor accuracy

Teleprompter, pre-answer mute, detailed history, and next-up cards

P1.5 — Call intelligence

Live transcript pipeline

Recording/transcript experience

Structured summaries, closing notes, reviews, and disposition confidence/review

Lead timeline integration

P1.6 — Follow-up and campaigns

Appointments calendar/list

Callback workspace

Campaign builder/settings and accurate pipeline

P1.7 — Reports and motivation

Report center and drill-down

Accurate customizable leaderboard and gamification

Cross-surface metric parity

P1.8 — Hardening and release readiness

Complete regression and end-to-end coverage

Performance, accessibility, security, and tenant-isolation verification

Migration rehearsal and rollback evidence

Observability dashboards/alerts

Final documentation and screenshots

Keep each workstream releasable. If the entire Phase 1 cannot be completed in one execution window, finish the current vertical slice, leave the repository passing, update the traceability matrix with exact Done / Partial / Blocked / Not started status, and provide the single highest-value next command/prompt to resume. Never compress unfinished work into a false complete claim.

18. Minimum acceptance tests

Implement automated tests covering at least these behaviors, adapted to the repository’s framework:

Duplicate/out-of-order provider events do not double-count a call or regress terminal state.

Dashboard, report, campaign, and drill-down totals match for identical filters.

Date boundaries and weekly/hourly charts respect organization timezone and daylight-saving transitions.

Average talk time excludes ringing, voicemail, and wrap-up.

Outcome mix is mutually exclusive and reconciles to the defined population.

Unknown import columns survive and appear correctly in Lead 360, filters where typed, reports where selected, and export.

DNC synonyms/truthy values import correctly and block manual, AI, and parallel dialing.

Duplicate strategy produces the previewed skip/merge/create results and is idempotent on retry.

Two concurrent workers cannot reserve or dial the same lead/phone.

Never-dialed eligible leads are selected before retry candidates by default.

A lead does not reappear until its callback/retry/cooldown policy makes it eligible.

Disposition filters return the same leads in table, smart list, assignment preview, report, and export.

AI/manual/either routing filters and campaign policy are enforced server-side.

Manager drag/slider assignment excludes ineligible leads and shows an exact preview/reconciliation.

Rep assignment progress persists and updates after disposition.

Manual pre-answer mute state is accurate and provider-capability aware.

Live-floor state follows canonical events and shows stale/reconnecting when the stream is interrupted.

Parallel lanes never contain the same lead or phone concurrently.

Live transcript interim/final revisions do not duplicate final text.

AI summaries and dispositions retain evidence, confidence, provenance, and override history.

Low-confidence or high-impact uncertain AI dispositions enter review rather than silently applying.

Appointment edits do not inflate appointments-set metrics.

Callback reservation prevents double execution and never overrides DNC.

Exported rows exactly match the visible filter and chosen fields, with permission masking and formula-injection protection.

One tenant cannot access another tenant’s leads, calls, audio, transcripts, exports, events, or aggregates.

Role restrictions are enforced through APIs even when a hidden UI action is called directly.

Every lead link opens the same canonical Lead 360 record and current timeline.

Leaderboard points are idempotent, explainable, and reconcile with source events.

Also create focused end-to-end journeys for:

import → map arbitrary fields/DNC → smart list → assign pack → rep dials → disposition → callback/appointment → dashboard/report reconciliation;

manager watches live AI call → hears supported audio → sees transcript stream → opens Lead 360 → reviews summary/disposition;

parallel session with mixed voicemail/human/no-answer outcomes → correct lane transitions → no duplicate/redial → accurate history and metrics;

export of a filtered custom-field cohort with selected call and appointment data.

19. Performance targets and verification

Measure the current baseline before choosing final thresholds. Then define and document realistic targets for:

dashboard and lead-table initial load;

filter/sort response at expected dataset sizes;

import throughput and memory use;

live-floor event latency;

transcript segment latency;

next-lead reservation latency;

report query time and large-export completion;

UI responsiveness with configured parallel-call concurrency.

Use indexes, pagination/cursors, background jobs, caching, and pre-aggregation only where justified. Cache keys must include tenant and filter dimensions, and invalidation/reconciliation must prevent silent metric drift. Add performance tests or query-plan evidence for the largest operational paths supported by repository fixtures.

20. Definition of done and final response

Phase 1 is done only when:

implemented behavior matches the traceability matrix;

migrations run and rollback safely in a rehearsal environment;

lint, type check, unit, integration, and end-to-end suites pass;

no requested control is a dead button or fake live state;

metrics reconcile across surfaces;

DNC and duplicate-dial protections work across every dialing mode;

permissions and tenant isolation are verified;

major screens have loading, empty, error, stale, and permission states;

documentation and QA evidence are current;

known provider limitations and deferred items are stated honestly.

At the end, report:

Executive outcome: what materially improved for admins, managers, and reps.

Implementation map: database, backend, real-time, frontend, jobs, tests, and docs changed.

Requirement status: every major requirement marked Done, Partial, Blocked, or Deferred, with evidence.

Metric integrity: definitions, reconciliation result, and test fixtures.

Migration/runbook: exact commands, environment/config additions, rollout flags, rollback, and backfill steps.

Verification: commands run and results; screenshots or routes for major UX changes.

Limitations: provider or architectural blockers without pretending they are solved.

Next action: the highest-value remaining Phase 1 slice, or a clean handoff point for the future Phase 2 prompt.

Begin now by inspecting the repository. Produce the audit and traceability foundation, then implement P1.1 and continue through the ordered workstreams as far as can be completed safely with a passing repository. Make decisions autonomously when the existing code, data, and requirements provide enough evidence. Ask a concise blocking question only when proceeding would risk data loss, break a production integration, require unavailable credentials, or force a material product choice with no safe default.