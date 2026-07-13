/**
 * End-to-end live-state run — `npm run e2e:live-states`.
 *
 * Drives 10 calls through the REAL /api/twilio/status route, on a REAL Next.js
 * server, with REAL timing (a 30s ring, exactly as Twilio would), and asserts each
 * one leaves the live states inside the promised window with nobody refreshing
 * anything.
 *
 * What is real here: the route handler, the whole transition table
 * (ai-call-state.ts), every compare-and-swap in records.ts, finalizeAIConversation,
 * classifyNonConversation, and the monitor feed's own view of the rows.
 *
 * What is simulated: the carrier. This process plays Twilio — it POSTs the exact
 * form-encoded callbacks Twilio sends (CallSid + CallStatus), on Twilio's real
 * schedule. And Postgres is stood in for by a PostgREST-shaped server below,
 * because this machine has no Docker/psql. So this run proves the SYSTEM's logic
 * and latency; it does not prove the carrier's behavior or Postgres's atomicity.
 * The 10 live calls against real phones are still required, and this is the
 * rehearsal for them.
 */
import { spawn } from "node:child_process";
import http from "node:http";

const DB_PORT = 54999;
const APP_PORT = 3100;
const APP = `http://127.0.0.1:${APP_PORT}`;

// Twilio's real shape: a leg rings, then gives up at the `timeout` we set (30s).
const RING_AFTER_MS = 1_500;
const NO_ANSWER_AFTER_MS = 30_000;
// The window we promise: 30s ring + callback delivery + our handling.
const SLA_MS = 35_000;

const CALLS = 10;

let failures = 0;
const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const bad = (m) => {
  failures++;
  console.log(`  \x1b[31m✗ ${m}\x1b[0m`);
};
const check = (c, m) => (c ? ok(m) : bad(m));

// ─────────────────────────────────────────────────────────────────────────────
// A PostgREST-shaped stand-in for Supabase.
//
// Implements only the query shapes this codebase actually issues. It is NOT a
// database — notably, it does not prove that the compare-and-swaps are atomic
// under real concurrency (Postgres guarantees that; a JS object cannot). What it
// DOES prove is that the code issues the right queries in the right order and
// reacts correctly to their results.
// ─────────────────────────────────────────────────────────────────────────────
const PK = { ai_conversations: "conversation_id", live_calls: "id", call_records: "id" };
const tables = new Map();
const rowsOf = (t) => {
  if (!tables.has(t)) tables.set(t, []);
  return tables.get(t);
};

/** `col=eq.x`, `col=in.(a,b)`, `col=is.null`, `col=gte.x`, `col=lt.x` */
function matches(row, params) {
  for (const [col, raw] of params) {
    if (["select", "order", "limit", "offset", "on_conflict"].includes(col)) continue;
    const [op, ...rest] = String(raw).split(".");
    const val = rest.join(".");
    const cell = row[col];
    if (op === "eq" && String(cell) !== val) return false;
    if (op === "neq" && String(cell) === val) return false;
    if (op === "is") {
      const want = val === "null" ? null : val === "true";
      const isNull = cell === null || cell === undefined;
      if (want === null && !isNull) return false;
      if (want !== null && Boolean(cell) !== want) return false;
    }
    if (op === "in") {
      const list = val.replace(/^\(|\)$/g, "").split(",").map((s) => s.replace(/^"|"$/g, ""));
      if (!list.includes(String(cell))) return false;
    }
    if (op === "gte" && !(new Date(cell) >= new Date(val))) return false;
    if (op === "lt" && !(new Date(cell) < new Date(val))) return false;
    if (op === "gt" && !(new Date(cell) > new Date(val))) return false;
  }
  return true;
}

