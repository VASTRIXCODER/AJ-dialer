import * as React from "react";
import { cn } from "@/lib/utils";

const base =
  "w-full rounded-xl border border-input bg-background/40 px-3.5 py-2.5 text-sm text-foreground transition-all duration-200 placeholder:text-muted-foreground/70 focus-visible:border-primary/50 focus-visible:bg-background/70 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/15 disabled:cursor-not-allowed disabled:opacity-60";

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => (
  // h-11 matches Button `md` exactly (44px). Sized by padding alone, this
  // computed to 42px — a height no Button size has, so an Input and a Button
  // in the same row never lined up. Eleven call sites already patch it by
  // hand (8x h-9, 3x h-8), which is how the app ended up shipping three
  // different heights for one control; those patches still win, because
  // tailwind-merge keeps the last conflicting class.
  //
  // On the <input> only — `base` is shared with Textarea, which sizes itself.
  <input ref={ref} className={cn(base, "h-11", className)} {...props} />
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

export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, ...props }, ref) => (
  <select ref={ref} className={cn(base, "cursor-pointer", className)} {...props} />
));
Select.displayName = "Select";

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
