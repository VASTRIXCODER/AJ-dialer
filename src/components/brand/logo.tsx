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
        className="h-[60%] w-[60%] text-white"
        aria-hidden
      >
        {/* Sun core */}
        <circle cx="12" cy="12" r="4" fill="currentColor" />
        {/* Rays / signal arcs */}
        <g
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          opacity="0.95"
        >
          <path d="M12 2.5v2.2" />
          <path d="M12 19.3v2.2" />
          <path d="M2.5 12h2.2" />
          <path d="M19.3 12h2.2" />
          <path d="M5.2 5.2l1.6 1.6" />
          <path d="M17.2 17.2l1.6 1.6" />
          <path d="M18.8 5.2l-1.6 1.6" />
          <path d="M6.8 17.2l-1.6 1.6" />
        </g>
      </svg>
    </span>
  );
}

export function Wordmark({
  className,
  collapsed = false,
}: {
  className?: string;
  collapsed?: boolean;
}) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <LogoMark className="h-9 w-9" />
      {!collapsed && (
        <div className="flex flex-col leading-none">
          <span className="text-[15px] font-bold tracking-tight">AIATWORK</span>
          <span className="text-[11px] font-medium text-muted-foreground">
            Solar Resolution
          </span>
        </div>
      )}
    </div>
  );
}
