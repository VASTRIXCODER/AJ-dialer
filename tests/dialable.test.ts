import { describe, expect, it } from "vitest";
import { DEFAULT_SEGMENTS } from "@/lib/dialer/segments";
import { DIALABLE_STATUSES, isDialableStatus } from "@/lib/leads/dialable";
import { LEAD_SORT_KEYS, isLeadSortKey } from "@/lib/leads/sort-keys";

describe("DIALABLE_STATUSES", () => {
  it("is exactly the three statuses still in play for outreach", () => {
    expect([...DIALABLE_STATUSES]).toEqual(["new", "no_answer", "callback"]);
  });

  // The dialer's safe default (segments tier "default") and the shared dialable
  // list are the same policy expressed twice — this pins them together so an
  // edit to either one fails loudly instead of quietly diverging.
  it("equals the dialer's DEFAULT_SEGMENTS", () => {
    expect(DEFAULT_SEGMENTS).toEqual([...DIALABLE_STATUSES]);
  });
});

describe("isDialableStatus", () => {
  it("accepts every dialable status", () => {
    for (const s of DIALABLE_STATUSES) expect(isDialableStatus(s)).toBe(true);
  });

  it("rejects everything else, including near-misses", () => {
    const rejected = [
      "dnc",
      "not_interested",
      "bills_fine",
      "appointment",
      "qualified",
      "contacted",
      "NEW",
      "new ",
      "",
    ];
    for (const s of rejected) expect(isDialableStatus(s)).toBe(false);
  });
});

describe("LEAD_SORT_KEYS", () => {
  it("carries the exact whitelist app_leads_page's CASE accepts", () => {
    expect([...LEAD_SORT_KEYS]).toEqual([
      "name",
      "city",
      "state",
      "status",
      "utility_bill",
      "solar_payment",
      "ai_score",
      "last_contacted_at",
      "created_at",
    ]);
  });

  it("isLeadSortKey accepts every key and rejects junk", () => {
    for (const k of LEAD_SORT_KEYS) expect(isLeadSortKey(k)).toBe(true);
    const junk = [
      "id; drop table leads",
      "utilityBill",
      "aiScore",
      "name.desc",
      "created_at ",
      "",
    ];
    for (const k of junk) expect(isLeadSortKey(k)).toBe(false);
  });
});
