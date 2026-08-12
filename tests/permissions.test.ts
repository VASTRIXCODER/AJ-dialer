import { describe, expect, it } from "vitest";
import {
  ROLE_RANK,
  assignableRoles,
  atLeast,
  can,
  effectivePermissions,
  isOrgRole,
  outranks,
} from "@/lib/permissions";

describe("role hierarchy", () => {
  it("ranks owner > admin > manager > rep", () => {
    expect(ROLE_RANK.owner).toBeGreaterThan(ROLE_RANK.admin);
    expect(ROLE_RANK.admin).toBeGreaterThan(ROLE_RANK.manager);
    expect(ROLE_RANK.manager).toBeGreaterThan(ROLE_RANK.rep);
  });

  it("outranks / atLeast compare correctly", () => {
    expect(outranks("admin", "manager")).toBe(true);
    expect(outranks("manager", "admin")).toBe(false);
    expect(atLeast("manager", "manager")).toBe(true);
    expect(atLeast("rep", "manager")).toBe(false);
  });
});

describe("can()", () => {
  it("grants owner everything and denies rep privileged actions", () => {
    expect(can("owner", "org.delete")).toBe(true);
    expect(can("admin", "org.delete")).toBe(false); // admin lacks delete
    expect(can("manager", "reports.view")).toBe(true);
    expect(can("rep", "dialer.ai")).toBe(false);
    expect(can("rep", "monitor.view")).toBe(true); // reps can watch
  });

  it("lets a per-member override win over the role default", () => {
    expect(can("rep", "dialer.ai", { "dialer.ai": true })).toBe(true);
    expect(can("owner", "org.delete", { "org.delete": false })).toBe(false);
  });

  it("returns false for a null role", () => {
    expect(can(null, "reports.view")).toBe(false);
  });
});

describe("effectivePermissions()", () => {
  it("reflects the role's defaults plus overrides", () => {
    const rep = effectivePermissions("rep");
    expect(rep).toContain("monitor.view");
    expect(rep).not.toContain("org.edit");
    expect(effectivePermissions("rep", { "dialer.ai": true })).toContain("dialer.ai");
  });
});

describe("assignableRoles()", () => {
  it("never includes owner and never exceeds the actor's rank", () => {
    expect(assignableRoles("owner")).toEqual(["admin", "manager", "rep"]);
    expect(assignableRoles("manager")).toEqual(["manager", "rep"]);
    expect(assignableRoles("rep")).toEqual(["rep"]);
    expect(assignableRoles("owner")).not.toContain("owner");
  });
});

describe("isOrgRole()", () => {
  it("accepts real roles and rejects junk", () => {
    expect(isOrgRole("manager")).toBe(true);
    expect(isOrgRole("superadmin")).toBe(false);
    expect(isOrgRole(42)).toBe(false);
    expect(isOrgRole(null)).toBe(false);
  });
});
