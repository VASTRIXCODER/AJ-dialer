// ─────────────────────────────────────────────────────────────────────────────
// Wrap-up draft autosave — PURE storage helpers (E3).
//
// A rep half-way through wrap-up notes whose tab dies (battery, crash, an
// accidental close) used to lose everything they'd typed: the notes debounce
// saves to the LEAD, but only once a lead id exists, and a manual dial's
// wrap-up screen could vanish with the text still local. The draft is keyed by
// the attempt's client idempotency id — the one identifier that names THIS
// call and no other — so a restored draft can never land on the wrong wrap-up.
//
// Pure over a StorageLike so tests drive it with a plain Map-backed fake; the
// browser wrapper at the bottom is the only place `window` is touched.
// Lifecycle: saved on a debounce while typing, restored when the same attempt's
// wrap-up remounts with empty notes, cleared when the disposition files.
// ─────────────────────────────────────────────────────────────────────────────

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface WrapupDraft {
  notes: string;
  savedAt: number;
}

const PREFIX = "aj:wrapupDraft:";
/** Drafts older than this are stale — the shift is over, drop them on read. */
export const WRAPUP_DRAFT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export function wrapupDraftKey(attemptId: string): string {
  return `${PREFIX}${attemptId}`;
}

/** Persist the draft. Empty notes clear instead — nothing worth restoring. */
export function saveWrapupDraft(
  store: StorageLike,
  attemptId: string,
  notes: string,
  now: number = Date.now(),
): void {
  if (!attemptId) return;
  try {
    if (!notes.trim()) {
      store.removeItem(wrapupDraftKey(attemptId));
      return;
    }
    const draft: WrapupDraft = { notes, savedAt: now };
    store.setItem(wrapupDraftKey(attemptId), JSON.stringify(draft));
  } catch {
    /* storage full / disabled — the draft just won't survive a crash */
  }
}

/** Read this attempt's draft; stale or malformed entries are removed and null. */
export function readWrapupDraft(
  store: StorageLike,
  attemptId: string,
  now: number = Date.now(),
): WrapupDraft | null {
  if (!attemptId) return null;
  try {
    const raw = store.getItem(wrapupDraftKey(attemptId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<WrapupDraft> | null;
    if (
      !parsed ||
      typeof parsed.notes !== "string" ||
      typeof parsed.savedAt !== "number" ||
      now - parsed.savedAt > WRAPUP_DRAFT_MAX_AGE_MS
    ) {
      store.removeItem(wrapupDraftKey(attemptId));
      return null;
    }
    return { notes: parsed.notes, savedAt: parsed.savedAt };
  } catch {
    return null;
  }
}

export function clearWrapupDraft(store: StorageLike, attemptId: string): void {
  if (!attemptId) return;
  try {
    store.removeItem(wrapupDraftKey(attemptId));
  } catch {
    /* best-effort */
  }
}

/** The browser's localStorage as a StorageLike; null on the server / disabled. */
export function browserWrapupStore(): StorageLike | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
