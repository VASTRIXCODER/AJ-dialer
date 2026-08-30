"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { Z } from "@/lib/z-layers";
import { cn } from "@/lib/utils";
import { Portal } from "./portal";

// ─────────────────────────────────────────────────────────────────────────────
// One overlay. Every dialog surface in the product is this component.
//
// Modal and Drawer were two files with a byte-identical 55-line focus trap
// between them — the same FOCUSABLE selector, the same Tab wrapping, the same
// scroll lock, the same focus restore, copy-pasted. Two copies of an
// accessibility contract is one copy that will silently fall behind, and the
// fix for a trap bug would have had to be made twice.
//
// What lives here, once:
//   · a portal, so the panel escapes any transformed or overflow-hidden parent
//   · role="dialog" + aria-modal, and a name from either `label` or `labelledBy`
//   · Escape to close, honouring `dismissible` (a save in flight must not be
//     dismissable by a stray keypress)
//   · a real focus trap — Tab and Shift+Tab wrap, and focus is pulled back in
//     if it escapes the panel
//   · initial focus on the first focusable element, or `initialFocus`
//   · a body scroll lock
//   · focus restored to whatever opened it, on close
//   · a translucent, blurred SCRIM, which is the one surface in the product
//     that is allowed to be see-through: it exists to show that the thing
//     behind it is still there but out of reach
//
// What the caller supplies: where the panel sits (`placement`), how it enters,
// and what is inside it. The panel itself is always opaque.
// ─────────────────────────────────────────────────────────────────────────────

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface OverlayProps {
  open?: boolean;
  onClose: () => void;
  /** Accessible name; prefer `labelledBy` (a heading id) when a title exists. */
  label?: string;
  labelledBy?: string;
  /** false disables backdrop-click and Escape — e.g. while a save is in flight. */
  dismissible?: boolean;
  /** Defaults to the `overlay` rung. Raise only for something that must cover it. */
  zIndex?: number;
  /** Layout of the fixed container: where the panel sits on screen. */
  containerClassName?: string;
  /** The panel itself. Must be opaque — a scrim is translucent, a panel is not. */
  panelClassName?: string;
  className?: string;
  /** Focused on open instead of the first focusable element. */
  initialFocus?: RefObject<HTMLElement | null>;
  /** Panel entry/exit. Reduced motion collapses whatever this is to a fade. */
  motionProps?: {
    initial?: Record<string, number>;
    animate?: Record<string, number>;
    exit?: Record<string, number>;
    transition?: Record<string, unknown>;
  };
  style?: React.CSSProperties;
  children: ReactNode;
}

export function Overlay({
  open = true,
  onClose,
  label,
  labelledBy,
  dismissible = true,
  zIndex = Z.overlay,
  containerClassName,
  panelClassName,
  className,
  initialFocus,
  motionProps,
  style,
  children,
}: OverlayProps) {
  const reduce = useReducedMotion();
  const panelRef = useRef<HTMLDivElement>(null);
  // Latest callbacks and flags without re-running the trap effect mid-dialog.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const dismissibleRef = useRef(dismissible);
  dismissibleRef.current = dismissible;

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;

    // The panel mounts through a portal — focus on the next frame, once it
    // actually exists in the document.
    const raf = requestAnimationFrame(() => {
      const panel = panelRef.current;
      if (!panel) return;
      const target =
        initialFocus?.current ?? panel.querySelector<HTMLElement>(FOCUSABLE) ?? panel;
      target.focus({ preventScroll: true });
    });

    function focusables(panel: HTMLElement): HTMLElement[] {
      return [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (el) => el.getClientRects().length > 0,
      );
    }

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && dismissibleRef.current) {
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const items = focusables(panel);
      if (items.length === 0) {
        e.preventDefault();
        panel.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      const inside = panel.contains(active);
      if (e.shiftKey && (active === first || !inside)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !inside)) {
        e.preventDefault();
        first.focus();
      }
    }

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      previous?.focus?.({ preventScroll: true });
    };
  }, [open, initialFocus]);

  const enter = motionProps?.initial ?? { opacity: 0 };
  const shown = motionProps?.animate ?? { opacity: 1 };
  const leave = motionProps?.exit ?? { opacity: 0 };

  return (
    <Portal>
      <AnimatePresence>
        {open && (
          <div className={cn("fixed inset-0", containerClassName, className)} style={{ zIndex }}>
            {/* The scrim. Translucent on purpose: what it covers is still
                there, just out of reach. */}
            <motion.div
              className="absolute inset-0 bg-background/70 backdrop-blur-xl"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={dismissible ? () => onCloseRef.current() : undefined}
              aria-hidden
            />
            <motion.div
              ref={panelRef}
              role="dialog"
              aria-modal="true"
              aria-label={label}
              aria-labelledby={labelledBy}
              tabIndex={-1}
              initial={reduce ? { opacity: 0 } : enter}
              animate={reduce ? { opacity: 1 } : shown}
              exit={reduce ? { opacity: 0 } : leave}
              transition={motionProps?.transition ?? { type: "spring", stiffness: 320, damping: 30 }}
              className={cn("relative outline-none", panelClassName)}
              style={style}
            >
              {children}
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </Portal>
  );
}
