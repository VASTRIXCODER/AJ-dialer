Master Build Prompt — BROCK × KING × AIATWORK Phase 2: AI Opportunity Pipeline

Paste this prompt into Claude Code while it is opened at the root of the existing outbound-dialer repository. Run it only after the Phase 1 prompt has been implemented or its exact completion status has been documented. Do not paste it into the separate ndr-agentic-ai project or any unrelated repository.

You are the principal product engineer, product designer, AI systems architect, real-time communications engineer, workflow-orchestration architect, data engineer, and QA lead responsible for Phase 2 of the BROCK × KING × AIATWORK product transformation.

Phase 1 turned the outbound dialer into a trusted operational foundation: canonical lead data, Lead 360, accurate call events and analytics, assignments, manual/AI/parallel ATLAS dialing, live monitoring, transcripts, appointments, callbacks, campaigns, reports, and DNC-safe eligibility.

Phase 2 must turn that foundation into a complete AI Opportunity Pipeline:

Every legitimate opportunity is owned, worked, followed up, confirmed, tracked, recovered, and intelligently recycled. Reps spend their time talking and closing—not doing administrative cleanup or trying to remember what to do next.

The operating principle is:

King defines the playbook → AIATWORK enforces the playbook → reps sell → Brock sees the truth.

AIATWORK must not try to teach an experienced operator like King how to sell. It must give King a configurable system that makes the Brock sales process happen consistently, detects when reality diverges from the process, and provides one accurate command center for intervention.

This is Phase 2 of a three-phase transformation. Implement Phase 2 completely, preserve Phase 1 behavior, and leave stable extension points for Phase 3 without inventing its unknown scope.

1. Phase 2 business outcomes

The implementation must deliver these connected outcomes:

No untouched opportunity: every eligible new lead receives ownership, an SLA clock, a next action, and escalation if it is not worked.

No forgotten follow-up: calls, messages, callbacks, appointments, reminders, no-shows, and stale opportunities generate deterministic work and automation according to King’s configured playbook.

Every interaction becomes context: outbound and inbound calls attach to the same customer/opportunity history, with verified summaries, extracted facts, next steps, and evidence.

Inbound calls become opportunities: AI reception answers supported inbound lines 24/7, recognizes known callers safely, qualifies intent, schedules or routes, supports human pickup/takeover when available, and creates a follow-up when nobody is available.

Appointments are protected: booking is only the beginning. The system confirms, reminds, detects risk, supports rescheduling, supplies a rep brief, measures shows, and launches no-show recovery.

Hot signals receive immediate attention: re-engagement, inbound callbacks, positive replies, overdue promised callbacks, and at-risk appointments rise to the correct queue with an explainable reason.

Sold customers remain visible without changing Brock’s contract workflow: AIATWORK mirrors trusted sold/install milestones, communicates approved updates, and alerts humans to stalls while leaving the existing contracting process untouched.

Installed customers become an active asset: customer care, satisfaction, issue escalation, reviews, referrals, add-on opportunities, and long-term reactivation are orchestrated responsibly.

Old leads are recycled intelligently: AIATWORK decides who is eligible today, why now, through which channel, with what approved message, and when to stop. It must never mean “call everyone again.”

King operates from one truth: today’s production, rep performance, appointment health, hot opportunities, pipeline leaks, sold/install stalls, reactivation results, and drill-down evidence live in one command center.

2. Phase 1 continuity and operating rules

Before changing code, inspect:

the existing Phase 1 requirements traceability matrix and QA evidence;

the actual schema, API, UI routes, jobs, providers, and tests now present;

the canonical lead, call attempt, call event, assignment, campaign, appointment, callback, transcript, recording, disposition, metric, and audit contracts;

Phase 1 feature flags, migrations, known limitations, and incomplete items;

the telephony provider’s inbound calling, media streaming, transfer, conference, DTMF, recording, transcription, and live-takeover capabilities;

the messaging provider’s SMS/MMS, delivery receipt, inbound reply, STOP/opt-out, template, and throughput capabilities;

any calendar, CRM, contracting, installation, or customer-care integration already present.

Create or update:

docs/phase-2/current-state-and-phase-1-readiness.md

docs/phase-2/requirements-traceability.md

docs/phase-2/opportunity-domain-and-state-machines.md

docs/phase-2/playbook-and-orchestration-contracts.md

docs/phase-2/channel-and-provider-capabilities.md

docs/phase-2/metric-glossary.md

docs/phase-2/ai-schemas-and-evaluation.md

docs/phase-2/implementation-plan.md

docs/phase-2/migration-and-rollback.md

docs/phase-2/qa-evidence.md

docs/phase-2/operations-runbook.md

Map every requirement in this prompt to a concrete implementation and mark it Done, Partial, Blocked, Deferred, or Not started. Include file paths, endpoints, migrations, tests, routes, and screenshots as evidence. Never convert Partial or Blocked into Done merely because a screen exists.

Preserve these Phase 1 constraints:

One canonical source of truth; no separate dashboard-only, dialer-only, or automation-only copies of the same business state.

Provider webhooks remain authoritative for raw communications outcomes.

DNC, consent, quiet hours, tenant isolation, permissions, eligibility, reservation, and retry policies are enforced on the server.

Existing Lead 360, Assignment Center, My Assignments, Smart Lists 2.0, ATLAS dialer modes, Live Floor, campaigns, callbacks, transcripts, appointments, reports, and shared metrics are extended rather than rebuilt as conflicting modules.

Every provider event and automation action is idempotent, auditable, and safe when duplicated, delayed, or received out of order.

Unsupported provider capabilities are capability-gated and explained honestly. Do not simulate live audio, transfer, takeover, delivery, confirmation, or AI success.

Use backward-compatible migrations, feature flags, staged backfills, and rollback plans.

Do not touch ndr-agentic-ai or any unrelated project.

Do not stop after producing a plan. After the audit, proceed through safe vertical slices unless blocked by a destructive ambiguity, unavailable credential, unsupported provider capability, production integration risk, or a material playbook decision with no safe default.

3. Product terminology and configuration boundary

Use these product terms consistently:

AIATWORK: the opportunity-orchestration and intelligence platform.

ATLAS: the manual, AI, and parallel dialing system established in Phase 1.

Brock: the operating business/tenant whose sales, installation, and customer lifecycle is being managed.

King: the senior sales operator/manager who defines and monitors the playbook.

Rep: a human seller, setter, closer, or customer-facing operator.

Opportunity: the sales/business pursuit connecting a lead/customer to a source, campaign, owner, lifecycle, and expected next action.

Touch: a recorded inbound or outbound interaction attempt through an approved channel.

Work item: a concrete task requiring human or automated execution.

Playbook: a versioned, manager-approved set of triggers, conditions, actions, SLAs, stop rules, routing rules, and escalation rules.

Signal: a time-bound fact suggesting urgency, intent, risk, or pipeline leakage.

Branding and tenant-specific labels must be configurable. Do not hard-code Brock, King, DFW, solar, or specific campaigns into database logic. The Brock deployment should use those labels, but the implementation must remain structurally reusable.

4. Canonical opportunity and orchestration model

Extend the Phase 1 domain; do not overload the Lead record with every new concept. Reuse existing entities where correct, but ensure the canonical model covers:

Opportunity

stable opportunity ID and tenant ID;

linked lead/contact and, where supported, household, property, account, or customer;

source, original source, campaign, territory, product/offer, and attribution history;

