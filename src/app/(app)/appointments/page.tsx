import { CalendarCheck, Users } from "lucide-react";
import { AppointmentsView, type ApptPrefs } from "@/components/pipeline/appointments-view";
import { EmptyState } from "@/components/shared/empty-state";
import { PageContainer, PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { getAppointments } from "@/lib/db/pipeline";
import { getUiPreferences } from "@/lib/db/team";

export const metadata = { title: "Appointments" };
export const dynamic = "force-dynamic";

export default async function AppointmentsPage() {
  const [appts, uiPrefs] = await Promise.all([getAppointments(), getUiPreferences()]);

  if (appts.length === 0) {
    return (
      <PageContainer>
        <PageHeader
          title="Appointments"
          description="Account reviews scheduled across your reps and the AI agent."
        />
        <EmptyState
          icon={CalendarCheck}
          title="No appointments scheduled"
          description="Booked account reviews from your reps and the AI agent appear here automatically. AI proposals land in a review lane for you to approve."
          action={{ label: "Open the dialer", href: "/dialer" }}
        />
      </PageContainer>
    );
  }

  const teamWide = appts.some((a) => a.teamWide);
  const reps = teamWide
    ? [...new Set(appts.map((a) => a.repName).filter((r): r is string => Boolean(r)))].sort()
    : [];
  const prefs = (uiPrefs.appointments as ApptPrefs | undefined) ?? {};

  return (
    <PageContainer>
      <PageHeader
        title="Appointments"
        description="AI bookings arrive as proposals — approve, edit the time, or route a lead back to another disposition. Updates re-file the lead and correct reports."
      >
        {teamWide && (
          <Badge tone="primary" className="gap-1">
            <Users className="h-3 w-3" /> Team-wide
          </Badge>
        )}
      </PageHeader>

      <AppointmentsView appts={appts} teamWide={teamWide} reps={reps} prefs={prefs} />
    </PageContainer>
  );
}
