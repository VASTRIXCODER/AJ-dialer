import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// A guard that cannot read its own data must not answer "go ahead".
//
// supabase-js does not throw on a failed read. It RESOLVES `{ data: null,
// error }`. So `const { data } = await q` followed by `data ?? []`, `!data`, or
// `Boolean(data?.x)` turns "the query failed" into whichever answer the falsy
// branch happens to be — and for a guard, that answer is almost always yes.
//
// A machine sweep of 236 destructures found fourteen sites where the falsy
// branch was the permissive one. The worst of them:
//
//   · an inbound STOP that could not be attributed to a workspace was answered
//     "You have been unsubscribed and will no longer be contacted" by a system
//     that had suppressed nothing
//   · the platform messaging kill switch read as OFF during a database
//     incident — the exact situation it exists for — while its own docstring
//     said "Defaults to PAUSED on any doubt"
//   · a suspended account was handed a working scope, because the suspension
//     backstop read `prof?.disabled` from a row that failed to load
//   · saving one org setting replaced every other setting with defaults, and
//     reported success
//
// This file pins the direction of each guard. It is deliberately about the
// SHAPE of the code rather than about behaviour, because these paths only
// misbehave when the database is failing — which is exactly when nobody is
// running tests.
// ─────────────────────────────────────────────────────────────────────────────

