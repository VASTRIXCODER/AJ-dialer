import {
  Activity,
  BarChart3,
  CalendarCheck,
  CheckCircle2,
  Headphones,
  LayoutDashboard,
  type LucideIcon,
  Megaphone,
  PhoneCall,
  PhoneIncoming,
  Radio,
  Settings,
  Sparkles,
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

export const navGroups: NavGroup[] = [
  {
    label: "Workspace",
    items: [
      { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
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
        label: "Appointments",
        href: "/appointments",
        icon: CalendarCheck,
        feature: "appointments",
        permission: "appointments.view",
      },
      { label: "Callbacks", href: "/callbacks", icon: PhoneIncoming, feature: "callbacks" },
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
