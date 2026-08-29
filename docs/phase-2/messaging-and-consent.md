# Customer messaging and consent

Everything about how ATLAS is allowed to send a text message, and what has to be
true before it can.

---

## The one architectural decision

> **The engine never sends. The engine proposes. A named human sends.**

Every safety property in this document falls out of that sentence. A runaway
playbook produces a pile of visible proposals instead of a pile of texts. The
exactly-once problem collapses from "did the carrier accept?" to "did a local
insert win?". And the actor problem — the orchestration engine runs as the
service role with no user and no permission check — is solved by moving the
decision to contact a customer out of the actorless process entirely.

It is enforced by a constraint, not by convention:

```sql
constraint messages_approved_by_required check (
  status not in ('approved','queued','sending','sent','delivered')
  or approved_by is not null
)
```

A message cannot reach a sendable status without a named human. A future
refactor that tries to auto-send is refused by Postgres, not by a code review.
`tests/messaging-architecture.test.ts` holds the other half: no module under
`src/lib/orchestration/` can reach `sendMessage` through **any** chain of
imports.

Rep-initiated 1:1 messages are not exempt — they are **self-approved**. The rep
holds `messaging.draft` and `messaging.approve.own`, so `approved_by` is their
own id and the audit row shows author == approver. One code path, one
constraint, two permission shapes.

`settings.messaging.autoSend` exists as a column and is **inert**: the drain
refuses it and the constraint refuses it. It is not a switch anyone can find.

---

## Consent (PART 40)

Keyed on the **number**, not the lead. `leads.phone` changes, the book contains
duplicates of the same human, and consent can arrive before a lead row exists.
`lead_id` is attribution only.

**Absence of a row means `unknown`, and `unknown` is treated exactly like
`revoked`.** There is deliberately no backfill. Provenance for the existing
37,000-record book is not known, and inventing a row for each would manufacture
evidence of permission nobody can point at.

DNC and consent both gate and neither replaces the other:

| | What it means | Where it lives |
|---|---|---|
| **DNC** | Never contact this number, whoever they are | `dnc_numbers` |
| **Consent** | They said yes, and here is what they said | `consent_events` + `consent_state` |

A number can be absent from DNC and still have no consent. That is the state
nearly every imported record is in.

### Scopes

- `transactional` — about something they already did. Confirmations, reminders,
  answering a message they sent.
- `promotional` — offers. Requires an explicit opt-in.

Promotional consent covers transactional sends. The reverse is never true.

### How consent is captured

| Path | Scope granted | Evidence stored |
|---|---|---|
| Inbound `START` / `YES` | `transactional` only | Their message, verbatim |
| Inbound `STOP` | *revokes* | Their message, verbatim |
| Rep, on a call (Lead 360) | Either, chosen | What the rep types — **required** |
| Twilio error 21610 | *revokes* | The carrier's rejection |

A grant **refuses to save without the words**. A checkbox proves nothing when
someone disputes it; the evidence is the point. A withdrawal needs no such
hurdle — making it harder to record a "no" is the wrong direction.

The ledger is append-only, enforced by a trigger. Revocation is a new row, never
a delete: internal do-not-contact retention runs five years from the request.

---

## The send gate

`src/lib/messaging/send-gate.ts`, pure, and it returns **every** reason a send
is refused rather than the first one. "Why can't I text this person?" is a
question with a complete answer.

It runs **twice**: at proposal, and again at the drain immediately before the
provider call. The second evaluation is the only reason STOP actually works —
the window between a human approving a message and Twilio accepting it is
exactly where an opt-out lands.

A message that passes at proposal and fails at drain becomes **`blocked`**,
never `failed`. One is the system correctly protecting someone; the other is
something breaking. Filing honoured opt-outs under failures would light the
failure alert every time compliance worked.

### Quiet hours bracket, they do not pick

`leads.timezone` defaults to `America/Los_Angeles` in the schema and
`resolveLeadTimezone` trusts any value containing a slash, so a Texas record
imported without a zone is evaluated as Pacific. Harmless for a morning message;
8pm Pacific is 11pm Eastern.

So when the stored zone and the area-code zone disagree, the message must be
inside the window in **both**. An unresolvable timezone is treated as closed —
we do not send into a zone we cannot name. The default window is 9am–8pm rather
than the statutory 8am–9pm, because the boundary hours are precisely the ones
the data gets wrong.

### Caps

Counted against sends the **carrier accepted** (`provider_sid is not null`), so
a blocked or failed message never burns someone's allowance and one that reached
them always does. Keyed on the thread's contact digits, so duplicate lead rows
cannot double it. A cap of `0` means no cap.

