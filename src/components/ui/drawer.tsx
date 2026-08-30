"use client";

import { type CSSProperties, type ReactNode, type RefObject } from "react";
import { Z } from "@/lib/z-layers";
import { cn } from "@/lib/utils";
import { Overlay } from "./overlay";

/**
 * Right-side drawer — the app's one slide-over shape. Full-screen sheet below
 * `sm`, fixed-width panel above it.
 *
 * The dialog contract (portal, scrim, role/aria-modal, Escape, focus trap,
 * initial focus, scroll lock, focus restore) comes from `Overlay`, shared with
 * Modal. This file used to hold its own verbatim copy of Modal's focus trap.
 *
 * The panel is OPAQUE, for the same reason Modal's is.
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
  zIndex = Z.overlay,
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
  return (
    <Overlay
      open={open}
      onClose={onClose}
      label={label}
      labelledBy={labelledBy}
      dismissible={dismissible}
      zIndex={zIndex}
      initialFocus={initialFocus}
      containerClassName={cn("flex justify-end", className)}
      motionProps={{
        initial: { opacity: 0, x: 48 },
        animate: { opacity: 1, x: 0 },
        exit: { opacity: 0, x: 48 },
        transition: { type: "spring", stiffness: 340, damping: 34 },
      }}
      panelClassName={cn(
        "surface-glass flex h-full w-full flex-col overflow-hidden border-l border-border/60 shadow-lift",
        "sm:max-w-[var(--drawer-w)] sm:rounded-l-2xl",
        panelClassName,
      )}
      style={{ "--drawer-w": `${width}px` } as CSSProperties}
    >
      {children}
    </Overlay>
  );
}
