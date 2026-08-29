import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// An architecture test for the one mistake TypeScript cannot see.
//
// `import "server-only"` is a runtime/bundler marker, not a type. A Client
// Component may import TYPES from a server-only module all day — types are
// erased — but importing a VALUE from one is a hard build failure that `tsc
// --noEmit` reports as perfectly fine. It only surfaces when Next bundles,
// which in this repo means it surfaces on Vercel, after a push, in production.
//
// That is exactly how it happened: a label helper exported beside the queries
// it labels, imported by a "use client" queue view. Clean type-check, clean
// test run, failed deploy.
//
// This walks the real source tree and refuses the combination.
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

const FILES = walk(SRC).map((f) => ({ path: f, source: readFileSync(f, "utf8") }));

/** Modules that declare themselves server-only, as `@/…` specifiers. */
const SERVER_ONLY = new Set(
  FILES.filter((f) => /^\s*import\s+["']server-only["']/m.test(f.source)).map((f) =>
    ("@/" + relative(SRC, f.path).replace(/\\/g, "/")).replace(/\.tsx?$/, ""),
  ),
);

const CLIENT_FILES = FILES.filter((f) => /^\s*["']use client["']/m.test(f.source));

/** Every import statement in a file, with whether it is type-only. */
function imports(source: string): { spec: string; typeOnly: boolean; clause: string }[] {
  const out: { spec: string; typeOnly: boolean; clause: string }[] = [];
  const re = /import\s+(type\s+)?([\s\S]*?)\s*from\s*["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    out.push({ spec: m[3], typeOnly: Boolean(m[1]), clause: m[2] ?? "" });
  }
  return out;
}

/**
 * `import { type A, type B }` is entirely erased, so it is as safe as
 * `import type`. Anything with at least one non-`type` named binding, or a
 * default/namespace binding, pulls real code in.
 */
function pullsValues(clause: string): boolean {
  const named = clause.match(/\{([\s\S]*)\}/);
  if (!named) return clause.trim().length > 0; // default or namespace import
  const before = clause.slice(0, clause.indexOf("{")).replace(/,/g, "").trim();
  if (before) return true; // `import Default, { … }`
  return named[1]
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .some((binding) => !binding.startsWith("type "));
}

describe("the detector itself", () => {
  // A guard that passes because it detects nothing is worse than no guard.
  // These pin it against the real import that broke the build, and against the
  // shapes it must NOT flag.
  it("flags the mixed import that actually failed on Vercel", () => {
    expect(pullsValues("{ workReasonLabel, workTypeLabel, type CrmQueue, type QueueItem }")).toBe(
      true,
    );
  });

  it("does not flag erased imports", () => {
    expect(pullsValues("{ type CrmBoard, type CrmQueue }")).toBe(false);
    expect(pullsValues("{ type A }")).toBe(false);
  });

  it("flags default and namespace imports", () => {
    expect(pullsValues("Thing")).toBe(true);
    expect(pullsValues("* as thing")).toBe(true);
    expect(pullsValues("Default, { type A }")).toBe(true);
  });

  it("parses `import type { … } from` as type-only", () => {
    const found = imports('import type { CrmBoard } from "@/lib/db/crm";');
    expect(found).toHaveLength(1);
    expect(found[0].typeOnly).toBe(true);
    expect(found[0].spec).toBe("@/lib/db/crm");
  });

  it("knows the module that broke the build is server-only", () => {
    expect(SERVER_ONLY.has("@/lib/db/crm")).toBe(true);
  });
});

describe("the server-only boundary", () => {
  it("finds both sides of the boundary to check", () => {
    // If either list is empty the test is vacuously passing and proves nothing.
    expect(SERVER_ONLY.size).toBeGreaterThan(10);
    expect(CLIENT_FILES.length).toBeGreaterThan(10);
  });

  it("no Client Component imports a VALUE from a server-only module", () => {
    const offences: string[] = [];
    for (const file of CLIENT_FILES) {
      for (const imp of imports(file.source)) {
        if (!SERVER_ONLY.has(imp.spec)) continue;
        if (imp.typeOnly || !pullsValues(imp.clause)) continue;
        offences.push(
          `${relative(SRC, file.path).replace(/\\/g, "/")} imports {${imp.clause.trim()}} from "${imp.spec}"`,
        );
      }
    }
    // Names the file and the import, because "a client component imports a
    // server module" is not enough to go and fix it.
    expect(offences, offences.join("\n")).toEqual([]);
  });
});
