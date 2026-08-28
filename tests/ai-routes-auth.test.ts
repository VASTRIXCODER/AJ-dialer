import { beforeEach, describe, expect, it, vi } from "vitest";

// The AI surfaces (briefing / copilot / summary) were unauthenticated LLM-spend
// endpoints. Phase 1 contract: a signed-in session (demo passes — it simulates),
// plus a per-user rate limit.

const getViewer = vi.fn();
vi.mock("@/lib/org/membership", () => ({ getViewer: () => getViewer() }));

const getLeadById = vi.fn();
vi.mock("@/lib/db/leads", () => ({ getLeadById: (id: string) => getLeadById(id) }));

vi.mock("@/lib/ai/services", () => ({
  getLeadBriefing: vi.fn(async () => ({ source: "demo", text: "brief" })),
  getCallCopilot: vi.fn(async () => ({ source: "demo", text: "tips" })),
  getCallSummary: vi.fn(async () => ({ source: "demo", text: "summary" })),
}));
vi.mock("@/lib/ai/org-context", () => ({
  orgAIContext: vi.fn(() => ({ isSolar: false })),
}));

import { POST as briefing } from "@/app/api/ai/briefing/route";
import { POST as copilot } from "@/app/api/ai/copilot/route";
import { POST as summary } from "@/app/api/ai/summary/route";

function req(body: unknown) {
  return new Request("http://test.local/api/ai/x", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  getLeadById.mockResolvedValue({ id: "l1", firstName: "Ada" });
});

const routes = [
  ["briefing", briefing],
  ["copilot", copilot],
  ["summary", summary],
] as const;

describe.each(routes)("/api/ai/%s auth", (_name, route) => {
  it("rejects anonymous non-demo callers before any lead read or AI spend", async () => {
    getViewer.mockResolvedValue({ user: null, isDemo: false, org: null });
    const res = await route(req({ leadId: "l1" }));
    expect(res.status).toBe(401);
    expect(getLeadById).not.toHaveBeenCalled();
  });

  it("allows demo mode (no Supabase, simulated AI)", async () => {
    getViewer.mockResolvedValue({ user: null, isDemo: true, org: null });
    const res = await route(req({ leadId: "l1" }));
    expect(res.status).toBe(200);
  });

  it("404s a missing lead for a signed-in caller", async () => {
    getViewer.mockResolvedValue({ user: { id: `u-${_name}` }, isDemo: false, org: null });
    getLeadById.mockResolvedValue(null);
    const res = await route(req({ leadId: "nope" }));
    expect(res.status).toBe(404);
  });
});

describe("rate limiting", () => {
  it("throttles a user after 30 requests in a minute", async () => {
    // A user id unique to this test so other cases don't consume the bucket.
    getViewer.mockResolvedValue({ user: { id: "rl-user" }, isDemo: false, org: null });
    let last = 0;
    for (let i = 0; i < 31; i++) {
      const res = await briefing(req({ leadId: "l1" }));
      last = res.status;
    }
    expect(last).toBe(429);
  });
});
