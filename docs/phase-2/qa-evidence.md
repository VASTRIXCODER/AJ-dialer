# Phase 2 — QA evidence

Per-slice log; append, never rewrite. Companion to requirements-traceability.md.

## Slice S1+S2 — 2026-08-29 (pre-flight + P2.1 foundation)

**Gates:** `npx tsc --noEmit` clean · `npm test` **74 files / 860 tests green**
· `npm run build` passes (all routes). (`npm run lint` remains unusable —
Phase 1 known limitation; gates are vitest + tsc + build.)

**New test files this slice:**
- `tests/org-config-wiring.test.ts` — resurrected-control logic: defaultMode
  sanitization, 0-default pacing knobs (stored dead values never wake),
  advisory-hours predicate (lead-tz, overnight wrap, degenerate-config
  never-blocks), accent hex→HSL + scoped CSS, dialer user prefs parsing,
  vocabulary tagline precedence, ElevenLabs voice override allow-list
  (fail-closed), talkTimeLimitMin new-key rule.
- `tests/opportunity-stage.test.ts` — exhaustive transition matrix:
  forward-free / regress-human-only / sold-trusted-only / DNC-leaves-by-human;
  leads.status mapping LOCKSTEP with the PART 37 backfill CASE.
- `tests/playbook-definition.test.ts` — seed templates publish clean; RESERVED
  kinds fail publish; unknown events vs vocabulary events; stop-rule
  always-enforced pair; firstTrippedStopRule precedence + opt-in rails;
  waitUntil determinism incl. local-time next-occurrence.
- `tests/artifact-override.test.ts` (updated) — do_not_call pinned in
  mergeAiDispositionPolicy.

**Adversarial review evidence (commit 3ee0184):** 4-lens find → 2-refuter
verify workflow; 20 raw findings, 17 confirmed, 3 refuted. All 17 fixed in the
follow-up commit, notably:
- CRITICAL stale `aiModeRef`: manual-default boot still AI-launched on Start.
- Fabricated `no_answer` records for hour-blocked parallel legs (server per-leg
  refusals + client undialed-set + claim release).
- Legacy `To` TwiML branch removed (DNC/hours/policy bypass via console).
- Cross-tenant intervene fallback fail-closed (durable org-ownership check).
- Primary-agent raw "default" voice override; talkTimeLimitMin key rename;
  due-callback bypass restored in the claim route (two-phase claim).

**Live-DB changes verified this session:**
- VICC flags read back after update: `aiDialer=true`, `defaultMode=manual`.
- PART 37: **APPLIED 2026-08-29** (user-authorized; first attempt failed on a
  text/uuid COALESCE — `leads.assigned_rep_id` is TEXT — fixed with a
  pattern-guarded cast, fed back to schema.sql, re-applied clean). Post-apply
  verification: 37,645 opportunities = 37,645 eligible leads (1:1, all
  `backfilled`); 37,433 open / 212 closed; stage mix new 33,795 · attempting
  2,167 · assigned 1,320 · dnc_suppressed 112 · lost 100 · contacted 69 ·
  nurture 58 · appointment_booked 20 · interested 4; orchestration_paused
  false; all 1,595 assigned_rep_id values matched the UUID pattern (0 bad).

**Not yet evidenced (honest):** any Phase 2 UI, engine behavior against real
tables (unit-tested pure planning only), backfill row counts, orchestrate
cron execution, opportunity parity.

## Slice S5 — 2026-08-29 (queue-fidelity review cycle + P2.6-lite)

**Gates:** tsc clean · 76 files / 878 tests green · build passes.

**Adversarial review of 1c5a611** (4 lenses × 2 refuters): 18 raw findings,
16 confirmed (~11 distinct), 2 refuted. All fixed:
- CRITICAL: auto-dial's lap refetch swapped a builder session for the default
  pool queue (off-list dialing resurrected through auto-dial) — the lap now
  honors the session contract: strict+no-refill ENDS auto-dial with the honest
  message; refill announces the swap.
