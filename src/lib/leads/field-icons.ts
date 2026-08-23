import {
  BatteryCharging,
  Building2,
  CalendarDays,
  Car,
  CircleEllipsis,
  DollarSign,
  Home,
  Link2,
  Mail,
  Phone,
  ShieldCheck,
  Users,
  Waves,
  type LucideIcon,
} from "lucide-react";
import type { LeadFieldDef } from "./field-schema";

// ─────────────────────────────────────────────────────────────────────────────
// One icon vocabulary for lead fields, shared by the dialer's qualify toggles
// and the Reports insight panel — they had drifted into two, so the same field
// wore different icons on two screens of the same product.
//
// Icons are chosen from the LABEL, not the storage key: the key `hasBattery` is
// a solar-era slot name that an insurance org relabels "Bundle interest" and a
// recruiter relabels "Actively looking". Matching on the key would have pinned a
// battery icon to both.
// ─────────────────────────────────────────────────────────────────────────────

const LABEL_ICONS: [RegExp, LucideIcon][] = [
  [/\b(ev|electric vehicle|vehicle|car|trade-?in|test drive)\b/i, Car],
  [/\bpool\b/i, Waves],
  [/\b(battery|storage|solar)\b/i, BatteryCharging],
  [/\b(home ?owner|owns home|home|property|mortgage)\b/i, Home],
  [/\b(insur|policy|cover|bundle|warranty|maintenance)\b/i, ShieldCheck],
  [/\b(provider|carrier|lender|school|employer|company)\b/i, Building2],
  [/\b(parent|contact|referral|family|patient|candidate)\b/i, Users],
];

/** The icon to show beside a lead field, chosen from its (org-specific) label. */
export function fieldIcon(field: Pick<LeadFieldDef, "label" | "type">): LucideIcon {
  for (const [pattern, icon] of LABEL_ICONS) {
    if (pattern.test(field.label)) return icon;
  }
  switch (field.type) {
    case "currency":
      return DollarSign;
    case "date":
      return CalendarDays;
    case "phone":
      return Phone;
    case "email":
      return Mail;
    case "url":
      return Link2;
    default:
      return CircleEllipsis;
  }
}
