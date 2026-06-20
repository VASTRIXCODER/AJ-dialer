import { CheckCircle2, Shield, Users, XCircle } from "lucide-react";
import { InviteTeammate } from "@/components/admin/invite-teammate";
import { CsvImport } from "@/components/leads/csv-import";
import { PageContainer, PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { isAIConfigured } from "@/lib/ai/claude";
import { getLeadStats } from "@/lib/db/leads";
import { getTeam } from "@/lib/db/team";
import { isElevenLabsConfigured } from "@/lib/elevenlabs";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { isAdminConfigured } from "@/lib/supabase/admin";
import { isRestConfigured, isVoiceConfigured } from "@/lib/twilio";
import { initials } from "@/lib/utils";

export const metadata = { title: "Admin" };
export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const [team, leadStats] = await Promise.all([getTeam(), getLeadStats()]);

  const integrations = [
    {
      name: "Supabase (accounts + database)",
      ok: isSupabaseConfigured(),
      detail: "Auth + per-account data persistence",
    },
    {
      name: "Claude API (intelligence)",
      ok: isAIConfigured(),
      detail: "Briefings, summaries, search, reporting",
    },
    {
      name: "ElevenLabs (AI voice agent)",
      ok: isElevenLabsConfigured(),
      detail: "AI conducts + records outbound calls",
    },
    {
      name: "Twilio Voice (browser SDK)",
      ok: isVoiceConfigured(),
      detail: "Access tokens & in-browser calling",
    },
    {
      name: "Twilio REST (parallel dial)",
      ok: isRestConfigured(),
      detail: "Server-orchestrated outbound calls",
    },
  ];

  return (
    <PageContainer>
      <PageHeader
        title="Administration"
        description="Connections, lead imports, and your team — all in one place."
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <SectionCard
          title="Integrations"
          description="Connection health"
          className="lg:col-span-1"
        >
          <div className="space-y-3">
            {integrations.map((it) => (
              <div
                key={it.name}
                className="flex items-start gap-3 rounded-xl border border-border p-3"
              >
                {it.ok ? (
                  <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" />
                ) : (
                  <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">{it.name}</p>
                  <p className="text-xs text-muted-foreground">{it.detail}</p>
                </div>
                <Badge tone={it.ok ? "success" : "warning"}>
                  {it.ok ? "Connected" : "Off"}
                </Badge>
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

      <SectionCard
        title="Team members"
        description={`${team.length || 1} ${team.length === 1 ? "member" : "members"} · role-based access`}
        bodyClassName="p-0"
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <th className="px-5 py-3">User</th>
                <th className="px-5 py-3">Team</th>
                <th className="px-5 py-3">Role</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {team.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-5 py-8 text-center text-sm text-muted-foreground">
                    Sign in with Supabase connected to manage your team.
                  </td>
                </tr>
              )}
              {team.map((m) => (
                <tr key={m.id} className="transition-colors hover:bg-muted/40">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2.5">
                      <Avatar initials={initials(m.name)} color={m.avatarColor} size="sm" />
                      <div>
                        <p className="font-semibold">{m.name}</p>
                        <p className="text-xs text-muted-foreground">{m.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-3 text-muted-foreground">{m.team}</td>
                  <td className="px-5 py-3">
                    <Badge tone="outline" className="capitalize">
                      <Shield className="h-3 w-3" />
                      {m.role}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>

      <SectionCard
        title="Invite your team"
        description={
          isAdminConfigured()
            ? "Send a Supabase invite email to add a teammate."
            : "Add SUPABASE_SERVICE_ROLE_KEY to enable email invites."
        }
      >
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
            <Users className="h-5 w-5" />
          </span>
          <div className="flex-1">
            <InviteTeammate />
          </div>
        </div>
      </SectionCard>
    </PageContainer>
  );
}
