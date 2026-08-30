import { ArrowLeftRight, Lock, LogOut, Sparkles } from "lucide-react";
import Link from "next/link";
import { LogoMark } from "@/components/brand/logo";
import { AmbientBackground } from "@/components/layout/ambient-background";
import type { OrgBilling } from "@/lib/org/settings";

/**
 * Full-screen lock shown to members of a workspace that's behind the platform
 * paywall and not yet marked active by the owner. No nav, no data — just the
 * plan, the price, and a way out (switch workspace / sign out). The superadmin
 * never sees this; access is granted from the superadmin console.
 */
export function PaywallScreen({
  orgName,
  productName,
  billing,
}: {
  orgName: string;
  productName?: string | null;
  billing: OrgBilling;
}) {
  const title = productName || orgName;
  const intervalLabel =
    billing.interval === "month" ? "/mo" : billing.interval === "year" ? "/yr" : "";
  const priceLabel =
    billing.price > 0
      ? new Intl.NumberFormat("en-US", {
          style: "currency",
          currency: billing.currency || "USD",
          maximumFractionDigits: Number.isInteger(billing.price) ? 0 : 2,
        }).format(billing.price)
      : null;

  return (
    <div className="relative flex min-h-screen items-center justify-center p-6">
      <AmbientBackground />
      <div className="surface-glass animate-fade-up w-full max-w-md rounded-2xl border border-border/60 p-8 text-center shadow-lift">
        <LogoMark className="mx-auto h-11 w-11" />
        <div className="mx-auto mt-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <Lock className="h-7 w-7" />
        </div>

        <h1 className="mt-4 text-xl font-bold tracking-tight">{title} is locked</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This workspace is on a paid plan that isn&apos;t active yet. Access unlocks
          for everyone the moment it&apos;s enabled by the dialer owner.
        </p>

        {priceLabel && (
          <div className="mx-auto mt-6 flex items-center justify-center gap-2 rounded-2xl border border-primary/20 bg-primary-soft/40 px-5 py-4">
            <Sparkles className="h-4 w-4 shrink-0 text-primary" />
            <span className="text-lg font-bold tabular text-foreground">
              {priceLabel}
              <span className="text-sm font-medium text-muted-foreground">{intervalLabel}</span>
            </span>
          </div>
        )}

        {billing.note && (
          // Attributed, deliberately. This is free text an owner typed into
          // billing settings, and unattributed in the middle of a lock screen
          // it reads as the platform's own support instruction — one workspace
          // had a personal Gmail address here, which the product then presented
          // as its official support channel. Saying where the message comes
          // from costs one line and stops the product vouching for it.
          <div className="mt-4 rounded-xl border border-border/60 bg-muted/40 px-4 py-3 text-left">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Note from this workspace
            </p>
            <p className="mt-1 text-sm text-muted-foreground">{billing.note}</p>
          </div>
        )}

        <div className="mt-7 flex flex-col gap-2.5 sm:flex-row sm:justify-center">
          <Link
            href="/hub"
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-border/60 px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
          >
            <ArrowLeftRight className="h-4 w-4" />
            Switch workspace
          </Link>
          <form action="/auth/signout" method="post">
            <button
              type="submit"
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-border/60 px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
            >
              <LogOut className="h-4 w-4" />
              Sign out
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
