"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useLead360 } from "./lead-360-provider";

// ─────────────────────────────────────────────────────────────────────────────
// LeadOpenLink — the one-line way for ANY surface (Server Components included)
// to open the Lead 360 drawer: wrap the lead's name in this tiny client
// component. It renders a real <button> (keyboard + screen-reader reachable),
// stops propagation so it works inside clickable rows, and inherits the
// surrounding typography by default so swapping a <p>'s text for this doesn't
// change how the row looks.
// ─────────────────────────────────────────────────────────────────────────────

export function LeadOpenLink({
  leadId,
  children,
  className,
  title,
  /** Runs before the drawer opens — e.g. close the modal this link sits in
   *  (sibling portals share z-index, so an open modal would cover the drawer). */
  onOpen,
}: {
  leadId: string;
  children: ReactNode;
  className?: string;
  title?: string;
  onOpen?: () => void;
}) {
  const { open } = useLead360();
  return (
    <button
      type="button"
      title={title ?? "Open full record"}
      onClick={(e) => {
        e.stopPropagation();
        onOpen?.();
        open(leadId);
      }}
      className={cn(
        // Inherit the row's font; only signal interactivity on hover/focus.
        "min-w-0 max-w-full cursor-pointer truncate text-left align-baseline transition-colors hover:underline",
        "focus-visible:outline-none focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      {children}
    </button>
  );
}
