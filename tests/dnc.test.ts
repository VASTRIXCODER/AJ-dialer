import { describe, expect, it } from "vitest";
import { dncKey, scrubDnc } from "@/lib/db/dnc";

describe("dncKey", () => {
  it("normalizes to the last 10 digits", () => {
    expect(dncKey("+14155551234")).toBe("4155551234");
    expect(dncKey("(415) 555-1234")).toBe("4155551234");
    expect(dncKey("1-415-555-1234")).toBe("4155551234");
  });

  it("returns '' for anything not dialable", () => {
    expect(dncKey("12345")).toBe("");
    expect(dncKey("")).toBe("");
  });
});

describe("scrubDnc", () => {
  const leads = [{ phone: "+14155551234" }, { phone: "+13105550000" }, { phone: "bad" }];

  it("drops leads whose number is on the suppression set", () => {
    const kept = scrubDnc(leads, new Set(["4155551234"]));
    expect(kept.map((l) => l.phone)).toEqual(["+13105550000", "bad"]);
  });

  it("returns the list unchanged when the set is empty", () => {
    expect(scrubDnc(leads, new Set())).toBe(leads);
  });

  it("keeps un-keyable numbers (a garbled phone isn't a match)", () => {
    const kept = scrubDnc([{ phone: "bad" }], new Set(["4155551234"]));
    expect(kept).toHaveLength(1);
  });
});
