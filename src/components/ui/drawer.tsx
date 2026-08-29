"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, useRef, type CSSProperties, type ReactNode, type RefObject } from "react";
import { cn } from "@/lib/utils";
import { Portal } from "./portal";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Right-side drawer — the app's one slide-over shape. Same accessibility
 * contract as `Modal` (whose proven focus-trap this reuses verbatim):
 * role="dialog"/aria-modal, Escape + backdrop close, a focus trap with restore
 * to the trigger, initial focus, and a body scroll lock. Below the `sm`
 * breakpoint it becomes a full-screen sheet; above it, a fixed-width panel
 * (default ~720px). Slide-in degrades to a plain fade under reduced motion.
 *
 * Like Modal, call sites may conditionally render (`{open && <Drawer/>}`) at
 * the cost of exit animations; render always and drive `open` to get exits.
 */
export function Drawer({
  open = true,
  onClose,
  label,
  labelledBy,
  width = 720,
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
  /** Panel width in px on sm+ screens (full-screen sheet below sm). */
  width?: number;
  /** false disables backdrop-click + Escape (e.g. while a save is in flight). */
  dismissible?: boolean;
  zIndex?: number;
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
            className={cn("fixed inset-0 flex justify-end", className)}
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
              initial={reduce ? { opacity: 0 } : { opacity: 0, x: 48 }}
              animate={reduce ? { opacity: 1 } : { opacity: 1, x: 0 }}
              exit={reduce ? { opacity: 0 } : { opacity: 0, x: 48 }}
              transition={{ type: "spring", stiffness: 340, damping: 34 }}
              className={cn(
                // Full-screen sheet on mobile; fixed width panel from sm up.
                "glass relative flex h-full w-full flex-col overflow-hidden border-l border-border/60 shadow-lift outline-none",
                "sm:max-w-[var(--drawer-w)] sm:rounded-l-2xl",
                panelClassName,
              )}
              style={{ "--drawer-w": `${width}px` } as CSSProperties}
            >
              {children}
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </Portal>
  );
}
