/**
 * Disposition-classifier check — `npm run verify:disposition`.
 *
 * Guards the invariant the zero-connect outage was made of: a call the AI agent
 * ANSWERED and then killed must never be filed as "the homeowner didn't pick up".
 *
 * The cases below are the real shapes pulled from production `call_records`
 * during the incident (nonzero 1-3s durations, no transcript, all filed
 * `no_answer`) plus the healthy cases that must keep working.
 */
import {
  breakerStatus,
  recordProviderFailure,
  resetBreaker,
} from "@/lib/ai-call-breaker";
import { classifyNonConversation, neverReachedHomeowner } from "@/lib/call-disposition";

type Case = {
  name: string;
  input: Parameters<typeof classifyNonConversation>[0];
  expect: { kind: "outcome"; outcome: string } | { kind: "failure"; failureKind: string };
};

const CASES: Case[] = [
  // ── THE ACTUAL OUTAGE: out of ElevenLabs credits. ──────────────────────────
  // Verbatim from the production conversation the user reproduced on their phone:
  //   "This request exceeds your quota limit." · Status: Error · Duration 0:02
  //   · 1 message (an incomplete greeting) · Conversation cost: 0 credits
  {
    name: 'OUT OF CREDITS — "This request exceeds your quota limit" (the real cause)',
    input: {
      durationSec: 2,
      hasHumanTurn: false,
      status: "failed",
      errorReason: "This request exceeds your quota limit.",
    },
    expect: { kind: "failure", failureKind: "provider_quota_exceeded" },
  },
  {
    name: "out of credits, phrased as an error code",
    input: { durationSec: 2, hasHumanTurn: false, errorCode: "quota_exceeded" },
    expect: { kind: "failure", failureKind: "provider_quota_exceeded" },
  },
  {
    name: "quota message must WIN over the generic kill-on-connect rule",
    input: {
      durationSec: 2,
      hasHumanTurn: false,
      terminationReason: "This request exceeds your quota limit.",
    },
    expect: { kind: "failure", failureKind: "provider_quota_exceeded" },
  },

  // ── Same visible signature, unknown cause (e.g. a disallowed override). ────
  {
    name: "ANSWERED then killed at 2s, no transcript, no quota message",
    input: { durationSec: 2, hasHumanTurn: false, status: "done", terminationReason: "" },
    expect: { kind: "failure", failureKind: "agent_terminated_on_connect" },
  },
  {
    name: "ANSWERED then killed at 1s",
    input: { durationSec: 1, hasHumanTurn: false, status: "failed" },
    expect: { kind: "failure", failureKind: "agent_terminated_on_connect" },
  },
  {
    name: "ANSWERED then killed at 3s (the max seen in prod)",
    input: { durationSec: 3, hasHumanTurn: false, status: "done" },
    expect: { kind: "failure", failureKind: "agent_terminated_on_connect" },
  },

  // ── The 25-second call that prod also filed as "no_answer". ────────────────
  {
    name: "answered 25s, nobody ever spoke (voicemail; AMD is off)",
    input: { durationSec: 25, hasHumanTurn: false, status: "done" },
    expect: { kind: "failure", failureKind: "answered_no_human_turn" },
  },

  // ── Genuine homeowner outcomes must STILL be filed as outcomes. ────────────
  {
    name: "never answered (0s) → a real no_answer",
    input: { durationSec: 0, hasHumanTurn: false, terminationReason: "no-answer" },
    expect: { kind: "outcome", outcome: "no_answer" },
  },
  {
    name: "busy, 0s → no_answer",
    input: { durationSec: 0, hasHumanTurn: false, terminationReason: "busy" },
    expect: { kind: "outcome", outcome: "no_answer" },
  },
  {
    name: "provider says voicemail → voicemail",
    input: { durationSec: 0, hasHumanTurn: false, terminationReason: "voicemail detected" },
    expect: { kind: "outcome", outcome: "voicemail" },
  },
  {
    name: "number not in service → wrong_number",
    input: { durationSec: 0, hasHumanTurn: false, terminationReason: "number not in service" },
    expect: { kind: "outcome", outcome: "wrong_number" },
  },

  // ── Explicit system faults. ────────────────────────────────────────────────
  {
    name: "provider returned an error code",
    input: { durationSec: 2, hasHumanTurn: false, errorCode: "invalid_config" },
    expect: { kind: "failure", failureKind: "provider_error" },
  },
  {
    name: "homeowner leg was never dialed (Twilio rejected it)",
    input: { durationSec: 0, failureKind: "bridge_dial_failed" },
    expect: { kind: "failure", failureKind: "bridge_dial_failed" },
  },
  {
    name: "reconciler could not read the conversation at all",
    input: { durationSec: 0, failureKind: "unresolvable" },
    expect: { kind: "failure", failureKind: "unresolvable" },
  },
];

