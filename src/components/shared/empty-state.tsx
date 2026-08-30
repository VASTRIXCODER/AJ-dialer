import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────────────────
// Two empties, because there are two situations and they are not alike.
//
// `panel` — a section INSIDE a working screen resolved with nothing in it.
//   It collapses to a single line. It does not reserve its populated height,
//   because a 340px box containing one centred sentence pushes everything
//   below it off the fold to say "there is nothing here". The whole point of
//   an empty panel is that it should cost almost no space.
//
// `page` — the entire screen has nothing to show: a permission gate, a
//   workspace with no data yet, a channel that was never connected. Here the
//   emptiness IS the screen, so it is allowed to be centred and generous.
//
// Both state what would be here and, where one exists, the action that creates
// it. Neither is decorated: a pulsing orb behind a drifting icon was depth and
// motion on a working surface.
// ─────────────────────────────────────────────────────────────────────────────

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  variant = "panel",
  className,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: { label: string; href: string };
  /**
   * `panel` (default) collapses to one line inside a working screen.
   * `page` fills a screen that has nothing else on it.
   *
   * The default is the quiet one on purpose: a new empty state added without
   * thinking about it should take up as little room as possible.
   */
  variant?: "panel" | "page";
  className?: string;
}) {
  if (variant === "panel") {
    return (
      <div
        className={cn(
          "flex flex-wrap items-center gap-x-2 gap-y-1 py-2 text-label-14",
          className,
        )}
      >
        <Icon className="h-4 w-4 shrink-0 text-ink-3" aria-hidden />
        <span className="font-semibold">{title}</span>
        <span className="text-muted-foreground">{description}</span>
        {action && (
          <Link
            href={action.href}
            className={buttonVariants({ size: "sm", variant: "ghost", className: "ml-auto" })}
          >
            {action.label}
          </Link>
        )}
      </div>
    );
  }

  return (
    <Card
      className={cn(
        "flex flex-col items-center justify-center px-6 py-16 text-center",
        className,
      )}
    >
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary-soft text-primary ring-1 ring-inset ring-primary/20">
        <Icon className="h-7 w-7" aria-hidden />
      </div>
      <h3 className="mt-6 text-heading-18">{title}</h3>
      <p className="mt-1.5 max-w-[66ch] text-copy-14 text-muted-foreground">{description}</p>
      {action && (
        <Link href={action.href} className={buttonVariants({ size: "sm", className: "mt-5" })}>
          {action.label}
        </Link>
      )}
    </Card>
  );
}
