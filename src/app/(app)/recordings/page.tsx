import { Headphones, Users } from "lucide-react";
import { CallArchive } from "@/components/calls/call-archive";
import { PageContainer, PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { getViewer, listMembers } from "@/lib/org/membership";
import { isSupervisorRole } from "@/lib/permissions";

export const metadata = { title: "Recordings & transcripts" };
export const dynamic = "force-dynamic";

/**
 * The call archive.
 *
 * Recordings and transcripts existed before this page, but only as a row you
 * could click inside an unfiltered list at the bottom of Reports — no search, no
 * date range, no way to find a call by what was said on it, and no way to get a
 * transcript out of the browser. This is the surface that makes them findable:
 * one searchable, filterable archive over every call the viewer may see.
 */
export default async function RecordingsPage({
  searchParams,
}: {
  searchParams: Promise<{ call?: string | string[] }>;
}) {
  const [viewer, sp] = await Promise.all([getViewer(), searchParams]);

  // Supervisors can narrow the archive to one rep; a rep only ever sees their
  // own calls, so the picker would be a control with one option.
  const supervisor = Boolean(
    isSupervisorRole(viewer.role),
  );
  const members =
    supervisor && viewer.org?.id ? await listMembers(viewer.org.id) : [];
  const reps = members
    .filter((m) => m.userId && m.status === "active")
    .map((m) => ({ id: m.userId, name: m.name || m.email || "Rep" }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const raw = sp.call;
  const initialCallId = (Array.isArray(raw) ? raw[0] : raw) ?? null;

  return (
    <PageContainer>
      <PageHeader
        title="Recordings & transcripts"
        description="Every call your team has made — searchable by name, number, notes, and what was actually said."
      >
        <Badge tone={supervisor ? "primary" : "neutral"} className="gap-1">
          {supervisor ? <Users className="h-3 w-3" /> : <Headphones className="h-3 w-3" />}
          {supervisor ? "Team-wide" : "Your calls"}
        </Badge>
      </PageHeader>

      <CallArchive reps={reps} canSeeReps={supervisor} initialCallId={initialCallId} />
    </PageContainer>
  );
}
