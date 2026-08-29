// ─────────────────────────────────────────────────────────────────────────────
// Hand-off for a dropped file on its way to the Import Studio.
//
// A File object can't survive a full navigation, but it CAN survive a Next.js
// client-side route change — the module instance (and this variable) stay in
// memory. Dropping a CSV on a group tile stores it here and router.push()es to
// /leads/import, where the wizard takes it and starts at the mapping step
// without the user re-picking the file. take() clears the slot so a stale file
// can never resurface on a later visit.
// ─────────────────────────────────────────────────────────────────────────────

let pending: File | null = null;

export function setPendingFile(file: File): void {
  pending = file;
}

/** Claim (and clear) the pending file. Null when nothing was dropped. */
export function takePendingFile(): File | null {
  const f = pending;
  pending = null;
  return f;
}