current owner, owner team, assignment reason, previous owners, and ownership timestamps;

sales lifecycle stage and stage-entry timestamp;

operational status and health;

interest level, qualification state, timeline, objections, and verified important homeowner/customer facts;

priority, priority reason, hot-signal state, risk state, and score version where scoring exists;

first received, first assigned, first attempted, first contacted, last touched, next action due, and closed timestamps;

attempt and contact counters based on canonical touch events;

active playbook/version and automation state;

outcome/loss/nurture reason with provenance;

links to calls, messages, appointments, callbacks, sales, fulfillment mirror, customer-care cases, and reactivation history;

audit/version information.

Define uniqueness and multiplicity explicitly. A lead may participate in more than one campaign or opportunity only according to a documented policy. Prevent accidental duplicate active opportunities for the same person/phone/property/product combination while preserving legitimate repeat or add-on business.

Touch and conversation

Create one channel-neutral touch model linked to Phase 1 call attempts and future message/email events:

direction: inbound or outbound;

channel: manual call, AI call, parallel call, inbound AI call, inbound human call, SMS, email, appointment, manual note, or supported extension;

provider IDs and idempotency keys;

initiated, delivered/ringing, connected/replied, failed, and completed timestamps;

raw provider outcome and canonical touch outcome;

actor: rep, AI agent, manager, customer, system;

campaign, playbook, work item, opportunity, lead, and owner context;

content/recording/transcript references subject to permissions;

consent and policy decision used before execution;

resulting signal, next action, disposition, or stage proposal;

audit and provenance.

Work item

Represent all actionable work consistently:

type: first call, callback, follow-up call, message review, appointment confirmation, appointment preparation, no-show recovery, hot-opportunity response, install-stall review, customer issue, reactivation, or custom;

linked opportunity/lead/customer and originating event;

owner/team/queue;

priority, reason, SLA due time, scheduled time, timezone, and escalation time;

status: pending, reserved, in progress, waiting, completed, canceled, skipped, expired, blocked, or needs review;

completion evidence/outcome;

automation eligibility and required human approval;

deduplication key so one trigger cannot create duplicate work;

audit trail.

Playbook definition and execution

Store:

versioned playbook definitions;

trigger, eligibility conditions, schedule, action sequence, wait conditions, branching, stop rules, and escalation;

channel templates and approved variables;

assignment/routing policy;

consent, DNC, quiet-hour, frequency-cap, and max-attempt constraints;

human approval requirements;

draft, simulated, published, paused, retired, and rolled-back states;

a playbook instance per opportunity/customer when activated;

step/action execution state, attempts, provider response, error, retry, and completion;

the exact playbook version used for every action.

Signal

Store signals as explainable, time-bound records:

type, source event, source evidence, detected time, expiration/TTL, confidence, and severity;

linked opportunity/customer/appointment/work item;

owner and acknowledgment state;

whether it affected priority, routing, or an automated action;

resolution and false-positive feedback.

Inbound reception and handoff

Model:

inbound number, line/campaign attribution, caller ID, caller-match confidence, and verification state;

AI reception session and agent/script/knowledge version;

captured intent, qualification answers, promised next action, and extracted facts;

routing candidates, selected rep/team, routing reason, availability snapshot, and transfer attempts;

warm handoff summary, transfer/conference status, human takeover event, fallback action, and final outcome;

call/touch linkage and full Lead 360 timeline integration.

Appointment protection

Extend the Phase 1 appointment model with:

confirmation state and state history;

reminder/protection policy and version;

confirmation attempts, channel, delivery, reply, and response parsing;

risk status, reasons, evaluation time, and rule/model version;

pre-appointment brief and evidence;

no-show declaration source, grace period, and timestamp;

recovery instance, actions, result, and recovered appointment;

reschedule lineage so the same business appointment is not double-counted.

Fulfillment mirror and customer care

Model a read-only/local mirror of external sold-to-install status:

external system and immutable external identifiers;

trusted source status, mapped AIATWORK status, event time, ingestion time, and mapping version;

sold, contract/process underway, install pending, install scheduled, install approaching, installed, and post-install milestones where the source supports them;

stall threshold, stall reason, owner, alert, and resolution;

customer communication actions based only on verified status;

post-install care plan, satisfaction responses, review/referral requests, issue cases, upsell/add-on eligibility, and reactivation dates.

5. Separate state machines—never use one overloaded status

Implement explicit state machines and document valid transitions. Keep these dimensions separate:

Sales lifecycle

Suggested canonical stages, adapted to existing terminology:

New → Assigned → Attempting → Contacted → Interested/Qualified → Appointment Booked → Appointment Completed → Sold

Alternate terminal or holding outcomes:

Nurture/Not Now, Lost, Invalid, DNC/Suppressed, Exhausted, Duplicate, or Disqualified.

Do not infer Sold from conversation text alone. Require the trusted sales/contract source or an authorized human action.

Operational work state

Every open opportunity should resolve to one of:

has a future valid next action;

has an active/reserved work item;

is waiting on customer or external process with an explicit review time;

is intentionally paused/suppressed with a reason;

is closed.

Create a leak detector for opportunities that match none of these conditions.

Appointment state

Proposed → Booked/Unconfirmed → Confirmed → Completed/Show

Branches:

Rescheduled, Canceled, No Show, or Invalid.

At Risk is a computed flag with reasons, not a destructive replacement for the underlying appointment state.

Fulfillment state

Not Sold → Sold → Contract/Process Underway → Install Pending → Install Scheduled → Install Approaching → Installed → Post-Install

This state must mirror trusted Brock sources. AIATWORK may annotate, alert, and communicate but must not silently advance Brock’s contracting or installation process.

Customer-care state

Not Started → Thanked → Satisfaction Requested → Satisfied or Issue Detected

Satisfied may proceed to review, referral, add-on, and long-term check-in. Issue Detected must create human follow-up and pause promotional asks until resolved.

Every transition must record source, actor, timestamp, reason, prior state, new state, supporting evidence, and playbook/model version where relevant.

6. Orchestration engine: King’s playbook enforced safely

Build a deterministic, observable orchestration engine. AI may extract information and recommend actions, but the execution framework must control whether, when, and how an action occurs.

The engine must support:

event triggers such as lead received, call completed, message received, appointment booked, appointment unconfirmed, appointment no-show, inbound callback, sale recorded, install stage changed, installed, customer issue, or stale timer;

scheduled triggers and periodic eligibility sweeps;

typed conditions using canonical and custom fields;

delays relative to events in the lead/customer’s local timezone;

branches based on verified outcome, response, state, ownership, and consent;

human tasks, automated calls/messages, notifications, assignments, escalations, stage proposals, and review requests;

wait-until and wait-for-event steps;

stop conditions for reply, contact, appointment, sale, DNC/opt-out, complaint, active issue, or manager pause;

frequency caps and maximum attempts by channel and playbook;

per-opportunity execution locks;

exactly-once business semantics through idempotency keys even when jobs retry;

retry with backoff for transient failures and terminal classification for permanent failures;

cancellation and compensation when an appointment is rescheduled, a lead is suppressed, ownership changes, or a playbook is paused;

dry-run/simulation against historical or sampled opportunities;

kill switches at tenant, playbook, channel, campaign, and opportunity level;

full execution timeline and failure queue.

The AI must never independently rewrite King’s published playbook. Changes require an authorized user, validation, versioning, and publication. Suggestions may be offered separately with evidence.

