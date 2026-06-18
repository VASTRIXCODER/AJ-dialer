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

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  badge?: string;
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
      { label: "Power Dialer", href: "/dialer", icon: PhoneCall, badge: "Live" },
      { label: "Leads", href: "/leads", icon: Users },
      { label: "Appointments", href: "/appointments", icon: CalendarCheck },
      { label: "Callbacks", href: "/callbacks", icon: PhoneIncoming, badge: "3" },
    ],
  },
  {
    label: "Team",
    items: [
      { label: "Live Monitor", href: "/monitor", icon: Radio },
      { label: "Leaderboard", href: "/leaderboard", icon: Trophy },
      { label: "Campaigns", href: "/campaigns", icon: Megaphone },
      { label: "Reports", href: "/reports", icon: BarChart3 },
    ],
  },
  {
    label: "System",
    items: [
      { label: "AI Agent", href: "/ai-agent", icon: Sparkles },
      { label: "Admin", href: "/admin", icon: Settings },
    ],
  },
];
