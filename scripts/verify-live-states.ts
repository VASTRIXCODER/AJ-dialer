/**
 * Live-state verification — `npm run verify:live-states`.
 *
 * Guards the invariant the Live Monitor was broken on: a call that nobody picked
 * up must leave "in progress" quickly, land on a truthful outcome, and be visibly
 * distinguishable from a call that is merely ringing.
 *
 * Three modes:
 *
 *   (no args)              Pure checks. The lifecycle guards and the Twilio-verdict
 *                          → outcome mapping. Free, offline, run this in CI.
 *
 *   --simulate <baseUrl>   Fire real-shaped Twilio status callbacks at a running
 *                          server and assert the conversation walks
 *                          initiated → ringing → terminal. Needs SUPABASE_SERVICE_ROLE_KEY.
 *
 *   --watch                Tail ai_conversations and print the state timeline of
 *                          every recent AI call — the readout for the 10 live
 *                          test calls. Needs SUPABASE_SERVICE_ROLE_KEY.
 */
import { createClient } from "@supabase/supabase-js";
import { classifyNonConversation } from "@/lib/call-disposition";
import {
  isTerminalLiveState,
  LIVE_STATES,
  liveStateRank,
  type AILiveState,
} from "@/lib/types";

// The window we promise: Twilio rings for 30s (the `timeout` we set on the
// homeowner's leg), then the status callback lands. Anything past this means the
// push path did NOT work and something slower caught the call instead.
const NO_ANSWER_SLA_MS = 35_000;
// Absolute ceiling. Past this, only the cron reconciler could have closed it.
const NO_ANSWER_CEILING_MS = 90_000;

let failures = 0;
const ok = (m: string) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const bad = (m: string) => {
  failures++;
  console.log(`  \x1b[31m✗ ${m}\x1b[0m`);
};
const check = (cond: boolean, m: string) => (cond ? ok(m) : bad(m));

