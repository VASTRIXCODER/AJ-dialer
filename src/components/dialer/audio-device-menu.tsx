"use client";

import { Check, Headphones, Volume2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { DialerDevices } from "@/lib/dialer/use-dialer-devices";
import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────────────────
// Audio device menu (E3) — pick which microphone the Twilio device captures
// and (where the browser supports setSinkId) which speaker plays the call.
// Choices persist per user via use-dialer-devices. Honesty rules:
//   • no Twilio device yet (demo / connecting) → the trigger is disabled with
//     a plain-language reason, not hidden and not a dead button;
//   • no setSinkId (Safari) → the output section renders disabled with
//     "Output selection isn't supported in this browser".
// ─────────────────────────────────────────────────────────────────────────────

export function AudioDeviceMenu({ devices }: { devices: DialerDevices }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Close on outside click / Escape — a tiny popover, not a Modal.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const disabledReason = devices.ready
    ? null
    : "Audio device selection is available once the Twilio line is connected.";

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        disabled={!devices.ready}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        title={disabledReason ?? "Choose microphone & speaker"}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-1 text-[11px] font-semibold text-muted-foreground transition-colors",
          devices.ready ? "hover:bg-muted hover:text-foreground" : "cursor-not-allowed opacity-60",
        )}
      >
        <Headphones className="h-3 w-3" />
        Audio
      </button>

      {open && devices.ready && (
        <div
          role="menu"
          aria-label="Audio devices"
          className="absolute right-0 top-full z-40 mt-2 w-72 rounded-2xl border border-border bg-card p-3 shadow-lift"
        >
          <p className="mb-1.5 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-muted-foreground">
            <Headphones className="h-3.5 w-3.5" />
            Microphone
          </p>
          <div className="mb-3 space-y-0.5">
            {devices.inputs.length === 0 && (
              <p className="px-2 py-1 text-xs text-muted-foreground">No microphones found.</p>
            )}
            {devices.inputs.map((d) => {
              const active = devices.inputId === d.deviceId || (!devices.inputId && d.deviceId === "default");
              return (
                <button
                  key={d.deviceId}
                  type="button"
                  role="menuitemradio"
                  aria-checked={active}
                  onClick={() => devices.setInput(d.deviceId)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted",
                    active ? "font-semibold text-foreground" : "text-muted-foreground",
                  )}
                >
                  <Check className={cn("h-3.5 w-3.5 shrink-0", active ? "opacity-100" : "opacity-0")} />
                  <span className="truncate">{d.label}</span>
                </button>
              );
            })}
          </div>

          <p className="mb-1.5 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-muted-foreground">
            <Volume2 className="h-3.5 w-3.5" />
            Speaker
          </p>
          {devices.outputSelectionSupported ? (
            <div className="space-y-0.5">
              {devices.outputs.length === 0 && (
                <p className="px-2 py-1 text-xs text-muted-foreground">No speakers found.</p>
              )}
              {devices.outputs.map((d) => {
                const active =
                  devices.outputId === d.deviceId || (!devices.outputId && d.deviceId === "default");
                return (
                  <button
                    key={d.deviceId}
                    type="button"
                    role="menuitemradio"
                    aria-checked={active}
                    onClick={() => devices.setOutput(d.deviceId)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted",
                      active ? "font-semibold text-foreground" : "text-muted-foreground",
                    )}
                  >
                    <Check className={cn("h-3.5 w-3.5 shrink-0", active ? "opacity-100" : "opacity-0")} />
                    <span className="truncate">{d.label}</span>
                  </button>
                );
              })}
            </div>
          ) : (
            // Feature-detected honesty: Safari has no setSinkId, so the call
            // plays through the system default and there is no picker to fake.
            <p className="rounded-lg bg-muted/60 px-2 py-1.5 text-xs text-muted-foreground">
              Output selection isn&apos;t supported in this browser — the call plays through your
              system&apos;s default speaker.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