const ROOT = resolve(__dirname, "..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(?<!:)\/\/.*$/gm, "");

/** The body of one function, from its declaration to the next top-level one. */
function fn(source: string, name: string): string {
  const start = source.indexOf(name);
  if (start < 0) throw new Error(`${name} not found`);
  const rest = source.slice(start);
  const end = rest.indexOf("\n}\n");
  return end < 0 ? rest : rest.slice(0, end);
}

describe("a kill switch that cannot read itself does not report 'off'", () => {
  it("messaging pauses on doubt, as its docstring promises", () => {
    const body = fn(read("src/lib/db/messages.ts"), "export async function isMessagingPaused");
    expect(body).toMatch(/const \{ data, error \}/);
    expect(body).toMatch(/if \(error\) return true;/);
    expect(body, "the catch must agree with the error branch").toMatch(/catch \{\s*return true;/);
  });

  it("the maintenance switch carries an explicit unknown", () => {
    const control = read("src/lib/db/app-control.ts");
    const body = fn(control, "export async function getAppSettings");
    expect(body).toMatch(/const \{ data, error \}/);
    expect(body).toMatch(/unknown: true/);
    // …and the shell acts on it rather than treating unknown as available.
    expect(read("src/app/(app)/layout.tsx")).toMatch(/settings\.unknown && !superadmin/);
  });

  it("a suspension check answers 'suspended' when it cannot tell", () => {
    const body = fn(read("src/lib/db/app-control.ts"), "export async function isAccountDisabled");
    expect(body).toMatch(/if \(error\) return true;/);
    expect(body).toMatch(/catch \{\s*return true;/);
  });

  it("getScope refuses rather than clearing somebody it could not read", () => {
    const scope = stripComments(read("src/lib/db/scope.ts"));
    expect(scope).toMatch(/const \{ data: prof, error \}/);
    // The refusal must come BEFORE the suspension test, or the test reads a
    // row that failed to load.
    const errIdx = scope.indexOf("if (error) return null;");
    const disabledIdx = scope.indexOf("prof?.disabled");
    expect(errIdx).toBeGreaterThan(-1);
    expect(errIdx).toBeLessThan(disabledIdx);
  });
});

describe("a cap or a suppression that cannot be read is treated as spent", () => {
  it("the per-contact message cap fails closed on BOTH of its reads", () => {
    // The count was already guarded; the thread read above it was not, and its
    // early return said "nothing sent today".
    const messages = read("src/lib/db/messages.ts");
    expect(messages).toMatch(/if \(threadsErr\) return Number\.MAX_SAFE_INTEGER;/);
  });

  it("the playbook attempt cap fails closed", () => {
    const engine = read("src/lib/orchestration/engine.ts");
    expect(engine).toMatch(/if \(error\) return Number\.MAX_SAFE_INTEGER;/);
    expect(engine).toMatch(/catch \{\s*return Number\.MAX_SAFE_INTEGER;/);
  });

  it("a playbook does not re-enter on doubt", () => {
    const events = read("src/lib/orchestration/events.ts");
    const body = fn(events, "async function reentryAllows");
    expect(body).toMatch(/const \{ data, error \}/);
    // Must precede `if (!data) return true`, which is the permissive branch.
    const errIdx = body.indexOf("if (error) return false;");
    const noDataIdx = body.indexOf("if (!data) return true;");
    expect(errIdx).toBeGreaterThan(-1);
    expect(errIdx).toBeLessThan(noDataIdx);
  });

  it("the Do-Not-Call scrub still fails closed", () => {
    // Fixed in an earlier commit; pinned here so the whole family lives in one
    // place.
    const dnc = read("src/lib/db/dnc.ts");
    expect(dnc).toMatch(/class DncUnavailableError/);
    for (const f of ["getDncDigits", "isOnDnc", "listDnc"]) {
      expect(fn(dnc, `export async function ${f}`), `${f} ignores its error`).toMatch(
        /if \(error\) throw new DncUnavailableError/,
      );
    }
  });
});

describe("an opt-out is confirmed only when it happened", () => {
  it("the workspace lookup distinguishes 'nobody owns it' from 'could not ask'", () => {
    const body = fn(
      read("src/lib/org/membership.ts"),
      "export async function orgIdForCallerId",
    );
    expect(body).toMatch(/const \{ data, error \}/);
    expect(body).toMatch(/if \(error\) \{[\s\S]{0,120}throw new Error/);
  });

  it("the STOP reply is gated on the suppression actually landing", () => {
    const route = stripComments(read("src/app/api/twilio/sms/route.ts"));
    expect(route).toMatch(/suppressed = await addToDnc\(/);
    expect(route).toMatch(/if \(!suppressed\) \{/);
    // The confirmation must sit AFTER that guard.
    const guard = route.indexOf("if (!suppressed) {");
    const reply = route.indexOf("You have been unsubscribed");
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(reply);
  });

  it("a STOP can still cancel what is already queued", () => {
    const messages = read("src/lib/db/messages.ts");
    expect(messages).toMatch(/if \(threadsErr\) \{[\s\S]{0,200}throw new Error/);
    expect(messages).toMatch(/if \(cancelErr\) \{[\s\S]{0,200}throw new Error/);
  });

  it("and the running playbooks are suppressed with it", () => {
    const opps = read("src/lib/db/opportunities.ts");
    expect(opps).toMatch(/if \(leadsErr\) \{[\s\S]{0,200}throw new Error/);
    expect(opps).toMatch(/if \(oppsErr\) \{[\s\S]{0,200}throw new Error/);
  });
});

describe("a read-modify-write never replaces what it could not read", () => {
  // Settings and preferences are JSONB blobs merged in application code. An
  // unchecked read spread `{}` or a set of defaults over the top, and the write
  // then destroyed everything the patch did not mention — while reporting
  // success.
  const CLOBBER_SITES: [string, string][] = [
    ["src/lib/org/membership.ts", "Couldn't read this workspace's current settings"],
    ["src/lib/db/org-control.ts", "Couldn't read this workspace's current settings"],
    ["src/lib/db/team.ts", "Couldn't load your current settings"],
  ];

  for (const [path, refusal] of CLOBBER_SITES) {
    it(`${path} refuses the write instead of merging onto nothing`, () => {
      expect(read(path)).toContain(refusal);
    });
  }
});

describe("a cross-tenant guard does not approve on a failed read", () => {
  it("the caller-ID conflict check refuses rather than returning an empty set", () => {
    const membership = read("src/lib/org/membership.ts");
    const body = fn(membership, "async function otherOrgsCallerIds");
    expect(body).toMatch(/if \(error\) \{[\s\S]{0,140}throw new Error/);
    // An empty set is the answer that APPROVES, so it must not be reachable
    // from a failure — the swallowing catch is gone.
    expect(body, "a catch here turns a failed guard back into approval").not.toMatch(
      /catch\s*\{/,
    );
    expect(membership).toMatch(/Couldn't verify that these numbers aren't in use/);
  });

  it("a failed membership read does not synthesize one from profiles.role", () => {
    // The resilience bridge exists for "no membership row". On a failed read it
    // also fired, producing an ACTIVE membership with NO permission overrides —
    // so a permission an admin deliberately revoked came back, and one they
    // granted disappeared. The refusal has to sit between the two.
    const body = stripComments(
      fn(read("src/lib/org/membership.ts"), "export const getActiveMembership"),
    );
    const dataIdx = body.indexOf("if (data) return mapMember");
    const errIdx = body.indexOf("if (error) return null;");
    const bridgeIdx = body.indexOf("id: `profile-${userId}`");
    expect(errIdx, "the error branch is missing").toBeGreaterThan(-1);
    expect(errIdx).toBeGreaterThan(dataIdx);
    expect(errIdx, "the bridge still fires on a failed read").toBeLessThan(bridgeIdx);
  });
});
