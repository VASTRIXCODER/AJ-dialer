"use client";

import { motion } from "framer-motion";
import { ArrowLeftRight, Building2, LogOut, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useId } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Wordmark } from "@/components/brand/logo";
import type { OrgFeatures } from "@/lib/org/settings";
import { DEFAULT_VOCABULARY, type OrgVocabulary } from "@/lib/org/vocabulary";
import { ROLE_LABEL, type OrgRole, isOrgRole } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { activeNavHref, navGroups, navLabel } from "./nav";
import { ReviewCountBadge } from "./review-count-badge";

type Account = { name: string; email: string; initials: string };

export function Sidebar({
  account,
  permissions = [],
  features = null,
  orgName = null,
  productName = null,
  brandColor = null,
  logoUrl = null,
  role = null,
  superadmin = false,
  vocabulary = DEFAULT_VOCABULARY,
  onNavigate,
}: {
  account?: Account | null;
  permissions?: string[];
  features?: OrgFeatures | null;
  orgName?: string | null;
  productName?: string | null;
  brandColor?: string | null;
  /** Org logo (Admin → Identity) — replaces the identity tile's generic icon. */
  logoUrl?: string | null;
  role?: string | null;
  superadmin?: boolean;
  /** The workspace's own nouns — nav labels follow them. */
  vocabulary?: OrgVocabulary;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  // Unique per instance so the desktop + mobile sidebars don't share a layout id.
  const uid = useId();
  let order = 0;

  const orgRole: OrgRole | null = isOrgRole(role) ? role : null;
  // Show only nav items the viewer may see (reps don't see Admin) and that the
  // org has enabled (a tenant can switch whole areas of the dialer off).
  const groups = navGroups
    .map((g) => ({
      ...g,
      items: g.items.filter(
        (it) =>
          (!it.permission || permissions.includes(it.permission)) &&
          (!it.feature || !features || features[it.feature] !== false) &&
          (!it.anyFeature ||
            !features ||
            it.anyFeature.some((f) => features[f] !== false)),
      ),
    }))
    .filter((g) => g.items.length > 0);

  // Decided once across every visible item, not per item — see `activeNavHref`.
  const activeHref = activeNavHref(
    pathname,
    groups.flatMap((g) => g.items.map((it) => it.href)),
  );

  return (
    <div className="glass flex h-full flex-col gap-6 border-r border-border/60">
      <div className="px-5 pt-5">
        <Link href="/dashboard" onClick={onNavigate} className="inline-flex">
          <Wordmark tagline={vocabulary.tagline} />
        </Link>
      </div>

      {/* Organization identity + workspace switcher */}
      {orgName && (
        <div className="px-3">
          <div className="rounded-xl border border-border/60 bg-surface/40 p-2.5">
            <div className="flex items-center gap-2.5">
              <span
                className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-lg text-white shadow-soft"
                style={{
                  background: brandColor
                    ? `linear-gradient(135deg, ${brandColor}, ${brandColor}cc)`
                    : "linear-gradient(135deg, hsl(var(--primary)), hsl(var(--accent)))",
                }}
              >
                {logoUrl ? (
                  // Plain <img>, not next/image: the URL is arbitrary tenant
                  // config and can't be enumerated in next.config remotePatterns.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={logoUrl}
                    alt=""
                    className="h-full w-full object-cover"
                    onError={(e) => {
                      // A dead URL falls back to the branded tile, not a broken image.
                      e.currentTarget.style.display = "none";
                    }}
                  />
                ) : (
                  <Building2 className="h-4 w-4" />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold leading-tight">{orgName}</p>
                <p className="truncate text-[11px] text-muted-foreground">
                  {productName || "AI Auto-Dialer"}
                </p>
              </div>
              {orgRole && (
                <Badge tone={orgRole === "rep" ? "neutral" : "primary"} className="shrink-0">
                  {ROLE_LABEL[orgRole]}
                </Badge>
              )}
            </div>
            <Link
              href="/hub"
              onClick={onNavigate}
              className="mt-2 flex items-center justify-center gap-1.5 rounded-lg border border-border/60 py-1.5 text-[11px] font-semibold text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
            >
              <ArrowLeftRight className="h-3.5 w-3.5" />
              Switch organization
            </Link>
          </div>
        </div>
      )}

      <nav className="flex-1 space-y-6 overflow-y-auto px-3">
        {groups.map((group) => (
          <div key={group.label}>
            <p className="px-3 pb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-ink-3">
              {group.label}
            </p>
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const active = item.href === activeHref;
                const Icon = item.icon;
                const delay = order++ * 0.035;
                return (
                  <motion.li
                    key={item.href}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{
                      delay,
                      duration: 0.4,
                      ease: [0.22, 1, 0.36, 1],
                    }}
                  >
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors duration-200",
                        active
                          ? "text-primary"
                          : "text-muted-foreground hover:bg-muted/70 hover:text-foreground",
                      )}
                    >
                      {active && (
                        <>
                          {/* Sliding active pill — glides between routes */}
                          <motion.span
                            layoutId={`nav-active-${uid}`}
                            className="absolute inset-0 z-0 rounded-xl bg-primary-soft"
                            transition={{ type: "spring", stiffness: 420, damping: 34 }}
                          />
                          <motion.span
                            layoutId={`nav-bar-${uid}`}
                            className="absolute left-0 top-1/2 z-10 h-5 w-1 -translate-y-1/2 rounded-r-full bg-primary"
                            transition={{ type: "spring", stiffness: 420, damping: 34 }}
                          />
                        </>
                      )}
                      {/* No glow on the active icon, and no hover scale. The
                          nav is chrome a rep's eye passes over hundreds of
                          times a shift; the active state is already carried by
                          the pill, the bar and the accent colour. */}
                      <Icon className="relative z-10 h-[18px] w-[18px] shrink-0" />
                      <span className="relative z-10 flex-1">{navLabel(item, vocabulary)}</span>
                      {item.countBadge === "reviews" && <ReviewCountBadge />}
                      {item.badge &&
                        (item.badge === "Live" ? (
                          <span className="relative z-10 flex items-center gap-1.5 text-[11px] font-bold text-success">
                            <span className="relative flex h-2 w-2">
                              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-60" />
                              <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
                            </span>
                            LIVE
                          </span>
                        ) : (
                          <Badge tone="primary" className="relative z-10 px-1.5 py-0">
                            {item.badge}
                          </Badge>
                        ))}
                    </Link>
                  </motion.li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="space-y-2 px-3 pb-5">
        {superadmin && (
          <Link
            href="/console"
            onClick={onNavigate}
            className="flex items-center justify-center gap-2 rounded-xl border border-border/60 px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
          >
            <ShieldCheck className="h-3.5 w-3.5" />
            Control Center
          </Link>
        )}
        <Link
          href="/settings"
          onClick={onNavigate}
          className="group flex items-center gap-3 rounded-2xl border border-border/60 bg-background/30 p-3 transition-all duration-300 hover:-translate-y-0.5 hover:border-border hover:bg-muted/60 hover:shadow-soft"
        >
          <Avatar
            initials={account?.initials ?? "·"}
            tone="primary"
            size="sm"
            ring
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">
              {account?.name ?? "Your account"}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {account?.email || "Signed in"}
            </p>
          </div>
          <span className="h-2 w-2 rounded-full bg-success shadow-[0_0_8px_0_hsl(var(--success)/0.9)]" />
        </Link>

        {account && (
          <form action="/auth/signout" method="post">
            <button
              type="submit"
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-border/60 px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
            >
              <LogOut className="h-3.5 w-3.5" />
              Sign out
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
