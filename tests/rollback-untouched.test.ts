import { describe, expect, it } from "vitest";
import { isUntouchedLead } from "@/lib/db/lead-import";

// ─────────────────────────────────────────────────────────────────────────────
// Rollback safety: only PROVABLY untouched rows may be deleted. A lead anyone
// has dialed, contacted, moved, or booked survives — a rollback undoes an
// import, never a rep's work.
// ─────────────────────────────────────────────────────────────────────────────

const clean = {
  status: "new",
  lastContactedAt: null,
  attemptCount: 0,
  hasActivity: false,
};

describe("isUntouchedLead", () => {
  it("accepts the freshly imported row", () => {
    expect(isUntouchedLead(clean)).toBe(true);
  });

  it("treats a null attempt_count as zero (pre-backfill rows)", () => {
    expect(isUntouchedLead({ ...clean, attemptCount: null })).toBe(true);
  });

  it("keeps any lead that left status 'new'", () => {
    for (const status of ["contacted", "interested", "appointment", "dnc", "bills_fine"]) {
      expect(isUntouchedLead({ ...clean, status })).toBe(false);
    }
  });

  it("keeps a lead that was ever contacted", () => {
    expect(
      isUntouchedLead({ ...clean, lastContactedAt: "2026-08-27T10:00:00Z" }),
    ).toBe(false);
  });

  it("keeps a lead with any dial attempts", () => {
    expect(isUntouchedLead({ ...clean, attemptCount: 1 })).toBe(false);
    expect(isUntouchedLead({ ...clean, attemptCount: 7 })).toBe(false);
  });

  it("keeps a lead referenced by calls, appointments, or callbacks", () => {
    expect(isUntouchedLead({ ...clean, hasActivity: true })).toBe(false);
  });
});