// ─────────────────────────────────────────────────────────────────────────────
// 1. The lifecycle is monotonic.
//
// Every state writer guards on rank. If these break, a late `ringing` webhook can
// drag a connected call backwards, or a stale cache entry can resurrect a call
// that already ended — which is exactly how "In Progress" became permanent.
// ─────────────────────────────────────────────────────────────────────────────
function checkLifecycle() {
  console.log("\nLifecycle — the state machine can only move forward");

  const order: AILiveState[] = ["initiated", "ringing", "in_progress", "completed"];
  for (let i = 1; i < order.length; i++) {
    check(
      liveStateRank(order[i]) > liveStateRank(order[i - 1]),
      `${order[i - 1]} ranks below ${order[i]}`,
    );
  }
  check(
    liveStateRank("failed") === liveStateRank("completed"),
    "failed and completed are both terminal (equal rank)",
  );

  // The bug this exists to prevent: ringing must NOT outrank in_progress.
  check(
    liveStateRank("ringing") < liveStateRank("in_progress"),
    "a late `ringing` cannot drag a connected call backwards",
  );

  check(
    LIVE_STATES.includes("ringing"),
    "`ringing` counts as live — else it is invisible to the monitor AND the reconciler",
  );
  check(LIVE_STATES.length === 3, "exactly initiated/ringing/in_progress are live");
  check(
    !isTerminalLiveState("ringing") && isTerminalLiveState("failed"),
    "isTerminalLiveState agrees with LIVE_STATES",
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Twilio's verdict on the homeowner's leg → the outcome we file.
//
// These are the exact inputs /api/twilio/status now hands to finalizeAIConversation.
// The load-bearing case is the last one: a leg that FAILED with an error code never
// rang anybody's phone, and must not be laundered into "the homeowner ignored us".
// ─────────────────────────────────────────────────────────────────────────────
function checkTwilioVerdicts() {
  console.log("\nTwilio verdict → filed outcome");

  const cases: {
    name: string;
    status: string;
    errorCode?: string | null;
    expect: { kind: "outcome"; value: string } | { kind: "failure"; value: string };
  }[] = [
    {
      name: "no-answer → no_answer (the case this whole change exists for)",
      status: "no-answer",
      expect: { kind: "outcome", value: "no_answer" },
    },
    {
      name: "busy → no_answer",
      status: "busy",
      expect: { kind: "outcome", value: "no_answer" },
    },
    {
      name: "canceled (we hung the leg up ourselves) → no_answer",
      status: "canceled",
      expect: { kind: "outcome", value: "no_answer" },
    },
    {
      name: "failed with NO error code → no_answer",
      status: "failed",
      expect: { kind: "outcome", value: "no_answer" },
    },
    {
      name: "failed + 21210 (bad caller ID) → provider_error, NOT a homeowner no-answer",
      status: "failed",
      errorCode: "21210",
      expect: { kind: "failure", value: "provider_error" },
    },
    {
      name: "failed + 21610 (number blocked) → provider_error, NOT a homeowner no-answer",
      status: "failed",
      errorCode: "21610",
      expect: { kind: "failure", value: "provider_error" },
    },
  ];

  for (const c of cases) {
    // Mirrors the call the status route makes: zero turns, zero duration, the
    // Twilio status as the termination reason, failureKind deliberately null.
    const got = classifyNonConversation({
      terminationReason: c.status,
      status: "failed",
      durationSec: undefined,
      errorCode: c.errorCode ?? null,
      hasHumanTurn: false,
      failureKind: null,
    });
    const actual =
      got.kind === "outcome"
        ? { kind: "outcome" as const, value: String(got.outcome) }
        : { kind: "failure" as const, value: String(got.failureKind) };
    check(
      actual.kind === c.expect.kind && actual.value === c.expect.value,
      `${c.name}${
        actual.value === c.expect.value ? "" : ` — got ${actual.kind}:${actual.value}`
      }`,
    );
  }

  // And the inverse: `completed` means the leg WAS answered. It must never reach
  // this classifier as a no-answer — the status route excludes it on purpose.
  console.log("\n  (note: Twilio `completed` = answered; the status route never files it as no-answer)");
}

// ─────────────────────────────────────────────────────────────────────────────
// Supabase (watch / simulate)
// ─────────────────────────────────────────────────────────────────────────────
function admin() {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !key) {
    console.error(
      "\nNeeds NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment.",
    );
    process.exit(1);
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

const ms = (a: string | null, b: string | null) =>
  a && b ? Date.parse(b) - Date.parse(a) : null;
const secs = (n: number | null) => (n == null ? "  —  " : `${(n / 1000).toFixed(1)}s`);

/**
 * The readout for the 10 live test calls. Prints, per call, how long it took to
 * start ringing and how long it took to LEAVE the live states — which is the
 * number the whole change is judged on.
 */
async function watch() {
  const db = admin();
  const since = new Date(Date.now() - 60 * 60_000).toISOString();

  const { data, error } = await db
    .from("ai_conversations")
    .select(
      "conversation_id, lead_name, state, outcome, failure_kind, termination_reason, started_at, ringing_at, connected_at, ended_at",
    )
    .gte("started_at", since)
    .order("started_at", { ascending: false })
    .limit(25);

  if (error) {
    console.error("Query failed:", error.message);
    process.exit(1);
  }

  const rows = data ?? [];
  if (rows.length === 0) {
    console.log("No AI calls in the last hour.");
    return;
  }

  console.log(
    "\nlead                 state         outcome            →ring   →ended  verdict",
  );
  console.log("─".repeat(92));

  let stranded = 0;
  let slow = 0;
  let unresolvable = 0;

  for (const r of rows) {
    const started = String(r.started_at);
    const toRing = ms(started, r.ringing_at as string | null);
    const toEnd = ms(started, r.ended_at as string | null);
    const live = LIVE_STATES.includes(String(r.state) as AILiveState);
    const age = Date.now() - Date.parse(started);

    let verdict: string;
    if (live && age > NO_ANSWER_CEILING_MS) {
      verdict = "\x1b[31mSTRANDED\x1b[0m"; // still "live" long after it must have ended
      stranded++;
    } else if (live) {
      verdict = "\x1b[36min flight\x1b[0m";
    } else if (r.failure_kind === "unresolvable") {
      verdict = "\x1b[31munresolvable\x1b[0m"; // push failed; something slow caught it
      unresolvable++;
    } else if (toEnd != null && toEnd > NO_ANSWER_SLA_MS && r.outcome === "no_answer") {
      verdict = "\x1b[33mslow\x1b[0m";
      slow++;
    } else {
      verdict = "\x1b[32mok\x1b[0m";
    }

    console.log(
      `${String(r.lead_name ?? "").slice(0, 20).padEnd(20)} ` +
        `${String(r.state).padEnd(13)} ` +
        `${String(r.outcome ?? r.failure_kind ?? "—").padEnd(18)} ` +
        `${secs(toRing).padStart(6)}  ${secs(toEnd).padStart(6)}  ${verdict}`,
    );
  }

  console.log("─".repeat(92));
  const noAnswers = rows.filter((r) => r.outcome === "no_answer");
  const timed = noAnswers
    .map((r) => ms(String(r.started_at), r.ended_at as string | null))
    .filter((n): n is number => n != null);
  if (timed.length > 0) {
    const worst = Math.max(...timed);
    const median = timed.sort((a, b) => a - b)[Math.floor(timed.length / 2)];
    console.log(
      `no-answer calls: ${timed.length}   median ${secs(median)}   worst ${secs(worst)}   ` +
        `(SLA ${NO_ANSWER_SLA_MS / 1000}s)`,
    );
    check(worst <= NO_ANSWER_CEILING_MS, `every no-answer cleared within ${NO_ANSWER_CEILING_MS / 1000}s`);
    check(
      timed.every((t) => t <= NO_ANSWER_SLA_MS),
      `every no-answer cleared within the ${NO_ANSWER_SLA_MS / 1000}s SLA`,
    );
  }
  const ringed = rows.filter((r) => r.ringing_at).length;
  check(
    ringed > 0,
    "at least one call recorded a `ringing` timestamp — the Twilio push path IS working",
  );
  check(stranded === 0, "no call is stranded in a live state");
  check(
    unresolvable === 0,
    "no call was filed `unresolvable` (that means the Twilio callback never arrived)",
  );
  if (slow > 0) {
    console.log(
      `\n  \x1b[33m${slow} call(s) took longer than the SLA — the webhook is arriving late, or the\n` +
        "  cron reconciler (not the push path) is what closed them.\x1b[0m",
    );
  }
}

/**
 * Drive a conversation through the real webhook with real-shaped Twilio payloads.
 * Proves the transitions without spending a cent of Twilio or ElevenLabs credit.
 */
async function simulate(baseUrl: string) {
  const db = admin();
  const id = `verify-${Date.now()}`;
  console.log(`\nSimulating a no-answer against ${baseUrl}\n  conversation: ${id}`);

  const { error: seedErr } = await db.from("ai_conversations").insert({
    conversation_id: id,
    lead_name: "Verify Harness",
    phone: "+15555550123",
    call_sid: "CAverifyagentleg",
    customer_call_sid: "CAverifycustomerleg",
    state: "initiated",
  });
  if (seedErr) {
    console.error("Could not seed the conversation:", seedErr.message);
    process.exit(1);
  }

  const post = async (callStatus: string) => {
    const body = new URLSearchParams({
      CallSid: "CAverifycustomerleg",
      CallStatus: callStatus,
    });
    const res = await fetch(
      `${baseUrl}/api/twilio/status?conversationId=${encodeURIComponent(id)}`,
      { method: "POST", body },
    );
    if (!res.ok && res.status !== 204) {
      bad(`POST ${callStatus} → HTTP ${res.status}`);
    }
  };

  const state = async () => {
    const { data } = await db
      .from("ai_conversations")
      .select("state, outcome, ringing_at")
      .eq("conversation_id", id)
      .maybeSingle();
    return data;
  };

  await post("ringing");
  let s = await state();
  check(s?.state === "ringing", `ringing callback → state is "ringing" (got "${s?.state}")`);
  check(Boolean(s?.ringing_at), "ringing_at was stamped");

  await post("no-answer");
  s = await state();
  check(
    s != null && isTerminalLiveState(String(s.state)),
    `no-answer callback → terminal state (got "${s?.state}")`,
  );
  check(
    s?.outcome === "no_answer",
    `no-answer callback → outcome "no_answer" (got "${s?.outcome ?? "null"}") ` +
      "— a terminal state with NO outcome means the claim/finalize handoff is broken",
  );

  // Idempotency: Twilio retries. A second delivery must change nothing.
  await post("no-answer");
  const again = await state();
  check(
    again?.outcome === s?.outcome && again?.state === s?.state,
    "a retried no-answer callback is idempotent",
  );

  // Regression guard: a LATE ringing event must not resurrect a finished call.
  await post("ringing");
  const late = await state();
  check(
    late != null && isTerminalLiveState(String(late.state)),
    "a late `ringing` callback cannot drag a finished call back to live",
  );

  await db.from("ai_conversations").delete().eq("conversation_id", id);
  console.log("  (cleaned up)");
}

// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--watch")) {
    await watch();
  } else if (args.includes("--simulate")) {
    const url = args[args.indexOf("--simulate") + 1];
    if (!url?.startsWith("http")) {
      console.error("Usage: --simulate https://your-tunnel.example.com");
      process.exit(1);
    }
    await simulate(url.replace(/\/$/, ""));
  } else {
    checkLifecycle();
    checkTwilioVerdicts();
  }

  console.log(
    failures === 0
      ? "\n\x1b[32mAll checks passed.\x1b[0m\n"
      : `\n\x1b[31m${failures} check(s) failed.\x1b[0m\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

void main();