7. Lead entry, routing, ownership, and speed-to-lead

Every supported lead-entry path—Phase 1 import, API, form, CRM sync, manual entry, inbound unknown caller, or campaign intake—must enter one canonical workflow.

Intake requirements

Validate tenant, source, source record ID, normalized phone(s), email, and required fields.

Preserve all source and custom fields from Phase 1.

Detect exact and probable duplicates using configurable rules.

Detect invalid/bad numbers from formatting, provider results, prior outcomes, and authorized validation services. Preserve original data and reason.

Respect existing DNC/consent/suppression state before any action.

Tag original source and current attribution without overwriting history.

Identify campaign, product, territory, and routing policy.

Create or attach to the correct opportunity idempotently.

Start the speed-to-lead clock only after the record is accepted and eligible for work. Record why a clock is delayed or not applicable.

Assignment requirements

Support configurable routing by:

territory/location;

source/campaign/product;

rep/team role or skill;

working schedule and current presence;

capacity, active assignment load, and SLA backlog;

round-robin or weighted round-robin;

sticky ownership for known callers/customers;

prior relationship and existing appointment;

manager override.

Every assignment must include a reason. If no preferred rep is available, use a documented fallback queue or escalation; never leave owner null silently.

Speed-to-lead

Track:

lead received time;

eligible time;

first assigned time;

first meaningful attempt time;

first human contact/reply time;

elapsed time at each threshold;

current owner and escalation history.

King configures SLA thresholds by source/campaign/priority. The system must:

notify the assigned rep immediately;

create the first-touch work item;

escalate as thresholds approach;

reassign or notify a manager after breach according to policy;

stop the first-touch SLA once a qualifying attempt occurs while continuing to measure first contact;

expose untouched and overdue queues;

never reset history merely because ownership changes.

King’s intake view must show lead volume, source, ownership, lead age, eligibility, untouched leads, contact speed, SLA compliance, and drill-down records.

8. Outbound rep workflow through ATLAS

Extend—not replace—the Phase 1 ATLAS dialer, assignments, Lead 360, call state machine, transcript pipeline, notes, and disposition system.

Before the call

Give the rep:

opportunity stage and health;

verified lead/customer/property context;

complete prior touch history;

last conversation summary;

objections, interest, timeline, promised callback, and open appointment;

source/campaign and approved script;

“why this person now” and the playbook step;

recommended goal and talking points;

compliance/consent restrictions;

one clear next action.

During the call

Record and transcribe when permitted and supported.

Show the Phase 1 teleprompter, live notes, Lead 360, and AI assistance.

Detect candidate interest, objections, timeline, appointment request, follow-up date, important homeowner/customer information, and commitments.

Clearly distinguish interim AI suggestions from verified facts.

Let reps correct or confirm extracted information without interrupting the call.

After the call

Generate a structured output:

canonical provider outcome;

proposed business disposition;

interest level;

qualification state;

objections;

timeline;

appointment details;

promised follow-up date/time/timezone;

verified important facts;

commitments by customer and rep;

concise summary;

recommended next action;

evidence references and confidence for every material extraction.

The pipeline may update automatically only according to policy and confidence. High-impact changes such as DNC, Sold, disqualified, sensitive customer facts, or contract status require deterministic evidence and/or authorized review. Missing or conflicting evidence goes to Needs Review.

Every completed call must:

attach to the correct lead/opportunity timeline;

log the touch;

complete or reschedule the originating work item;

create the next valid work item when required;

update the opportunity’s last touch and next action;

trigger appointment protection, no-answer follow-up, nurture, hot-signal, or review playbooks as appropriate;

never generate duplicate callbacks or reminders on webhook retry.

No answer and stale lead behavior

Missed/no-answer/busy/voicemail outcomes must enter a configurable multi-touch follow-up sequence rather than disappearing. The sequence must respect Phase 1 cooldowns, max attempts, DNC, local calling windows, channel consent, and frequency caps.

Old opportunities should recycle only after the configured interval and only when no appointment, callback, active conversation, open issue, sale, install, DNC, or other stop condition blocks them.

9. AI inbound reception

Build AI Inbound Reception as a first-class system, not an outbound screen with direction reversed.

Inbound entry

Route configured inbound numbers through the telephony provider’s supported inbound flow.

Identify tenant, line, source, campaign, business unit, and operating hours from the dialed number/configuration.

Normalize caller ID and search permitted records.

Match an existing lead/customer only when confidence is sufficient.

When several records match, ask minimal safe clarifying questions and avoid exposing private details.

For an unknown caller, create a provisional lead/opportunity with source “Inbound Call” and capture information progressively.

Attach the inbound call/touch to the matched or newly created record exactly once.

AI reception behavior

The AI receptionist must:

answer 24/7 when enabled and provider services are healthy;

use the approved Brock greeting, recording/transcription notice, language, tone, and script version;

recognize returning leads/customers safely;

know the verified reason for prior contact, last conversation, assigned rep, appointment status, and trusted fulfillment status;

answer approved basic questions from versioned knowledge sources;

state uncertainty and route to a human instead of inventing;

capture name, callback number, intent, product/service interest, urgency, preferred time, and relevant qualification fields;

schedule an appointment only into real permitted availability;

create a callback/work item when resolution or transfer is not possible;

handle interruptions/barge-in, silence, DTMF, voicemail-like audio, and hangup gracefully where the provider supports them;

never make unapproved guarantees about pricing, savings, eligibility, contracts, incentives, timelines, installations, or outcomes.

Caller recognition and privacy

Caller ID is a routing signal, not proof of identity. Before exposing sensitive record details, require configured verification appropriate to the information. Store verification status and method. Unknown or unverified callers can still receive general information and leave intent/callback details.

Routing and transfer

Use:

existing owner/sticky relationship;

rep presence and active-call state from Phase 1 Live Floor;

role/skill, territory, campaign, language, capacity, business hours, and overflow priority;

manager-configured queue and fallback rules.

Support, only when the provider truly allows:

warm transfer with AI-generated handoff brief;

ringing multiple eligible reps according to policy;

rep pickup/takeover from AI;

conference/bridge transition;

fallback to callback, voicemail capture, or scheduled appointment;

continuation by AI while a rep is being located.

The rep must receive before pickup:

caller identity/match confidence;

reason for calling;

known opportunity/customer stage;

last interaction;

current intent;

key answers;

urgency;

recommended handling;

transfer context.

If nobody is available, AI must confirm the captured next step, create the correct callback/work item, notify the owner/queue, and protect it with an SLA.

Inbound monitoring and metrics

Integrate inbound sessions into Live Floor with live transcript/audio where permitted, current intent, route state, transfer state, and fallback state.

Measure:

inbound calls offered;

AI answered;

human answered directly;

recognized existing vs new callers;

qualified;

transferred attempted;

transferred connected;

appointments created;

callbacks created;

abandoned;

unresolved/needs review;

final outcomes and time to human.

Every metric must drill down and reconcile to canonical inbound sessions.

10. Appointment Protection System

Treat an appointment as an actively protected commitment:

Booked → Confirmed → Reminded → Show

Booking integrity

All appointment sources—rep, AI outbound, AI inbound, manager, external calendar—use one canonical appointment contract.

Validate availability, timezone, owner, duration, duplicate/conflict, and required fields.

Link source touch/call, lead, opportunity, campaign, setter, closer/owner, and playbook.

