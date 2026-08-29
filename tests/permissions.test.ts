import { describe, expect, it } from "vitest";
import {
  ORG_ROLES,
  PERMISSIONS,
  PERMISSION_LABEL,
  ROLE_RANK,
  assignableRoles,
  atLeast,
  can,
  effectivePermissions,
  isOrgRole,
  outranks,
} from "@/lib/permissions";

describe("the CRM's permissions", () => {
  it("gives reps the two that make the shared queue usable", () => {
    // A queue only supervisors can claim from is a report, not a queue.
    expect(can("rep", "crm.view")).toBe(true);
    expect(can("rep", "work.claim")).toBe(true);
  });

  it("does NOT let a rep hand-move a stage", () => {
    // Stage is derived from evidence — the dispositions a rep already files
    // move it through the same state machine, with an event written. Hand
    // edits would make opportunity_events describe a process that didn't run.
    expect(can("rep", "crm.pipeline.manage")).toBe(false);
    expect(can("manager", "crm.pipeline.manage")).toBe(true);
    expect(can("admin", "crm.pipeline.manage")).toBe(true);
    expect(can("owner", "crm.pipeline.manage")).toBe(true);
  });

  it("still honours a deliberate per-member grant", () => {
    expect(can("rep", "crm.pipeline.manage", { "crm.pipeline.manage": true })).toBe(true);
  });

  it("every role above rep can open the workspace", () => {
    for (const role of ORG_ROLES) expect(can(role, "crm.view")).toBe(true);
  });
});

describe("the permission registry stays complete", () => {
  it("labels every permission — the member editor renders from this map", () => {
    // A permission with no label appears in the admin dialog as a blank row.
    for (const p of PERMISSIONS) {
      expect(PERMISSION_LABEL[p], `missing label for ${p}`).toBeTruthy();
    }
    expect(Object.keys(PERMISSION_LABEL).sort()).toEqual([...PERMISSIONS].sort());
  });

  it("never labels a permission with a raw schema-style key", () => {
    for (const p of PERMISSIONS) expect(PERMISSION_LABEL[p]).not.toContain(".");
  });
});

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
    // Phase 1: reps no longer hold monitor.view/listen by default — live-call
    // listening is a supervisor capability, grantable per-member via override.
    expect(can("rep", "monitor.view")).toBe(false);
    expect(can("rep", "monitor.listen")).toBe(false);
    expect(can("manager", "monitor.listen")).toBe(true);
  });

  it("lets a per-member override win over the role default", () => {
    expect(can("rep", "dialer.ai", { "dialer.ai": true })).toBe(true);
    expect(can("rep", "monitor.listen", { "monitor.listen": true })).toBe(true);
    expect(can("owner", "org.delete", { "org.delete": false })).toBe(false);
  });

  it("returns false for a null role", () => {
    expect(can(null, "reports.view")).toBe(false);
  });
});

describe("effectivePermissions()", () => {
  it("reflects the role's defaults plus overrides", () => {
    const rep = effectivePermissions("rep");
    expect(rep).toContain("appointments.manage");
    expect(rep).not.toContain("monitor.view");
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
