import { CheckCircle2, XCircle } from "lucide-react";
import { UserManagement } from "@/components/admin/user-management";
import { CsvImport } from "@/components/leads/csv-import";
import { PageContainer, PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { isAIConfigured } from "@/lib/ai/claude";
import { getUser, userDisplay } from "@/lib/auth";
import { getLeadStats } from "@/lib/db/leads";
import { isElevenLabsConfigured } from "@/lib/elevenlabs";
import { isAdminConfigured } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { isRestConfigured, isVoiceConfigured } from "@/lib/twilio";

export const metadata = { title: "User Management" };
export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const [user, leadStats] = await Promise.all([getUser(), getLeadStats()]);
  const owner = user ? userDisplay(user) : null;

  const integrations = [
    { name: "Supabase (accounts + database)", ok: isSupabaseConfigured(), detail: "Auth + per-account data persistence" },
    { name: "Claude API (intelligence)", ok: isAIConfigured(), detail: "Briefings, summaries, search, reporting" },
    { name: "ElevenLabs (AI voice agent)", ok: isElevenLabsConfigured(), detail: "AI conducts + records outbound calls" },
    { name: "Twilio Voice (browser SDK)", ok: isVoiceConfigured(), detail: "Access tokens & in-browser calling" },
    { name: "Twilio REST (parallel dial)", ok: isRestConfigured(), detail: "Server-orchestrated outbound calls" },
  ];

  return (
    <PageContainer>
      <PageHeader
        title="User Management"
        description="Manage who can access the floor — roles, access levels, and granular permissions — plus your integrations and lead imports."
      />

      {/* Users & access — the primary admin surface */}
      <Card className="p-5">
        <UserManagement owner={owner} adminConfigured={isAdminConfigured()} />
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <SectionCard title="Integrations" description="Connection health" className="lg:col-span-1">
          <div className="space-y-3">
            {integrations.map((it) => (
              <div key={it.name} className="flex items-start gap-3 rounded-xl border border-border p-3">
                {it.ok ? (
                  <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" />
                ) : (
                  <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">{it.name}</p>
                  <p className="text-xs text-muted-foreground">{it.detail}</p>
                </div>
                <Badge tone={it.ok ? "success" : "warning"}>{it.ok ? "Connected" : "Off"}</Badge>
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard
          title="Import leads"
          description={`${leadStats.total.toLocaleString()} leads in your account`}
          className="lg:col-span-2"
        >
          <CsvImport variant="dropzone" />
          <div className="mt-4 grid grid-cols-2 gap-3 text-center sm:grid-cols-4">
            {[
              ["Total", leadStats.total],
              ["Qualified", leadStats.qualified],
              ["Appointments", leadStats.appointments],
              ["Avg AI score", leadStats.avgScore],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl bg-muted p-3">
                <p className="text-lg font-bold tabular">{value}</p>
                <p className="text-[11px] text-muted-foreground">{label}</p>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>
    </PageContainer>
  );
}
