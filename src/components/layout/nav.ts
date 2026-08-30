import {
  Activity,
  BarChart3,
  CalendarCheck,
  CheckCircle2,
  ClipboardList,
  Compass,
  Headphones,
  KanbanSquare,
  LayoutDashboard,
  type LucideIcon,
  Megaphone,
  PhoneCall,
  PhoneIncoming,
  Radio,
  Settings,
  Sparkles,
  Sunrise,
  Trophy,
  Users,
} from "lucide-react";
import { DEMO_DATA } from "@/lib/demo";
import type { OrgFeatures } from "@/lib/org/settings";
import { DEFAULT_VOCABULARY, type OrgVocabulary } from "@/lib/org/vocabulary";
import type { Permission } from "@/lib/permissions";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  badge?: string;
  /**
   * When set, the sidebar shows the workspace's own word here instead of
   * `label`. A recruiting workspace's nav should read "Candidates", not
   * "Leads" — and "Bills are fine" is a sentence only a solar rep would say.
   * `label` remains the neutral fallback for anywhere without a vocabulary.
   */
  vocabLabel?: keyof OrgVocabulary;
  /**
   * When set, the sidebar renders a live count chip on this item (a small
   * client component that polls its endpoint). "reviews" = open needs-review
   * items (F1) — the number a supervisor is on the hook for right now.
   */
  countBadge?: "reviews";
  /** When set, the item is only shown to viewers holding this permission. */
  permission?: Permission;
  /** When set, the item only shows if the org has this feature enabled. */
  feature?: keyof OrgFeatures;
  /** When set, the item shows if the org has ANY of these features enabled. */
  anyFeature?: (keyof OrgFeatures)[];
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

/** The label to render for a nav item in a given workspace. */
export function navLabel(
  item: NavItem,
  vocabulary: OrgVocabulary = DEFAULT_VOCABULARY,
): string {
  if (!item.vocabLabel) return item.label;
  const value = vocabulary[item.vocabLabel];
  return typeof value === "string" && value.trim() ? value : item.label;
}

/**
 * Which nav item — if any — the current path belongs to. Longest match wins.
 *
 * The obvious test, `pathname === href || pathname.startsWith(href + "/")`,
 * lights every ancestor: on `/monitor/team` both "Live Monitor" (`/monitor`)
 * and "Team Status" (`/monitor/team`) came out active. Two items carrying
 * `aria-current="page"` is invalid — a document has exactly one current page —
 * so a screen reader announced the rep as being in two places at once, and
 * sighted users saw two highlighted rows with no way to tell which was real.
 *
 * Deciding across the whole candidate list rather than per item is what makes
 * the winner unique. Matching stays on segment boundaries, so `/leads` can
 * never claim `/leadsource`, and an href of `/` only ever matches exactly.
 *
 * Pass the items the viewer can actually see: if a parent route is hidden by
 * permission, its child should still win rather than fall through to nothing.
 */
export function activeNavHref(pathname: string, hrefs: string[]): string | null {
  let winner: string | null = null;
  for (const href of hrefs) {
    if (pathname !== href && !pathname.startsWith(`${href}/`)) continue;
    if (winner === null || href.length > winner.length) winner = href;
  }
  return winner;
}

export const navGroups: NavGroup[] = [
  {
    label: "Workspace",
    items: [
      { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
      // P2.6: the rep's personal "what should I do right now" — deliberately
      // ungated: it degrades to an honest empty state everywhere.
      { label: "My Day", href: "/today", icon: Sunrise },
      {
        label: "Power Dialer",
        href: "/dialer",
        icon: PhoneCall,
        // Show for any org that can dial — manual-only (e.g. Donny) or AI.
        anyFeature: ["manualDialer", "aiDialer"],
        ...(DEMO_DATA ? { badge: "Live" } : {}),
      },
      {
        label: "Leads",
        vocabLabel: "LeadNounPlural",
        href: "/leads",
        icon: Users,
        feature: "leads",
      },
      {
        // The pipeline board, the shared work queue, and audiences. Reps hold
        // crm.view by default, so this is a floor-wide destination, not an
        // supervisor one — the queue is where unowned work gets picked up.
        label: "CRM",
        href: "/crm",
        icon: KanbanSquare,
        feature: "crm",
        permission: "crm.view",
      },
      {
        // Deliberately NO permission filter: managers land in the Assignment
        // Center, reps in My Assignments — the route itself does the switch.
        label: "Assignments",
        href: "/assignments",
        icon: ClipboardList,
        feature: "leads",
      },
      {
        label: "Appointments",
        href: "/appointments",
        icon: CalendarCheck,
        feature: "appointments",
        permission: "appointments.view",
      },
      {
        label: "Callbacks",
        href: "/callbacks",
        icon: PhoneIncoming,
        feature: "callbacks",
        // The needs-review lane (F1) lives on the callbacks workspace — the
        // badge is what tells a supervisor there's adjudication waiting.
        countBadge: "reviews",
      },
      {
        label: "No need right now",
        vocabLabel: "noNeedLabel",
        href: "/bills-fine",
        icon: CheckCircle2,
        feature: "billsFine",
      },
    ],
  },
  {
    label: "Team",
    items: [
      {
        label: "Live Monitor",
        href: "/monitor",
        icon: Radio,
        feature: "liveMonitor",
        permission: "monitor.view",
      },
      {
        label: "Team Status",
        href: "/monitor/team",
        icon: Activity,
        feature: "liveMonitor",
        permission: "monitor.roster",
      },
      { label: "Leaderboard", href: "/leaderboard", icon: Trophy, feature: "leaderboard" },
      { label: "Campaigns", href: "/campaigns", icon: Megaphone, feature: "campaigns" },
      {
        // Recordings and transcripts existed only as an unsearchable list at the
        // bottom of Reports — nobody could find a call, so effectively nobody
        // used them. They get their own destination.
        label: "Recordings",
        href: "/recordings",
        icon: Headphones,
        feature: "reports",
      },
      { label: "Reports", href: "/reports", icon: BarChart3, feature: "reports" },
      {
        // P2.10: the supervisor cockpit — today strip, pipeline leaks, rep
        // performance. Same permission as Reports; it IS reporting, live.
        label: "Command Center",
        href: "/command",
        icon: Compass,
        feature: "reports",
        permission: "reports.view",
      },
    ],
  },
  {
    label: "System",
    items: [
      { label: "AI Agent", href: "/ai-agent", icon: Sparkles, feature: "aiAgent" },
      {
        label: "Admin",
        href: "/admin",
        icon: Settings,
        permission: "admin.access",
      },
    ],
  },
];
