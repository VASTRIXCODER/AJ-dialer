import { beforeEach, describe, expect, it, vi } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// The Automation tab's endpoint reads four logs about one person. It must be
// fenced exactly like the panel and the timeline it sits beside — and it must
// reuse THEIR fence rather than a fourth copy, or the three views of one record
// can drift into disagreeing about who may see it.
//
// The other property pinned here: a missing table is not an error. PART 37 may
// not be applied on an environment, and a rep with the drawer open mid-call
// must get an empty history, not a 500.
// ─────────────────────────────────────────────────────────────────────────────

const getScopedLeadRow = vi.fn();
vi.mock("@/lib/db/lead-360", () => ({
  getScopedLeadRow: (id: string) => getScopedLeadRow(id),
}));

vi.mock("@/lib/rate-limit", () => ({ rateLimit: () => ({ ok: true, retryAfter: 0 }) }));

const tableData = vi.fn();
const adminConfigured = vi.fn(() => true);
vi.mock("@/lib/supabase/admin", () => ({
  isAdminConfigured: () => adminConfigured(),
  createAdminClient: () => ({
    from: (table: string) => {
      const self: Record<string, unknown> = {};
      return new Proxy(self, {
        get(_t, prop: string) {
          if (prop === "maybeSingle") return async () => ({ data: tableData(table)[0] ?? null });
          if (prop === "then")
            return (resolve: (v: unknown) => unknown) =>
              Promise.resolve({ data: tableData(table) }).then(resolve);
          return () => new Proxy(self, this as ProxyHandler<object>);
        },
      });
    },
  }),
}));

import { GET } from "@/app/api/leads/[id]/automation/route";

const LEAD = "22222222-2222-4222-8222-222222222222";
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const req = () => new Request(`http://x/api/leads/${LEAD}/automation`);

beforeEach(() => {
  vi.clearAllMocks();
  adminConfigured.mockReturnValue(true);
  getScopedLeadRow.mockResolvedValue({
    ok: true,
    row: { id: LEAD, org_id: "org-a" },
    scope: { userId: "user-a", orgId: "org-a", supervisor: true },
  });
  tableData.mockImplementation((table: string) => {
    if (table === "opportunities") return [{ id: "opp-1" }];
    if (table === "opportunity_events")
      return [
        {
          id: 1,
          type: "stage_changed",
          actor_kind: "system",
          actor_id: null,
          from_stage: "new",
          to_stage: "attempting",
          detail: { reason: "intake" },
          created_at: "2026-08-29T10:00:00.000Z",
        },
      ];
    if (table === "playbook_instances")
      return [
        {
          id: "inst-1",
          playbook_id: "pb-1",
          playbook_version: 1,
          status: "stopped",
          current_step: 2,
          stopped_reason: "attempted",
          started_at: "2026-08-29T10:00:00.000Z",
          ended_at: "2026-08-29T11:00:00.000Z",
        },
      ];
    if (table === "playbook_executions")
      return [
        {
          id: 5,
          instance_id: "inst-1",
          step_index: 0,
          action_kind: "create_work_item",
          status: "succeeded",
          detail: {},
          error: null,
          executed_at: "2026-08-29T10:01:00.000Z",
        },
      ];
    if (table === "playbooks") return [{ id: "pb-1", name: "Speed to lead" }];
    if (table === "work_items")
      return [
        {
          id: "w1",
          type: "first_call",
          reason: "speed_to_lead",
          status: "completed",
          priority: 90,
          queue: null,
          due_at: null,
          created_at: "2026-08-29T10:01:00.000Z",
          completed_at: "2026-08-29T10:30:00.000Z",
        },
      ];
    if (table === "signals")
      return [
        {
          id: "s1",
          type: "escalation:speed_to_lead_breach",
          severity: 4,
          evidence: { reason: "speed_to_lead_breach" },
          audience: "managers",
          detected_at: "2026-08-29T10:20:00.000Z",
          resolved_at: null,
          resolution: null,
          acknowledged_at: null,
        },
      ];
    if (table === "organization_members") return [];
    return [];
  });
});

describe("who may read a record's automation history", () => {
  it("returns it to someone the shared fence allows", async () => {
    const res = await GET(req(), params(LEAD));
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.events).toHaveLength(1);
    expect(j.runs[0]).toMatchObject({ name: "Speed to lead", status: "stopped" });
    expect(j.runs[0].steps).toHaveLength(1);
    expect(j.workItems).toHaveLength(1);
    expect(j.signals[0]).toMatchObject({ severity: 4, audience: "managers" });
  });

  it("401s when nobody is signed in", async () => {
    getScopedLeadRow.mockResolvedValue({ ok: false, reason: "unauthenticated" });
    const res = await GET(req(), params(LEAD));
    expect(res.status).toBe(401);
  });

  it("403s a rep reaching outside their own book, inside their org", async () => {
    getScopedLeadRow.mockResolvedValue({ ok: false, reason: "denied" });
    const res = await GET(req(), params(LEAD));
    expect(res.status).toBe(403);
  });

  it("404s a record in another tenant — never confirming it exists", async () => {
    // The fence collapses cross-org to not_found on purpose; the route must
    // not helpfully upgrade that to a 403 and leak that the id is real.
    getScopedLeadRow.mockResolvedValue({ ok: false, reason: "not_found" });
    const res = await GET(req(), params(LEAD));
    expect(res.status).toBe(404);
  });

  it("uses the SHARED fence, so it cannot drift from the panel", async () => {
    await GET(req(), params(LEAD));
    expect(getScopedLeadRow).toHaveBeenCalledWith(LEAD);
  });
});

describe("an environment without the automation tables", () => {
  it("reads as empty history, not as an error in an open drawer", async () => {
    adminConfigured.mockReturnValue(false);
    const res = await GET(req(), params(LEAD));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      events: [],
      runs: [],
      workItems: [],
      signals: [],
    });
  });

  it("a lead with no opportunity returns empty logs, not a failure", async () => {
    tableData.mockImplementation((table: string) =>
      table === "work_items" || table === "signals" ? [] : [],
    );
    const res = await GET(req(), params(LEAD));
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.events).toEqual([]);
    expect(j.runs).toEqual([]);
  });
});
