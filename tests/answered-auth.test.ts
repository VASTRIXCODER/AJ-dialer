import { beforeEach, describe, expect, it, vi } from "vitest";

// /api/twilio/answered used to accept arbitrary SIDs unauthenticated and hang
// up whichever calls it judged "losers". These tests pin the Phase-1 contract:
// session required; releases only for a verified room owner (or supervisor with
// monitor.intervene); an unverified request degrades to status reads.

const getViewer = vi.fn();
vi.mock("@/lib/org/membership", () => ({ getViewer: () => getViewer() }));

const getHumanCall = vi.fn();
vi.mock("@/lib/human-call-store", () => ({ getHumanCall: (id: string) => getHumanCall(id) }));

const update = vi.fn(async () => ({}));
const fetchCall = vi.fn(async () => ({ status: "ringing" }));
const calls = vi.fn(() => ({ fetch: fetchCall, update }));
const getRestClient = vi.fn(async () => ({ calls }));
vi.mock("@/lib/twilio", () => ({ getRestClient: () => getRestClient() }));

vi.mock("@/lib/telemetry", () => ({ count: vi.fn(), timing: vi.fn() }));

import { POST } from "@/app/api/twilio/answered/route";

function req(body: unknown) {
  return new Request("http://test.local/api/twilio/answered", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const owner = {
  user: { id: "rep-1" },
  isDemo: false,
  org: { id: "org-1" },
  permissions: [] as string[],
};

beforeEach(() => {
  vi.clearAllMocks();
  getViewer.mockResolvedValue(owner);
  getHumanCall.mockResolvedValue({ ownerId: "rep-1", orgId: "org-1" });
});

describe("auth", () => {
  it("rejects anonymous non-demo callers", async () => {
    getViewer.mockResolvedValue({ user: null, isDemo: false, org: null, permissions: [] });
    const res = await POST(req({ room: "hc-x", legs: [{ leadId: "l1", sid: "CA1" }] }));
    expect(res.status).toBe(401);
    expect(update).not.toHaveBeenCalled();
  });

  it("returns done for an empty leg list without touching Twilio", async () => {
    const res = await POST(req({ legs: [] }));
    expect(await res.json()).toEqual({ answeredLeadId: null, done: true });
    expect(getRestClient).not.toHaveBeenCalled();
  });
});

describe("room ownership", () => {
  it("rejects a room owned by someone else in another org", async () => {
    getHumanCall.mockResolvedValue({ ownerId: "other-rep", orgId: "org-2" });
    const res = await POST(req({ room: "hc-h1", legs: [{ leadId: "l1", sid: "CA1" }] }));
    expect(res.status).toBe(403);
  });

  it("allows an org supervisor with monitor.intervene", async () => {
    getViewer.mockResolvedValue({
      ...owner,
      user: { id: "mgr-1" },
      permissions: ["monitor.intervene"],
    });
    getHumanCall.mockResolvedValue({ ownerId: "rep-1", orgId: "org-1" });
    const res = await POST(req({ room: "hc-h1", legs: [{ leadId: "l1", sid: "CA1" }] }));
    expect(res.status).toBe(200);
  });

  it("releases losing legs only for a verified owner", async () => {
    fetchCall
      .mockResolvedValueOnce({ status: "in-progress" })
      .mockResolvedValueOnce({ status: "ringing" });
    const res = await POST(
      req({
        room: "hc-h1",
        legs: [
          { leadId: "winner", sid: "CA1" },
          { leadId: "loser", sid: "CA2" },
        ],
      }),
    );
    const body = (await res.json()) as { answeredLeadId: string | null };
    expect(body.answeredLeadId).toBe("winner");
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("NEVER releases legs when the room can't be verified", async () => {
    getHumanCall.mockResolvedValue(null); // start/end raced the poll
    fetchCall
      .mockResolvedValueOnce({ status: "in-progress" })
      .mockResolvedValueOnce({ status: "ringing" });
    const res = await POST(
      req({
        room: "hc-h1",
        legs: [
          { leadId: "winner", sid: "CA1" },
          { leadId: "loser", sid: "CA2" },
        ],
      }),
    );
    const body = (await res.json()) as { answeredLeadId: string | null };
    expect(body.answeredLeadId).toBe("winner"); // reads still work
    expect(update).not.toHaveBeenCalled(); // but nothing gets hung up
  });

  it("ignores junk room formats (no verification, reads only)", async () => {
    const res = await POST(
      req({ room: "../../etc", legs: [{ leadId: "l1", sid: "CA1" }] }),
    );
    expect(res.status).toBe(200);
    expect(getHumanCall).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });
});
