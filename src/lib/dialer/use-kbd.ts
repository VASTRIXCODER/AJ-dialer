"use client";

// ─────────────────────────────────────────────────────────────────────────────
// Dialer keyboard shortcuts (E3).
//
// One window-level keydown listener, registered ONLY while the dialer page is
// mounted (the hook lives in DialerShell). Listening at the window means it
// hears keystrokes meant for whatever is layered on top of it, so it stands
// down for three things, and everything except Escape is swallowed by each:
//
//   · text entry — input / textarea / select / contentEditable
//   · a widget doing its own typeahead — listbox, option, combobox, menu
//   · any open dialog, counted through the one `Overlay` primitive
//
// Modifier chords (Cmd/Ctrl/Alt) pass through untouched so browser shortcuts
// keep working; plain Shift is allowed because "?" needs it.
//
// The gate is `decideKeystroke`, a pure function, because this is the code that
// decides whether a stray keypress files a disposition on a live call.
//
// Every shortcut is a convenience over a visible button — never the only way
// to do something — so the handlers here just call the same callbacks the
// buttons do, and each handler self-gates on the dialer state it needs.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useRef } from "react";
import { anyOverlayOpen } from "../overlay-open";

export interface DialerKbdHandlers {
  /** c — start the next call (idle only; the handler gates). */
  onStartCall?: () => void;
  /** m — toggle mute (dialing/live only). */
  onToggleMute?: () => void;
  /** . — skip / cancel (dialing or wrap-up). */
  onSkip?: () => void;
  /** n — focus the notes field. */
  onFocusNotes?: () => void;
  /** 1..9 — disposition hotkeys in wrap-up, grid order. */
  onDigit?: (n: number) => void;
  /** ? — toggle the shortcut overlay. */
  onToggleOverlay?: () => void;
  /** Escape — close overlays. */
  onEscape?: () => void;
}

/**
 * Widgets that own every keystroke landing inside them. Typeahead in a listbox
 * is as much "typing" as a text field is: SelectMenu jumps to a matching option
 * on a printable key, and a key it does not match still belongs to the list,
 * not to the page underneath. Opening the booking dialog's duration picker and
 * typing "m" for "min" muted the live call.
 */
const KEYBOARD_OWNING_ROLES =
  '[role="listbox"], [role="option"], [role="combobox"], [role="menu"], [role="menuitem"], [contenteditable="true"]';

/** True when a keystroke belongs to the element, not to the dialer. */
export function isEditableTarget(el: EventTarget | null): boolean {
  // Duck-typed rather than `instanceof HTMLElement`: that check is wrong across
  // realms (an element inside an iframe is an HTMLElement — just not THIS
  // window's), and it makes the decision impossible to test outside a browser.
  const node = el as Partial<HTMLElement> | null;
  if (!node || typeof node.tagName !== "string") return false;
  const tag = node.tagName.toUpperCase();
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (node.isContentEditable) return true;
  return Boolean(node.closest?.(KEYBOARD_OWNING_ROLES));
}

/** What a keystroke is allowed to reach. */
export type KbdVerdict =
  /** Not ours — a chord, a repeat, something already handled, or typing. */
  | { kind: "ignore" }
  /** Escape gets through from anywhere; it is the universal "put this away". */
  | { kind: "escape" }
  | { kind: "shortcut"; key: string };

/**
 * The whole gate, as one pure decision — so it can be tested without a browser.
 *
 * The rule it enforces: the dialer listens at the WINDOW, which means it hears
 * keystrokes meant for whatever is on top of it. It must stand down for
 * anything that owns text entry, and for any open dialog.
 */
export function decideKeystroke(
  e: {
    key: string;
    repeat?: boolean;
    defaultPrevented?: boolean;
    metaKey?: boolean;
    ctrlKey?: boolean;
    altKey?: boolean;
    target?: EventTarget | null;
  },
  overlayOpen: boolean,
): KbdVerdict {
  if (e.defaultPrevented || e.repeat) return { kind: "ignore" };
  // Modifier chords belong to the browser and the OS.
  if (e.metaKey || e.ctrlKey || e.altKey) return { kind: "ignore" };
  // A dialog is up: it owns the keyboard until it closes. Without this the
  // dialer kept listening underneath every modal in the product — most sharply
  // through its OWN shortcut sheet, where a rep pressing [?] during wrap-up and
  // then [1] to see what that did filed a real disposition and advanced the
  // queue behind the open sheet.
  if (overlayOpen || isEditableTarget(e.target ?? null)) {
    return e.key === "Escape" ? { kind: "escape" } : { kind: "ignore" };
  }
  return { kind: "shortcut", key: e.key };
}

export function useDialerKbd(handlers: DialerKbdHandlers, active = true): void {
  // Latest handlers without re-binding the listener every render.
  const ref = useRef(handlers);
  ref.current = handlers;

  useEffect(() => {
    if (!active || typeof window === "undefined") return;
    const onKeyDown = (e: KeyboardEvent) => {
      const verdict = decideKeystroke(e, anyOverlayOpen());
      if (verdict.kind === "ignore") return;
      if (verdict.kind === "escape") {
        ref.current.onEscape?.();
        return;
      }
      switch (verdict.key) {
        case "?":
          e.preventDefault();
          ref.current.onToggleOverlay?.();
          return;
        case "c":
          ref.current.onStartCall?.();
          return;
        case "m":
          ref.current.onToggleMute?.();
          return;
        case ".":
          ref.current.onSkip?.();
          return;
        case "n":
          // preventDefault so the "n" doesn't land inside the just-focused field.
          e.preventDefault();
          ref.current.onFocusNotes?.();
          return;
        case "Escape":
          ref.current.onEscape?.();
          return;
        default:
          if (/^[1-9]$/.test(verdict.key)) ref.current.onDigit?.(Number(verdict.key));
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active]);
}