let failures = 0;
console.log("\nDisposition classifier — an answered-then-killed call must NEVER be a no_answer\n");

for (const c of CASES) {
  const got = classifyNonConversation(c.input);
  const gotLabel =
    got.kind === "outcome" ? `outcome:${got.outcome}` : `failure:${got.failureKind}`;
  const wantLabel =
    c.expect.kind === "outcome"
      ? `outcome:${c.expect.outcome}`
      : `failure:${c.expect.failureKind}`;
  const ok = gotLabel === wantLabel;
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${c.name}`);
  if (!ok) console.log(`          got ${gotLabel}, expected ${wantLabel}`);
}

// The whole point: none of the killed calls may be dispositioned at all — a null
// outcome is what keeps them out of the connect-rate denominator.
console.log("\nNo system failure may carry a homeowner disposition\n");
for (const c of CASES) {
  if (c.expect.kind !== "failure") continue;
  const got = classifyNonConversation(c.input);
  const leaks = got.kind === "outcome";
  if (leaks) failures++;
  console.log(
    `  ${leaks ? "FAIL" : "PASS"}  ${c.expect.failureKind} → ${leaks ? "LEAKED a disposition!" : "outcome is null (excluded from rates)"}`,
  );
}

// Leads whose phone never rang must remain due for a first attempt.
console.log("\nLeads we never actually dialed must stay un-contacted\n");
for (const [kind, expected] of [
  ["bridge_dial_failed", true],
  ["not_placed", true],
  ["agent_terminated_on_connect", false], // their phone DID ring
  ["provider_quota_exceeded", false], // their phone rang and they heard half a sentence
] as const) {
  const got = neverReachedHomeowner(kind);
  const ok = got === expected;
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${kind}: neverReachedHomeowner = ${got}`);
}

// The breaker must halt a running batch the moment credits run out.
console.log("\nA quota failure must halt dialing IMMEDIATELY (not after 5 strikes)\n");
{
  resetBreaker();
  const after = recordProviderFailure("provider_quota_exceeded", "quota");
  const ok = after.open;
  if (!ok) failures++;
  console.log(
    `  ${ok ? "PASS" : "FAIL"}  one quota failure trips the breaker → dialing halted = ${after.open}`,
  );

  resetBreaker();
  let st = recordProviderFailure("agent_terminated_on_connect", "x");
  const notYet = !st.open;
  if (!notYet) failures++;
  console.log(`  ${notYet ? "PASS" : "FAIL"}  a single ambiguous failure does NOT halt the floor`);

  for (let i = 0; i < 4; i++) st = recordProviderFailure("agent_terminated_on_connect", "x");
  const tripped = st.open;
  if (!tripped) failures++;
  console.log(`  ${tripped ? "PASS" : "FAIL"}  5 consecutive kills DO halt it (${st.consecutiveFailures} failures)`);

  resetBreaker();
  const reset = !breakerStatus().open;
  if (!reset) failures++;
  console.log(`  ${reset ? "PASS" : "FAIL"}  a successful conversation clears the breaker`);
}

console.log(failures === 0 ? "\nAll checks passed.\n" : `\n${failures} check(s) FAILED.\n`);
process.exit(failures === 0 ? 0 : 1);
