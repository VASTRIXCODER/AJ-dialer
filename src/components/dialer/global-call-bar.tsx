"use client";

import { motion } from "framer-motion";
import { ExternalLink, Mic, MicOff, PhoneOff, Radio } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useVocabulary } from "@/components/layout/vocabulary";
import { Avatar } from "@/components/ui/avatar";
import { cn, formatDuration, initials, leadDisplayName } from "@/lib/utils";
import { useDialerContext } from "./dialer-context";
import { Z } from "@/lib/z-layers";

/**
 * Floating call bar shown on EVERY app page (except the dialer itself) whenever
 * there's a call in progress — so a rep can wander to Leads / Reports / anywhere
 * without the call dropping, and still see + control it. Backed by the app-wide
 * DialerProvider, so this is the same live call, not a copy.
 */
export function GlobalCallBar() {
  const { dialer } = useDialerContext();
  const { state } = dialer;
  const pathname = usePathname();
  const vocab = useVocabulary();

  const inProgress =
    state.status === "dialing" || state.status === "live" || state.status === "wrapup";
  // The full dialer page already shows everything — no need for the floating bar there.
  if (!inProgress || pathname === "/dialer") return null;

  const lead = state.connectedLead ?? state.lines[0]?.lead ?? null;
  const name = leadDisplayName(
    lead ? `${lead.firstName} ${lead.lastName}` : "",
    lead?.phone,
    vocab.leadNoun,
  );
  const live = state.status === "live";
  const dialing = state.status === "dialing";

  const statusLabel = live
    ? formatDuration(state.durationSec)
    : dialing
      ? "Dialing…"
      : "Wrap-up";
  const statusTone = live ? "text-success" : dialing ? "text-warning" : "text-muted-foreground";

  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 24 }}
      className="fixed inset-x-0 bottom-4 flex justify-center px-4"
      style={{ zIndex: Z.callBar }}
    >
      <div className="glass flex items-center gap-3 rounded-2xl border border-border/60 px-3 py-2 shadow-lift">
        <span className="relative flex h-9 w-9 shrink-0 items-center justify-center">
          <Avatar initials={initials(name)} tone="success" size="sm" />
          {live && (
            <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-card bg-success" />
          )}
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold leading-tight">{name}</p>
          <p className={cn("flex items-center gap-1 text-xs font-medium tabular", statusTone)}>
            <Radio className="h-3 w-3" />
            {statusLabel}
          </p>
        </div>

        <div className="ml-1 flex items-center gap-1">
          {live && (
            <button
              type="button"
              onClick={dialer.toggleMute}
              aria-label={state.muted ? "Unmute" : "Mute"}
              className={cn(
                "flex h-9 w-9 items-center justify-center rounded-xl border transition-colors",
                state.muted
                  ? "border-danger/50 bg-danger/10 text-danger"
                  : "border-border text-muted-foreground hover:bg-muted",
              )}
            >
              {state.muted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
            </button>
          )}
          {(live || dialing) && (
            <button
              type="button"
              onClick={live ? dialer.endCall : dialer.skip}
              aria-label="End call"
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-danger bg-danger text-danger-foreground transition-transform active:scale-95"
            >
              <PhoneOff className="h-4 w-4" />
            </button>
          )}
          <Link
            href="/dialer"
            className="flex h-9 items-center gap-1.5 rounded-xl border border-border px-3 text-xs font-semibold transition-colors hover:bg-muted"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Dialer
          </Link>
        </div>
      </div>
    </motion.div>
  );
}
