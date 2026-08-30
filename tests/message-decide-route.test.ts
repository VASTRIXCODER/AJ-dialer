import { beforeEach, describe, expect, it, vi } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// Approving is the human half of "the engine proposes, a named human sends".
// The approver id this route writes is the one Postgres requires before a row
// may reach a sendable status, so these checks are not a formality — they are
// the only thing standing between an automation's proposal and a real phone.
// ─────────────────────────────────────────────────────────────────────────────

const getViewer = vi.fn();
vi.mock("@/lib/org/membership", () => ({ getViewer: () => getViewer() }));

const getScope = vi.fn();
vi.mock("@/lib/db/scope", () => ({ getScope: () => getScope() }));

const approveMessage = vi.fn();
const rejectMessage = vi.fn();
const getMessageAuthors = vi.fn();
vi.mock("@/lib/db/messages", () => ({
  approveMessage: (i: unknown) => approveMessage(i),
  rejectMessage: (i: unknown) => rejectMessage(i),
  getMessageAuthors: (o: string, ids: string[]) => getMessageAuthors(o, ids),
}));

vi.mock("@/lib/rate-limit", () => ({ rateLimit: () => ({ ok: true, retryAfter: 0 }) }));

import { POST } from "@/app/api/messages/decide/route";

const post = (body: unknown) =>
  new Request("http://x/api/messages/decide", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const MANAGER = [
  "crm.view",
  "messaging.draft",
  "messaging.approve.own",
  "messaging.approve",
  "messaging.approve.bulk",
];
const REP = ["crm.view", "messaging.draft", "messaging.approve.own"];

function viewerWith(permissions: string[]) {
  getViewer.mockResolvedValue({
    user: { id: "user-a" },
    isDemo: false,
    role: "manager",
    permissions,
    org: { id: "org-a" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  viewerWith(MANAGER);
  getScope.mockResolvedValue({ userId: "user-a", orgId: "org-a", supervisor: true });
  approveMessage.mockResolvedValue({ id: "m1", status: "approved" });
  rejectMessage.mockResolvedValue({ id: "m1", status: "rejected" });
  // m1 was written by the caller; m2 is an automation proposal (author null).
  getMessageAuthors.mockResolvedValue(
    new Map<string, string | null>([
      ["m1", "user-a"],
      ["m2", null],
      ["m3", "someone-else"],
    ]),
  );
});

describe("approving", () => {
  it("writes the approver's own id, never anyone else's", () => {
    return POST(post({ id: "m1", action: "approve" })).then(async (res) => {
      expect(res.status).toBe(200);
      expect(approveMessage).toHaveBeenCalledWith({
        id: "m1",
        orgId: "org-a",
        approverId: "user-a",
      });
    });
  });

  it("401s an anonymous caller and never touches the database", async () => {
    getViewer.mockResolvedValue({ user: null, isDemo: false, permissions: [] });
    const res = await POST(post({ id: "m1", action: "approve" }));
    expect(res.status).toBe(401);
    expect(approveMessage).not.toHaveBeenCalled();
  });

  it("403s someone with no approval permission at all", async () => {
    viewerWith(["crm.view"]);
    const res = await POST(post({ id: "m1", action: "approve" }));
    expect(res.status).toBe(403);
    expect(approveMessage).not.toHaveBeenCalled();
  });

  it("reports a lost race honestly instead of counting it as done", async () => {
    // A null means the CAS found the row somewhere other than needs_approval:
    // someone else decided first, or an opt-out cancelled it in between.
    approveMessage.mockResolvedValue(null);
    const res = await POST(post({ id: "m1", action: "approve" }));
    await expect(res.json()).resolves.toMatchObject({
      decided: 0,
      requested: 1,
      missed: ["m1"],
    });
  });
});

describe("approving in bulk", () => {
  it("lets a manager approve a batch", async () => {
    const res = await POST(post({ ids: ["m1", "m2", "m3"], action: "approve" }));
    expect(res.status).toBe(200);
    expect(approveMessage).toHaveBeenCalledTimes(3);
  });

  it("refuses a rep the batch while still allowing them one at a time", async () => {
    viewerWith(REP);
    const batch = await POST(post({ ids: ["m1", "m2"], action: "approve" }));
    expect(batch.status).toBe(403);
    expect(approveMessage).not.toHaveBeenCalled();

    const single = await POST(post({ id: "m1", action: "approve" }));
    expect(single.status).toBe(200);
  });

  it("caps the blast radius at 100", async () => {
    const ids = Array.from({ length: 101 }, (_, i) => `m${i}`);
    const res = await POST(post({ ids, action: "approve" }));
    expect(res.status).toBe(422);
    expect(approveMessage).not.toHaveBeenCalled();
  });

  it("deduplicates ids rather than approving one message twice", async () => {
    await POST(post({ ids: ["m1", "m1", "m2"], action: "approve" }));
    expect(approveMessage).toHaveBeenCalledTimes(2);
  });

  it("says how many actually landed when some had already been decided", async () => {
    approveMessage
      .mockResolvedValueOnce({ id: "m1" })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "m3" });
    const res = await POST(post({ ids: ["m1", "m2", "m3"], action: "approve" }));
    await expect(res.json()).resolves.toMatchObject({ decided: 2, requested: 3 });
  });
});

describe("the two approval permissions are actually different", () => {
  // The route used to compute `canApproveAutomation` and never use it, so a rep
  // holding only `approve.own` could wave through anything — including a batch
  // of messages nobody wrote, to people they had never spoken to.

  it("lets a rep approve the 1:1 they wrote themselves", async () => {
    viewerWith(REP);
    const res = await POST(post({ id: "m1", action: "approve" }));
    expect(res.status).toBe(200);
    expect(approveMessage).toHaveBeenCalledTimes(1);
  });

  it("REFUSES a rep the automation's proposal, and never reaches the write", async () => {
    viewerWith(REP);
    const res = await POST(post({ id: "m2", action: "approve" }));
    expect(res.status).toBe(403);
    expect(approveMessage).not.toHaveBeenCalled();
  });

  it("refuses a rep another person's draft too", async () => {
    viewerWith(REP);
    const res = await POST(post({ id: "m3", action: "approve" }));
    expect(res.status).toBe(403);
    expect(approveMessage).not.toHaveBeenCalled();
  });

  it("explains WHY rather than a bare denial", async () => {
    viewerWith(REP);
    const res = await POST(post({ id: "m2", action: "approve" }));
    const j = await res.json();
    expect(j.error).toContain("proposed by the automation");
    expect(j.forbidden).toEqual(["m2"]);
  });

  it("a manager approves the automation's proposal without an author lookup", async () => {
    viewerWith(MANAGER);
    const res = await POST(post({ id: "m2", action: "approve" }));
    expect(res.status).toBe(200);
    // Holding messaging.approve means ownership is irrelevant — no extra read.
    expect(getMessageAuthors).not.toHaveBeenCalled();
  });

  it("in a mixed batch a rep's own land and the rest are refused, honestly counted", async () => {
    viewerWith([...REP, "messaging.approve.bulk"]);
    const res = await POST(post({ ids: ["m1", "m2", "m3"], action: "approve" }));
    expect(res.status).toBe(200);
    const j = await res.json();
    // Only m1 was theirs.
    expect(approveMessage).toHaveBeenCalledTimes(1);
    expect(j.decided).toBe(1);
    expect(j.requested).toBe(3);
    expect(j.forbidden.sort()).toEqual(["m2", "m3"]);
  });

  it("treats an unknown author as not-yours — the safe way to be wrong", async () => {
    viewerWith(REP);
    getMessageAuthors.mockResolvedValue(new Map());
    const res = await POST(post({ id: "m1", action: "approve" }));
    expect(res.status).toBe(403);
    expect(approveMessage).not.toHaveBeenCalled();
  });

  it("still lets a rep REJECT the automation's proposal", async () => {
    // Refusing to send is never the risky direction.
    viewerWith(REP);
    const res = await POST(post({ id: "m2", action: "reject" }));
    expect(res.status).toBe(200);
    expect(rejectMessage).toHaveBeenCalledTimes(1);
  });
});

describe("rejecting", () => {
  it("does not require the approval permission", async () => {
    // Refusing to send something is never the risky direction, and a
    // permission wall in front of "no" is how a bad message goes out because
    // nobody could stop it.
    viewerWith(["crm.view"]);
    const res = await POST(post({ id: "m1", action: "reject" }));
    expect(res.status).toBe(200);
    expect(rejectMessage).toHaveBeenCalledTimes(1);
  });

  it("records the actor and the reason", async () => {
    await POST(post({ id: "m1", action: "reject", reason: "Wrong person." }));
    expect(rejectMessage).toHaveBeenCalledWith({
      id: "m1",
      orgId: "org-a",
      actorId: "user-a",
      reason: "Wrong person.",
    });
  });

  it("still refuses someone with no CRM access at all", async () => {
    viewerWith([]);
    const res = await POST(post({ id: "m1", action: "reject" }));
    expect(res.status).toBe(403);
    expect(rejectMessage).not.toHaveBeenCalled();
  });
});

describe("malformed requests", () => {
  it("422s an empty id list", async () => {
    const res = await POST(post({ ids: [], action: "approve" }));
    expect(res.status).toBe(422);
  });

  it("defaults an unknown action to approve rather than guessing something destructive", async () => {
    await POST(post({ id: "m1", action: "obliterate" }));
    expect(approveMessage).toHaveBeenCalledTimes(1);
    expect(rejectMessage).not.toHaveBeenCalled();
  });
});