function send(res, status, body, accept) {
  // PostgREST returns a bare object (not an array) when the client asks for one,
  // and PGRST116 when it wanted exactly one row and got none. supabase-js's
  // .maybeSingle() depends on precisely this.
  const wantsObject = String(accept ?? "").includes("pgrst.object");
  if (wantsObject && Array.isArray(body)) {
    if (body.length === 0) {
      res.writeHead(406, { "content-type": "application/json" });
      return res.end(JSON.stringify({ code: "PGRST116", message: "0 rows" }));
    }
    body = body[0];
  }
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

const db = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  // Middleware doesn't run on API routes, but be safe: no session, ever.
  if (url.pathname.startsWith("/auth/")) return send(res, 401, { message: "no session" });

  const table = url.pathname.replace("/rest/v1/", "");
  const params = [...url.searchParams.entries()];
  const accept = req.headers.accept;
  const prefer = String(req.headers.prefer ?? "");

  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const rows = rowsOf(table);
    const body = raw ? JSON.parse(raw) : null;

    if (req.method === "GET") {
      let out = rows.filter((r) => matches(r, params));
      const order = url.searchParams.get("order");
      if (order) {
        const [col, dir] = order.split(".");
        out = [...out].sort((a, b) =>
          dir === "desc"
            ? String(b[col] ?? "").localeCompare(String(a[col] ?? ""))
            : String(a[col] ?? "").localeCompare(String(b[col] ?? "")),
        );
      }
      const limit = url.searchParams.get("limit");
      if (limit) out = out.slice(0, Number(limit));
      return send(res, 200, out, accept);
    }

    if (req.method === "POST") {
      const list = Array.isArray(body) ? body : [body];
      const pk = PK[table] ?? "id";
      for (const r of list) {
        const i = rows.findIndex((x) => x[pk] === r[pk]);
        // upsert === Prefer: resolution=merge-duplicates
        if (i >= 0 && prefer.includes("merge-duplicates")) rows[i] = { ...rows[i], ...r };
        else if (i < 0) rows.push({ ...r });
      }
      return send(res, 201, prefer.includes("return=representation") ? list : [], accept);
    }

    if (req.method === "PATCH") {
      const hit = rows.filter((r) => matches(r, params));
      for (const r of hit) Object.assign(r, body);
      return send(res, 200, prefer.includes("return=representation") ? hit : [], accept);
    }

    if (req.method === "DELETE") {
      const keep = rows.filter((r) => !matches(r, params));
      tables.set(table, keep);
      return send(res, 200, [], accept);
    }

    send(res, 405, { message: "nope" });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Play Twilio: POST a form-encoded status callback for the homeowner's leg. */
async function twilio(conversationId, callSid, callStatus, errorCode) {
  const body = new URLSearchParams({ CallSid: callSid, CallStatus: callStatus });
  if (errorCode) body.set("ErrorCode", String(errorCode));
  const res = await fetch(
    `${APP}/api/twilio/status?conversationId=${encodeURIComponent(conversationId)}`,
    { method: "POST", body },
  );
  if (res.status !== 204 && !res.ok) throw new Error(`status route → HTTP ${res.status}`);
}

// A SNAPSHOT, not a live reference. The store hands back the real object, so
// holding onto it means a later transition silently rewrites your "before" value.
const row = (id) => {
  const r = rowsOf("ai_conversations").find((x) => x.conversation_id === id);
  return r ? { ...r } : undefined;
};

/** Seed a conversation exactly as placeAiCallForLead()'s seedAIConversation would. */
function seed(id, i) {
  rowsOf("ai_conversations").push({
    conversation_id: id,
    owner_id: "00000000-0000-0000-0000-0000000000aa",
    org_id: "00000000-0000-0000-0000-0000000000bb",
    lead_id: null,
    lead_name: `Test Homeowner ${i + 1}`,
    phone: `+1555000${String(1000 + i)}`,
    call_sid: `CAagent${i}`,
    customer_call_sid: `CAcustomer${i}`,
    state: "initiated",
    sentiment: "neutral",
    outcome: null,
    summary: null,
    termination_reason: null,
    duration_sec: null,
    started_at: new Date().toISOString(),
    ringing_at: null,
    connected_at: null,
    ended_at: null,
  });
}

/** One call that nobody answers — on Twilio's real clock. */
async function noAnswerCall(i) {
  const id = `e2e-noanswer-${i}`;
  const sid = `CAcustomer${i}`;
  const t0 = Date.now();
  seed(id, i);

  await twilio(id, sid, "initiated");
  const afterInit = row(id)?.state;

  await sleep(RING_AFTER_MS);
  await twilio(id, sid, "ringing");
  const tRing = Date.now();
  const afterRing = row(id);

  // Twilio gives up at the 30s `timeout` we set on the leg.
  await sleep(NO_ANSWER_AFTER_MS - RING_AFTER_MS);
  const tHangup = Date.now();
  await twilio(id, sid, "no-answer");
  const r = row(id);
  const tEnd = Date.now();

  return {
    id,
    afterInit,
    ringState: afterRing?.state,
    ringStamped: Boolean(afterRing?.ringing_at),
    ringLatencyMs: tRing - t0,
    finalState: r?.state,
    outcome: r?.outcome,
    failureKind: r?.failure_kind,
    endedAt: r?.ended_at,
    // What WE control: from the moment Twilio tells us it rang out, how long until
    // the call is off the board? The other 30s is the carrier's ring, not ours.
    handleMs: tEnd - tHangup,
    totalMs: tEnd - t0,
  };
}

async function main() {
  await new Promise((r) => db.listen(DB_PORT, r));
  console.log(`PostgREST stand-in on :${DB_PORT}`);

  const env = {
    ...process.env,
    NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${DB_PORT}`,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "e2e-anon",
    SUPABASE_SERVICE_ROLE_KEY: "e2e-service-role",
    // No Twilio / ElevenLabs creds on purpose: the agent-leg hangup must degrade
    // gracefully rather than throw, and nothing may call out to a real provider.
  };

  console.log("Starting the server…");
  const app = spawn(
    "node",
    ["node_modules/next/dist/bin/next", "dev", "-p", String(APP_PORT)],
    { env, stdio: "ignore" },
  );

  const done = () => {
    try {
      app.kill();
    } catch {}
    db.close();
  };
  process.on("exit", done);

  // Wait for the route to actually answer.
  const deadline = Date.now() + 120_000;
  for (;;) {
    if (Date.now() > deadline) {
      console.error("Dev server never came up.");
      done();
      process.exit(1);
    }
    try {
      const res = await fetch(`${APP}/api/twilio/status`, {
        method: "POST",
        body: new URLSearchParams({ CallSid: "warmup", CallStatus: "" }),
      });
      if (res.status === 204 || res.ok) break;
    } catch {}
    await sleep(1000);
  }
  console.log(`App up on ${APP}`);

  // ── Warm the route ─────────────────────────────────────────────────────────
  // The dev server compiles a route the first time it is hit, and the no-answer
  // branch pulls in the whole finalize + disposition chain — several seconds of
  // one-off compilation that would otherwise be charged to the first real call and
  // read as latency that production will never see. Pay it up front, on a throwaway
  // call, so the numbers below are the code's and not the bundler's.
  const warm = "e2e-warmup";
  seed(warm, 999);
  await twilio(warm, "CAcustomer999", "ringing");
  await twilio(warm, "CAcustomer999", "no-answer");
  tables.set(
    "ai_conversations",
    rowsOf("ai_conversations").filter((r) => r.conversation_id !== warm),
  );
  console.log("Route warmed.\n");

  // ── The run: 10 unanswered calls, concurrently, on Twilio's real clock ──────
  console.log(`Placing ${CALLS} calls that nobody answers (30s ring each)…\n`);
  const results = await Promise.all(
    Array.from({ length: CALLS }, (_, i) => noAnswerCall(i)),
  );

  console.log(
    "call                  pre-ring    on-ring   →cleared  our latency  outcome",
  );
  console.log("─".repeat(80));
  for (const r of results) {
    console.log(
      `${r.id.padEnd(20)}  ${String(r.afterInit).padEnd(10)}  ` +
        `${String(r.ringState).padEnd(8)}  ${(r.totalMs / 1000).toFixed(1)}s` +
        `${" ".repeat(6)}${String(r.handleMs).padStart(4)}ms       ${String(r.outcome)}`,
    );
  }
  console.log("─".repeat(80));

  console.log("\nAssertions");
  check(
    results.every((r) => r.afterInit === "initiated"),
    'all 10 sit at "initiated" (Calling) before the phone rings — not "in progress"',
  );
  check(
    results.every((r) => r.ringState === "ringing"),
    'all 10 moved to "ringing" when Twilio said the phone was ringing',
  );
  check(
    results.every((r) => r.ringStamped),
    "all 10 stamped ringing_at",
  );
  check(
    results.every((r) => r.finalState === "failed"),
    "all 10 left the live states on no-answer",
  );
  check(
    results.every((r) => r.outcome === "no_answer"),
    'all 10 were filed "no_answer" — a terminal state with a NULL outcome would mean ' +
      "the claim/finalize handoff is broken",
  );
  check(
    results.every((r) => Boolean(r.endedAt)),
    "all 10 stamped ended_at",
  );
  const worst = Math.max(...results.map((r) => r.totalMs));
  check(
    worst <= SLA_MS,
    `every call cleared within the ${SLA_MS / 1000}s window (worst was ${(worst / 1000).toFixed(1)}s)`,
  );
  // The 30s ring is the carrier's; this is the only part of the window we own.
  const worstHandle = Math.max(...results.map((r) => r.handleMs));
  check(
    worstHandle <= 2_000,
    `our own handling of the no-answer took under 2s (worst was ${worstHandle}ms) — ` +
      "the rest of the window is Twilio's 30s ring",
  );
  check(
    rowsOf("ai_conversations").filter((r) =>
      ["initiated", "ringing", "in_progress"].includes(r.state),
    ).length === 0,
    "no call left stranded in a live state",
  );

  // ── The call that IS answered must NOT be filed as a no-answer ──────────────
  console.log("\nThe answered call (the inverse case)");
  const aId = "e2e-answered";
  seed(aId, 99);
  await twilio(aId, "CAcustomer99", "ringing");
  await twilio(aId, "CAcustomer99", "in-progress");
  const conn = row(aId);
  check(conn?.state === "in_progress", "answered → in_progress (Connected)");
  check(Boolean(conn?.connected_at), "connected_at stamped — the talk timer starts HERE, not at dial");

  await twilio(aId, "CAcustomer99", "completed");
  const after = row(aId);
  check(
    after?.outcome !== "no_answer",
    'Twilio "completed" (= the leg WAS answered) is never filed as a no-answer',
  );

  // ── Ordering + idempotency: the things that actually bite in production ─────
  console.log("\nOut-of-order and duplicate callbacks (Twilio guarantees neither)");

  // A no-answer arriving for a call that already connected must NOT kill it.
  const before = row(aId)?.state;
  await twilio(aId, "CAcustomer99", "no-answer");
  check(
    row(aId)?.state === before && row(aId)?.outcome !== "no_answer",
    "a late no-answer cannot hang up / re-file a call that already connected",
  );

  // A late `ringing` must not drag a finished call backwards.
  const fin = results[0];
  await twilio(fin.id, `CAcustomer0`, "ringing");
  check(
    row(fin.id)?.state === "failed",
    "a late `ringing` cannot resurrect a finished call",
  );

  // Twilio retries on non-2xx. A duplicate must change nothing.
  const snap = JSON.stringify(row(fin.id));
  await twilio(fin.id, `CAcustomer0`, "no-answer");
  check(
    JSON.stringify(row(fin.id)) === snap,
    "a retried no-answer callback is idempotent",
  );

  // ── A carrier failure is not a homeowner no-answer ──────────────────────────
  console.log("\nA failed leg with a Twilio error code");
  const eId = "e2e-badcallerid";
  seed(eId, 98);
  await twilio(eId, "CAcustomer98", "ringing");
  await twilio(eId, "CAcustomer98", "failed", 21210);
  const err = row(eId);
  check(
    err?.outcome === null && err?.failure_kind === "provider_error",
    "failed + 21210 (bad caller ID) → provider_error with a NULL outcome, " +
      "so it stays out of the connect-rate denominator instead of posing as a no-answer",
  );

  console.log(
    failures === 0
      ? "\n\x1b[32mAll assertions passed.\x1b[0m\n"
      : `\n\x1b[31m${failures} assertion(s) failed.\x1b[0m\n`,
  );
  done();
  process.exit(failures === 0 ? 0 : 1);
}

void main();