- Double cursor advance (claim-advance + advanceQueue) skipped ~parallel leads
  per round and halved laps — advanceQueue now consumes the claim-advance
  flag; lap wrap is recorded at claim time; override rounds reset the flags.
- Due-callback bypass was dead in strict mode — the claim route now pre-claims
  dueIds ∩ leadIds with the knobs off.
- 200-id window + a second-window probe fixes the false "list finished" on
  large sessions with an ineligible head window.
- Suspended supervisors could read org books through the admin-client paths
  (session builder AND the pre-existing getDialQueue) — both now check
  profiles.disabled and fail closed.
- loadSession resets the cursor and clears stale campaign/group/my-leads
  filters; BOTH "Load leads" doors open the SessionBuilder; the builder now
  uses the Modal primitive (dialog role, focus trap, Escape, reduced-motion),
  renders org vocabulary (no solar copy for non-solar tenants), refuses an
  empty disposition selection instead of silently loading defaults, and uses
  groupLabel()/leadGroupLabels for group chips (incl. "Miscellaneous").

**P2.6-lite shipped:** /api/signals (org-fenced list/acknowledge/dismiss;
reps see own-opportunity signals, supervisors the org) + the dashboard Hot
signals card (severity-first, self-explaining rows, renders nothing when
clear).

## Slice S6 — 2026-08-29 (Phase 2 H: P2.3 completion, P2.6, P2.10, P2.9)

**Gates:** tsc clean · **78 files / 896 tests** green · `npm run build` passes
(new routes `/today` and `/command` compile). Commits `cbd90ce` (feature) and
`0d91fe1` (self-review fixes); both deployed to production and verified.

**New test files:**
- `tests/next-action.test.ts` (11) — the disposition → next-action mapping
  (agreed callback/appointment times ride through; no-answer/voicemail = 2-day
  follow-up; qualified = 1 day; bills_fine = 30-day nurture; wrong_number and
  the closing outcomes CLEAR; unknown outcome leaves the row untouched), plus
  the `whyNowLine` precedence ladder (due work item > hot signal > overdue
  next action > upcoming item > fresh/attempted/stage story) and its use of
  the workspace's own lead noun.
- `tests/reactivation.test.ts` (7) — cohort invariants: **no cohort can ever
  contain a blocked (DNC) status**, every cohort status is a known segment,
  every cohort is genuinely aged (≥30 days), exact cutoff arithmetic, unknown
  keys resolve to null (never a default sweep), and `aged_untouched` requires
  never-attempted while the others cap attempts.

**Tenant-isolation checks performed on the new routes:**
- `/api/opportunities/context` — org fence on the lead read + `canActOn`, with
  an explicit assigned-to-viewer allowance; returns `{context:null}` (not an
  error) for anything the viewer may not see, so it can't be used as an
  existence oracle.
- `/api/reactivation` — cohort ids are discovered own-scoped for reps
  (org-wide only for supervisors) and then re-materialised through
  `buildSession({leadIds})`, which independently re-applies the scope fence,
  the org fence, the DNC status block and the number-level scrub.
- `getScope()` now returns null for `profiles.disabled` — the suspension
  backstop every service-role read inherits. Verified the column exists
  (`not null default false`, schema.sql line ~209), so no existing profile
  changes behavior.
- `releaseCallWorkItemsForRep` is keyed on `reserved_by = self`, so no rep can
  release another's reservations.

**Self-review of `cbd90ce` (the workflow reviewers all died on a session quota
limit — that empty result was recorded as ZERO COVERAGE, not a pass — so this
pass was done inline and an independent workflow re-run followed).** Five real
defects found and fixed in `0d91fe1`:
1. **Counts derived from fetched arrays** (the session-builder rule, re-broken
   in two places): My Day's overdue/due-today/unscheduled callback counts came
   from a 100-row page, and the Command Center's today strip from a 5,000-row
   page — an org dialing >5,000 times a day was shown a saturated "5000".
   Both now use head+exact COUNT queries.
