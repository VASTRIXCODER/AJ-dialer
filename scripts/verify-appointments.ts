/**
 * Appointments & calendar check — `npm run verify:appointments`.
 *
 * Guards the invariants Part 6 is built on, all of which are silent when broken:
 *
 *  1. The FLOATING WALL CLOCK. `scheduled_at` is a timestamptz that does not hold
 *     an instant. If a round trip through the time helpers ever shifts "6pm" by
 *     an offset, every appointment in the database moves by hours and nobody
 *     notices until reps start missing reviews. This is the one that matters.
 *  2. A NULL time is not an error. Half the AI's bookings have a label and no
 *     timestamp; every helper has to survive that rather than render "NaN".
 *  3. CONFLICTS are per-person and half-open. Two reps at 2pm is a busy Tuesday.
 *     A review ending at 3:00 does not clash with one starting at 3:00.
 *  4. The 7.2 PERMISSION GATE. `canActOnAppt` is the choke point every write goes
 *     through — the truth table below is the ticket's done-condition in code.
 *  5. RETRY BACKOFF terminates. A notification that retried forever would never
 *     raise the alert that stops it failing silently.
 */
import { bucketOf } from "@/lib/appointments-organize";
import { type ApptScope, canActOnAppt } from "@/lib/appointments/access";
import { conflictedIds, conflictsAt, findConflicts } from "@/lib/appointments/conflicts";
import {
  addMonths,
  endOf,
  formatRange,
  monthGrid,
  parseFloating,
  slotFromOffset,
  toFloatingString,
  weekDays,
  whenLabel,
} from "@/lib/appointments/time";
import { renderAppointmentEmail, whenSentence } from "@/lib/email/templates/appointment";
import { BACKOFF_MIN, MAX_ATTEMPTS, nextAttemptDelayMs } from "@/lib/notifications/backoff";

let failures = 0;

function check(name: string, ok: boolean, detail?: string) {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok && detail) console.log(`          ${detail}`);
}

