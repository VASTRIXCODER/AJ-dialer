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
      {/* No glow, no float. This renders inside working screens, and a pulsing
          orb behind a drifting icon is decoration on an Instrument surface —
          the tile still reads as a tile from its tonal step and its ring.
          W2 takes this further: an empty panel collapses to a single line
          rather than reserving its populated height, and the full-screen
          "nothing here at all" cases move to a separate Stage component that
          is allowed to be cinematic. */}
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary-soft text-primary ring-1 ring-inset ring-primary/20">
        <Icon className="h-7 w-7" />
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