---

## Status is honest

```
draft → needs_approval → approved → queued → sending → sent → delivered
```

- **`sent` is never written because `messages.create()` returned.** Twilio
  answers `queued`/`accepted`, which means "we have it", not "they got it".
- **`delivered` requires a provider event.** Nothing else, ever.
- Out-of-order callbacks are handled by ranked compare-and-set, so a late `sent`
  cannot demote a `delivered` and a stray callback cannot resurrect something a
  human rejected.
- **Many US routes stop at `sent` and never confirm delivery.** A message parked
  there is *not* a failure. Sent, delivered and no-receipt are three counts.
- **There is no read receipt.** `read_at` means an agent of ours opened the
  thread and must never be presented as the customer having read anything.

A row stuck in `sending` is **never reclaimed**. Twilio's Messages API has no
idempotency key, so retrying a message that may already have gone is how one
person receives the same text twice. Those rows go to `needs_review` with their
`provider_sid`, which is written before anything else precisely so a human can
ask Twilio what really happened.

---

## Pre-flight, before enabling for a workspace

Every line is **checked**, not ticked. Admin → Messaging runs all of these
against Twilio when you open it.

1. **Credentials present.** `TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN`.
2. **The workspace switch is on.** Admin → Messaging.
3. **A usable quiet-hours window.** A degenerate one holds every message forever.
4. **A daily cap.** Without it a misconfigured playbook has nothing stopping it.
5. **At least two people can approve.** One means nothing goes out while they
   are away.
6. **At least one template published.** Publishing runs a real render, so a
   template using an unfillable variable is refused there.
7. **Every SMS-capable number's Messaging webhook points at
   `{app}/api/twilio/sms`.**

   **This is the one that bites.** Those webhooks currently point at ElevenLabs,
   which 404s inbound SMS — and the proof is in the data: `dnc_numbers` holds
   **zero** rows sourced from a text message across the platform's entire
   history. Sending before fixing this means STOP replies are dropped on the
   floor while messages keep going out. The Admin panel names the wrong numbers
   and offers to repoint them (Messaging webhook only — Voice is left alone,
   because for these numbers it targets the AI agent on purpose).

8. **The `messages` cron is scheduled** — see `supabase/cron.sql`, and schedule
   it *after* step 7, not before.
9. **Verify end to end** by texting STOP from a real handset and confirming
   three things landed: a `dnc_numbers` row with `source = 'sms_stop'`, a
   `consent_events` revocation, and the opportunity moved to `dnc_suppressed`.

### The 10DLC trap

With a Messaging Service and Advanced Opt-Out enabled — the common
configuration, and this account's A2P is already registered — **Twilio
intercepts STOP and may never forward it to the webhook**, while silently
blocking later sends with error 21610. The drain therefore treats 21610 as an
authoritative opt-out in its own right, writing both the suppression list and a
consent revocation. Whether Advanced Opt-Out is on is a decision that has to be
made and written down, not discovered.

---

## Safety valves

| Variable | Effect |
|---|---|
| `MESSAGING_SIMULATION=true` | Never calls Twilio at all |
| `MESSAGING_SIMULATE_FAILURE=true` | Proves the retry and alert path works |
| `MESSAGING_ALLOWLIST=+1555…,+1555…` | Refuses any recipient not on it, **independent of simulation** |

The allow-list's independence is the point: a staging deploy that loses its
simulation flag can still only reach the team's own handsets.

### Rollback

```sql
update public.app_settings set messaging_paused = true where id = 'global';
```

The drain refuses to claim while this is on and **approved rows stay exactly as
they are**. Pausing must be reversible; a pause that destroyed the queue would
be a one-way door. To stop the job entirely:
`select cron.unschedule('messages');`

---

## Publishing a messaging playbook

Held to a higher bar than one that only creates tasks, because a task that turns
out to be unnecessary wastes a rep's minute and a message that does lands on a
stranger's phone and cannot be recalled. Refused at publish:

- **`stop.rules` must include `replied`** — a sequence that cannot be silenced
  by someone answering it is not publishable.
- **`caps.touchesPerDay` must be set** — there is no safe default.
- **`lead.received` triggers are refused.** `processLeadIntake` emits at most 50
  per run against roughly 1,400 new leads a day, so only an arbitrary subset
  would be messaged. Unauditable, and unequal treatment of otherwise identical
  customers.
- **A `send_message` must be last, or followed by a `wait` or `stop`** —
  otherwise the next step runs while the proposal is still in a queue.

`send_sms` and `send_email` remain reserved forever; their publish error
redirects to `send_message`.
