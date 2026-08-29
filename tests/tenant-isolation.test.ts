import { beforeEach, describe, expect, it, vi } from "vitest";

// Tenant-isolation contract tests at the ROUTE layer: a caller outside a row's
// org must get a denial status and NEVER row data. These pin the routes'
// authorization mapping with mocked scope/db seams; RLS itself is out of CI
// reach (node-only Vitest, no DB) — the manual SQL checklist in
// docs/phase-1/qa-evidence.md covers that layer.

// ── /api/leads/[id]/panel ────────────────────────────────────────────────────

const getLeadPanelResult = vi.fn();
const getLeadTimeline = vi.fn();
vi.mock("@/lib/db/lead-360", () => ({
  getLeadPanelResult: (id: string) => getLeadPanelResult(id),
}));
vi.mock("@/lib/db/lead-timeline", () => ({
  getLeadTimeline: (id: string, opts?: unknown) => getLeadTimeline(id, opts),
}));

const getScope = vi.fn();
vi.mock("@/lib/db/scope", () => ({ getScope: () => getScope() }));

vi.mock("@/lib/supabase/config", () => ({ isSupabaseConfigured: () => true }));
vi.mock("@/lib/telemetry", () => ({ count: vi.fn(), timing: vi.fn() }));

const getViewer = vi.fn();
vi.mock("@/lib/org/membership", () => ({ getViewer: () => getViewer() }));

const setLeadsArchived = vi.fn();
vi.mock("@/lib/db/lead-archive", () => ({
  setLeadsArchived: (ids: string[], a: boolean) => setLeadsArchived(ids, a),
}));

import { GET as panelGET } from "@/app/api/leads/[id]/panel/route";
import { POST as archivePOST } from "@/app/api/leads/archive/route";

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const req = (url: string, body?: unknown) =>
  new Request(url, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

beforeEach(() => {
  vi.clearAllMocks();
  getScope.mockResolvedValue({ userId: "user-a", orgId: "org-a", supervisor: true });
  getViewer.mockResolvedValue({
    user: { id: "user-a" },
    isDemo: false,
    org: { id: "org-a" },
    permissions: [],
  });
});

describe("/api/leads/[id]/panel — cross-tenant reads", () => {
  it("maps a foreign-org lead to 404 with NO panel data", async () => {
    // Cross-org reads deliberately resolve as not_found (existence itself is
    // information) — the db layer's documented behavior.
    getLeadPanelResult.mockResolvedValue({ ok: false, reason: "not_found" });
    const res = await panelGET(req("http://t.local/api/leads/lead-b/panel"), params("lead-b"));
    expect(res.status).toBe(404);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.panel).toBeUndefined();
    expect(body.timeline).toBeUndefined();
    expect(getLeadTimeline).not.toHaveBeenCalled();
  });

  it("maps in-org-but-not-your-book to 403 with NO data", async () => {
    getLeadPanelResult.mockResolvedValue({ ok: false, reason: "denied" });
    const res = await panelGET(req("http://t.local/api/leads/lead-x/panel"), params("lead-x"));
    expect(res.status).toBe(403);
    expect(((await res.json()) as Record<string, unknown>).panel).toBeUndefined();
  });

  it("maps signed-out to 401", async () => {
    getLeadPanelResult.mockResolvedValue({ ok: false, reason: "unauthenticated" });
    const res = await panelGET(req("http://t.local/api/leads/lead-x/panel"), params("lead-x"));
    expect(res.status).toBe(401);
  });

  it("a foreign timeline page (?before=) is 404, never rows", async () => {
    getLeadTimeline.mockResolvedValue(null); // db scope check refused
    const res = await panelGET(
      req("http://t.local/api/leads/lead-b/panel?before=2026-01-01T00:00:00Z"),
      params("lead-b"),
    );
    expect(res.status).toBe(404);
    expect(((await res.json()) as Record<string, unknown>).timeline).toBeUndefined();
  });
});

describe("/api/leads/archive — role gate", () => {
  it("rejects a rep (below manager) with 403 and never touches the db", async () => {
    getScope.mockResolvedValue({ userId: "rep-1", orgId: "org-a", supervisor: false });
    const res = await archivePOST(req("http://t.local/api/leads/archive", { leadIds: ["l1"] }));
    expect(res.status).toBe(403);
    expect(setLeadsArchived).not.toHaveBeenCalled();
  });

  it("rejects anonymous callers with 401", async () => {
    getViewer.mockResolvedValue({ user: null, isDemo: false, org: null, permissions: [] });
    const res = await archivePOST(req("http://t.local/api/leads/archive", { leadIds: ["l1"] }));
    expect(res.status).toBe(401);
    expect(setLeadsArchived).not.toHaveBeenCalled();
  });

  it("allows a supervisor and forwards only the capped id list", async () => {
    setLeadsArchived.mockResolvedValue({ updated: 1 });
    const res = await archivePOST(req("http://t.local/api/leads/archive", { leadIds: ["l1"] }));
    expect(res.status).toBe(200);
    expect(setLeadsArchived).toHaveBeenCalledWith(["l1"], true);
  });
});
