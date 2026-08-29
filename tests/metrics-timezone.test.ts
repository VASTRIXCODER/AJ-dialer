import { describe, expect, it } from "vitest";
import { appointmentsSet, hourlyBuckets, weekRange, type MetricRow } from "@/lib/metrics/compute";

const TZ = "America/Chicago";

const at = (iso: string, outcome: string | null = "no_answer"): MetricRow => ({
  startedAt: iso,
  outcome,
  durationSec: 0,
});

/** One row per UTC hour, starting at `startIso`, for `count` hours. */
const hourlyRows = (startIso: string, count: number): MetricRow[] => {
  const start = Date.parse(startIso);
  return Array.from({ length: count }, (_, i) => at(new Date(start + i * 3_600_000).toISOString()));
};

describe("hourlyBuckets — day boundary", () => {
  // Chicago is CDT (UTC-5) in August: the local day flips at 05:00Z.
  it("assigns 04:59Z to the previous local day and 05:01Z to the next", () => {
    const rows = [
      at("2026-08-28T04:59:00Z", "qualified"), // 23:59 on 08-27
      at("2026-08-28T05:01:00Z", "qualified"), // 00:01 on 08-28
    ];
    expect(hourlyBuckets(rows, "2026-08-27", TZ)).toEqual([{ hour: 23, calls: 1, connects: 1 }]);
    expect(hourlyBuckets(rows, "2026-08-28", TZ)).toEqual([{ hour: 0, calls: 1, connects: 1 }]);
  });
});

describe("hourlyBuckets — DST", () => {
  it("spring-forward day (2026-03-08) skips local hour 2 and never double-counts", () => {
    // Local day: 06:00Z Mar 8 → 05:00Z Mar 9 (23 hours). One row per UTC hour.
    const rows = hourlyRows("2026-03-08T06:00:00Z", 23);
    const buckets = hourlyBuckets(rows, "2026-03-08", TZ);
    const hours = buckets.map((b) => b.hour);
    expect(hours).not.toContain(2); // 2:00–2:59 local never existed
    expect(hours).toEqual([0, 1, ...Array.from({ length: 21 }, (_, i) => i + 3)]);
    // Every row lands in exactly one bucket, one per surviving local hour.
    expect(buckets.reduce((n, b) => n + b.calls, 0)).toBe(23);
    expect(buckets.every((b) => b.calls === 1)).toBe(true);
  });

  it("fall-back day (2026-11-01) keeps all 25 rows, folding both 1am passes together", () => {
    // Local day: 05:00Z Nov 1 → 06:00Z Nov 2 (25 hours). One row per UTC hour.
    const rows = hourlyRows("2026-11-01T05:00:00Z", 25);
    const buckets = hourlyBuckets(rows, "2026-11-01", TZ);
    expect(buckets.reduce((n, b) => n + b.calls, 0)).toBe(25); // nothing lost
    expect(buckets.map((b) => b.hour)).toEqual(Array.from({ length: 24 }, (_, i) => i));
    expect(buckets.find((b) => b.hour === 1)?.calls).toBe(2); // 1am CDT + 1am CST
    expect(buckets.filter((b) => b.calls === 2)).toHaveLength(1);
  });
});

describe("weekRange", () => {
  // 2026-01-01 is a Thursday; 18:00Z = 12:00 CST.
  const NOW = new Date("2026-01-01T18:00:00Z");

  it("Monday start crosses the year boundary back to 2025-12-29", () => {
    expect(weekRange(NOW, TZ, 1)).toEqual({
      fromKey: "2025-12-29",
      toKey: "2026-01-04",
      days: [
        "2025-12-29",
        "2025-12-30",
        "2025-12-31",
        "2026-01-01",
        "2026-01-02",
        "2026-01-03",
        "2026-01-04",
      ],
    });
  });

  it("Sunday start shifts the same instant to 2025-12-28 → 2026-01-03", () => {
    expect(weekRange(NOW, TZ, 0)).toEqual({
      fromKey: "2025-12-28",
      toKey: "2026-01-03",
      days: [
        "2025-12-28",
        "2025-12-29",
        "2025-12-30",
        "2025-12-31",
        "2026-01-01",
        "2026-01-02",
        "2026-01-03",
      ],
    });
  });

  it("produces 7 distinct consecutive days across the spring-forward week", () => {
    // Tue 2026-03-10, 13:00 CDT — the containing Sunday-start week holds the
    // 23-hour day (Sun 03-08) and must still enumerate exactly 7 dates.
    const { fromKey, toKey, days } = weekRange(new Date("2026-03-10T18:00:00Z"), TZ, 0);
    expect(fromKey).toBe("2026-03-08");
    expect(toKey).toBe("2026-03-14");
    expect(new Set(days).size).toBe(7);
    expect(days).toEqual([
      "2026-03-08",
      "2026-03-09",
      "2026-03-10",
      "2026-03-11",
      "2026-03-12",
      "2026-03-13",
      "2026-03-14",
    ]);
  });
});

describe("appointmentsSet", () => {
  // The Monday-start week above: [2025-12-29, 2026-01-04] in org tz (CST, UTC-6).
  const FROM = "2025-12-29";
  const TO = "2026-01-04";

  it("counts creations by org-local day, edges included, cancellations excluded", () => {
    const appts = [
      { createdAt: "2025-12-29T06:00:00Z", status: "scheduled" }, // 00:00 Dec 29 → in
      { createdAt: "2025-12-29T05:59:00Z", status: "scheduled" }, // 23:59 Dec 28 → out
      { createdAt: "2026-01-05T05:59:00Z", status: "confirmed" }, // 23:59 Jan 4 → in
      { createdAt: "2026-01-05T06:01:00Z", status: "scheduled" }, // 00:01 Jan 5 → out
      { createdAt: "2026-01-02T18:00:00Z", status: "cancelled" }, // in range, cancelled
      { createdAt: "2026-01-02T19:00:00Z", status: "canceled" }, // one-L spelling too
      { createdAt: "2026-01-02T20:00:00Z", status: "scheduled" }, // in
    ];
    expect(appointmentsSet(appts, FROM, TO, TZ)).toBe(3);
  });

  it("returns 0 for an empty list", () => {
    expect(appointmentsSet([], FROM, TO, TZ)).toBe(0);
  });
});
