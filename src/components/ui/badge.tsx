import * as React from "react";
import { cn } from "@/lib/utils";

type Tone =
  | "neutral"
  | "primary"
  | "accent"
  | "success"
  | "warning"
  | "danger"
  | "outline";

const tones: Record<Tone, string> = {
  neutral: "bg-muted text-muted-foreground",
  primary: "bg-primary-soft text-primary",
  accent: "bg-accent-soft text-accent",
  success: "bg-success/12 text-success",
  warning: "bg-warning/15 text-warning",
  danger: "bg-danger/12 text-danger",
  outline: "border border-border text-muted-foreground",
};

export function Badge({
  className,
  tone = "neutral",
  dot = false,
  icon: Icon,
  children,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & {
  tone?: Tone;
  dot?: boolean;
  /**
   * A glyph for the state this badge names — the SHAPE channel.
   *
   * The tones differ only in fill and text colour, and `dot` draws the identical
   * 6px circle for every one of them, so "Qualified" and "Appointment" (both
   * success) or "Wrong number" and "Do not call" (both danger) were separated by
   * hue alone. The status maps in src/lib/status.ts now carry the icon next to
   * the tone, so a call site cannot render one and forget the other.
   */
  icon?: React.ComponentType<{ className?: string }>;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold",
        tones[tone],
        className,
      )}
      {...props}
    >
      {Icon ? (
        <Icon className="h-3 w-3 shrink-0" />
      ) : (
        dot && <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" />
      )}
      {children}
    </span>
  );
}
