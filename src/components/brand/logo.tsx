import { cn } from "@/lib/utils";

export function LogoMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "relative inline-flex items-center justify-center rounded-xl bg-brand shadow-glow",
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
  tagline = "AI Sales Dialer",
}: {
  className?: string;
  collapsed?: boolean;
   /**
    * Line under the wordmark. The default is vertical-neutral — it used to be
    * "Solar Resolution", which is one tenant's product name and reads as a
    * mistake to everyone else. The app shell passes the workspace's own (see
    * orgVocabulary), and a solar workspace still gets "Solar Resolution" from
    * its vertical.
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
