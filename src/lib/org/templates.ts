// Dialer specializations an organization can be configured for. Pure data so it
// can be shared by onboarding (create org) and the admin customization screen.

export interface DialerTemplate {
  value: string;
  label: string;
  blurb: string;
}

export const DIALER_TEMPLATES: DialerTemplate[] = [
  { value: "general", label: "General", blurb: "All-purpose AI auto-dialer." },
  { value: "solar", label: "Solar", blurb: "Residential solar resolution & sales." },
  { value: "insurance", label: "Insurance", blurb: "Policy quoting & renewals." },
  { value: "real_estate", label: "Real Estate", blurb: "Buyer & seller outreach." },
  { value: "home_services", label: "Home Services", blurb: "Estimates & scheduling." },
  { value: "healthcare", label: "Healthcare", blurb: "Appointment & intake calls." },
  { value: "finance", label: "Financial Services", blurb: "Lending & advisory outreach." },
  { value: "automotive", label: "Automotive", blurb: "Sales & service follow-ups." },
  { value: "recruiting", label: "Recruiting", blurb: "Candidate screening calls." },
  { value: "education", label: "Education", blurb: "Enrollment & admissions." },
];

export function templateLabel(value: string): string {
  return DIALER_TEMPLATES.find((t) => t.value === value)?.label ?? "General";
}