Use idempotency so repeated AI or provider events cannot create duplicate appointments.

Maintain reschedule lineage and never inflate appointment-set counts.

Configurable protection sequence

Support a manager-configured sequence such as:

Immediate confirmation after booking.

Day-before reminder.

Same-day reminder.

Pre-appointment confirmation/check-in.

Additional escalation for still-unconfirmed appointments.

Timing must be relative to the appointment’s local timezone and honor channel consent, quiet hours, frequency caps, provider status, and customer preferences. The exact schedule must be configurable by campaign, appointment type, source, and risk.

Customers must be able to:

confirm;

request rescheduling;

cancel;

ask a basic question;

request human help;

opt out of a channel.

Parse replies with structured, evidence-backed classification. When ambiguous, ask a safe clarification or create human review. Do not treat delivery as confirmation.

Confirmation states

Show:

Unconfirmed;

Confirmation Sent;

Confirmed;

Reschedule Requested;

Rescheduled;

Canceled;

At Risk;

Completed/Show;

No Show.

Rep and manager views must show who/what changed the state, when, through which channel, and supporting evidence.

Appointment risk

Calculate risk from operational facts—not protected demographic attributes. Potential reasons:

confirmation not received by configured threshold;

reminder delivery failure;

invalid or unavailable contact channel;

customer asked to reschedule but no new time exists;

promised rep follow-up overdue;

repeated unanswered protection touches;

recent negative/uncertain intent;

prior no-show behavior where allowed;

calendar/assignment conflict;

appointment owner unavailable.

Display each reason, freshness, and recommended action. Risk is a prioritization tool, not an unexplained black-box score.

Rep pre-appointment brief

Create a concise, evidence-grounded brief displayed in My Day, calendar, appointment detail, and Lead 360:

JOHN SMITH — 3:30 PM
Confirmed
Source: DFW Solar Add-On
Attempts: 3
Last conversation: Interested
Primary concern: Monthly savings
Objection: Does not want a large upfront cost
AI recommendation: Lead with the approved economics discussion

The actual card must use real data and include:

confirmation/risk state;

appointment time/timezone and owner;

source/campaign;

attempt/contact history;

last summary;

verified needs, goals, objections, decision timeline, and important facts;

prior commitments;

open questions;

approved recommended approach;

direct links to transcript/recording evidence where permitted.

Never manufacture a concern, objection, recommendation, or homeowner fact to fill the card.

Appointment operations view

Extend Phase 1 calendar/list with:

today/upcoming/unconfirmed/at-risk/reschedule/no-show/recovered segments;

team/rep/campaign/source/appointment-type filters;

real-time confirmation status;

mass but policy-safe reminder actions;

owner reassignment;

conflict and coverage warnings;

funnel and show-rate analytics;

Lead 360 and playbook timeline.

11. No-show recovery

Replace rep memory with a deterministic recovery workflow:

No Show → Immediate message → Call/AI follow-up → Reschedule → Protected appointment

Trigger

Declare no-show only after:

the appointment time plus configured grace period; and

absence evidence from the trusted appointment/rep/calendar workflow; or

an authorized human marks no-show.

Prevent a delayed check-in, reschedule, or duplicate external event from triggering conflicting recovery.

Recovery sequence

Support:

immediate approved no-show SMS/message;

automated or rep callback work item;

AI inquiry asking whether the customer wants to reschedule;

prioritized alert when the customer replies;

available-time lookup and rescheduling;

escalation to an owner/queue;

controlled follow-up until a stop rule is reached.

One no-show should have one active recovery instance. Use idempotency to prevent duplicate messages/calls. Rescheduling must create/update the proper appointment lineage, cancel obsolete reminders, and activate a new protection sequence.

Stop rules

Stop or pause when:

rescheduled;

customer declines;

customer asks not to be contacted or opts out;

DNC/suppression is applied;

complaint or customer-care issue is detected;

manager pauses/closes;

maximum recovery duration/attempts is reached.

Measurement

Define:

no-shows;

recovery attempts;

customers re-engaged;

rescheduled;

recovered shows;

no-show recovery rate;

median time to re-engage and reschedule;

recovery by rep, source, campaign, appointment type, and sequence.

Do not count a rescheduled appointment as a recovered show until the later appointment is actually completed/showed.

12. AI Sales Assistant for every rep

Build a role-aware assistant embedded in My Day, ATLAS, Lead 360, appointments, callbacks, and assignments.

The assistant should handle:

call summaries and CRM notes;

follow-up and callback creation;

appointment reminders and protection status;

lead/opportunity/customer history;

daily prioritized queue;

stale-opportunity and SLA alerts;

no-show recovery work;

“Who should I call next?”;

pre-call and pre-appointment briefs;

promised-action tracking;

end-of-day summary;

next-day preparation;

manager-approved coaching suggestions.

My Day

Give each rep one operational view:

start-here priority;

overdue promised callbacks;

hot opportunities;

new untouched leads;

due callbacks/follow-ups;

appointments and confirmation risk;

no-show recovery;

assignment progress;

stale opportunities;

completed work and daily performance.

The rep can open Lead 360, launch ATLAS, send an approved message, complete/reassign a task where permitted, or view why something is prioritized.

“Who should I call next?”

This must query the canonical eligibility, assignment, SLA, hot-signal, callback, and playbook state. It must return:

one recommended opportunity or a short ordered list;

why now;

due/SLA context;

opportunity stage and last touch;

approved call goal;

consent/eligibility check;

expected next action.

It must never recommend DNC, ineligible, concurrently reserved, outside-call-window, sold/active-install, unresolved issue, or already-completed work.

Assistant action boundary

Label:

suggestions requiring rep confirmation;

playbook-approved actions AIATWORK may execute automatically;

actions blocked by permission, consent, confidence, or missing data.

The assistant cannot invent customer facts, promise discounts, change Sold/install status, bypass DNC, alter King’s playbook, or silently close opportunities.

End-of-day summary

Summarize from source records:

work completed;

calls/contacts/appointments;

promised actions still open;

overdue or unworked opportunities;

tomorrow’s appointments and risk;

hot signals;

assignment progress;

issues needing manager attention.

Every count and item must link to its underlying records.

13. Hot Opportunity Detection

Build an explainable signal-and-priority system continuously evaluating canonical events.

Examples:

Prospect called back twice.

Prospect replied with clear interest.

Appointment tomorrow remains unconfirmed.

High-intent opportunity has been untouched for two hours.

Prospect requested a callback at 4:00 PM and it is overdue.

Old prospect re-engaged after 37 days.

Customer visited/responded through another supported high-intent channel.

AI inbound reception captured urgent buying intent.

No-show customer asked to reschedule.

Signal engine

Support:

deterministic rules for explicit events and SLA breaches;

AI classification only where language/intent interpretation is needed;

evidence, confidence, severity, freshness, TTL, and decay;

configurable weights and thresholds by campaign/source/stage;

deduplication and signal aggregation;

current owner, required response SLA, and escalation;

acknowledgement, snooze with reason, resolution, and false-positive feedback;

prevention of permanent priority inflation from stale signals.

Hot queue

Show:

customer/opportunity;

signal label;

why it is hot;

evidence excerpt/link;

age and expiration;

current owner;

required action and SLA;

last touch;

eligibility;

one-click ATLAS or approved response.

When ownership is missing, absent, or overloaded, route through King’s configured fallback. Do not let multiple reps race the same hot opportunity.

