"use client";

import { Keyboard } from "lucide-react";
import { Modal } from "@/components/ui/modal";

// ─────────────────────────────────────────────────────────────────────────────
// The dialer's keyboard shortcut overlay (E3) — opened by [?] or the header
// button. Purely descriptive: every shortcut listed here is a convenience over
// a visible button, and the disposition hotkeys show the CURRENT wrap-up
// grid's labels (the org's own taxonomy, campaign-narrowed), in grid order.
// ─────────────────────────────────────────────────────────────────────────────

function Key({ children }: { children: string }) {
  return (
    <kbd className="inline-flex h-6 min-w-6 items-center justify-center rounded-md border border-border bg-muted px-1.5 text-[11px] font-bold text-foreground shadow-soft">
      {children}
    </kbd>
  );
}

export function KbdOverlay({
  open,
  onClose,
  dispositionLabels = [],
}: {
  open: boolean;
  onClose: () => void;
  /** The wrap-up grid's labels in order — what 1..9 will press. */
  dispositionLabels?: string[];
}) {
  const rows: { keys: string[]; label: string }[] = [
    { keys: ["c"], label: "Start the next call" },
    { keys: ["m"], label: "Mute / unmute" },
    { keys: ["."], label: "Skip — cancel dialing, or skip wrap-up without a disposition" },
    { keys: ["n"], label: "Focus the notes field" },
    { keys: ["?"], label: "Show / hide this overlay" },
    { keys: ["Esc"], label: "Close overlays" },
  ];

  return (
    <Modal open={open} onClose={onClose} label="Keyboard shortcuts" maxWidth="max-w-md">
      <div className="flex items-center gap-2 border-b border-border px-5 py-4">
        <Keyboard className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-base font-bold">Keyboard shortcuts</h2>
      </div>
      <div className="space-y-2.5 overflow-y-auto p-5">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between gap-4">
            <span className="text-sm text-muted-foreground">{row.label}</span>
            <span className="flex shrink-0 items-center gap-1">
              {row.keys.map((k) => (
                <Key key={k}>{k}</Key>
              ))}
            </span>
          </div>
        ))}
        <div className="mt-3 border-t border-border pt-3">
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">
            Wrap-up dispositions
          </p>
          {dispositionLabels.length ? (
            <div className="space-y-1.5">
              {dispositionLabels.slice(0, 9).map((label, i) => (
                <div key={`${label}-${i}`} className="flex items-center justify-between gap-4">
                  <span className="text-sm text-muted-foreground">{label}</span>
                  <Key>{String(i + 1)}</Key>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              During wrap-up, <Key>1</Key>–<Key>9</Key> press the disposition buttons in grid
              order.
            </p>
          )}
        </div>
        <p className="pt-2 text-[11px] text-ink-3">
          Shortcuts pause automatically while you&apos;re typing in a text field.
        </p>
      </div>
    </Modal>
  );
}
