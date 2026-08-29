import { beforeEach, describe, expect, it, vi } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// Route-layer contract tests for the CRM's three writes.
//
// The sidebar hides what a viewer may not use and the board never renders an
// illegal move — but neither is a security control. A URL is typed, and a POST
// body is whatever the caller says it is. These pin that each route re-checks
// permission itself, and that a denial NEVER reaches the database seam.
// ─────────────────────────────────────────────────────────────────────────────

const getViewer = vi.fn();
vi.mock("@/lib/org/membership", () => ({ getViewer: () => getViewer() }));

const getScope = vi.fn();
vi.mock("@/lib/db/scope", () => ({ getScope: () => getScope() }));

const transitionOpportunityStage = vi.fn();
vi.mock("@/lib/db/opportunities", () => ({
  transitionOpportunityStage: (i: unknown) => transitionOpportunityStage(i),
}));

const addToDnc = vi.fn();
vi.mock("@/lib/db/dnc", () => ({ addToDnc: (i: unknown) => addToDnc(i) }));

// A tiny stand-in for the admin client: enough to answer the org-fenced read
// and the claim RPC, and to record whether either was reached at all.
const oppRow = vi.fn();
const rpc = vi.fn();
const updateSpy = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({
  isAdminConfigured: () => true,
  createAdminClient: () => ({
    from: (table: string) => {
      const chain: Record<string, unknown> = {};
      const self = new Proxy(chain, {
        get(_t, prop: string) {
          if (prop === "maybeSingle") return async () => ({ data: oppRow(table) });
          if (prop === "select")
            return (...a: unknown[]) => {
              // `update(...).select()` resolves; `from().select()` keeps chaining.
              if (chain.__updated) return Promise.resolve({ data: [{ id: "w1" }] });
              void a;
              return self;
            };
          if (prop === "update")
            return (patch: unknown) => {
              updateSpy(table, patch);
              chain.__updated = true;
              return self;
            };
          return () => self;
        },
      });
      return self;
    },
    rpc: (name: string, args: unknown) => rpc(name, args),
  }),
}));

vi.mock("@/lib/rate-limit", () => ({ rateLimit: () => ({ ok: true, retryAfter: 0 }) }));

import { POST as claimPOST } from "@/app/api/crm/claim/route";
import { POST as releasePOST } from "@/app/api/crm/release/route";
import { POST as stagePOST } from "@/app/api/crm/stage/route";

const post = (url: string, body: unknown) =>
  new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const ALL = [
  "crm.view",
  "work.claim",
  "crm.pipeline.manage",
] as const;

/** The opportunity row the org-fenced read returns. Tests reassign it. */
let opportunity: Record<string, unknown> | null = null;