Measurement

Track hot opportunities detected, actioned within SLA, connected, appointed, sold, expired, dismissed, and falsely classified. Measure lift against comparable non-hot cohorts when enough data exists.

14. Sold-to-install visibility without changing Brock’s contracting process

This boundary is absolute:

Do not modify, replace, or silently drive Brock’s existing contracting process.

AIATWORK may observe trusted milestones around it, create internal visibility/tasks, send approved communications, answer questions from verified data, and alert King/Brock to stalls.

Integration adapter

Identify the actual source of truth for Sold, contract/process, and installation status.

Integrate through supported API, webhook, file sync, or authorized manual update.

Keep external IDs and raw status history.

Map external statuses to AIATWORK’s mirror with versioned mapping.

Make ingestion idempotent and resilient to delayed/out-of-order events.

Flag conflicts or unknown states for review; do not guess.

Show data freshness and source.

Never write back unless a future explicitly approved integration supports a narrow, audited action.

Install Watch

Show:

sold customers;

current trusted milestone;

stage age;

expected next milestone/date if provided by the source;

outstanding internal action;

owner/team;

customer communication status;

stall threshold and reason;

last verified update;

alerts and resolution.

Suggested monitored stages:

Sold → Contract/process underway → Install pending → Install scheduled → Install approaching → Installed → Post-install

Thresholds must be configurable by product/process. “Stalled” means the trusted state has exceeded a defined expectation or an expected step is missing; show the rule.

Customer communication

AIATWORK may:

acknowledge the next approved milestone;

send installation reminders;

communicate only verified schedule/status data;

answer approved inbound questions;

capture customer concerns;

route complex, contractual, technical, billing, safety, or disputed questions to a human;

notify staff of outstanding steps.

Never invent an install date, contract status, approval, equipment detail, incentive, savings amount, or resolution.

Leadership visibility

King/Brock must see:

sold volume;

stage distribution;

aging and stalled count;

installs scheduled/approaching/completed;

customers awaiting an internal action;

customer questions/issues;

drill-down by owner, source, campaign, stage, and age.

15. Post-install automation and customer care

Trigger only from a trusted Installed milestone.

Post-install journey

Support a configurable sequence:

Thank-you communication.

Satisfaction check.

Issue detection and human escalation.

Review request when appropriate.

Referral request when appropriate.

Follow-up check-in.

Add-on/upsell eligibility when appropriate.

Long-term customer reactivation.

Satisfaction and issue handling

Capture satisfaction through structured response plus free text.

Detect negative sentiment, unresolved issue, complaint, safety/technical concern, billing/contract question, or request for human help.

Create a high-priority customer-care work item with owner and SLA.

Notify the appropriate human/team.

Pause review, referral, and promotional steps while an issue is open.

Record resolution and customer confirmation before resuming eligible journeys.

Do not let AI claim an issue is resolved without trusted human/system evidence.

Review and referral

Use approved, truthful messaging.

Respect platform, consent, and company policies.

Prevent duplicates and excessive requests.

Track request, delivery, response/click where supported, completion where known, and attribution.

Do not manipulate, fabricate, or condition customer support on a positive review.

Add-on and long-term value

Preserve the installed customer as a customer/account, not a dead lead.

Identify approved add-on opportunities using product/customer facts that exist.

Create a distinct opportunity linked to the original customer rather than corrupting the completed sale.

Explain why the customer is eligible and prevent contact during open issues or suppression.

Measure satisfaction response, issue rate, time to human response/resolution, review requests/completions, referrals, referral opportunities/sales, add-on opportunities/sales, and long-term engagement.

16. Dead-lead reactivation

Build a Reactivation Studio and controlled eligibility engine for:

no-answer cohorts;

old appointments;

no-shows;

Not Now/nurture prospects;

previously interested prospects;

lost opportunities eligible for re-engagement;

old customer database;

installed customers eligible for approved add-ons.

Non-negotiable principle

Reactivation must answer:

Who should be contacted today, why now, through which permitted channel, with what approved message, and when should the system stop?

It must not mean:

Call everyone again.

Eligibility

Exclude or pause:

global/campaign/channel DNC or opt-out;

invalid/bad numbers without another permitted channel;

active callbacks, appointments, conversations, sales, installs, or customer-care issues;

opportunities inside cooldown;

maximum attempts reached;

explicit “do not contact until” date;

duplicate active opportunity;

restricted source/campaign;

contact outside permitted hours;

customers already receiving another conflicting playbook.

Selection and reason

Use deterministic facts plus carefully evaluated AI signals:

prior interest and objection;

prior promised future timing;

time since last touch;

prior appointment/no-show history;

new inbound or message engagement;

source/campaign/product relevance;

prior outcome and number validity;

customer lifecycle and add-on eligibility;

approved business timing/seasonality inputs where configured.

Every selected record must display “Why now” and the evidence. Do not use protected traits or unsupported inferences.

Controlled sequence

Create a reactivation cohort with frozen eligibility snapshot and playbook version.

Set channel mix, cadence, frequency cap, max attempts, and stop rules.

Personalize only from approved, verified fields.

Route positive replies/callbacks to a hot queue immediately.

Stop on contact, appointment, sale, decline, opt-out/DNC, complaint, active issue, or exhaustion.

Allow pause, suppression, and cohort rollback of future actions.

Use control/holdout groups where feasible to measure incremental lift rather than raw conversions only.

Measurement

Track cohort size, attempted, delivered, contacted, re-engaged, appointed, showed, sold, opted out, complained, exhausted, and incremental lift. Calculate cost and revenue only from trusted inputs, with definitions visible.

17. King’s Command Center

King must not dig through ten screens. Build one role-aware operating view with accurate, real-time or clearly timestamped data.

Today command strip

Display configurable cards such as:

Leads Worked

Contacts

Appointments Set

Confirmed

At Risk

No Shows

Recovered

Sales

Installs

Hot Opportunities

Do not hard-code example numbers. Every card must show definition, date/timezone, freshness, active filters, trend/comparison where valid, and drill-down.

Metric definitions

At minimum define:

Leads Worked: unique eligible opportunities with at least one qualifying outbound touch initiated today. Also expose total touch attempts separately.

Contacts: unique opportunities with a verified human connection or qualifying two-way reply today. Keep voicemail and delivery separate.

Appointments Set: distinct canonical appointments created today, excluding duplicate writes and reschedule inflation.

Confirmed: distinct active appointments that entered Confirmed in the selected period; optionally show current confirmed appointments for upcoming window as a separately labeled stock metric.

At Risk: current upcoming appointments matching a published risk rule as of the displayed freshness time.

No Shows: appointments newly declared No Show in the period under the grace/source policy.

Recovered: no-show recovery instances that produced a new valid appointment in the period; display recovered shows separately.

Sales: distinct opportunities entering trusted Sold state in the period.

Installs: distinct customers entering trusted Installed state in the period.

Hot Opportunities: active, unexpired hot opportunities requiring or receiving attention; show newly detected separately.

Extend the Phase 1 shared metrics service. Do not recalculate these independently in each widget.

Rep performance

Show:

Calls | Contacts | Appointments | Confirmed | Shows | Sales | Follow-Up Completion %

Also support:

speed-to-lead;

hot-response SLA;

callback SLA;

appointment show rate;

no-show recovery;

productive talk time;

assignment completion;

quality/review metrics.

