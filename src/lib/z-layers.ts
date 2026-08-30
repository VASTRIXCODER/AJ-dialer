/**
 * The z ladder — every stacking level in the app, in one place.
 *
 * The values used to be written inline at each call site and had drifted into
 * 30, 40, 50, 80, 90, 91, 100, 101, 130, 130, 140, 200. Two of those were the
 * same number doing different jobs: `confirm-dialog` and the menu primitives
 * both sat at 130, so a Select opened inside a confirmation dialog could paint
 * behind the dialog it belonged to. Ties are the bug; the ordering below has
 * none.
 *
 * Read it top to bottom as "what is allowed to cover what".
 *
 * Pure and importable from anywhere — no React, no `server-only`.
 */
export const Z = {
  /** Sticky table headers and in-card affordances. */
  raised: 10,
  /** The sticky top bar. Below the sidebar, which is a sibling to its left. */
  topbar: 20,
  /** The shell's fixed sidebar. */
  sidebar: 30,
  /** The persistent call bar — follows the rep, never covered by content. */
  callBar: 40,
  /** Mobile navigation: scrim, then the panel over it. */
  navScrim: 50,
  navPanel: 60,
  /** Anchored row menus, which bring their own outside-click catcher. */
  rowMenu: 90,
  /** Modals, drawers and the command palette: scrim and panel together. */
  overlay: 100,
  /** A confirmation sits above whatever overlay asked for it. */
  confirm: 120,
  /**
   * Menus, selects and dropdowns. Deliberately ABOVE `confirm`: a menu is
   * opened from inside a dialog and has to clear it, and unlike a dialog it
   * never covers the whole screen, so being high costs nothing.
   */
  popover: 130,
  /** Toasts report on what just happened, including inside a dialog. */
  toast: 140,
  /** Transient, pointer-following, never blocks anything. */
  tooltip: 150,
} as const;

export type ZLayer = keyof typeof Z;
