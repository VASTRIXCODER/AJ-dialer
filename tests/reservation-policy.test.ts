import { beforeEach, describe, expect, it, vi } from "vitest";

// The reservation shell: claim → per-lead-timezone window re-check → release
// what can't be dialed right now. The SQL WHERE/ORDER themselves are mirrored
// by src/lib/dialer/eligibility.ts (covered in tests/eligibility.test.ts);
// these tests pin the TS-side behavior around the RPC.

const rpc = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({
  isAdminConfigured: () => true,
  createAdminClient: () => ({ rpc }),
}));
vi.mock("@/lib/db/leads", () => ({
  // Identity mapper — these tests only care about ids/phones/timezones.
  rowToLead: (r: Record<string, unknown>) => r,
}));
vi.mock("@/lib/calls/apply-event", () => ({
  applyCallEvent: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/lib/telemetry", () => ({ count: vi.fn(), timing: vi.fn() }));

import { claimDialLeads, releaseDialLeads } from "@/lib/db/reservations";
import type { AutomationSettings } from "@/lib/org/settings";

// A window that is OPEN at 18:00 UTC for America/Chicago (13:00 local) and
// CLOSED for Pacific numbers at early-morning local times.
const WINDOW: AutomationSettings = {
  enabled: true,
  timezone: "America/Chicago",
  days: [0, 1, 2, 3, 4, 5, 6],
  windows: [{ start: 9, end: 20 }],
  callsPerRun: 5,
  dailyCap: 0,
  cooldownHours: 24,
};

function lead(id: string, phone: string, timezone?: string) {
  return { id, phone, timezone: timezone ?? "" };
}

beforeEach(() => {
  rpc.mockReset();
});

describe("claimDialLeads", () => {
  it("passes sanitized statuses to the RPC — dnc can never be claimed", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    await claimDialLeads({
      orgId: "org-1",
      userId: "u1",
      supervisor: false,
      limit: 3,
      statuses: ["new", "dnc", "nonsense"],
    });
    const args = rpc.mock.calls[0][1] as { p_statuses: string[] };
    expect(args.p_statuses).not.toContain("dnc");
    expect(args.p_statuses).toContain("new");
  });

  it("clamps the limit and forwards cooldown/max-attempt policy", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    await claimDialLeads({
      orgId: "org-1",
      userId: "u1",
      supervisor: true,
      limit: 9999,
      cooldownMinutes: 90.6,
      maxAttempts: 4,
    });
    const args = rpc.mock.calls[0][1] as Record<string, number>;
    expect(args.p_limit).toBe(500);
    expect(args.p_cooldown_minutes).toBe(91);
    expect(args.p_max_attempts).toBe(4);
  });

  it("releases claimed leads whose LOCAL calling window is closed", async () => {
    // 18:00 UTC = 13:00 Chicago (open), 11:00 Pacific (open)… use a window that
    // closes at 12: Chicago 13:00 is OUT, a lead pinned to UTC (18:00) is OUT,
    // and an early-morning zone is IN. Simplest deterministic split: pin lead
    // timezones directly.
    const now = new Date("2026-08-28T18:00:00Z"); // 13:00 Chicago, 11:00 LA
    const win: AutomationSettings = {
      ...WINDOW,
      windows: [{ start: 9, end: 12 }], // open 9–12 local
    };
    rpc
      .mockResolvedValueOnce({
        data: [
          lead("in", "+13105551234", "America/Los_Angeles"), // 11:00 → in
          lead("out", "+13125551234", "America/Chicago"), // 13:00 → out
        ],
        error: null,
      })
      // the release RPC call
      .mockResolvedValueOnce({ data: 1, error: null });

    const got = await claimDialLeads({
      orgId: "org-1",
      userId: "u1",
      supervisor: true,
      limit: 5,
      window: win,
      now,
    });
    expect(got.map((l) => l.id)).toEqual(["in"]);
    // Second RPC call must be the release of the out-of-window lead.
    expect(rpc.mock.calls[1][0]).toBe("app_release_dial_leads");
    expect((rpc.mock.calls[1][1] as { p_lead_ids: string[] }).p_lead_ids).toEqual(["out"]);
  });

  it("returns [] and never throws on an RPC error", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    const got = await claimDialLeads({
      orgId: "org-1",
      userId: "u1",
      supervisor: false,
      limit: 1,
    });
    expect(got).toEqual([]);
  });
});

describe("releaseDialLeads", () => {
  it("no-ops on an empty id list without hitting the RPC", async () => {
    const n = await releaseDialLeads("org-1", "u1", []);
    expect(n).toBe(0);
    expect(rpc).not.toHaveBeenCalled();
  });
});
