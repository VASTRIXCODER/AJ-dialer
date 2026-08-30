"use client";

import { type ReactNode, type RefObject } from "react";
import { Z } from "@/lib/z-layers";
import { cn } from "@/lib/utils";
import { Overlay } from "./overlay";

/**
 * The app's one modal shape: bottom sheet on mobile, centred card from `sm` up.
 *
 * Everything that makes it a dialog — the portal, the scrim, role/aria-modal,
 * Escape, the focus trap, initial focus, the scroll lock and focus restore —
 * lives in `Overlay`, which Drawer uses too. This file is now only the shape.
 * The two used to carry a byte-identical copy of that trap each.
 *
 * The panel is OPAQUE. It was `.glass` at 55% alpha, which put whatever was
 * behind the dialog underneath the words in it.
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
  /** Tailwind max-width class for the panel (max-w-md … max-w-3xl). */
  maxWidth?: string;
  /** false disables backdrop-click + Escape (e.g. while a save is in flight). */
  dismissible?: boolean;
  /** The overlay rung by default; raise only to cover another overlay. */
  zIndex?: number;
  /** Extra classes on the outermost fixed container (e.g. superadmin-theme). */
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
      containerClassName={cn("flex items-end justify-center sm:items-center sm:p-4", className)}
      motionProps={{
        initial: { opacity: 0, y: 20, scale: 0.98 },
        animate: { opacity: 1, y: 0, scale: 1 },
        exit: { opacity: 0, y: 16, scale: 0.98 },
      }}
      panelClassName={cn(
        "surface-glass flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-2xl border border-border/60 shadow-lift sm:max-h-[88vh] sm:rounded-2xl",
        maxWidth,
        panelClassName,
      )}
    >
      {children}
    </Overlay>
  );
}
