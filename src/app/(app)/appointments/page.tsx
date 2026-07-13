import { CalendarCheck, Lock, Users } from "lucide-react";
import { Suspense } from "react";
import {
  AppointmentsWorkspace,
  type FailedNotice,
} from "@/components/appointments/appointments-workspace";
import type { ApptAccess, ApptPrefs } from "@/components/appointments/shared";
import { EmptyState } from "@/components/shared/empty-state";
import { PageContainer, PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { getAppointments } from "@/lib/db/pipeline";
import { getUiPreferences } from "@/lib/db/team";
import { listFailedNotifications } from "@/lib/notifications/outbox";
import { getViewer, listMembers } from "@/lib/org/membership";

export const metadata = { title: "Appointments" };
export const dynamic = "force-dynamic";

export default async function AppointmentsPage() {
  const viewer = await getViewer();

  // The nav already hides this, but a page must never trust the nav — a URL is
  // typed, bookmarked and shared. (The writes are gated independently, in
  // /api/pipeline and src/lib/db/appointments.ts — that's what makes revoking
  // the permission actually mean something. See ticket 7.2.)
  if (!viewer.permissions.includes("appointments.view")) {
    return (
      <PageContainer>
        <PageHeader title="Appointments" description="Account reviews across your reps and the AI agent." />
        <EmptyState
          icon={Lock}
          title="You don't have access to the calendar"
          description="Your role doesn't include appointment access. An owner or admin can grant it in Admin → Members."
        />
      </PageContainer>
    );
  }

  const canTeam = viewer.permissions.includes("appointments.team");

  const [appts, uiPrefs, members, failedRows] = await Promise.all([
    getAppointments(),
    getUiPreferences(),
    canTeam && viewer.org?.id ? listMembers(viewer.org.id) : Promise.resolve([]),
    viewer.permissions.includes("appointments.manage")
      ? listFailedNotifications(viewer.org?.id ?? null)
      : Promise.resolve([]),
  ]);

  const access: ApptAccess = {
    canManage: viewer.permissions.includes("appointments.manage"),
    canTeam,
    meId: viewer.user?.id ?? null,
  };

  const failed: FailedNotice[] = failedRows.map((f) => ({
    id: f.id,
    appointmentId: f.appointmentId,
    leadName: f.leadName,
    lastError: f.lastError,
    attempts: f.attempts,
  }));

  if (appts.length === 0 && failed.length === 0) {
    return (
      <PageContainer>
        <PageHeader
          title="Appointments"
          description="Account reviews scheduled across your reps and the AI agent."
        />
        <EmptyState
          icon={CalendarCheck}
          title="No appointments scheduled"
          description="Booked account reviews from your reps and the AI agent appear here automatically — on a real calendar you can drag, reschedule and plan around. AI proposals land in a review lane for you to approve first."
          action={{ label: "Open the dialer", href: "/dialer" }}
        />
      </PageContainer>
    );
  }

  const reps = canTeam
    ? [...new Set(appts.map((a) => a.repName).filter((r): r is string => Boolean(r)))].sort()
    : [];

  const repOptions = members
    .filter((m) => m.status === "active")
    .map((m) => ({ id: m.userId, name: m.name || m.email || "Rep" }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const prefs = (uiPrefs.appointments as ApptPrefs | undefined) ?? {};

  return (
    <PageContainer>
      <PageHeader
        title="Appointments"
        description="Plan on the calendar, triage in the list. AI bookings arrive as proposals — approve, move, or route the lead back to another disposition."
      >
        {canTeam && (
          <Badge tone="primary" className="gap-1">
            <Users className="h-3 w-3" /> Team-wide
          </Badge>
        )}
      </PageHeader>

      {/* useSearchParams (the ?v= / ?d= deep link) needs a Suspense boundary. */}
      <Suspense fallback={null}>
        <AppointmentsWorkspace
          appts={appts}
          access={access}
          reps={reps}
          repOptions={repOptions}
          prefs={prefs}
          failed={failed}
        />
      </Suspense>
    </PageContainer>
  );
}
