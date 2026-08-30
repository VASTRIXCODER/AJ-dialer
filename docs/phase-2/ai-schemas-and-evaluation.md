# Phase 2 — AI schemas & evaluation (§20)

The versioned AI schema registry and the evaluation program (docs/phase_two.md
§20). Sections 1 marks what EXISTS (Phase 1 as-built, with file evidence);
sections 2–4 are the Phase 2 plan — **nothing in them is built** unless marked
otherwise. Follows docs/phase-2/opportunity-domain-and-state-machines.md:
deterministic engine, advisory AI; nothing tenant-specific hardcoded. Brock and
King are REAL — a real tenant and a real person (King proposed Phase 2 and wrote
docs/phase_two.md). What must not be hardcoded is their NAMES; the code models
the tenant org and the senior sales operator generically.

## 1. What exists today (as-built inventory)

### 1.1 The combined analysis schema — version `p1-f1`
`src/lib/ai/schemas.ts` (PURE, no I/O). One `generateJSON` call produces every
artifact kind for a call; `ANALYSIS_PROMPT_VERSION = "p1-f1"` is stamped onto
every row it writes.

- Seven kinds (`ARTIFACT_KINDS`): `summary`, `facts`, `objections`,
  `commitments`, `appointment_signals`, `compliance_flags`,
  `proposed_disposition`.
- **Every kind carries `confidence` (clamped 0..1) and `evidence` = transcript
  TURN INDICES** — the §20 "confidence + evidence per material field" rule is
  already the house pattern, not a Phase 2 invention.
- `parseAnalysis()` is the strict gate between model and DB: shape drift →
  whole payload rejects to null (never throws, never repairs into half-truth);
  malformed list ITEMS drop individually; `sanitizeEvidence()` bounds-checks
  indices against the real turn count. Nothing un-validated persists.
- Schema shape: `output_config.format` takes exactly `{type, schema}` — a
  `name` 400s and silently degrades every surface to demo
  (src/lib/ai/claude.ts; the Phase 1 postmortem that motivated version pins).

### 1.2 The analyzer and its policies
`src/lib/ai/analyze-call.ts`: numbers turns `[i] role: message` so evidence
indices are grounded (caps: 200 turns / 9,000 chars — a prefix, never a
filter, so indices stay real). Demo/no-key/fallback persists NOTHING — a
simulated artifact would be indistinguishable from a real one forever.

- **Appointment-only summary policy**: `includeSummary` — callers pass
  `outcome === "appointment_booked"`; every other artifact kind always writes
  (analyze-call.ts:67, task "Auto AI summaries only for appointment-booked").
- `src/lib/ai/disposition-policy.ts` (PURE) decides what a proposed
  disposition may do: `auto_apply` (only into a NULL slot — an existing value,
  human or AI, is never overwritten) | `review` | `none`. Defaults:
  `autoApplyMin: 0.8`; `alwaysReview: ["do_not_call"]` with **do_not_call
  PINNED** — `mergeAiDispositionPolicy` re-adds it no matter what a stored
  blob or admin editor says; `reviewOnMissingTranscript: true` (no transcript
  = no checkable evidence = never auto-apply).
- **Human supremacy**: `aiMaySupersede(source)` — an AI writer may NEVER
  supersede a `source='human'` artifact; humans supersede AI freely.

### 1.3 The wrap-up suggestion (manual dialing)
`getWrapupSuggestion` (src/lib/ai/services.ts:298): tiny 4-field schema
(`recommendedKey`, `rationale`, `quickSummary`, `confidence`), effort low,
runs at every manual wrap-up. Advisory only — the rep's click files.
`src/app/api/ai/wrapup-suggest/route.ts` validates the recommended key
server-side against the org's resolved taxonomy (narrowed by the campaign
subset), so a hallucinated key can never render as a pressable button.

### 1.4 AI-call analysis
`analyzeConversation` (services.ts:442): ElevenLabs transcript → disposition
+ sentiment + appointment time (date-anchored, timezone-aware) + follow-ups.
The solar qualification block is gated to solar-template orgs at the schema
level — non-solar orgs never get solar fields written back.

