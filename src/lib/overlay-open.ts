// ─────────────────────────────────────────────────────────────────────────────
// Is anything modal on screen right now?
//
// A window-level keydown listener cannot see React state, so the dialer's
// shortcut handler had no way to know a dialog was open — and kept firing
// underneath it. The worst version of that: a rep presses [?] during wrap-up to
// remind themselves what the number keys do, presses [1] to find out, and the
// call is dispositioned and the queue advances behind the open sheet.
//
// A counter rather than a boolean, because overlays nest — a confirmation
// dialog opened from inside a drawer must not "close" the keyboard lock when it
// alone goes away. `Overlay` is the single implementation every dialog surface
// in the product goes through (see src/components/ui/overlay.tsx), so counting
// there counts all of them.
//
// Deliberately a plain module rather than context: the consumers are listeners
// registered outside React's tree, and they need the answer synchronously
// during an event, not on the next render.
// ─────────────────────────────────────────────────────────────────────────────

let openCount = 0;

/** Register an open overlay. Call the returned function when it closes. */
export function markOverlayOpen(): () => void {
  openCount += 1;
  let released = false;
  return () => {
    // Idempotent: React can run an effect cleanup more than once in StrictMode,
    // and a double decrement would unlock the keyboard while a dialog is still
    // on screen.
    if (released) return;
    released = true;
    openCount = Math.max(0, openCount - 1);
  };
}

/** True while at least one modal surface is open. */
export function anyOverlayOpen(): boolean {
  return openCount > 0;
}

/** Test seam — resets the counter between cases. Never called by the app. */
export function __resetOverlayCount(): void {
  openCount = 0;
}
