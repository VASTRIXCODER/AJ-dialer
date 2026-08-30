import { Clock3 } from "lucide-react";

/**
 * "Data as of 3:42 PM · org timezone America/Chicago · Aug 22 – Aug 28" —
 * the honesty line under a force-dynamic analytics page. generatedAt is the
 * RENDER time, which for these pages is exactly when every number on screen
 * was computed, so the stamp is true by construction (no cache to lie about).
 * Server-safe: no hooks, renders inline in RSC pages.
 */
export function DataStamp({
  generatedAt,
  timezone,
  rangeLabel,
}: {
  generatedAt: Date;
  /** Org IANA timezone — the zone every day boundary on the page used. */
  timezone: string;
  /** The active window as explicit dates (reports); omit when not range-scoped. */
  rangeLabel?: string;
}) {
  let asOf: string;
  try {
    asOf = generatedAt.toLocaleString("en-US", {
      timeZone: timezone,
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    // Invalid org timezone string — show UTC rather than crash the page.
    asOf = `${generatedAt.toLocaleString("en-US", {
      timeZone: "UTC",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    })} UTC`;
  }
  return (
    <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground">
      <Clock3 className="h-3.5 w-3.5" aria-hidden />
      <span>
        Data as of <span className="font-medium text-muted-foreground tabular">{asOf}</span>
      </span>
      <span aria-hidden>·</span>
      <span>
        org timezone <span className="font-medium text-muted-foreground">{timezone}</span>
      </span>
      {rangeLabel && (
        <>
          <span aria-hidden>·</span>
          <span className="font-medium text-muted-foreground">{rangeLabel}</span>
        </>
      )}
    </p>
  );
}
