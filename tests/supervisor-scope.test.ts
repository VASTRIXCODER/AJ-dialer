import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { isSupervisorRole } from "@/lib/permissions";

// ─────────────────────────────────────────────────────────────────────────────
// "Supervisor" is decided in ONE place, from the membership row.
//
// `profiles.role` is a denormalized copy of `organization_members.role`, and it
// drifts three ways:
//
//   · it carried a column default of 'manager' while handle_new_user inserts
//     only (id, full_name) — so a row nobody ever set read as a supervisor
//   · switchOrg moves `profiles.org_id` and never touches `profiles.role`, so
//     the role from the PREVIOUS workspace follows the user into the next one
//   · the roster edits the members table; nothing writes the copy back
//
// Fifteen sites across seven db modules tested that column, and each of them
// decides whether somebody reads their own uploads or their organization's
// whole book. Measured in production: profile 329a50a9-…-b31e4 is `rep` in the
// members table and `admin` on the profile, so it read as a supervisor and held
// all 37,987 leads, every call record and every metric in the org.
//
// This is a source-shape test because the failure is a READ OF THE WRONG
// COLUMN, which no unit test with a stubbed client can see.
// ─────────────────────────────────────────────────────────────────────────────

const ROOT = resolve(__dirname, "..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(?<!:)\/\/.*$/gm, "");

/** Every tracked source file, so a new module cannot quietly opt out. */
function sourceFiles(): string[] {
  return execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "src"],
    { cwd: ROOT, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  )
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /\.tsx?$/.test(l));
}

describe("isSupervisorRole", () => {
  it("is the three roles, and nothing else", () => {
    for (const r of ["owner", "admin", "manager"]) expect(isSupervisorRole(r)).toBe(true);
    for (const r of ["rep", "", null, undefined, "Admin", "OWNER", 0, {}]) {
      expect(isSupervisorRole(r), `${JSON.stringify(r)} must not be a supervisor`).toBe(false);
    }
  });

  it("does NOT default an absent role to anything privileged", () => {
    // The old inline form was `String(role ?? "rep")`, which is fine — but the
    // COLUMN defaulted to 'manager', so an unset row arrived here already
    // spelled "manager" and sailed through.
    expect(isSupervisorRole(undefined)).toBe(false);
    expect(isSupervisorRole(null)).toBe(false);
  });
});

describe("only one module decides what a supervisor is", () => {
  it("the three-role list is not restated anywhere else", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles()) {
      if (file === "src/lib/permissions.ts") continue;
      const code = stripComments(read(file));
      // The FOUR-role list (with "rep") is the roster's role picker, not a
      // supervision test — that one is allowed.
      const three = /["']owner["']\s*,\s*["']admin["']\s*,\s*["']manager["'](?!\s*,\s*["']rep["'])/;
      if (three.test(code)) offenders.push(file);
    }
    expect(
      offenders,
      `Import isSupervisorRole from @/lib/permissions instead:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("no module derives scope from a profiles.role it read itself", () => {
    // The exact shape that was wrong fifteen times: select `role` from
    // `profiles`, then branch on it to widen a data read.
    const offenders: string[] = [];
    for (const file of sourceFiles()) {
      if (file === "src/lib/db/scope.ts") continue;
      const code = stripComments(read(file));
      if (!/from\("profiles"\)/.test(code)) continue;
      if (/\bsupervisor\b/.test(code) && /prof\??\.\s*role/.test(code)) offenders.push(file);
    }
    expect(
      offenders,
      `These decide scope from the stale copy — use readProfileScope():\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});

describe("the resolver reads the membership, for the active org", () => {
  const scope = read("src/lib/db/scope.ts");
  const resolver = stripComments(
    scope.slice(scope.indexOf("export async function resolveSupervisor")),
  );

  it("asks organization_members, scoped to the org and to active rows", () => {
    expect(resolver).toMatch(/from\("organization_members"\)/);
    expect(resolver).toMatch(/\.eq\("user_id", userId\)/);
    expect(resolver).toMatch(/\.eq\("org_id", orgId\)/);
    expect(resolver).toMatch(/\.eq\("status", "active"\)/);
  });

  it("consults profiles.role ONLY when there is no membership row", () => {
    const fromMember = resolver.indexOf("if (data) return isSupervisorRole(data.role);");
    const bridge = resolver.indexOf("return isSupervisorRole(profileRole);");
    expect(fromMember, "the membership row is not preferred").toBeGreaterThan(-1);
    expect(bridge).toBeGreaterThan(fromMember);
  });

  it("never consults it at all when there is no org", () => {
    // A role left over from a workspace this person has since left must not
    // grant anything in the next one.
    const noOrg = resolver.indexOf("if (!orgId) return false;");
    expect(noOrg).toBeGreaterThan(-1);
    expect(noOrg).toBeLessThan(resolver.indexOf('from("organization_members")'));
  });

  it("answers FALSE on a failed read, not by falling back to the copy", () => {
    // Both wrong answers are bad; they are not equally bad. "Not a supervisor"
    // shrinks a manager's view and gets reported in a minute. "Supervisor"
    // hands a rep the whole book and is silent.
    const errBranch = resolver.slice(resolver.indexOf("if (error)"));
    expect(errBranch.slice(0, 200)).toMatch(/return false;/);
    expect(
      errBranch.slice(0, 200),
      "the error branch must not reach for profileRole",
    ).not.toMatch(/profileRole/);
  });

  it("getScope resolves through it", () => {
    const body = scope.slice(scope.indexOf("export const getScope"), scope.indexOf("\n});"));
    expect(body).toMatch(/await resolveSupervisor\(/);
    expect(body, "getScope still reads the stale copy directly").not.toMatch(
      /\["owner", "admin", "manager"\]/,
    );
  });
});
