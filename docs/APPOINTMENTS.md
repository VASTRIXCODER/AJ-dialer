# Appointments & calendar

The in-house scheduling system: where an account review is booked, moved, held, or
called off — and who gets told about it.

## What it replaced

The Appointments tab was a flat, bucketed list with a **"Calendar view coming soon"**
placeholder behind the Calendar toggle. Two things were structurally missing, not just
unbuilt:

1. **Rep-booked appointments had no time on them.** A rep clicking *Appointment booked*
   in the dialer filed the disposition and nothing ever asked *when*. `scheduled_at` was
   `NULL`, the row sank into the "Later" bucket, and it could never appear on a calendar.
   Every rep booking in the system was invisible to the thing meant to show it.
2. **An appointment could not exist without a call behind it.** The only insert site was
   `routeDisposition()`. A manager could not simply schedule a review.

Both are fixed. The calendar is real.

---

## The one invariant everything depends on

**`appointments.scheduled_at` is a floating wall clock, not an instant.**

It's declared `timestamptz`, but the app writes an offset-less string
(`"2026-06-23T18:00:00"`), Postgres reads it as UTC, and the read path strips the `+00`
back off. So *6pm means 6pm* regardless of where the server, the database, or the browser
is. The appointment's actual zone is recorded separately in `appointments.timezone`.

This is deliberate: an account review at 6pm is at 6pm on the homeowner's clock, and it
must not shift because a rep opened the calendar from another state.

> **Do not "fix" this into real UTC** without backfilling every existing row and rewriting
> every reader. A half-done migration silently moves every appointment in the database by
> hours, and nobody finds out until people start missing reviews.

`src/lib/appointments/time.ts` is the **single** place that parses or serializes it. Never
call `new Date(scheduledAt)` directly — use `parseFloating()`, which reads the digits in the
local zone so the wall clock survives.

`scheduled_at` is also **nullable, permanently**. The AI books "sometime next week": a human
label with no timestamp. Those rows can't be drawn on a grid, so the calendar surfaces them
in a **"Needs a time"** rail beneath it. Every helper in `time.ts` is null-safe.

---

## Views

| View | What it's for |
|---|---|
| **List** | Triage. AI proposals awaiting approval, then overdue / today / tomorrow / this week. The view you *work from*. |
| **Month** | The shape of the month. Drag a review to another day (it keeps its time of day). |
| **Week** | The working view. Drag to a time in 15-minute snaps; drag the bottom edge to change the duration. |
| **Day** | One column. Same grid, same maths — Week with `days.length === 1`. |

The anchor date and view are in the URL (`?v=week&d=2026-07-14`), so a link opens the screen
the sender was looking at. `Save view` persists the default to `profiles.preferences`.

**Per-rep vs team-wide** is the `appointments.team` permission (below). Holders see the whole
floor with a rep filter; everyone else sees their own calendar.

**Double-booking** is detected per *assignee*, not per org — two reps at 2pm is a busy
Tuesday, not a problem. It's a warning, never a block: the dialog shows what clashes, the
drop target turns red, and the chip gets a warning triangle. The rep still decides.

---

## Roles & permissions (ticket 7.2)

| Permission | owner | admin | manager | rep |
|---|:-:|:-:|:-:|:-:|
| `appointments.view` — open the calendar | ✅ | ✅ | ✅ | ✅ |
| `appointments.manage` — book, reschedule, approve, cancel | ✅ | ✅ | ✅ | ✅ |
| `appointments.team` — see & manage the whole team's calendar | ✅ | ✅ | ✅ | ❌ |

Reps hold `view` + `manage` because **they book their own reviews** — revoking those would
break the dialer's disposition flow. What they don't get is `team`.

**Permissions are the single source of truth for appointments**, which was not previously
true anywhere in this app. Everywhere else, feature access (`viewer.permissions`) and row
access (`getScope().supervisor`, derived from the denormalized `profiles.role`) are separate,
uncoordinated axes — so a per-member override changed which *buttons* you saw and nothing
else. Here, `canActOnAppt()` (`src/lib/appointments/access.ts`) governs both reads and writes,
so revoking `appointments.manage` on a member locks them out of the **data**.

Enforced at four layers, because the ticket's done-condition includes a hand-crafted POST:

1. `nav.ts` — the nav item requires `appointments.view`.
2. `app/(app)/appointments/page.tsx` — the page re-checks; it never trusts the nav.
3. `app/api/pipeline/route.ts` — every `appointment-*` action requires `appointments.manage` → **403**.
4. `lib/db/appointments.ts` — `canActOnAppt` on every individual write. Even if the route
   gate were bypassed, the DB layer refuses.

(`callback` and `disposition` on that route are deliberately *not* gated — they're shared with
the Callbacks page and the leads table, where owning the row has always been enough.)

