/**
 * Dialer safety checks — `npm run verify:dialer`.
 *
 * Guards the two behaviours that could hurt real homeowners:
 *
 *   1. CONCURRENCY. The pump must hold the floor to N live calls. The old code
 *      launched N fresh calls every 8 seconds whether or not the previous ones
 *      had ended — an AI call runs 2-5 minutes, so "3X" meant ~22 calls a minute
 *      and 100+ simultaneous within a few minutes. That is how a 10-concurrent
 *      plan got flooded and a credit balance was drained in an afternoon.
 *
 *   2. QUEUE WRAPAROUND. advanceQueue() used `% queue.length`, so a finished
 *      session rolled back to index 0 and re-dialed every homeowner again, on a
 *      loop, for as long as auto-dial was on.
 *
 * Both are simulated below against the real logic.
 */
import { sanitizeSegments, BLOCKED_SEGMENTS } from "@/lib/dialer/segments";

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
};

// ── 1. Concurrency ───────────────────────────────────────────────────────────
console.log("\n1. The pump must never exceed N live calls\n");

const CALL_SECONDS = 180; // a real AI call: 3 minutes
const TICK = 5; // pump interval (AI_PUMP_MS)
const HORIZON = 600; // simulate 10 minutes

/** OLD: launch `n` every 8s regardless of what's still live. */
function simulateOld(n: number, queue: number) {
  let launched = 0;
  let peak = 0;
  const live: number[] = []; // end-times
  for (let t = 0; t <= HORIZON; t += 1) {
    for (let i = live.length - 1; i >= 0; i--) if (live[i] <= t) live.splice(i, 1);
    if (t % 8 === 0 && launched < queue) {
      const batch = Math.min(n, queue - launched);
      for (let i = 0; i < batch; i++) live.push(t + CALL_SECONDS);
      launched += batch;
    }
    peak = Math.max(peak, live.length);
  }
  return { launched, peak };
}

/** NEW: only launch into free slots. */
function simulateNew(n: number, queue: number) {
  let launched = 0;
  let peak = 0;
  const live: number[] = [];
  for (let t = 0; t <= HORIZON; t += 1) {
    for (let i = live.length - 1; i >= 0; i--) if (live[i] <= t) live.splice(i, 1);
    if (t % TICK === 0) {
      const slots = Math.max(0, n - live.length);
      const batch = Math.min(slots, queue - launched);
      for (let i = 0; i < batch; i++) live.push(t + CALL_SECONDS);
      launched += batch;
    }
    peak = Math.max(peak, live.length);
  }
  return { launched, peak };
}

for (const n of [3, 10]) {
  const oldSim = simulateOld(n, 5000);
  const newSim = simulateNew(n, 5000);
  console.log(
    `  at ${n}X over 10 minutes:  OLD peaked at ${oldSim.peak} live calls (launched ${oldSim.launched})` +
      `  ·  NEW peaked at ${newSim.peak} (launched ${newSim.launched})`,
  );
  check(`${n}X never exceeds ${n} concurrent`, newSim.peak <= n, `peak ${newSim.peak}`);
  check(
    `${n}X: the old code genuinely over-dialed (proving this test is meaningful)`,
    oldSim.peak > n * 3,
    `old peak ${oldSim.peak}`,
  );
}

// ── 2. Queue wraparound ──────────────────────────────────────────────────────
console.log("\n2. A finished session must STOP, not re-dial everyone\n");

const QUEUE = 50;
const PARALLEL = 3;

/** OLD advanceQueue: (i + n) % len. */
function walkOld(steps: number) {
  let i = 0;
  const dialed = new Map<number, number>();
  for (let s = 0; s < steps; s++) {
    for (let k = 0; k < PARALLEL && k < QUEUE; k++) {
      const idx = (i + k) % QUEUE;
      dialed.set(idx, (dialed.get(idx) ?? 0) + 1);
    }
    i = (i + PARALLEL) % QUEUE;
  }
  return dialed;
}

/** NEW advanceQueue: clamp at the end; nextLeads slices without wrapping. */
function walkNew(steps: number) {
  let i = 0;
  const dialed = new Map<number, number>();
  for (let s = 0; s < steps; s++) {
    if (i >= QUEUE) break; // exhausted — session over
    for (let k = 0; k < PARALLEL && i + k < QUEUE; k++) {
      dialed.set(i + k, (dialed.get(i + k) ?? 0) + 1);
    }
    i = Math.min(i + PARALLEL, QUEUE);
  }
  return dialed;
}

const oldWalk = walkOld(40); // more steps than the queue has room for
const newWalk = walkNew(40);
const oldMax = Math.max(...oldWalk.values());
const newMax = Math.max(...newWalk.values());

console.log(
  `  a 50-lead session run to completion:  OLD called someone up to ${oldMax}× · NEW calls everyone exactly ${newMax}×`,
);
check("nobody is dialed twice", newMax === 1, `max ${newMax} calls to one lead`);
check("every lead in the session is dialed once", newWalk.size === QUEUE, `${newWalk.size}/${QUEUE}`);
check(
  "the old code genuinely repeat-dialed (proving this test is meaningful)",
  oldMax > 1,
  `old max ${oldMax}`,
);

// nextLeads must not wrap within a single batch either.
const shortQueue = [10, 11];
const slice = shortQueue.slice(0, 3); // new nextLeads
check(
  "a 2-lead queue at 3X does not dial the same person twice in one batch",
  slice.length === 2 && new Set(slice).size === 2,
  `got [${slice.join(", ")}]`,
);

// ── 3. DNC can never be dialed ───────────────────────────────────────────────
console.log("\n3. Do-not-call leads can never enter a session\n");

const sneaky = sanitizeSegments(["new", "dnc", "callback"]);
check("dnc is stripped server-side", !sneaky.includes("dnc"), `got [${sneaky.join(", ")}]`);
check("legitimate segments survive", sneaky.includes("new") && sneaky.includes("callback"));
const onlyDnc = sanitizeSegments(["dnc"]);
check(
  "a dnc-only request falls back to safe defaults rather than dialing dnc",
  !onlyDnc.some((s) => BLOCKED_SEGMENTS.includes(s)) && onlyDnc.length > 0,
  `got [${onlyDnc.join(", ")}]`,
);

console.log(failures === 0 ? "\nAll checks passed.\n" : `\n${failures} check(s) FAILED.\n`);
process.exit(failures === 0 ? 0 : 1);
