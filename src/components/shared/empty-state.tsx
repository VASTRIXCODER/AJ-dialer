import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: { label: string; href: string };
  className?: string;
}) {
  return (
    <Card
      className={cn(
        "animate-fade-up flex flex-col items-center justify-center overflow-hidden px-6 py-16 text-center",
        className,
      )}
    >
      <div className="relative">
        <div className="glow-orb animate-glow-pulse absolute -inset-4 opacity-50" />
        <div className="animate-float relative flex h-16 w-16 items-center justify-center rounded-2xl bg-primary-soft text-primary ring-1 ring-inset ring-primary/20">
          <Icon className="h-7 w-7" />
        </div>
      </div>
      <h3 className="mt-6 text-lg font-semibold">{title}</h3>
      <p className="mt-1.5 max-w-md text-sm text-muted-foreground">{description}</p>
      {action && (
        <Link
          href={action.href}
          className={buttonVariants({ size: "sm", className: "mt-5" })}
        >
          {action.label}
        </Link>
      )}
    </Card>
  );
}

/**
 * The small, inline "nothing here yet" box — the tier below EmptyState.
 *
 * EmptyState above is a whole Card at px-6 py-16 with an animated orb: right
 * for a page that has nothing on it, far too much for the inside of a panel.
 * So eleven places hand-rolled the same dashed box instead, and drifted into
 * four different heights (py-3, py-5, py-6, py-8) and two alignments — most
 * visibly in the call detail modal, where two of them sit in one dialog.
 *
 * `size` exists because the tier genuinely has two uses: `tight` for a slot
 * inside a list or a modal section, `roomy` for a panel that is otherwise
 * empty. Everything else is fixed, so two of these can never disagree again.
 */
export function InlineEmpty({
  children,
  size = "roomy",
  align = "center",
  className,
}: {
  children: React.ReactNode;
  size?: "tight" | "roomy";
  align?: "center" | "left";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border border-dashed border-border/70 px-4 text-sm text-muted-foreground",
        size === "tight" ? "py-5" : "py-8",
        align === "center" ? "text-center" : "flex items-center gap-2",
        className,
      )}
    >
      {children}
    </div>
  );
}
