import { cn } from "@/lib/utils";

export function LogoMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "relative inline-flex items-center justify-center rounded-xl bg-solar shadow-glow",
        className,
      )}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        className="h-[62%] w-[62%] text-white"
        aria-hidden
      >
        {/* Signal core */}
        <circle cx="12" cy="13.5" r="2.4" fill="currentColor" />
        {/* Broadcast arcs — command-center pulse */}
        <g
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinecap="round"
          fill="none"
        >
          <path d="M8.1 9.6a5.5 5.5 0 0 1 7.8 0" opacity="0.95" />
          <path d="M5.5 6.9a9.2 9.2 0 0 1 13 0" opacity="0.55" />
        </g>
      </svg>
    </span>
  );
}

export function Wordmark({
  className,
  collapsed = false,
  tagline = "Solar Resolution",
}: {
  className?: string;
  collapsed?: boolean;
  /**
   * Line under the wordmark. Defaults to the original solar tagline so the
   * marketing site and any caller without org context are unchanged; the app
   * shell passes the tenant's own (see brandTagline in lib/org/vertical.ts),
   * because "Solar Resolution" is someone else's industry to a tenant that
   * doesn't sell solar.
   */
  tagline?: string;
}) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <LogoMark className="h-9 w-9" />
      {!collapsed && (
        <div className="flex flex-col leading-none">
          <span className="text-[15px] font-bold tracking-tight">AIATWORK</span>
          <span className="text-[11px] font-medium text-muted-foreground">
            {tagline}
          </span>
        </div>
      )}
    </div>
  );
}
