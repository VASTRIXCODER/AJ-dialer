"use client";

// ─────────────────────────────────────────────────────────────────────────────
// Dialer keyboard shortcuts (E3).
//
// One window-level keydown listener, registered ONLY while the dialer page is
// mounted (the hook lives in DialerShell) and NEVER firing while the rep is
// typing — any input/textarea/select/contentEditable target swallows every
// shortcut except Escape. Modifier chords (Cmd/Ctrl/Alt) pass through
// untouched so browser shortcuts keep working; plain Shift is allowed because
// "?" needs it.
//
// Every shortcut is a convenience over a visible button — never the only way
// to do something — so the handlers here just call the same callbacks the
// buttons do, and each handler self-gates on the dialer state it needs.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useRef } from "react";

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

/** True when a keystroke belongs to the element, not to the dialer. */
export function isEditableTarget(el: EventTarget | null): boolean {
  if (!el || !(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return el.isContentEditable;
}

export function useDialerKbd(handlers: DialerKbdHandlers, active = true): void {
  // Latest handlers without re-binding the listener every render.
  const ref = useRef(handlers);
  ref.current = handlers;

  useEffect(() => {
    if (!active || typeof window === "undefined") return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isEditableTarget(e.target)) {
        // Typing must never trigger the dialer — but Escape still closes
        // overlays even from inside a field.
        if (e.key === "Escape") ref.current.onEscape?.();
        return;
      }
      switch (e.key) {
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
          if (/^[1-9]$/.test(e.key)) ref.current.onDigit?.(Number(e.key));
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active]);
}