Define Follow-Up Completion % as due follow-up work completed within its allowed window divided by follow-up work due in the period, with exclusions documented. Do not reward duplicate calls or administrative edits.

Pipeline leaks

Show prioritized, drillable queues:

hot leads untouched;

new leads approaching/breaching speed-to-lead SLA;

appointments unconfirmed or at risk;

callbacks/promised actions overdue;

opportunities with no valid next action;

no-show recoveries unworked;

inbound calls unresolved;

sold customers stalled;

install/customer questions awaiting humans;

old leads newly reactivated;

automation failures or dead-letter items.

Each leak must include count, severity, oldest age, owner/team, expected action, SLA, and one-click operational drill-down.

Supporting views

Add:

live intake and ownership;

source/campaign funnel;

inbound reception funnel;

appointment protection funnel;

no-show recovery;

hot opportunity queue;

sales-to-install aging;

post-install care/issues;

reactivation cohorts and lift;

rep/team performance;

AI automation health and human-review queue.

Filters must include date/timezone, team, rep, source, campaign, territory, product, opportunity stage, channel, playbook, and relevant lifecycle dimensions. Saved leadership views and scheduled summaries may be supported through existing product patterns.

18. Playbook Studio and administration

Give King authorized control over how Brock operates.

Visual Playbook Studio

Support:

trigger selection;

typed conditions with nested AND/OR;

timing, delays, local-time windows, and wait-for-event;

human vs automated action;

channel/template/AI-agent selection;

assignment and escalation;

retry/cooldown/frequency cap/max attempts;

stop rules;

approval gates;

test data preview;

estimated affected records;

conflict detection with other playbooks;

draft, validate, simulate, publish, pause, clone, version, retire, and roll back.

Initial playbook templates

Provide configurable templates for:

new-lead speed-to-lead;

no-answer follow-up;

promised callback protection;

appointment confirmation/reminders;

at-risk appointment escalation;

no-show recovery;

inbound transfer fallback;

hot-opportunity response;

stale-opportunity escalation;

sold/install milestone communication;

stalled-install alert;

post-install customer care;

dead-lead reactivation.

Templates are starting points, not hard-coded behavior.

Safe publication

Before publish:

validate referenced fields, campaigns, dispositions, providers, numbers, calendars, queues, templates, and permissions;

calculate possible reach and action volume;

warn about missing consent/quiet-hour configuration;

detect loops, unreachable steps, conflicting actions, and missing stop rules;

simulate representative paths;

require authorized confirmation;

retain prior version for rollback.

Show live execution counts, success/failure, waiting steps, blocked policy decisions, review items, and affected opportunities. Provide a per-opportunity execution timeline in Lead 360.

19. Cross-channel communication integrity

Create or extend a provider-neutral communication layer for calls, SMS, and any other supported channel.

Requirements:

normalized sender/recipient identities;

approved templates with versioning;

safe variable substitution from verified fields;

message preview;

idempotent send;

delivery/read/reply status only where the provider genuinely supplies it;

inbound reply threading to the correct lead/opportunity;

STOP/opt-out and DNC handling before any further outbound action;

local timezone, quiet hours, frequency caps, and channel preference;

invalid-number/bounce/failure feedback into eligibility;

sending limits, retry/backoff, and provider failover only if explicitly configured;

audit trail and content retention according to policy;

clear human vs AI vs system authorship.

Do not claim a message was delivered, read, confirmed, or answered without the corresponding provider/customer event.

20. AI grounding, decision safety, and evaluation

No AI component is 100% accurate. Build for high reliability, measurable quality, and safe uncertainty.

Grounding

AI inputs may include only permission-appropriate:

current Lead 360/opportunity data;

verified prior summaries and structured facts;

relevant transcript segments and messages;

appointment and callback state;

published playbook/script;

approved knowledge articles;

trusted fulfillment mirror;

current date/time/timezone and provider capability.

Label stale, inferred, unverified, and source-reported data. Never turn phone-area inference into physical location or transform a model guess into a customer fact.

Structured outputs

Use versioned schemas and validators for:

intent;

qualification;

interest;

objection;

timeline;

homeowner/customer facts;

appointment request;

follow-up commitment;

inbound route;

summary;

recommended action;

hot signal;

disposition/stage proposal;

satisfaction/issue classification;

reactivation reason.

Each material field needs confidence and evidence. Invalid schema, conflicting evidence, missing transcript, or low confidence must fall back to clarification, safe default, or human review.

Authority boundaries

AI must not autonomously:

remove DNC or opt-out;

make unapproved pricing/savings/legal/contract/install promises;

expose private customer data to an unverified caller;

mark Sold or Installed without trusted evidence;

close a customer issue as resolved;

publish/modify a playbook;

contact outside policy;

create duplicate opportunities/appointments;

overwrite human notes without history;

hide failed automation.

Evaluation

Build labeled review samples and track:

intent accuracy;

disposition/stage agreement;

appointment extraction precision/recall;

follow-up date accuracy including timezone;

hot-signal precision/coverage;

inbound routing correctness;

transfer success;

summary factuality;

issue-detection recall;

override rate;

automated-action error rate;

review queue volume and latency.

Store model/provider/prompt/schema/knowledge versions. Support rollback and comparison. Never train from customer data outside approved data-governance policy.

21. Security, compliance, reliability, and human control

Treat these as release requirements:

strict tenant isolation and server-side authorization for Brock’s leads, calls, messages, recordings, transcripts, appointments, sales, installs, and customers;

permission roles for admin, King/manager, rep, QA/reviewer, fulfillment/customer care, and reporting;

signature verification and replay protection for telephony, messaging, calendar, CRM, and fulfillment webhooks;

secrets in approved configuration only;

DNC and channel opt-out enforcement across outbound manual, AI, parallel, SMS, reactivation, and post-install promotion;

consent/recording/transcription notices and retention configured for applicable jurisdiction and company policy;

customer local-time calling/messaging rules;

safe caller verification before private inbound disclosure;

PII-safe logs and error messages;

encryption and current secure-storage patterns;

immutable audit events for ownership, status, consent, playbook publication, automated action, AI proposal, human override, and external status sync;

manual pause/kill switch and emergency queue stop;

work reservation, distributed locks, idempotency, retries, backoff, dead-letter handling, and replay tools;

no action when eligibility or policy cannot be established safely;

clear disclosure of what requires customer legal/compliance review.

Controls do not justify a blanket “fully compliant” claim. Document implemented safeguards, tenant configuration requirements, and items requiring legal validation.

22. UX and information architecture

Create a coherent Phase 2 navigation and embed features into existing surfaces rather than adding dozens of disconnected tabs.

Recommended top-level experience:

King’s Command Center

My Day

ATLAS Dialer

Opportunities

Live Floor

Appointments

Inbound Reception

Customers / Install Watch

Reactivation

Reports

Playbook Studio / Administration

Adapt to existing navigation to avoid redundant destinations.

Universal Opportunity 360

Extend Phase 1 Lead 360 into an opportunity/customer-aware experience without breaking lead access. Include:

identity/contact/property/custom fields;

source, campaign, territory, owner, assignment;

sales stage, operational health, next action, SLA;

hot/risk signals;

complete omnichannel timeline;

calls/messages/recordings/transcripts;

extracted facts with evidence;

appointments and protection/recovery history;

playbook execution timeline;

sale and read-only fulfillment mirror;

post-install care, issues, reviews/referrals/add-ons;

reactivation cohorts;

audit/provenance.

