import { describe, expect, it } from "vitest";
import {
  clearWrapupDraft,
  readWrapupDraft,
  saveWrapupDraft,
  WRAPUP_DRAFT_MAX_AGE_MS,
  wrapupDraftKey,
  type StorageLike,
} from "@/lib/dialer/wrapup-draft";

// Wrap-up draft autosave: keyed by the attempt's client idempotency id so a
// restored draft can never land on the wrong call's wrap-up. Save while
// typing, restore after a tab death, clear on disposition.

function fakeStore(): StorageLike & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

const ATTEMPT = "3f9a2c10-aaaa-bbbb-cccc-000000000001";
const OTHER = "3f9a2c10-aaaa-bbbb-cccc-000000000002";

describe("wrapup draft save/restore/clear", () => {
  it("round-trips a draft keyed by attempt id", () => {
    const store = fakeStore();
    saveWrapupDraft(store, ATTEMPT, "spoke to spouse, call Friday", 1000);
    expect(readWrapupDraft(store, ATTEMPT, 2000)).toEqual({
      notes: "spoke to spouse, call Friday",
      savedAt: 1000,
    });
    // A DIFFERENT attempt sees nothing — drafts never cross calls.
    expect(readWrapupDraft(store, OTHER, 2000)).toBeNull();
  });

  it("clears on disposition and stays cleared", () => {
    const store = fakeStore();
    saveWrapupDraft(store, ATTEMPT, "notes", 1000);
    clearWrapupDraft(store, ATTEMPT);
    expect(readWrapupDraft(store, ATTEMPT, 2000)).toBeNull();
    expect(store.map.size).toBe(0);
  });

  it("saving empty notes clears instead of storing an empty draft", () => {
    const store = fakeStore();
    saveWrapupDraft(store, ATTEMPT, "something", 1000);
    saveWrapupDraft(store, ATTEMPT, "   ", 2000);
    expect(readWrapupDraft(store, ATTEMPT, 3000)).toBeNull();
  });

  it("drops stale drafts on read (older than the max age) and removes them", () => {
    const store = fakeStore();
    saveWrapupDraft(store, ATTEMPT, "old shift", 0);
    expect(readWrapupDraft(store, ATTEMPT, WRAPUP_DRAFT_MAX_AGE_MS + 1)).toBeNull();
    expect(store.map.has(wrapupDraftKey(ATTEMPT))).toBe(false);
    // Just inside the window it still restores.
    saveWrapupDraft(store, ATTEMPT, "recent", 0);
    expect(readWrapupDraft(store, ATTEMPT, WRAPUP_DRAFT_MAX_AGE_MS - 1)?.notes).toBe("recent");
  });

  it("survives malformed storage contents by removing them", () => {
    const store = fakeStore();
    store.setItem(wrapupDraftKey(ATTEMPT), "{not json");
    expect(readWrapupDraft(store, ATTEMPT)).toBeNull();
    store.setItem(wrapupDraftKey(ATTEMPT), JSON.stringify({ notes: 42, savedAt: "x" }));
    expect(readWrapupDraft(store, ATTEMPT)).toBeNull();
    expect(store.map.has(wrapupDraftKey(ATTEMPT))).toBe(false);
  });

  it("ignores a missing attempt id entirely", () => {
    const store = fakeStore();
    saveWrapupDraft(store, "", "notes");
    expect(store.map.size).toBe(0);
    expect(readWrapupDraft(store, "")).toBeNull();
  });
});