function viewerWith(permissions: readonly string[], role = "manager") {
  getViewer.mockResolvedValue({
    user: { id: "user-a" },
    isDemo: false,
    role,
    permissions: [...permissions],
    org: { id: "org-a" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  viewerWith(ALL);
  getScope.mockResolvedValue({ userId: "user-a", orgId: "org-a", supervisor: true });
  opportunity = { id: "opp-1", org_id: "org-a", lead_id: "lead-1", stage: "contacted" };
  // The DNC branch reads the lead's phone in a second query, so the stand-in
  // has to answer per table or that branch silently never fires.
  oppRow.mockImplementation((table: string) =>
    table === "leads" ? { phone: "+15105550143" } : opportunity,
  );
  transitionOpportunityStage.mockResolvedValue(true);
  rpc.mockResolvedValue({ data: [{ id: "w1" }, { id: "w2" }], error: null });
  addToDnc.mockResolvedValue(true);
});

describe("moving a stage", () => {
  const body = { opportunityId: "opp-1", from: "contacted", to: "interested" };

  it("moves it when the caller may", async () => {
    const res = await stagePOST(post("http://x/api/crm/stage", body));
    expect(res.status).toBe(200);
    expect(transitionOpportunityStage).toHaveBeenCalledTimes(1);
  });

  it("refuses without crm.pipeline.manage, and never reaches the database", async () => {
    viewerWith(["crm.view", "work.claim"], "rep");
    const res = await stagePOST(post("http://x/api/crm/stage", body));
    expect(res.status).toBe(403);
    expect(transitionOpportunityStage).not.toHaveBeenCalled();
  });

  it("401s an anonymous caller", async () => {
    getViewer.mockResolvedValue({ user: null, isDemo: false, role: null, permissions: [] });
    const res = await stagePOST(post("http://x/api/crm/stage", body));
    expect(res.status).toBe(401);
    expect(transitionOpportunityStage).not.toHaveBeenCalled();
  });

  it("422s an unknown stage rather than passing it through", async () => {
    const res = await stagePOST(
      post("http://x/api/crm/stage", { ...body, to: "definitely_not_a_stage" }),
    );
    expect(res.status).toBe(422);
    expect(transitionOpportunityStage).not.toHaveBeenCalled();
  });

  it("409s a stale board and says where the record actually is", async () => {
    // The card said "contacted"; the row has since moved on.
    opportunity = {
      id: "opp-1",
      org_id: "org-a",
      lead_id: "lead-1",
      stage: "appointment_booked",
    };
    const res = await stagePOST(post("http://x/api/crm/stage", body));
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({
      currentStage: "appointment_booked",
    });
    expect(transitionOpportunityStage).not.toHaveBeenCalled();
  });

  it("404s a record in another org", async () => {
    opportunity = null; // the org-fenced read matched nothing
    const res = await stagePOST(post("http://x/api/crm/stage", body));
    expect(res.status).toBe(404);
    expect(transitionOpportunityStage).not.toHaveBeenCalled();
  });

  it("refuses a rep's attempt to mark a record won, by the state machine's rule", async () => {
    viewerWith([...ALL], "rep");
    const res = await stagePOST(
      post("http://x/api/crm/stage", { ...body, to: "sold" }),
    );
    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toMatchObject({
      reason: "sold_needs_trusted_actor",
    });
    expect(transitionOpportunityStage).not.toHaveBeenCalled();
  });

  it("refuses a backwards move unless it is asked for deliberately", async () => {
    opportunity = {
      id: "opp-1",
      org_id: "org-a",
      lead_id: "lead-1",
      stage: "interested",
    };
    const back = { opportunityId: "opp-1", from: "interested", to: "attempting" };
    const refused = await stagePOST(post("http://x/api/crm/stage", back));
    expect(refused.status).toBe(422);

    const allowed = await stagePOST(
      post("http://x/api/crm/stage", { ...back, allowRegress: true }),
    );
    expect(allowed.status).toBe(200);
  });

  it("marking Do Not Contact also writes the suppression list", async () => {
    // Otherwise the board would look right while the next import puts the same
    // person straight back in the dial queue.
    const res = await stagePOST(
      post("http://x/api/crm/stage", { ...body, to: "dnc_suppressed" }),
    );
    expect(res.status).toBe(200);
    expect(addToDnc).toHaveBeenCalledTimes(1);
    await expect(res.json()).resolves.toMatchObject({ suppressed: true });
  });

  it("a normal move does not touch the suppression list", async () => {
    await stagePOST(post("http://x/api/crm/stage", body));
    expect(addToDnc).not.toHaveBeenCalled();
  });

  it("reports a lost race as a conflict, not a success", async () => {
    transitionOpportunityStage.mockResolvedValue(false);
    const res = await stagePOST(post("http://x/api/crm/stage", body));
    expect(res.status).toBe(409);
  });
});

describe("claiming shared work", () => {
  it("claims through the atomic RPC, not an update", async () => {
    const res = await claimPOST(post("http://x/api/crm/claim", { count: 5 }));
    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith(
      "app_claim_work_items",
      expect.objectContaining({ p_org: "org-a", p_user: "user-a", p_limit: 5 }),
    );
  });

  it("reports how many it actually got, never how many were asked for", async () => {
    rpc.mockResolvedValue({ data: [{ id: "w1" }], error: null });
    const res = await claimPOST(post("http://x/api/crm/claim", { count: 5 }));
    await expect(res.json()).resolves.toMatchObject({ claimed: 1, requested: 5 });
  });

  it("an empty claim is a normal 200, not an error", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    const res = await claimPOST(post("http://x/api/crm/claim", { count: 5 }));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ claimed: 0 });
  });

  it("refuses without work.claim, and never reaches the RPC", async () => {
    viewerWith(["crm.view"], "rep");
    const res = await claimPOST(post("http://x/api/crm/claim", { count: 5 }));
    expect(res.status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("clamps an absurd request rather than honouring it", async () => {
    await claimPOST(post("http://x/api/crm/claim", { count: 10_000 }));
    expect(rpc).toHaveBeenCalledWith(
      "app_claim_work_items",
      expect.objectContaining({ p_limit: 10 }),
    );
  });
});

describe("releasing claimed work", () => {
  it("releases and reports the count", async () => {
    const res = await releasePOST(post("http://x/api/crm/release", {}));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ released: 1 });
    expect(updateSpy).toHaveBeenCalledWith(
      "work_items",
      expect.objectContaining({ status: "pending", reserved_by: null }),
    );
  });

  it("refuses without work.claim, and never writes", async () => {
    viewerWith(["crm.view"], "rep");
    const res = await releasePOST(post("http://x/api/crm/release", {}));
    expect(res.status).toBe(403);
    expect(updateSpy).not.toHaveBeenCalled();
  });
});
