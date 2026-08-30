import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// "Supervisor" is decided in ONE place, from the membership row.
//
// `profiles.role` is a denormalized copy of `organization_members.role`, and it
// drifts three ways:
//
//   · it carried a column default of 'manager', and handle_new_user inserts
//     only (id, full_name) — so a row nobody ever set read as a supervisor
//   · switchOrg moves `profiles.org_id` and never touches `profiles.role`, so
//     the role from the PREVIOUS workspace follows the user into the next one
//   · the roster edits the members table; nothing writes the copy back
//
// Twenty-one sites across seven db modules tested that column directly, and
// each of them decides whether somebody reads their own uploads or their whole
// organization's book. Measured in production before the fix: eight profiles
// whose two roles disagree — one a `rep` in the members table reading as
// `admin` on the profile, which is a rep with the org's entire 37,987-lead
// book, and two more disagreeing the other way.
//
// This file pins the choke point. It is a source-shape test because the failure
// is a *read of the wrong column*, which no unit test with a stubbed client can
// see.
// ─────────────────────────────────────────────────────────────────────────────

const ROOT = resolve(__dirname, "..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(?<!:)\/\/.*$/gm, "");

/** Every tracked source file, so a new module cannot quietly opt out. */
function sourceFiles(): string[] {
  const out = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "src"],
    { cwd: ROOT, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  );
  return out
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /\.tsx?$/.test(l));
}

describe("only one module decides what a supervisor is", () => {
  it("the role list is not restated anywhere else", () => {
    // Any file that spells out the three supervisor roles is making the
    // decision itself, which is how twenty-one copies happened. It lives in
    // lib/permissions (pure, importable from both server and client).
    const offenders: string[] = [];
    for (const file of sourceFiles()) {
      if (file === "src/lib/permissions.ts") continue;
      const code = stripComments(read(file));
      // The FOUR-role list (with "rep") is the roster's role picker, not a
      // supervision test — it is allowed.
      const three = /["']owner["']\s*,\s*["']admin["']\s*,\s*["']manager["'](?!\s*,\s*["']rep["'])/;
      if (three.test(code)) offenders.push(file);
    }
    expect(
      offenders,
      "Import isSupervisorRole from @/lib/permissions instead:\n" + offenders.join("\n"),
    ).toEqual([]);
  });

  it("no module derives supervision from a profiles.role it read itself", () => {
    // The specific shape that was wrong twenty-one times: select role off
    // `profiles`, then branch on it.
    const offenders: string[] = [];
    for (const file of sourceFiles()) {
      if (file === "src/lib/db/scope.ts") continue;
      const code = stripComments(read(file));
      if (!/from\("profiles"\)/.test(code)) continue;
      // Reading the role to DISPLAY it is fine; reading it to decide scope is
      // not. `supervisor` is the word this codebase uses for that decision.
      if (/\bsupervisor\b/.test(code) && /prof\??\.\s*role/.test(code)) {
        offenders.push(file);
      }
    }
    expect(
      offenders,
      "These decide scope from the denormalized copy — use readProfileScope():\n" +
        offenders.join("\n"),
    ).toEqual([]);
  });
});

describe("the resolver reads the membership, and refuses when it cannot", () => {
  const scope = read("src/lib/db/scope.ts");
  const resolver = stripComments(
    scope.slice(scope.indexOf("export async function resolveSupervisor")),
  );

  it("asks organization_members for the ACTIVE org", () => {
    expect(resolver).toMatch(/from\("organization_members"\)/);
    expect(resolver).toMatch(/\.eq\("org_id", orgId\)/);
    expect(resolver).toMatch(/\.eq\("status", "active"\)/);
  });

  it("throws rather than guessing a direction on a failed read", () => {
    // Both wrong answers are bad, in opposite ways — see the class docstring.
    expect(resolver).toMatch(/if \(error\) \{[\s\S]{0,200}throw new ScopeUnavailableError/);
  });

  it("consults profiles.role ONLY when there is no membership row", () => {
    const dataIdx = resolver.indexOf("if (data) return isSupervisorRole(data.role);");
    const bridgeIdx = resolver.indexOf("return isSupervisorRole(profileRole);");
    expect(dataIdx).toBeGreaterThan(-1);
    expect(bridgeIdx).toBeGreaterThan(dataIdx);
  });

  it("never consults it at all when there is no org", () => {
    // A role left over from a workspace this person has since left must not
    // grant anything in the next one.
    const noOrg = resolver.indexOf("if (!orgId) return false;");
    expect(noOrg).toBeGreaterThan(-1);
    expect(noOrg).toBeLessThan(resolver.indexOf("from(\"organization_members\")"));
  });

  it("getScope refuses outright rather than downgrading", () => {
    const start = scope.indexOf("export const getScope");
    const end = scope.indexOf("\n});", start);
    expect(start, "getScope not found").toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const body = scope.slice(start, end);
    expect(body).toMatch(/await resolveSupervisor\(/);
    // Downgrading to `supervisor: false` here would hand a manager their own
    // uploads and call it their workspace. Null is the path every caller
    // already handles.
    expect(body).toMatch(/catch \{[\s\S]{0,200}return null;/);
  });
});

describe("the schema no longer seeds the drift", () => {
  const sql = read("supabase/schema.sql");

  it("profiles.role has no column default", () => {
    // handle_new_user inserts only (id, full_name), so a default here is a role
    // assigned to every new user by the database.
    expect(sql).toMatch(/alter table public\.profiles alter column role drop default;/);
  });

  it("nor do the other two columns nothing ever writes", () => {
    expect(sql).toMatch(/alter table public\.profiles alter column team drop default;/);
    expect(sql).toMatch(/alter table public\.profiles alter column avatar_color drop default;/);
  });
});