Open the same canonical record from every command-center count, rep queue, live session, appointment, install alert, report, and notification.

Visual quality

The experience should feel like an elite real-time revenue operations system:

strong command-center hierarchy;

compact but readable tables and cards;

purposeful state color plus icon/text;

clear “Now / Due soon / At risk / Blocked / Completed” treatment;

live status motion used sparingly;

drill-down rather than unexplained aggregates;

source/evidence visibility;

customizable density and saved views;

loading, empty, partial, stale, permission, and error states;

keyboard navigation, focus management, contrast, reduced motion, and screen-reader announcements;

responsive rep workflows and desktop-optimized command views.

Avoid decorative “AI” graphics that conceal workflow state. The impressive element must be the real-time operational clarity.

23. Shared metrics and analytics integrity

Extend Phase 1’s metric glossary/service; do not build a second analytics pipeline for Phase 2.

Every metric must specify:

event population;

unique entity key;

numerator/denominator;

inclusion/exclusion;

event time vs ingestion time;

tenant timezone;

late-event behavior;

current stock vs period flow;

attribution rules;

drill-down query;

freshness and reconciliation policy.

Add reports for:

lead volume and speed-to-lead by source/campaign/rep;

untouched and SLA breach;

outbound contact/follow-up funnel;

inbound reception and transfer funnel;

appointment confirmation, risk, show, and recovery;

hot signals and response lift;

rep follow-up execution;

opportunity leakage and aging;

sales-to-install stage/aging/stalls;

post-install satisfaction/issues/reviews/referrals/add-ons;

reactivation cohorts, cost, conversion, opt-out/complaint, and lift;

playbook execution/automation failure;

AI quality and human review.

Dashboard, report, notification count, and drill-down must match for identical definitions and filters. Build aggregate repair/reconciliation for late or corrected events.

24. Required Phase 2 delivery sequence

Execute in dependency order and keep each workstream releasable.

P2.0 — Readiness and baseline

Inspect Phase 1 completion and provider capabilities.

Create Phase 2 traceability matrix.

Baseline current funnels, data quality, appointment behavior, and operational gaps.

Record screenshots, tests, and known blockers.

P2.1 — Opportunity and orchestration foundation

Canonical opportunity, touch, work item, signal, playbook, and execution contracts.

Separate state machines.

Migration/backfill from Phase 1 data.

Orchestration engine, idempotency, timers, locks, audit, kill switches.

Shared metrics extensions.

P2.2 — Lead intake and speed-to-lead

Unified intake and dedupe.

Source/territory/campaign identification.

Assignment/routing.

SLA timers, notifications, escalation, and untouched queues.

King’s intake visibility.

P2.3 — Outbound opportunity automation

ATLAS pre-call context.

Structured post-call extraction.

Next-action generation.

No-answer follow-up and controlled recycling.

Promise/callback protection.

P2.4 — AI inbound reception

Inbound line configuration.

Caller recognition/verification.

AI receptionist and knowledge grounding.

Qualification, appointment, routing, warm transfer/takeover/fallback.

Live monitoring and inbound metrics.

P2.5 — Appointment protection and no-show recovery

Confirmation/reminder sequence.

Customer confirm/reschedule/cancel response.

Risk reasons and queues.

Rep pre-appointment brief.

No-show detection, recovery, and measurement.

P2.6 — Rep AI assistant and hot opportunities

My Day.

“Who should I call next?”

Daily priorities and end-of-day summary.

Signal engine, hot queue, SLA, feedback, and analytics.

P2.7 — Sold/install mirror

Trusted source adapter.

Read-only milestone mapping and freshness.

Install Watch, stall alerts, customer communication, inbound answer context.

No changes to Brock’s contracting process.

P2.8 — Post-install customer lifecycle

Thank-you, satisfaction, issue escalation.

Review/referral.

Add-on opportunity creation.

Long-term customer care.

P2.9 — Reactivation

Eligibility and exclusions.

Cohort builder and “Why now.”

Controlled playbooks and stop rules.

Hot-response handoff and lift measurement.

P2.10 — King’s Command Center and Playbook Studio

Today strip, rep performance, pipeline leaks, and drill-down.

Cross-lifecycle analytics.

Visual playbook builder, simulation, publication, rollback, and execution health.

P2.11 — Hardening and release readiness

Full regression, integration, end-to-end, performance, accessibility, security, and tenant-isolation tests.

Migration rehearsal and rollback.

Provider failure drills.

Metric reconciliation.

AI evaluation baseline.

Operations runbook, observability, alerts, and QA evidence.

If the execution window ends, finish the current vertical slice, leave the repository passing, update traceability honestly, and provide the single highest-value continuation prompt. Do not scatter half-built UI across all workstreams.

25. Minimum acceptance tests

Implement tests adapted to the existing stack for at least:

Intake, ownership, and SLA

Retried intake with the same source key creates one lead/opportunity.

Probable duplicate follows the configured merge/review policy without data loss.

All imported custom fields and provenance remain visible after opportunity creation.

Invalid/bad-number reason is stored and blocks that phone while preserving other permitted contact paths.

DNC/suppressed intake creates a reportable record but no outbound work.

Territory/campaign/source routing selects the expected rep and records why.

Capacity/availability fallback assigns to the correct queue rather than leaving the lead untouched.

Speed-to-lead starts at the defined eligible time and survives reassignment.

SLA threshold creates one notification/escalation despite job retry.

Untouched leak query exactly matches underlying qualifying opportunities.

Outbound follow-up

ATLAS call attaches once to touch, lead, opportunity, campaign, and work item.

Duplicate/out-of-order call webhooks cannot create duplicate follow-up.

AI extraction retains evidence/confidence and does not invent missing facts.

Low-confidence disposition or follow-up time enters Needs Review.

Verified callback request creates one timezone-correct work item.

No-answer enters the configured follow-up sequence once.

Retry/cooldown/max-attempt and never-dialed-first rules remain enforced.

DNC/opt-out immediately cancels future playbook actions.

Every open opportunity is closed, paused with reason, waiting with review date, or has a next action/work item.

Inbound reception

Known caller ID matches the correct permitted record and attaches one inbound touch.

Ambiguous caller match does not expose private details before verification.

Unknown caller creates one provisional inbound opportunity with source attribution.

AI answers from approved knowledge and expresses uncertainty for unsupported questions.

Inbound appointment uses real availability and remains idempotent.

Routing respects owner, presence, skills, territory, capacity, and fallback.

Warm transfer provides the correct handoff brief and records each attempt.

Failed/unavailable transfer creates one callback with owner and SLA.

Rep pickup/takeover state appears accurately in Live Floor only when supported.

Inbound metrics reconcile to provider sessions and opportunity records.

Appointments and no-show recovery

Immediate/day-before/same-day/pre-appointment actions schedule in the appointment timezone.

Quiet hours, channel consent, and frequency caps shift or block reminders correctly.

Provider delivery does not equal customer confirmation.

Confirm, reschedule, cancel, ambiguous reply, and opt-out follow their separate paths.

Reschedule cancels obsolete actions, preserves lineage, and does not inflate appointments set.

Appointment risk shows the exact published reasons and freshness.

Pre-appointment brief contains only verified facts/evidence.

No-show cannot trigger before appointment plus grace period.

Duplicate no-show events create one recovery instance.

Recovery response routes to the owner/hot queue and creates one new appointment.

“Recovered show” counts only when the later appointment actually completes.

