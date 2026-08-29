"use client";

import { useState, type ReactNode } from "react";
import { useDialerKbd, type DialerKbdHandlers } from "@/lib/dialer/use-kbd";
import { KbdOverlay } from "./kbd-overlay";
import { ShellHeader } from "./shell-header";

// ─────────────────────────────────────────────────────────────────────────────
// DialerShell (E3) — the command-center frame around the dialer page.
// Renders the ShellHeader (mode switcher, scope + progress, line readiness,
// realtime health + presence, session stats) above whatever the conductor
// (dialer-client) mounts, and owns the two page-scoped chrome behaviors:
// keyboard shortcuts (registered only while this shell is mounted) and the
// shortcut overlay. All call behavior stays in the engine — the shell only
// wires visible controls and their keyboard equivalents to the same handlers.
// ─────────────────────────────────────────────────────────────────────────────

export function DialerShell({
  assignmentLabel,
  kbd,
  dispositionLabels,
  children,
}: {
  assignmentLabel?: string;
  /** The page's shortcut handlers — each self-gates on dialer state. */
  kbd?: DialerKbdHandlers;
  /** Current wrap-up grid labels, in order — shown against 1..9 in the overlay. */
  dispositionLabels?: string[];
  children: ReactNode;
}) {
  const [kbdOpen, setKbdOpen] = useState(false);

  useDialerKbd({
    ...kbd,
    onToggleOverlay: () => setKbdOpen((v) => !v),
    onEscape: () => setKbdOpen(false),
  });

  return (
    <div className="space-y-4">
      <ShellHeader assignmentLabel={assignmentLabel} onOpenKbd={() => setKbdOpen(true)} />
      {children}
      <KbdOverlay
        open={kbdOpen}
        onClose={() => setKbdOpen(false)}
        dispositionLabels={dispositionLabels}
      />
    </div>
  );
}