### 1.5 Provenance and review (schema.sql PART 36)
`call_artifacts`: `model`, `prompt_version`, `confidence` (null for
human-authored), `evidence int[]`, `source` (`ai`|`human`), `status`
(`active`|`superseded`), `supersedes` chain, `created_by`. Every artifact
answers "which model, which prompt version, who, superseding what".
`call_review_queue`: `reason` (`low_confidence`|`high_impact`|`conflict`|
`missing_transcript`|`rep_flagged`), `proposed_disposition`, `confidence`,
`status`, `resolved_by/at`, `resolution`. Adjudication verbs
(src/app/api/review-queue/[id]/route.ts): **accept** (apply AI's key),
**change** (apply reviewer's key, resolution `changed`), **dismiss**.

## 2. Phase 2 schema registry — PLANNED (not built)

§20 requires versioned schemas + validators for the full extraction surface.
Each new schema follows the p1-f1 conventions: a PURE module, a strict parse
gate (reject-to-null), confidence + evidence on every material field, a
version constant stamped into `prompt_version` (proposed ids below), and
`{type, schema}` only. Registry = one module per schema under `src/lib/ai/`,
exported through a single index so surfaces can't grab an unversioned shape.

| Schema (planned id) | Purpose | Consumer | Notes |
|---|---|---|---|
| `p2-intent-1` | caller/prospect intent | inbound reception (P2.4), hot signals | evidence = turn indices |
| `p2-qualification-1` | qualification state per org's resolved lead fields | post-call (P2.3) | field LABELS from `resolveLeadFields`, never literals |
| `p2-objection-1` | exists in p1-f1; splits out when objection taxonomy lands | coaching, reactivation "why now" | |
| `p2-timeline-1` | decision timeline | opportunity stage proposals | absolute dates only (analyzeConversation date-anchor rule) |
| `p2-appt-request-1` | appointment request + specific time | appointment protection (P2.5) | timezone-explicit; supersedes `appointment_signals` |
| `p2-followup-commitment-1` | promised callback date/time/tz | callback protection work items | low confidence → needs_review, never a silent work item |
| `p2-inbound-route-1` | routing candidate + reason | inbound transfer (P2.4) | route decision stays deterministic; AI only classifies |
| `p2-hot-signal-1` | language-based urgency classification | `signals` table (built, P2.1) | writes `signals.confidence`/`evidence` — columns already exist |
| `p2-satisfaction-1` | satisfaction / issue classification | post-install care (P2.8) | issue → human work item, pauses promotion |
| `p2-reactivation-reason-1` | "why now" evidence | Reactivation Studio (P2.9) | approved fields only |

Disposition/stage proposal and summary already exist (`p1-f1`); they migrate
into the registry unchanged. The `signals` table (P2.1, live) already carries
`confidence`, `evidence` jsonb, `dedupe_key`, TTL — the landing zone for
`p2-hot-signal-1` exists; the classifier does not.

## 3. Authority boundaries (§20, verbatim-adapted)

AI must not autonomously: remove DNC or opt-out; make unapproved
pricing/savings/legal/contract/install promises; expose private customer data
to an unverified caller; mark Sold or Installed without trusted evidence;
close a customer issue as resolved; publish/modify a playbook; contact
outside policy; create duplicate opportunities/appointments; overwrite human
notes without history; hide failed automation.

Enforcement map (built vs planned):

| Boundary | Enforcement | Status |
|---|---|---|
| DNC removal | `do_not_call` pinned in `alwaysReview`; `dnc_suppressed` stage only leaves via a human (stage-machine.ts) | Built |
| Mark Sold | `sold` requires actor `manager`/`system-fulfillment`, never AI (stage-machine.ts) | Built (P2.1) |
| Modify playbook | AI cannot write `playbooks`; publish is an authorized-human API (opportunity doc §2) | Built (P2.1) |
| Overwrite human notes/artifacts | `aiMaySupersede` + append-only supersede chain | Built |
| Duplicate work/appointments | `work_items.dedupe_key` partial unique; `playbook_executions.idempotency_key` | Built (P2.1); appointments P2.5 |
| Contact outside policy | engine v0 cannot execute channel actions at all; consent/quiet-hour checks gate them when P2.3/P2.5 unlock | Built (by omission) / Planned |
| Unapproved promises, caller privacy, issue closure, hidden failures | inbound scripts (P2.4), care flow (P2.8), execution failure queue (P2.1 has the columns; ops surface planned) | Planned |

## 4. Evaluation program — PLANNED (some counters already possible)

### 4.1 Labeled samples come free from adjudication
`call_review_queue` resolutions ARE labels: **accept** = model correct,
**change** = override with the corrected label attached (the reviewer's key),
**dismiss** = not-actionable/false positive. No separate labeling tool is
required to start; the plan is a periodic sample of NON-queued (auto-applied
and `none`) calls routed into the same queue so the labeled set isn't
review-biased. That sampling job is not built.

### 4.2 Metrics
Countable TODAY from existing tables (no code yet computes/displays them):

- **Override rate** — `resolution='changed'` / resolved rows.
- **Low-confidence rate** — `reason='low_confidence'` / analyzed calls.
- **Review latency** — `resolved_at - created_at` distribution.
- **Queue volume/backlog** — open rows by age.

Requiring new instrumentation (planned):

- **Schema-fail rate** — `parseAnalysis` → null is currently only a skipped
  analysis; needs a counter row/log with `prompt_version` so a bad prompt
  release is visible within hours.
- **Auto-apply error rate** — an auto-applied disposition later changed by a
  human; needs the artifact-vs-final-disposition diff.
- Per-schema precision/recall (appointment extraction, follow-up date incl.
  timezone, hot-signal precision, intent accuracy, inbound routing
  correctness, summary factuality, issue-detection recall) — needs the §4.1
  sampling job plus a small golden-transcript fixture set. Not started.

### 4.3 Version pinning and rollback
- Every artifact row already stores `model` + `prompt_version`; metrics
  group by both, so version A vs B comparison is a query, not a migration.
- Model pin: `AI_MODEL` env (src/lib/ai/claude.ts). Prompt/schema pin: the
  version constant per registry module. **Rollback = revert the module +
  redeploy**; historical rows keep their stamps, so a rollback never
  falsifies past provenance.
- Knowledge versions (inbound reception scripts/articles, P2.4) and playbook
  versions (built, P2.1) join the same stamp-everything rule.
- Per §20: no training on customer data outside approved governance — nothing
  in the platform trains today, and Phase 2 adds no training path.

### 4.4 Honest status summary
Built: p1-f1 schema + gate, disposition policy, human-supremacy chain,
wrap-up suggestion with server-side key validation, provenance columns,
review queue with free-label adjudication, signals landing zone.
Not built: every `p2-*` schema, the registry index, the sampling job, all
metric computation/dashboards, schema-fail instrumentation, golden fixtures.
