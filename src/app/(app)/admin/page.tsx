import { ShieldAlert } from "lucide-react";
import { AdminConsole } from "@/components/admin/admin-console";
import { EmptyState } from "@/components/shared/empty-state";
import { PageContainer, PageHeader } from "@/components/shared/page-header";
import { isAIConfigured } from "@/lib/ai/claude";
import { listAuditLog } from "@/lib/db/app-control";
import { emailConfigProblem, isEmailConfigured } from "@/lib/email/resend";
import { getLeadStats } from "@/lib/db/leads";
import { getPlatformPool } from "@/lib/dialer/rotation-server";
import { isElevenLabsConfigured } from "@/lib/elevenlabs";
import { listMembers, listOrgCompanies, getViewer } from "@/lib/org/membership";
import { topRepsForOrg } from "@/lib/org/top-reps";
import { isAdminConfigured } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { isSuperadmin } from "@/lib/superadmin";
import { isRestConfigured, isVoiceConfigured } from "@/lib/twilio";

export const metadata = { title: "Admin" };
export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const viewer = await getViewer();

  // Reps (and anyone without admin access) never see the admin surface.
  if (!viewer.org || !viewer.permissions.includes("admin.access")) {
    return (
      <PageContainer>
        <PageHeader title="Admin" description="Organization administration." />
        <EmptyState
          icon={ShieldAlert}
          title="Admin access required"
          description="You don’t have permission to manage this organization. Ask an owner or admin if you need access."
          action={{ label: "Back to dashboard", href: "/dashboard" }}
        />
      </PageContainer>
    );
  }

  const [members, companies, leadStats, audit, superadmin] = await Promise.all([
    viewer.permissions.includes("members.view")
      ? listMembers(viewer.org.id)
      : Promise.resolve([]),
    viewer.permissions.includes("companies.manage")
      ? listOrgCompanies(viewer.org.id)
      : Promise.resolve([]),
    getLeadStats(),
    viewer.permissions.includes("members.view")
      ? listAuditLog(viewer.org.id)
      : Promise.resolve([]),
    isSuperadmin(),
  ]);

  // Who currently holds the AI dialer through the top-rep rule rather than a
  // stored override. The Members tab needs this to report the TRUE state — its
  // per-rep AI toggle reads the permissions blob, which says nothing about a
  // rep the rule is granting, so without this it would show "off" for someone
  // who demonstrably has AI access.
  const topRepAccess = viewer.org.settings.ai.topRepAccess ?? 0;
  const canSeeMembers = viewer.permissions.includes("members.view");
  const autoAiUserIds = !canSeeMembers
    ? []
    : viewer.org.settings.ai.allRepAccess
      ? // Whole-floor switch: everyone holds it, so every row is auto-granted.
        members.map((m) => m.userId)
      : topRepAccess > 0
        ? (await topRepsForOrg(viewer.org.id, topRepAccess)).map((t) => t.userId)
        : [];

  const platformPool = getPlatformPool(viewer.org.settings);

  const integrations = [
    { name: "Supabase (accounts + database)", ok: isSupabaseConfigured(), detail: "Auth + per-account data persistence" },
    { name: "Claude API (intelligence)", ok: isAIConfigured(), detail: "Briefings, summaries, search, reporting" },
    { name: "ElevenLabs (AI voice agent)", ok: isElevenLabsConfigured(), detail: "AI conducts + records outbound calls" },
    { name: "Twilio Voice (browser SDK)", ok: isVoiceConfigured(), detail: "Access tokens & in-browser calling" },
    { name: "Twilio REST (parallel dial)", ok: isRestConfigured(), detail: "Server-orchestrated outbound calls" },
    { name: "Resend (email)", ok: isEmailConfigured(), detail: "Appointment notifications to the sales lead" },
  ];

  return (
    <PageContainer>
      <PageHeader
        title="Admin"
        description={`Manage ${viewer.org.name} — members, customization, companies, and data.`}
      />
      <AdminConsole
        org={viewer.org}
        role={viewer.role ?? "rep"}
        permissions={viewer.permissions}
        members={members}
        autoAiUserIds={autoAiUserIds}
        companies={companies}
        leadStats={leadStats}
        integrations={integrations}
        audit={audit}
        demo={viewer.isDemo}
        isSuperadmin={superadmin}
        platformPool={platformPool.pool}
        platformRotateEvery={platformPool.rotateEvery}
        platformPoolLocked={platformPool.isLocked}
        emailConfigured={isEmailConfigured()}
        emailProblem={emailConfigProblem()}
      />
    </PageContainer>
  );
}