2. The per-rep breakdown genuinely needs rows (PostgREST can't GROUP BY), so
   it pages to a 12,000-call bound and **says so** when it hits it: "leads
   worked" renders "≥N" with a reason and the floor table names its window.
3. WhyNow cached each lead's brief for the whole session, so paging back after
   filing a disposition showed the pre-call state forever — 60s TTL.
4. My Day linked to /callbacks, /appointments and /assignments unconditionally
   — now gated on org features and the viewer's permissions.
5. Who-next copy rendered "due and overdue" from an always-true branch.

**Second self-review pass (`d2191bc`, `7250101`)** — four more real defects:
6. **My Day's who-next dialed a promised callback without its callback id.**
   That id is what CLOSES the promise when the disposition is filed (the
   contract the callbacks board already relies on), so working the
   recommendation left the callback open and re-recommended the same person
   forever. Fixed, and all four "call this person" entry points (My Day,
   Callbacks board, Leads table, Nurture) now share one tested builder,
   `src/lib/dialer/deep-link.ts`.
7. **A 500 on the dialer, reproduced:** the page called `decodeURIComponent()`
   on `?name=`, but Next.js has already decoded searchParams — a lead named
   "50% Off Corp" arrives as `50% Off Corp` and the bare `%` throws URIError.
   Verified the throw at a node prompt, removed the second decode, and pinned
   the invariant with `tests/dial-deep-link.test.ts` (6 tests, incl. `%`,
   `&`, unicode, non-uuid callback ids, and the length cap).
8. `/api/dialer/release` released ALL of a rep's work-item reservations when
   given an empty leadIds list, while `releaseDialLeads()` no-ops on the same
   input — the rep kept the leads while their work items became claimable by
   someone else. Now scoped to the same ids.
9. My Day's own dials/conversations/appointments came from a 2,000-row fetch
   (reachable in a long 3-line parallel session) → head+exact COUNT queries.
   Only talk time still rides the row fetch, because SUM isn't expressible in
   PostgREST; documented in place.
10. `getMyDay()` / `getCommandCenter()` had no try/catch — a transient DB
    error would 500 a rep's first screen of the day. Both now degrade to the
    page's existing empty state.

**Design-rule spot checks on the new surfaces:** zero sub-11px text
(`text-[10px]` and below absent from /today, /command, WhyNow, Reactivation
and the hot queue) and zero raw hex values — the two mechanical rules from
docs/final_phase_ui.md that a grep can settle.

**Live production verification (2026-08-29, VICC / Donny's Dialer, Owner):**
first real end-to-end evidence for any Phase 2 UI — both new routes loaded on
`aiatworkdialer.vercel.app` against live data.

- `/today` renders: one primary action (the `whoNext`-null fallback, "Open the
  dialer" — correct, since this Owner holds no callbacks of their own), the
  honest empty state, and the end-of-day strip labeled "Today so far · you ·
  org time" with real zeros that are genuinely zero, not loading artifacts.
- `/command` renders against the real book: **8 overdue callbacks · 76
  callbacks with no time set · 10,233 untouched new leads · speed to first
  call 621m (median, first attempts today) · pipeline leaks 12,363 open**,
  sampled 8 with owner/stage/last-touch and labeled "Showing 8 of 12363".
  The floor table lists the org's four real reps.
- **`app_pipeline_leaks` is confirmed working against production data** — the
  §5 leak detector had shipped in PART 37 with no consumer since.
- **A design decision validated by live data:** the Callbacks page reports
  "Due now 77" for this org; the Command Center resolves the same population
  as 8 genuinely overdue + 76 *unscheduled*. The spec's rule (an item with no
  agreed time is not "due") turns out to describe 76 of those 77 rows.
- Both nav entries appear in the right groups for an Owner; no console errors
  or hydration warnings on a fresh load of either route.

### Independent adversarial review (4 lenses × 2 refuters, 70 agents)

First run died on a session quota with all four finders lost — recorded as
**zero coverage, not a pass**, and re-run. The re-run produced 34 distinct
findings; 5 refuter agents failed on API safeguards, so a few verdicts are
unresolved and were triaged by hand. Everything below was reproduced before
being fixed.

**CRITICAL — `9a486af`. Promised callback times were read in the wrong time
frame.** `callbacks.due_at` and `appointments.scheduled_at` hold FLOATING
wall-clock strings; the convention is enforced elsewhere (`rescheduleCallback`
REJECTS any value carrying an offset, and lanes.ts warns that parsing one as
an instant "shifts by the viewer's UTC offset"). My Day and the Command Center
compared that column against `new Date().toISOString()`. In America/Chicago a
callback promised for 2pm was counted overdue from 9am, badged red, and pushed
by the who-next card as "it's due now" with a primary Call button — driving a
rep to break a promise by calling five hours early. East-of-UTC orgs failed the
opposite way, hiding genuinely late callbacks; and after the day's UTC rollover
the "due later today" range went empty every evening. Fixed with
`zonedFloatingNow` (comparisons), `floatingRelativeTime` (display, which had
the same shift on screen) and `floatingToUtcIso` (so
`opportunities.next_action_due_at` holds a real instant, since
`app_pipeline_leaks` compares it against `now()`). 12 tests pin all three,
including one that demonstrates the old comparison's failure directly.

**Demo mode was broken app-wide, not just here.** `createServerClient("", "")`
throws "Your project's URL and Key are required" — reproduced at a node
prompt — so `getScope()` threw whenever Supabase was unconfigured, taking down
every page that resolves a scope during render: `/today` plus five
**pre-existing** pages (callbacks, leads, dialer, assignments, campaign edit).
`getScope()` now returns null when Supabase is absent, which every caller
already handled.

**Also fixed (`318c8e5`):** two more saturating counts on My Day (open tasks
and appointments-today were page lengths behind LIMIT 50); signals fetched
org-wide and filtered to the viewer only afterwards, so a rep in a busy org
could see none of their own; a DST fall-back day collapsing My Day's day
window to zero width (now+24h can land on the same local date in a 25-hour
day); `reserveCallWorkItems` taking items explicitly assigned to another rep;
the Command Center's "untouched new" counting opportunities whose lead was
archived or DNC'd; a failed scan page leaving `scanCapped` false so a
truncated rep table read as the whole floor; an unordered speed-to-lead
sample; the reactivation badge showing a pre-exclusion count directly above a
sentence promising exclusions; the reactivation exclusion report being written
to state and then immediately navigated away from (it now travels in the
session summary the dialer displays); hardcoded "Appointments" where the
workspace's own noun belongs; and no rate limit on `GET /api/reactivation`.

**Post-fix verification in production (VICC):**
- Pipeline leaks fell from **12,363 → 2,016** once never-attempted
  opportunities were excluded, so the leak panel and the "untouched new"
  queue (10,232) now describe genuinely distinct populations instead of
  double-counting one backlog.
- The `leads!inner` join is confirmed working — untouched moved 10,233 →
  10,232, excluding an archived/DNC'd lead rather than erroring to zero (the
  one change that could not be verified locally).
- Overdue callbacks still read 8 after the timezone fix, which is consistent
  with this org's data rather than evidence the fix is inert: all 8 are from
  previous days and the other 76 carry no agreed time at all, so there is no
  callback scheduled for later *today* to reclassify. The behaviour itself is
  pinned by unit tests, including one asserting the old comparison's failure.

**A process failure worth recording:** commit `318c8e5` failed to build on
Vercel ("Property 'AppointmentNounPlural' does not exist on type
'OrgVocabulary'") while local `tsc` passed, so the review fixes sat undeployed
until `865deda`. Two causes, both from working in a repo with a concurrent
session: (1) the working tree carried an *uncommitted* change adding the
capitalized vocabulary keys, so local type-checking validated against a
definition that was never in the commit; (2) `tsconfig.tsbuildinfo` is
incremental and had gone stale. Mitigations now in use: stage by explicit
path, never `git add -A`; verify referenced symbols against
`git show HEAD:<file>` before committing; run `tsc --noEmit --incremental
false`; and always confirm the deploy status rather than assuming a push
shipped. `npm run build` cannot be trusted locally at all while three
concurrent `next dev` servers share `.next`.

## Slice S7 — 2026-08-29 (King's pipeline: first execution test)

**The finding that framed the slice:** the orchestration engine had never run.
Production held 0 playbooks, 0 instances, 0 executions, 0 work items and 0
signals; no org had the master switch on; and `cron.job` carried only
auto-dial, reconcile-ai and reconcile-data — no orchestrate job. Every prior
test covered the PURE planning helpers, so the imperative shell was entirely
unexecuted code.

**Method:** a small in-memory PostgREST stand-in
(`tests/helpers/fake-supabase.ts`) that enforces the real UNIQUE constraints
from schema.sql — exactly-once execution, activation dedupe and signal dedupe
ARE those constraints, so a fake without them proves nothing. It also mirrors
`default now()` and parses offset-less timestamps as UTC the way Postgres does
on the service connection, so floating-time tests don't depend on the machine
they run on. `tests/orchestration-pipeline.test.ts` then RUNS the engine: 17
tests over all four hops (event → activation → step execution → work
items/signals/next actions), plus stop rules and all four kill switches.

**Three bugs, all found by execution rather than reading:**
1. **Instances could freeze permanently.** The exactly-once gate inserts an
   execution row before acting; a tick that died between that insert and the
   step advance left every later tick re-planning the same step, hitting the
   same 23505 and `continue`ing without advancing. Now a duplicate key means
   "already done" — skip the action, advance the instance.
2. **`maxAttempts` compared the wrong two numbers.** `attemptsSinceActivation`
   was filled from the opportunity's LIFETIME `attempt_count`, so the
   no-answer follow-up playbook (cap 4, eligible under 6 attempts) stopped
   instantly on any lead already dialed four times — exactly the leads it
   exists to work. Now counted from `call_records` since the instance started,
   and only when a cap is configured.
3. **The promised-callback sweep read floating times as instants** — the same
   convention error as the dashboards, but on the path that ESCALATES. A
   promise still an hour away looked hours overdue, which would nudge owners
   and raise hot work items over promises nobody had broken. `Date.parse` on
   an offset-less string also reads the SERVER's zone, so the error changed
   with where the code ran (0 minutes locally, 240 on Vercel) — the reason a
   first version of the test passed for the wrong reason.

**Silent-failure fix:** switching the master switch ON did nothing until the
orchestrate cron was scheduled by hand, with no indication why. Every tick now
stamps `app_settings.orchestration_last_tick_at` (PART 38 — additive, applied
to the live DB) and Admin → Playbooks states whether the engine is running,
stalled, or has never run.

**Deliberately NOT done:** no org's orchestration was enabled and no cron was
scheduled. That starts automated follow-through against 37,878 live
opportunities and is the operator's decision.

**Not yet evidenced (honest):** perf/a11y sweeps and multi-role/multi-tenant
walkthroughs of the Phase 2 surfaces (only the Owner role on one org was
loaded); the opportunity-parity check riding reconcile-data; orchestrate-cron
execution (still unscheduled — it activates when the first org opts in). Five
refuter agents died mid-review, so a handful of lower-severity verdicts rest
on hand triage rather than two independent votes.
