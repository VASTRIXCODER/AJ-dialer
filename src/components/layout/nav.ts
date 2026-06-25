import {
  BarChart3,
  CalendarCheck,
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
import type { Permission } from "@/lib/permissions";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  badge?: string;
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
      { label: "Leads", href: "/leads", icon: Users, feature: "leads" },
      { label: "Appointments", href: "/appointments", icon: CalendarCheck, feature: "appointments" },
      { label: "Callbacks", href: "/callbacks", icon: PhoneIncoming, feature: "callbacks" },
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
      { label: "Leaderboard", href: "/leaderboard", icon: Trophy, feature: "leaderboard" },
      { label: "Campaigns", href: "/campaigns", icon: Megaphone, feature: "campaigns" },
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