---

## How it ties into leads and calls

- `lead_id → leads` — the homeowner. Phone, address and the qualifying numbers are joined at
  read time.
- `call_record_id → call_records` — **the call the booking came out of.** This link did not
  exist before.
- `owner_id` = who booked it. `assigned_to` = who *runs* the review (defaults to the owner; a
  manager can reassign). The calendar filters and conflict-checks on the assignee.
- Re-dispositioning a lead **cancels** its scheduled appointment rather than hard-deleting it,
  so the day still tells the truth. ⚠️ **Reports must exclude cancelled rows from
  `appointmentsBooked`** (`src/lib/db/metrics.ts`) or that change silently inflates every
  report.

---

## Notifications (ticket 6.2)

**The enqueue is a Postgres trigger, not application code.** supabase-js has no transactions,
so an app-level "insert the appointment, then insert the outbox row" can lose the second write
to a cold lambda or an unhandled throw — and a dropped notification is precisely what this
feature exists to prevent. A trigger is atomic with the INSERT by construction, and it can't be
forgotten by whatever new booking path someone adds next year.

**When it fires** is a product decision, not a technical one:

| Event | Email |
|---|---|
| INSERT with `approved = true` | **Appointment set.** A rep booked it; it's real. |
| `approved` goes false → true | **Appointment set.** A human accepted the AI's proposal. *That* is when an AI booking becomes real — firing on the raw proposal would email a guess. |
| `scheduled_at` changes on a notified row | **Appointment moved.** |
| `status → cancelled` on a notified row | **Appointment cancelled.** |

`appointments.notified_at` makes "set" at-most-once, so a re-approve can't double-send.

**Recipients** are resolved at *send* time, not enqueue time (Postgres can't read the app's
env): the org's list in **Admin → Notifications**, falling back to `APPOINTMENT_NOTIFY_EMAILS`.

**Retry:** 5 attempts on a `1m → 5m → 15m → 1h → 6h` backoff, then the row goes terminal
`failed`. `nextAttemptDelayMs()` is pure and unit-tested — a ladder that never ends would
never raise the alert.

**"Skipped" is not "failed".** No recipients and no env fallback → `skipped`, terminal and
benign. An org that doesn't want the email doesn't get red banners. `failed` is reserved for
things that are *actually* broken (recipients configured but no API key, provider rejecting
the send), which is what keeps the alert worth acting on.

**The alert path**, when retries are exhausted — three surfaces, none of them a log line:
1. The **notifications bell** gets a danger-toned entry that stays unread until it's dealt with.
2. A **banner on the calendar** with **Retry all**.
3. A **badge on the appointment itself**, with a per-row Retry.

**Where the drain runs.** It rides the existing per-minute `/api/cron/reconcile-ai` tick
(before its telephony guard, so email still flows in a Twilio-less workspace). This is
deliberate: per-minute crons **cannot** live in `vercel.json` — on Hobby they make the whole
deployment fail (see `docs/CRON.md`) — so the schedule is hand-applied pg_cron SQL that isn't
in this repo. A *new* job is a step someone can simply forget, and a forgotten job here would
mean the email silently never sends. Riding a tick that already exists makes it work the moment
the code deploys.

A standalone `/api/cron/notifications` also ships, if you'd rather schedule it properly. Running
both is harmless — the drain claims rows by flipping their status, so a double-fire sends nothing
twice.

---

## Verifying

```bash
npm run build                # type-checks every route
npm run verify:appointments  # the invariants above, as assertions
```

`scripts/verify-appointments.ts` proves the floating-clock round trip (including that a `+00`
from Postgres is *stripped*, not applied), null-time handling, the 42-cell month grid, drag
snapping and clamping, half-open per-assignee conflict detection, the **full 7.2 permission
truth table**, that the retry ladder terminates, and that the email names a time, a person and
a timezone — and escapes the lead's name.

**To prove the email end-to-end:** Admin → Notifications → add a recipient → **Send test email**.
A real message goes out, or the provider's actual error comes back on screen.

**To prove the failure path:** set `EMAIL_SIMULATE_FAILURE=true`, book an appointment, and watch
the outbox row walk `pending → attempts 1..5 → failed`. The bell and the calendar banner must
light up. Unset the flag and click **Retry** — it sends.

**To prove the 7.2 gate:** revoke `appointments.manage` from a test member (Admin → Members →
Permissions). The nav item disappears, the page shows a no-access state, and:

```bash
curl -X POST https://<host>/api/pipeline \
  -H 'content-type: application/json' \
  --cookie '<their session>' \
  -d '{"action":"appointment-edit","id":"<any id>","notes":"nope"}'
# → 403 {"ok":false,"error":"You don't have permission to manage appointments."}
```
