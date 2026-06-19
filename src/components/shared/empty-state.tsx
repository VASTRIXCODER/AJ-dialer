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
        <div className="glow-orb absolute -inset-4 opacity-50" />
        <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl bg-primary-soft text-primary ring-1 ring-inset ring-primary/20">
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
