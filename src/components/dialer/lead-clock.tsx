"use client";

import { Clock } from "lucide-react";
import { useEffect, useState } from "react";
import { describeLeadClock, leadLocalTime } from "@/lib/dialer/lead-timezone";
import { cn } from "@/lib/utils";
import { useDialerContextOptional } from "./dialer-context";
import { DEFAULT_TIMEZONE } from "@/lib/metrics/definitions";

// ─────────────────────────────────────────────────────────────────────────────
// What time it is where the contact is.
//
// The timezone resolver has driven server-side TCPA enforcement for a long time
// — the dial routes refuse a call that is outside the CONTACT's window, in the
// contact's own zone — and not one surface in the product ever showed a rep the
// number it produces. So a rep in Phoenix worked down a list of New Jersey
// contacts at what was, to them, a perfectly reasonable hour, and watched lane
// after lane cancel with no idea why until they stopped to read the refusal.
//
// This is the same resolver, on the row. Static, quiet, and warning-toned when
// the contact is outside the window — so the rep sees the refusal coming
// instead of discovering it after the fact.
// ─────────────────────────────────────────────────────────────────────────────

export function LeadClock({
  phone,
  timezone,
  className,
  compact = false,
}: {
  phone: string;
  /** The lead's stored IANA zone, if it has one. */
  timezone?: string | null;
  className?: string;
  /** Time only — for a dense list row. */
  compact?: boolean;
}) {
  const ctx = useDialerContextOptional();
  // Mounted-only: the server and the client would format different minutes,
  // and a hydration mismatch on a clock is a guaranteed one.
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  if (!now || !ctx || !phone) return null;
  const clock = leadLocalTime(
    phone,
    timezone,
    ctx.config.orgTimezone || DEFAULT_TIMEZONE,
    now,
    ctx.config.callingHours,
  );
  if (!clock) return null;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap text-[11px] font-medium",
        clock.outsideWindow ? "text-warning" : "text-muted-foreground",
        className,
      )}
      // The zone, and where it came from. An area-code guess is a guess, and a
      // rep about to make a decision on it deserves to know that.
      title={
        `${describeLeadClock(clock)} · ${clock.timezone}` +
        (clock.source === "areaCode"
          ? " (from their area code)"
          : clock.source === "fallback"
            ? " (workspace default — no zone on file)"
            : "")
      }
    >
      <Clock className="h-3 w-3 shrink-0" aria-hidden />
      {compact ? clock.time : describeLeadClock(clock)}
    </span>
  );
}