function eq(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  check(name, ok, `got ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\nFloating wall clock — 6pm must round-trip as 6pm, in any timezone\n");

const SIX_PM = "2026-07-14T18:00:00";
const parsed = parseFloating(SIX_PM)!;
eq("parse keeps the hour", parsed.getHours(), 18);
eq("parse keeps the date", parsed.getDate(), 14);
eq("parse keeps the month (0-indexed)", parsed.getMonth(), 6);
eq("round-trips byte-for-byte", toFloatingString(parsed), SIX_PM);

// This is the regression that would move every appointment in the DB. Postgres
// hands back "+00"; if we ever let Date apply that offset, the wall clock shifts.
eq(
  "a +00 offset from Postgres is STRIPPED, not applied",
  toFloatingString(parseFloating("2026-07-14T18:00:00+00:00")!),
  SIX_PM,
);
eq(
  "a space-separated Postgres timestamp parses the same",
  toFloatingString(parseFloating("2026-07-14 18:00:00")!),
  SIX_PM,
);

console.log("\nA null time is normal, not an error\n");
check("parseFloating(null) is null", parseFloating(null) === null);
check("parseFloating('') is null", parseFloating("") === null);
check("endOf() with no time is null", endOf({ scheduledAt: null, durationMin: 60 }) === null);
eq(
  "whenLabel falls back to the AI's own words",
  whenLabel({ scheduledAt: null, scheduledLabel: "Tomorrow afternoon" }),
  "Tomorrow afternoon",
);
eq(
  "whenLabel with nothing at all still says something",
  whenLabel({ scheduledAt: null, scheduledLabel: "" }),
  "No time set",
);
eq(
  "an untimed booking buckets to 'later', never crashes",
  bucketOf({
    id: "x",
    status: "scheduled",
    approved: true,
    source: "rep",
    scheduledAt: null,
    createdAt: new Date().toISOString(),
  }),
  "later",
);

console.log("\nDuration & ranges\n");
eq(
  "endOf adds the duration",
  toFloatingString(endOf({ scheduledAt: SIX_PM, durationMin: 90 })!),
  "2026-07-14T19:30:00",
);
eq("a missing duration defaults to 60", toFloatingString(endOf({ scheduledAt: SIX_PM })!), "2026-07-14T19:00:00");
eq("range drops the repeated meridiem", formatRange(parseFloating(SIX_PM)!, 60), "6:00 – 7:00 PM");
eq(
  "range keeps both when they differ",
  formatRange(parseFloating("2026-07-14T11:30:00")!, 60),
  "11:30 AM – 12:30 PM",
);

// ─────────────────────────────────────────────────────────────────────────────
console.log("\nGrids — the month grid must always be 42 cells, or it reflows as you page\n");

for (const iso of ["2026-02-01T00:00:00", "2026-07-14T00:00:00", "2027-01-31T00:00:00"]) {
  const grid = monthGrid(parseFloating(iso)!);
  check(`${iso.slice(0, 7)} → 42 cells`, grid.length === 42, `got ${grid.length}`);
  check(`${iso.slice(0, 7)} → starts on a Sunday`, grid[0].getDay() === 0);
}
eq("a week is 7 days", weekDays(parseFloating(SIX_PM)!).length, 7);
eq("the week starts on Sunday", weekDays(parseFloating(SIX_PM)!)[0].getDay(), 0);

// Jan 31 + 1 month must not skid into March — the classic Date.setMonth trap.
eq(
  "Jan 31 + 1 month clamps to Feb 28, it does not roll into March",
  toFloatingString(addMonths(parseFloating("2026-01-31T00:00:00")!, 1)).slice(0, 10),
  "2026-02-28",
);

console.log("\nDrag maths — a pixel offset snaps to a 15-minute slot\n");
const day = parseFloating("2026-07-14T00:00:00")!;
// Grid starts at 06:00; 56px per hour.
eq("the top of the grid is 6:00am", toFloatingString(slotFromOffset(day, 0, 56)), "2026-07-14T06:00:00");
eq("one row down is 7:00am", toFloatingString(slotFromOffset(day, 56, 56)), "2026-07-14T07:00:00");
eq("a half row is 6:30am", toFloatingString(slotFromOffset(day, 28, 56)), "2026-07-14T06:30:00");
eq("an off-grid pixel snaps to :15", toFloatingString(slotFromOffset(day, 15, 56)), "2026-07-14T06:15:00");
eq(
  "dragging above the grid clamps to the first slot, it doesn't wrap to yesterday",
  toFloatingString(slotFromOffset(day, -500, 56)),
  "2026-07-14T06:00:00",
);
eq(
  "dragging below the grid clamps to the last slot",
  toFloatingString(slotFromOffset(day, 99999, 56)),
  "2026-07-14T21:00:00",
);

// ─────────────────────────────────────────────────────────────────────────────
console.log("\nDouble-booking — the same rep in two places at once\n");

const ana = "rep-ana";
const bob = "rep-bob";
const at = (t: string, mins = 60, assignedTo = ana, id = t) => ({
  id,
  assignedTo,
  scheduledAt: t,
  durationMin: mins,
  status: "scheduled",
  leadName: `Lead ${id}`,
});

const twoPM = at("2026-07-14T14:00:00");
const twoThirty = at("2026-07-14T14:30:00", 60, ana, "overlap");
const threePM = at("2026-07-14T15:00:00", 60, ana, "adjacent");
const twoPMBob = at("2026-07-14T14:00:00", 60, bob, "bob");

check("an overlapping review for the SAME rep conflicts", findConflicts(twoPM, [twoThirty]).length === 1);
check(
  "a review ending at 3:00 does NOT conflict with one starting at 3:00 (half-open)",
  findConflicts(twoPM, [threePM]).length === 0,
);
check(
  "the same slot for a DIFFERENT rep is not a conflict — it's a busy Tuesday",
  findConflicts(twoPM, [twoPMBob]).length === 0,
);
check("an appointment never conflicts with itself", findConflicts(twoPM, [twoPM]).length === 0);
check(
  "a CANCELLED review frees its slot back up",
  findConflicts(twoPM, [{ ...twoThirty, status: "cancelled" }]).length === 0,
);
check(
  "an untimed booking can't be double-booked",
  findConflicts({ ...twoPM, scheduledAt: null }, [twoThirty]).length === 0,
);
check(
  "conflictsAt answers for a slot not yet saved (what the dialog asks on every keystroke)",
  conflictsAt({ id: "new", assignee: ana }, parseFloating("2026-07-14T14:15:00")!, 30, [twoPM])
    .length === 1,
);
eq(
  "conflictedIds flags BOTH sides of a clash, for the warning dots",
  [...conflictedIds([twoPM, twoThirty, twoPMBob])].sort(),
  ["2026-07-14T14:00:00", "overlap"],
);

// ─────────────────────────────────────────────────────────────────────────────
console.log("\nTicket 7.2 — the calendar permission gate\n");

const scope = (manage: boolean, team: boolean): ApptScope => ({
  userId: "me",
  orgId: "org-1",
  manage,
  team,
});

// The done-condition, in code: no manage permission ⇒ no write, ever. Not for
// their own row, not for anyone's. This is what a hand-crafted POST hits.
check(
  "NO manage ⇒ cannot touch even their OWN appointment",
  canActOnAppt(scope(false, false), "me", "org-1") === false,
);
check(
  "NO manage ⇒ team permission does not rescue it",
  canActOnAppt(scope(false, true), "me", "org-1") === false,
);
check("manage ⇒ can edit their own", canActOnAppt(scope(true, false), "me", "org-1") === true);
check(
  "manage but NOT team ⇒ cannot edit a teammate's",
  canActOnAppt(scope(true, false), "someone-else", "org-1") === false,
);
check(
  "manage + team ⇒ can edit a teammate's, in their own org",
  canActOnAppt(scope(true, true), "someone-else", "org-1") === true,
);
check(
  "manage + team ⇒ STILL cannot reach another org's appointment",
  canActOnAppt(scope(true, true), "someone-else", "org-2") === false,
);
check(
  "an orphaned row (no owner, no org) is not writable by anyone",
  canActOnAppt(scope(true, true), null, null) === false,
);

// ─────────────────────────────────────────────────────────────────────────────
console.log("\nNotification retry — it must give up, or it never raises the alert\n");

eq("five attempts", MAX_ATTEMPTS, 5);
eq("backoff ladder (minutes)", BACKOFF_MIN, [1, 5, 15, 60, 360]);
eq("after attempt 1, retry in 1 minute", nextAttemptDelayMs(1), 60_000);
eq("after attempt 4, retry in an hour", nextAttemptDelayMs(4), 60 * 60_000);
check(
  "after the LAST attempt there is no next one — the row goes terminal and alerts",
  nextAttemptDelayMs(MAX_ATTEMPTS) === null,
);
check("a runaway attempt count still terminates", nextAttemptDelayMs(99) === null);

// ─────────────────────────────────────────────────────────────────────────────
console.log("\nThe email — it must name a time, a person, and a timezone\n");

const email = renderAppointmentEmail({
  kind: "appointment_set",
  payload: {
    leadName: "Dana Whitfield",
    scheduledAt: SIX_PM,
    durationMin: 60,
    timezone: "America/Chicago",
    phone: "+15125550147",
    address: "88 Larkspur Way, Austin, TX",
    utilityBill: 240,
    solarPayment: 180,
    source: "rep",
  },
  repName: "Ana Ruiz",
  orgName: "Sunrun",
  appUrl: "https://example.com",
});

check("subject names the homeowner", email.subject.includes("Dana Whitfield"));
check("subject carries the time", email.subject.includes("6:00"));
check(
  "the time is qualified by its timezone — '6pm' alone is meaningless to another state",
  /CDT|CST|America\/Chicago/.test(email.text),
  email.text,
);
check("the html renders the phone", email.html.includes("(512) 555-0147"));
check("the html shows the combined bill — the whole premise of the pitch", email.html.includes("$420"));
check("the rep is named", email.text.includes("Ana Ruiz"));
check("there's a link back to the calendar", email.html.includes("https://example.com/appointments"));
check(
  "an untimed booking still sends, with the words that were agreed",
  whenSentence({ scheduledAt: null, scheduledLabel: "Tomorrow afternoon" }) === "Tomorrow afternoon",
);

const cancelled = renderAppointmentEmail({
  kind: "appointment_cancelled",
  payload: { leadName: "Dana Whitfield", scheduledAt: SIX_PM, cancelReason: "Homeowner rescheduled" },
});
check("a cancellation says so", cancelled.subject.startsWith("Appointment cancelled"));
check("a cancellation gives the reason", cancelled.text.includes("Homeowner rescheduled"));

// HTML-escaping: a lead name is user data, and it goes into an email body.
const nasty = renderAppointmentEmail({
  kind: "appointment_set",
  payload: { leadName: '<script>alert("x")</script>', scheduledAt: SIX_PM },
});
check(
  "a lead name is escaped before it reaches the html",
  !nasty.html.includes("<script>") && nasty.html.includes("&lt;script&gt;"),
);

// ─────────────────────────────────────────────────────────────────────────────
console.log(
  failures === 0
    ? "\n✅ All appointment invariants hold.\n"
    : `\n❌ ${failures} check${failures === 1 ? "" : "s"} failed.\n`,
);
process.exit(failures === 0 ? 0 : 1);
