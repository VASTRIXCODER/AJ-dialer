/**
 * Speaker-aware transcript-read check — `npm run verify:readcall`.
 *
 * Guards the disposition-correctness invariants that produced the reported bugs:
 * appointments/qualifications filed for people who never booked, and bookings
 * with no date/time. readCall is pure, so its booking logic is tested directly.
 *
 * The load-bearing rule: the AGENT's scripted closing words ("you're all set")
 * must NOT book a call over the CUSTOMER's explicit decline, and a booking is
 * only real when either the customer strongly accepted a concrete slot or the
 * agent confirmed one without a decline.
 */
import { readCall } from "@/lib/ai/appointment";

// A fixed anchor so relative dates ("tomorrow at 6") resolve deterministically.
const NOW = new Date("2026-07-15T14:00:00Z"); // a Wednesday afternoon
const TZ = "America/Chicago";

type Case = {
  name: string;
  transcript: string;
  expect: {
    booked?: boolean;
    outcome?: string;
    /** When booked, whether a concrete machine time (iso) must be present. */
    hasIso?: boolean;
  };
};

const CASES: Case[] = [
  // ── THE BUG: agent's scripted close must not book over a decline. ──────────
  {
    name: "customer declines, agent says 'you're all set' → NOT booked, not_interested",
    transcript: [
      "agent: So can we get you on the calendar for a quick review?",
      "user: No, I'm really not interested, thanks.",
      "agent: No problem at all — you're all set, have a great day!",
    ].join("\n"),
    expect: { booked: false, outcome: "not_interested" },
  },
  {
    name: "customer says do-not-call, mentioned a time earlier → DNC, NOT booked",
    transcript: [
      "user: I mean 6pm is usually when I'm home.",
      "agent: Great, let me get you set up.",
      "user: Actually, take me off your list and do not call me again.",
    ].join("\n"),
    expect: { booked: false, outcome: "do_not_call" },
  },

  // ── Genuine bookings must STILL book. ─────────────────────────────────────
  {
    name: "customer accepts a concrete slot → booked WITH a real time",
    transcript: [
      "agent: How does tomorrow at 6 PM sound for the review?",
      "user: Yeah, that works for me, tomorrow at 6 is perfect.",
      "agent: Perfect, you're all set.",
    ].join("\n"),
    expect: { booked: true, outcome: "appointment_booked", hasIso: true },
  },
  {
    name: "skeptical-then-books: initial 'not interested' then accepts a slot → booked",
    transcript: [
      "user: Honestly I'm not interested, is this a scam?",
      "agent: Totally fair — it's free and only 15 minutes. How's Friday at 5?",
      "user: Okay, that works, Friday at 5 is fine.",
    ].join("\n"),
    expect: { booked: true, outcome: "appointment_booked", hasIso: true },
  },
  {
    name: "agent confirms a booking, no decline → booked (agent-confirmed path)",
    transcript: [
      "agent: I've got you down for Thursday at 6 PM with your account manager.",
      "user: Sounds good.",
    ].join("\n"),
    expect: { booked: true, outcome: "appointment_booked" },
  },

  // ── Agreement-in-principle without a time is NOT a booking. ───────────────
  {
    name: "vague 'sure, sometime' with no time and no agent confirm → NOT booked",
    transcript: [
      "agent: Would you be open to a quick review of your bill?",
      "user: Yeah sure, sometime could work, just call me to set it up.",
    ].join("\n"),
    expect: { booked: false },
  },
];

let failures = 0;
console.log("\nreadCall — the agent's script must never book over a customer decline\n");

for (const c of CASES) {
  const r = readCall(c.transcript, NOW, TZ);
  const checks: string[] = [];
  let ok = true;

  if (c.expect.booked !== undefined && r.booked !== c.expect.booked) {
    ok = false;
    checks.push(`booked=${r.booked} (expected ${c.expect.booked})`);
  }
  if (c.expect.outcome !== undefined && r.outcome !== c.expect.outcome) {
    ok = false;
    checks.push(`outcome=${r.outcome} (expected ${c.expect.outcome})`);
  }
  if (c.expect.hasIso !== undefined) {
    const hasIso = r.appointment.iso !== "";
    if (hasIso !== c.expect.hasIso) {
      ok = false;
      checks.push(`hasIso=${hasIso} (expected ${c.expect.hasIso})`);
    }
  }

  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${c.name}`);
  if (!ok) console.log(`          ${checks.join(", ")}`);
}

console.log(failures === 0 ? "\nAll checks passed.\n" : `\n${failures} check(s) FAILED.\n`);
process.exit(failures === 0 ? 0 : 1);
