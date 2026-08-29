"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Tooltip } from "@/components/ui/tooltip";
import type { FilterSpec } from "@/lib/leads/filter-spec";
import { drillHref } from "@/lib/reports/drill";
import { cn } from "@/lib/utils";

/**
 * DrillLink — wraps a report figure in a link to the leads table pre-filtered
 * to (an approximation of) the rows behind that figure, via the same ?f=
 * FilterSpec param the /leads page already reads.
 *
 * Only /leads is a legal target: the call archive (/recordings) accepts no
 * filter querystring at all (its filters are client state; the only deep-link
 * it honors is ?call=<id>), so a "filtered" recordings link would silently
 * show everything — a lie this component refuses to emit. If the spec can't
 * encode (absurd size), the children render UNLINKED rather than pointing at a
 * wrong page.
 *
 * The tooltip says "opens the matching leads" because a drill-down is a
 * leads-side approximation of a call-side number — see src/lib/reports/drill.ts.
 */
export function DrillLink({
  filter,
  children,
  className,
  label = "Opens the matching leads",
}: {
  filter: FilterSpec;
  children: ReactNode;
  className?: string;
  /** Tooltip text — override when the approximation needs its own words. */
  label?: string;
}) {
  const href = drillHref(filter);
  if (!href) return <>{children}</>;
  return (
    <Tooltip content={label}>
      <Link
        href={href}
        className={cn(
          "block rounded-2xl outline-none transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-primary/60",
          className,
        )}
      >
        {children}
      </Link>
    </Tooltip>
  );
}