Assistant and hot opportunities

“Who should I call next?” never returns DNC, ineligible, out-of-window, sold/install, active-issue, or concurrently reserved records.

Recommended opportunity shows a valid “why now” and source evidence.

Promised callback overdue creates one hot signal/work item.

Repeated inbound callback signals aggregate without permanent score inflation.

Expired/stale signals leave the active hot count.

Signal acknowledgment/resolution and false-positive feedback are audited.

End-of-day counts reconcile to underlying calls, contacts, appointments, and tasks.

Sold, install, and post-install

External Sold/install webhook retry is idempotent.

Out-of-order fulfillment events do not regress trusted terminal state without review policy.

Unknown/conflicting external status enters review rather than guessing.

AIATWORK cannot write to or change Brock’s contracting workflow.

Stall alert uses configured stage-age threshold and appears once until resolved/reopened.

Customer installation message contains only trusted status/date information.

Installed milestone triggers one post-install journey.

Negative satisfaction/issue response creates urgent human work and pauses review/referral promotion.

Issue closure requires trusted evidence and resumes only eligible actions.

Review/referral requests honor consent, frequency cap, and deduplication.

Add-on creates a linked new opportunity without reopening/corrupting the completed sale.

Reactivation

Reactivation excludes DNC, active appointment/callback, sold/install, open issue, cooldown, max-attempt, and duplicate-active opportunity.

Cohort snapshot retains eligibility reason, playbook version, and “why now.”

Reactivation personalization uses only approved verified fields.

Positive response stops remaining sequence and routes immediately.

Decline/opt-out/complaint stops sequence and updates suppression appropriately.

Control/holdout membership remains stable for lift measurement.

Cohort funnel and cost/revenue use trusted, defined inputs.

Command center, playbooks, security

King’s metric cards, reports, alerts, and drill-downs match for identical filters.

Stock metrics such as active hot/at-risk are not confused with period flow metrics.

Rep Follow-Up Completion % uses the published due-work population.

Pipeline leak count contains no opportunities with valid next action/intentional pause/closure.

Playbook simulation causes no production actions.

Playbook publish validates fields/providers/queues/stop rules and records authorized version.

Playbook rollback affects future execution safely and preserves historical version attribution.

Kill switch prevents new actions while preserving audit and in-flight state handling.

Duplicate scheduler/provider/job events cause one business action.

One tenant cannot access another tenant’s leads, calls, messages, customers, installs, playbooks, metrics, or audio.

Server-side permissions block unauthorized playbook publication, customer data, transfer monitoring, export, and status override.

STOP/DNC propagates across outbound calls, SMS, reactivation, and post-install promotion.

Audit history reconstructs who/what/when/why for every material state and action.

End-to-end journeys

New DFW lead → dedupe/source/territory → rep assignment → speed-to-lead → ATLAS call → AI summary/follow-up → appointment → confirmation → show → trusted sale, with all counts reconciled.

Known customer inbound call → safe recognition → AI qualification → warm rep transfer → updated opportunity/timeline.

Unknown inbound caller → provisional opportunity → no rep available → callback SLA → rep completion.

Appointment unconfirmed → risk → reminders → no-show → recovery → reschedule → confirmed → recovered show.

Trusted Sold → external install milestones → stall alert → installed → satisfaction issue → human resolution → later eligible review/referral.

Old interested prospect → reactivation cohort → approved message → inbound callback → hot queue → appointment, with remaining sequence stopped.

26. Performance, scale, and observability

Baseline before choosing final targets, then document and test:

lead-intake-to-assignment latency;

speed-to-lead notification latency;

timer/scheduler accuracy at expected opportunity volume;

orchestration throughput and queue lag;

inbound answer time and AI voice latency;

caller-match and context-load latency;

transfer setup and time-to-human;

live transcript/event latency;

appointment reply-to-state-update latency;

hot-signal detection-to-queue latency;

command-center query/load time;

fulfillment sync lag;

reactivation cohort build and export time.

Instrument:

intake failures and duplicate rate;

unowned/untouched opportunities;

SLA breaches;

orchestration queue depth, retries, dead letters, duplicate suppression, and stuck executions;

provider delivery/webhook failures;

inbound answer/abandon/transfer failures;

appointment reminder failure and ambiguous reply queue;

no-show recovery action failure;

hot-signal lag and false positives;

fulfillment sync freshness/conflicts;

customer issue SLA;

metric drift/reconciliation repairs;

AI schema failures, low-confidence rate, override rate, and review backlog.

Provide operational dashboards/alerts and replay/recovery procedures. Logs must be tenant-scoped and PII-safe.

27. Definition of done

Phase 2 is complete only when:

every requirement is traceable with honest status and evidence;

Phase 1 behavior and tests remain passing;

opportunity, touch, work item, signal, and playbook models are canonical and migrated safely;

every eligible open opportunity has ownership and an explicit next-action state;

automated actions are idempotent, policy-checked, observable, stoppable, and auditable;

inbound AI reception works through real provider capabilities with safe recognition, routing, transfer/fallback, and timeline attachment;

appointment confirmation, risk, reminders, rescheduling, no-show recovery, and counts reconcile;

the rep assistant and hot queue never bypass eligibility or fabricate facts;

Brock’s contracting process remains unchanged and fulfillment is a clearly sourced mirror;

customer issues pause promotional post-install actions and reach humans;

reactivation is selective, explainable, frequency-controlled, and measurable;

King’s Command Center matches source records and drills into exact work;

DNC/opt-out, permissions, tenant isolation, quiet hours, caller privacy, and audit are verified;

migrations, backfills, feature flags, rollout, rollback, and provider failure behavior are rehearsed;

unit, integration, contract, end-to-end, performance, accessibility, and security tests pass;

unsupported capabilities and remaining limitations are documented without fake completion.

28. Required final response from Claude Code

At the end, report:

Executive outcome: how Phase 2 changed Brock operations for King, reps, customers, and leadership.

Phase 1 continuity: what was reused, migrated, extended, or blocked.

Architecture: opportunity, work item, touch, signal, orchestration, inbound, appointment, fulfillment mirror, post-install, and reactivation components.

Implementation map: database, backend, providers, real-time, jobs, frontend, AI schemas, metrics, tests, and docs changed.

Requirement status: Done, Partial, Blocked, Deferred, or Not started for every major area with evidence.

Metric integrity: definitions, fixture totals, parity tests, reconciliation, and freshness.

AI quality: schemas, confidence/evidence rules, evaluation results, review/override behavior, and known limitations.

Provider capabilities: inbound answer, audio, transcript, transfer, takeover, messaging, delivery, and unsupported gaps.

Migration/runbook: exact commands, environment/config changes, backfills, feature flags, rollout, rollback, kill switches, and recovery.

Verification: tests and checks run, results, routes, screenshots, and end-to-end evidence.

Risks/limitations: concrete blockers or decisions still needed.

Next action: highest-value remaining Phase 2 slice or a clean handoff for the future Phase 3 prompt.

Begin now. Inspect the existing repository and Phase 1 evidence, create the Phase 2 readiness report and traceability matrix, then implement P2.1 and continue through the ordered workstreams as far as can be completed safely with a passing repository. Make evidence-based decisions autonomously when requirements and existing code provide a safe answer. Ask one concise blocking question only when proceeding would risk data loss, violate policy, break a production integration, require unavailable credentials, or force a material Brock/King playbook choice with no safe default.