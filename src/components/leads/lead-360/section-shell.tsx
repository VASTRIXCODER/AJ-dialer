"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The Lead 360 sections' shared shell: a quiet bordered card with a small
 * uppercase heading — denser than SectionCard on purpose, since eight of these
 * stack inside one drawer.
 */
export function PanelSection({
  title,
  action,
  children,
  className,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-2xl border border-border/60 bg-card p-4", className)}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          {title}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Label → value row used across the sections. Values fall back to "—". */
export function InfoRow({
  label,
  children,
}: {
  label: string;
  children?: ReactNode;
}) {
  const empty = children == null || children === "" || children === false;
  return (
    <div className="flex items-baseline justify-between gap-4 py-1 text-sm">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-right font-medium">
        {empty ? <span className="text-muted-foreground">—</span> : children}
      </dd>
    </div>
  );
}
