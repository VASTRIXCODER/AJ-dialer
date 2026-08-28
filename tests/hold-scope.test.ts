import { beforeEach, describe, expect, it, vi } from "vitest";

// /api/twilio/hold authenticated but never org-scoped the conference room — any
// signed-in user in any org could hold a call whose room name they guessed.
// Phase 1 contract: the live_calls row must belong to the caller, or the caller
// must be an org supervisor with monitor.intervene; unknown rooms 404.

const getViewer = vi.fn();
vi.mock("@/lib/org/membership", () => ({ getViewer: () => getViewer() }));

const getHumanCall = vi.fn();
vi.mock("@/lib/human-call-store", () => ({ getHumanCall: (id: string) => getHumanCall(id) }));

const participantsUpdate = vi.fn(async () => ({}));
const conferencesList = vi.fn(async () => [{ sid: "CF1" }]);
vi.mock("@/lib/twilio", () => ({
  isRestConfigured: () => true,
  getPublicBaseUrl: () => "https://app.test",
  getRestClient: async () => ({
    conferences: Object.assign(
      () => ({
        participants: Object.assign(() => ({ update: participantsUpdate }), {
          list: async () => [],
        }),
      }),
      { list: conferencesList },
    ),
  }),
}));

import { POST } from "@/app/api/twilio/hold/route";

function req(body: unknown) {
  return new Request("http://test.local/api/twilio/hold", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  getViewer.mockResolvedValue({
    user: { id: "rep-1" },
    isDemo: false,
    org: { id: "org-1" },
    permissions: [],
  });
});

describe("/api/twilio/hold scoping", () => {
  it("404s a room we don't track", async () => {
    getHumanCall.mockResolvedValue(null);
    const res = await POST(req({ room: "hc-ghost", sids: ["CA1"], hold: true }));
    expect(res.status).toBe(404);
    expect(conferencesList).not.toHaveBeenCalled();
  });

  it("403s a foreign org's call", async () => {
    getHumanCall.mockResolvedValue({ ownerId: "other", orgId: "org-2" });
    const res = await POST(req({ room: "hc-h1", sids: ["CA1"], hold: true }));
    expect(res.status).toBe(403);
  });

  it("403s a same-org member without monitor.intervene", async () => {
    getHumanCall.mockResolvedValue({ ownerId: "other", orgId: "org-1" });
    const res = await POST(req({ room: "hc-h1", sids: ["CA1"], hold: true }));
    expect(res.status).toBe(403);
  });

  it("allows the owning rep", async () => {
    getHumanCall.mockResolvedValue({ ownerId: "rep-1", orgId: "org-1" });
    const res = await POST(req({ room: "hc-h1", sids: ["CA1"], hold: true }));
    expect(res.status).toBe(200);
    expect(participantsUpdate).toHaveBeenCalled();
  });

  it("allows a same-org supervisor with monitor.intervene", async () => {
    getViewer.mockResolvedValue({
      user: { id: "mgr-1" },
      isDemo: false,
      org: { id: "org-1" },
      permissions: ["monitor.intervene"],
    });
    getHumanCall.mockResolvedValue({ ownerId: "rep-1", orgId: "org-1" });
    const res = await POST(req({ room: "hc-h1", sids: ["CA1"], hold: true }));
    expect(res.status).toBe(200);
  });

  it("rejects malformed room names", async () => {
    const res = await POST(req({ room: "not-a-room!", sids: ["CA1"] }));
    expect(res.status).toBe(400);
  });
});
