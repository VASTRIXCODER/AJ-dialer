import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// The architectural rule, made mechanical.
//
//   The engine never sends. The engine proposes. A named human sends.
//
// Two mechanisms hold it. Postgres holds one: `messages_approved_by_required`
// refuses any row reaching a sendable status without an approver. This test
// holds the other: no module under src/lib/orchestration may REACH sendMessage,
// directly or through any chain of imports.
//
// Transitive, not surface-level, on purpose. A direct-import check is trivially
// satisfied by adding one indirection, and would have passed even before the
// config split that made this boundary real — src/lib/db/messages.ts used to
// import the transport for a single configuration predicate, which put the
// ability to send exactly one hop from the engine.
// ─────────────────────────────────────────────────────────────────────────────

const SRC = resolve(__dirname, "..", "src");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

const FILES = new Map(
  walk(SRC).map((f) => [
    ("@/" + relative(SRC, f).replace(/\\/g, "/")).replace(/\.tsx?$/, ""),
    readFileSync(f, "utf8"),
  ]),
);

/** Module specifiers a file imports, normalised to `@/…` where resolvable. */
function importsOf(spec: string): string[] {
  const source = FILES.get(spec);
  if (!source) return [];
  const out: string[] = [];
  const re = /(?:from|import)\s*["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const raw = m[1];
    if (raw.startsWith("@/")) {
      out.push(raw);
    } else if (raw.startsWith(".")) {
      // Resolve relative to the importing module's directory.
      const base = spec.replace(/^@\//, "").split("/").slice(0, -1);
      const parts = raw.split("/");
      for (const part of parts) {
        if (part === "." || part === "") continue;
        if (part === "..") base.pop();
        else base.push(part);
      }
      out.push(`@/${base.join("/")}`);
    }
  }
  return out;
}

/** Every module reachable from `roots` by following imports. */
function reachableFrom(roots: string[]): Set<string> {
  const seen = new Set<string>();
  const stack = [...roots];
  while (stack.length) {
    const spec = stack.pop() as string;
    if (seen.has(spec)) continue;
    seen.add(spec);
    for (const next of importsOf(spec)) {
      if (!seen.has(next) && FILES.has(next)) stack.push(next);
    }
  }
  return seen;
}

const ORCHESTRATION = [...FILES.keys()].filter((k) =>
  k.startsWith("@/lib/orchestration/"),
);
const TRANSPORT = "@/lib/messaging/transport";

describe("the graph itself is being read correctly", () => {
  it("found the orchestration modules and the transport", () => {
    // Without these, every assertion below is vacuously true.
    expect(ORCHESTRATION.length).toBeGreaterThan(3);
    expect(FILES.has(TRANSPORT)).toBe(true);
    expect(FILES.get(TRANSPORT)).toContain("export async function sendMessage");
  });

  it("resolves relative imports into the same namespace as absolute ones", () => {
    // src/lib/messaging/transport.ts imports "../twilio".
    expect(importsOf(TRANSPORT)).toContain("@/lib/twilio");
  });

  it("actually traverses more than one hop", () => {
    const reachable = reachableFrom([TRANSPORT]);
    expect(reachable.size).toBeGreaterThan(2);
    expect(reachable.has("@/lib/twilio")).toBe(true);
  });
});

describe("the engine cannot send", () => {
  it("reaches nothing that can hand a message to a carrier", () => {
    const reachable = reachableFrom(ORCHESTRATION);
    const offending = [...reachable].filter((m) => m === TRANSPORT);
    expect(
      offending,
      `The orchestration engine can reach ${TRANSPORT}, which exports sendMessage.\n` +
        `The engine must only PROPOSE messages. Import the predicate from ` +
        `@/lib/messaging/config instead of the transport.`,
    ).toEqual([]);
  });

  it("does not reach for the Twilio client itself", () => {
    // DIRECT imports only, unlike the transport rule above, and the difference
    // is deliberate. `@/lib/twilio` is reachable transitively from almost
    // anything — org/membership imports it to resolve caller IDs — so a
    // transitive ban here would forbid the engine from importing the message
    // PROPOSAL helpers it legitimately needs, and the only way to satisfy it
    // would be to weaken the rule that actually matters.
    //
    // What is worth forbidding is an orchestration module reaching for a REST
    // client by name. That is always a mistake and always deliberate.
    for (const spec of ORCHESTRATION) {
      expect(importsOf(spec), `${spec} imports the Twilio client directly`).not.toContain(
        "@/lib/twilio",
      );
    }
  });

  it("names sendMessage nowhere in the orchestration source", () => {
    for (const spec of ORCHESTRATION) {
      expect(FILES.get(spec), `${spec} mentions sendMessage`).not.toMatch(
        /\bsendMessage\b/,
      );
    }
  });
});

describe("the drain is the one place that does send", () => {
  it("reaches the transport, as it must", () => {
    // The mirror of the rule above: if this ever stopped being true, messages
    // would silently stop going out and the test suite would be quiet about it.
    expect(reachableFrom(["@/lib/messaging/drain"]).has(TRANSPORT)).toBe(true);
  });

  it("re-judges every message before sending it", () => {
    const drain = FILES.get("@/lib/messaging/drain") ?? "";
    // The send-time re-gate is the only reason STOP works for a message that
    // was approved a minute ago.
    expect(drain).toMatch(/judgeSend/);
    expect(drain).toMatch(/buildSendContext/);
  });

  it("never reclaims a message stuck mid-send", () => {
    const drain = FILES.get("@/lib/messaging/drain") ?? "";
    // Scoped to the function itself. A whole-file regex here matched the
    // deferral branch's `status: "approved"` against the word "stuck" hundreds
    // of lines away, which is to say it asserted nothing at all.
    const start = drain.indexOf("export async function flagStuckMessages");
    expect(start, "flagStuckMessages is gone").toBeGreaterThan(-1);
    const body = drain.slice(start);

    // Twilio's Messages API has no idempotency key, so re-queueing a row that
    // may already have gone is how one person receives the same text twice.
    expect(body).toMatch(/needs_review/);
    expect(body, "a stuck row must not be re-queued").not.toMatch(/"approved"/);
    expect(body, "a stuck row must not be given a retry time").not.toMatch(
      /next_attempt_at/,
    );
  });
});
