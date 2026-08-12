"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { cn } from "@/lib/utils";
import { Portal } from "./portal";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * The app's one modal shape — the exact overlay markup every hand-rolled
 * dialog used (portal → fixed container → blurred backdrop → glass panel,
 * bottom-sheet on mobile, centered card on sm+), plus the accessibility every
 * one of them was missing: role="dialog"/aria-modal, Escape-to-close, a focus
 * trap with focus restore to the trigger, initial focus, and a body scroll
 * lock. Panel motion is the standard spring, degraded to a plain fade under
 * reduced motion.
 *
 * Call sites may keep conditional rendering (`{open && <MyDialog/>}`) — exit
 * animations then simply don't play. Render it always and drive `open` to get
 * exits through the internal AnimatePresence.
 */
export function Modal({
  open = true,
  onClose,
  label,
  labelledBy,
  maxWidth = "max-w-lg",
  dismissible = true,
  zIndex = 100,
  className,
  panelClassName,
  initialFocus,
  children,
}: {
  open?: boolean;
  onClose: () => void;
  /** Accessible name; prefer labelledBy (heading id) when a title exists. */
  label?: string;
  labelledBy?: string;
  /** Tailwind max-width class for the panel (max-w-md … max-w-3xl). */
  maxWidth?: string;
  /** false disables backdrop-click + Escape (e.g. while a save is in flight). */
  dismissible?: boolean;
  /** The overlay ladder default is 100; raise for modals above z-100 chrome. */
  zIndex?: number;
  /** Extra classes on the outermost fixed container (e.g. superadmin-theme). */
  className?: string;
  panelClassName?: string;
  /** Focused on open instead of the first focusable element. */
  initialFocus?: RefObject<HTMLElement | null>;
  children: ReactNode;
}) {
  const reduce = useReducedMotion();
  const panelRef = useRef<HTMLDivElement>(null);
  // Latest callbacks/flags without re-running the trap effect mid-dialog.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const dismissibleRef = useRef(dismissible);
  dismissibleRef.current = dismissible;

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;

    // Panel mounts via portal — focus on the next frame once it exists.
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

  return (
    <Portal>
      <AnimatePresence>
        {open && (
          <div
            className={cn(
              "fixed inset-0 flex items-end justify-center sm:items-center sm:p-4",
              className,
            )}
            style={{ zIndex }}
          >
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
              initial={reduce ? { opacity: 0 } : { opacity: 0, y: 20, scale: 0.98 }}
              animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
              exit={reduce ? { opacity: 0 } : { opacity: 0, y: 16, scale: 0.98 }}
              transition={{ type: "spring", stiffness: 320, damping: 30 }}
              className={cn(
                "glass relative flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-2xl border border-border/60 shadow-lift outline-none sm:max-h-[88vh] sm:rounded-2xl",
                maxWidth,
                panelClassName,
              )}
            >
              {children}
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </Portal>
  );
}
