import * as React from "react";
import { cn } from "@/lib/utils";

// An opaque inset well. This was `bg-background/40`, a 40%-opacity fill sitting
// behind whatever the user types — the page showing through the box they are
// reading their own words in. `--surface-2` is the plane the design system
// reserves for inset wells, and it is a real tonal step from the card in both
// themes. The focus ring is the focus signal; it does not need a colour change
// underneath the text as well.
const base =
  "w-full rounded-xl border border-input bg-surface-2 px-3.5 py-2.5 text-sm text-foreground transition-colors duration-200 placeholder:text-ink-3 focus-visible:border-primary/50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/15 disabled:cursor-not-allowed disabled:opacity-60";

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => (
  <input ref={ref} className={cn(base, className)} {...props} />
));
Input.displayName = "Input";

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(base, "min-h-[88px] resize-y leading-relaxed", className)}
    {...props}
  />
));
Textarea.displayName = "Textarea";

// `Select` — a styled native <select> — used to live here. It is gone rather
// than deprecated: a component that still exports gets imported again, and the
// whole point of the sweep was that the product has exactly ONE way to choose a
// value. Use `SelectMenu` from ./select-menu. The native element could not be
// tokenised (its popup is drawn by the OS, in the OS's colours, ignoring the
// app's theme entirely), could not carry an icon or say why an option is
// unavailable, and on Windows rendered a system list that looked nothing like
// the rest of the product. tests/token-discipline.test.ts keeps it from coming
// back.

export function Label({
  className,
  ...props
}: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn(
        "mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}
