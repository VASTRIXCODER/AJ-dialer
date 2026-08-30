"use client";

import { Check, Copy, Eye, EyeOff } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────────────────
// A short credential, masked until someone asks for it.
//
// A join code is not a label, it is a key: anyone holding it can add themselves
// to the workspace. It was rendered as plain text on Admin, on Org settings and
// — worst of all — as a chip on every row of the Superadmin org list, where a
// single screenshot exposed the join code of every tenant on the platform at
// once. These are exactly the screens that get shared, demoed and recorded.
//
// Copy deliberately works WITHOUT revealing. Copying is the common action
// (paste it into an invite), reading it aloud is the rare one, so the default
// path never puts the value on screen at all.
// ─────────────────────────────────────────────────────────────────────────────

export function SecretValue({
  value,
  label,
  className,
  valueClassName,
  copyable = false,
}: {
  value: string;
  /** What this is, for the screen-reader labels: "Join code". */
  label: string;
  className?: string;
  /** The type treatment for the value — each site keeps its own. */
  valueClassName?: string;
  /** Render a copy button. Off by default; several sites already have one. */
  copyable?: boolean;
}) {
  const [shown, setShown] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  // Same length as the real value so revealing never reflows the row.
  const mask = "•".repeat(Math.max(value.length, 1));

  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5", className)}>
      <span
        className={cn("truncate font-mono", valueClassName)}
        // Screen readers get the state, never the masked bullets read out one
        // by one. The value itself is only in the tree once revealed.
        aria-label={shown ? `${label} ${value}` : `${label} hidden`}
      >
        {shown ? value : mask}
      </span>
      <button
        type="button"
        onClick={() => setShown((s) => !s)}
        aria-pressed={shown}
        aria-label={shown ? `Hide ${label.toLowerCase()}` : `Reveal ${label.toLowerCase()}`}
        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {shown ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
      </button>
      {copyable && (
        <button
          type="button"
          onClick={() => {
            navigator.clipboard?.writeText(value);
            setCopied(true);
            if (timer.current) clearTimeout(timer.current);
            timer.current = setTimeout(() => setCopied(false), 1500);
          }}
          aria-label={`Copy ${label.toLowerCase()}`}
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {copied ? (
            <Check className="h-3.5 w-3.5 text-success" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
        </button>
      )}
    </span>
  );
}
