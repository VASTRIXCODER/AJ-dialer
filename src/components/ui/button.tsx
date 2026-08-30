import * as React from "react";
import { cn } from "@/lib/utils";

type Variant =
  | "primary"
  | "secondary"
  | "outline"
  | "ghost"
  | "danger"
  | "success"
  | "subtle";
type Size = "sm" | "md" | "lg" | "icon";

const variants: Record<Variant, string> = {
  primary:
    "bg-brand text-white shadow-soft ring-1 ring-inset ring-white/10 hover:brightness-[1.06] active:brightness-95",
  secondary: "bg-foreground text-background hover:opacity-90 shadow-soft",
  // Opaque, no blur. A button carries text, and a translucent blurred fill
  // puts whatever is behind the button underneath its label.
  outline:
    "border border-border/70 bg-surface text-foreground hover:border-border hover:bg-surface-muted",
  ghost: "text-foreground hover:bg-muted/70",
  subtle: "bg-muted text-foreground hover:bg-secondary",
  danger:
    "bg-danger text-danger-foreground shadow-soft hover:brightness-105 active:brightness-95",
  success:
    "bg-success text-success-foreground shadow-soft hover:brightness-105 active:brightness-95",
};

/**
 * Heights are LITERAL, not scale steps, and that is deliberate.
 *
 * globals.css redefines Tailwind's spacing scale (`--spacing-9: 48px`,
 * `--spacing-10: 64px`) but stops at 10, so steps past it fall back to
 * Tailwind's 0.25rem base. This ladder was written in scale steps and came out
 * INVERTED: sm `h-9` = 48px, md `h-11` = 44px, lg `h-12` = 48px, icon `h-10` =
 * 64px. A small button was taller than a medium one, large equalled small, and
 * an icon button was the biggest control in the product.
 *
 * Nobody could see that from reading the file, which is the argument for pixels
 * here. tests/control-ladders.test.ts resolves these against the compiled
 * tokens and fails if the ladder stops ascending.
 *
 * The floor is 40px: these are tap targets, and the two 12px checkboxes this
 * codebase shipped are a reminder of where the drift goes if nothing holds it.
 */
const sizes: Record<Size, string> = {
  sm: "h-[40px] px-3.5 text-sm gap-1.5 rounded-lg",
  md: "h-[44px] px-5 text-sm gap-2 rounded-xl",
  lg: "h-[48px] px-7 text-base gap-2 rounded-xl",
  // Square, and the same height as md — an icon button sits beside one.
  icon: "h-[44px] w-[44px] rounded-xl",
};

export function buttonVariants({
  variant = "primary",
  size = "md",
  className,
}: { variant?: Variant; size?: Size; className?: string } = {}) {
  return cn(
    // Colour and opacity on the 90ms state curve, and nothing else. Every
    // button in the product goes through here, which made `active:scale-[0.98]`
    // the single largest source of motion on Instrument surfaces: every filter,
    // every Save, every Apply in a data grid shrank when pressed. Buttons that
    // want a press signal get a darker fill from their variant.
    "inline-flex items-center justify-center whitespace-nowrap font-semibold transition-colors duration-[var(--dur-state)]",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
    "disabled:pointer-events-none disabled:opacity-50",
    variants[variant],
    sizes[size],
    className,
  );
}

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", ...props }, ref) => (
    <button
      ref={ref}
      className={buttonVariants({ variant, size, className })}
      {...props}
    />
  ),
);
Button.displayName = "Button";
