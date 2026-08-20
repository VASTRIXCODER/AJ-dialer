import { describe, expect, it } from "vitest";
import { MAX_PACKS_PER_UPLOAD, planCityPacks } from "@/lib/db/lead-packs";

const row = (city: string, state = "CA") => ({ city, state });

describe("planCityPacks", () => {
  it("orders cities by FIRST APPEARANCE, never alphabetically", () => {
    // Zeta first, Alpha last in the file — alphabetical would invert this.
    const rows = [...Array(10).fill(row("Zeta")), ...Array(10).fill(row("Alpha"))];
    const packs = planCityPacks(rows, 10, "Jan list");
    expect(packs.map((p) => p.label)).toEqual([
      "Jan list · Zeta, CA",
      "Jan list · Alpha, CA",
    ]);
  });

  it("keeps a city's rows in file order inside its pack", () => {
    const rows = [row("Fresno"), row("Bakersfield"), row("Fresno"), row("Fresno")];
    const packs = planCityPacks(rows, 10, "L");
    expect(packs[0].indices).toEqual([0, 2, 3]); // Fresno, original row order
    expect(packs[1].indices).toEqual([1]);
  });

  it("re-groups a city that reappears later in the file into its first bucket", () => {
    // A file that goes Fresno → Bakersfield → Fresno again must not create two
    // separate Fresno packs; the city keeps its original position.
    const rows = [row("Fresno"), row("Bakersfield"), row("Fresno")];
    const packs = planCityPacks(rows, 10, "L");
    expect(packs).toHaveLength(2);
    expect(packs[0].label).toBe("L · Fresno, CA");
    expect(packs[0].indices).toEqual([0, 2]);
  });

  it("cuts a large city into numbered packs, still in file order", () => {
    const rows = Array.from({ length: 25 }, () => row("Fresno"));
    const packs = planCityPacks(rows, 10, "Big");
    expect(packs.map((p) => p.label)).toEqual([
      "Big · Fresno, CA · Pack 1",
      "Big · Fresno, CA · Pack 2",
      "Big · Fresno, CA · Pack 3",
    ]);
    expect(packs[0].indices).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(packs[2].indices).toEqual([20, 21, 22, 23, 24]);
  });

  it("names a single-pack city plainly, with no misleading 'Pack 1'", () => {
    const packs = planCityPacks([row("Fresno")], 10, "L");
    expect(packs[0].label).toBe("L · Fresno, CA");
  });

  it("folds case and whitespace into one city, keeping the first spelling", () => {
    const rows = [row("Fresno"), row("fresno "), row("FRESNO")];
    const packs = planCityPacks(rows, 10, "L");
    expect(packs).toHaveLength(1);
    expect(packs[0].label).toBe("L · Fresno, CA");
    expect(packs[0].indices).toEqual([0, 1, 2]);
  });

  it("treats the same city name in different states as different cities", () => {
    const rows = [row("Springfield", "IL"), row("Springfield", "MO")];
    const packs = planCityPacks(rows, 10, "L");
    expect(packs.map((p) => p.label)).toEqual([
      "L · Springfield, IL",
      "L · Springfield, MO",
    ]);
  });

  it("collects rows with no city into their own trailing bucket", () => {
    const rows = [row("Fresno"), { city: "", state: "" }, row("Fresno")];
    const packs = planCityPacks(rows, 10, "L");
    expect(packs.map((p) => p.label)).toEqual(["L · Fresno, CA", "L · No city"]);
    expect(packs[1].indices).toEqual([1]);
  });

  it("never loses a row to the pack ceiling", () => {
    // Every lead its own city ⇒ far more planned packs than the cap allows.
    const rows = Array.from({ length: MAX_PACKS_PER_UPLOAD + 250 }, (_, i) =>
      row(`City${i}`),
    );
    const packs = planCityPacks(rows, 10, "L");
    expect(packs.length).toBeLessThanOrEqual(MAX_PACKS_PER_UPLOAD);
    const covered = packs.flatMap((p) => p.indices).sort((a, b) => a - b);
    expect(covered).toEqual(rows.map((_, i) => i)); // every row placed exactly once
    expect(packs[packs.length - 1].label).toBe("L · Remaining cities");
  });

  it("enforces the minimum pack size rather than exploding on packSize 0", () => {
    const rows = Array.from({ length: 30 }, () => row("Fresno"));
    const packs = planCityPacks(rows, 0, "L");
    expect(packs).toHaveLength(3); // clamped to MIN_PACK_SIZE (10)
  });

  it("returns nothing for an empty file", () => {
    expect(planCityPacks([], 10, "L")).toEqual([]);
  });
});
