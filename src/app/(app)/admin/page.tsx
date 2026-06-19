import {
  CheckCircle2,
  CreditCard,
  FileSpreadsheet,
  Phone,
  Plus,
  Shield,
  UploadCloud,
  UserPlus,
  XCircle,
} from "lucide-react";
import { PageContainer, PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { reps } from "@/lib/data";
import { repStatusConfig } from "@/lib/status";
import { isRestConfigured, isVoiceConfigured } from "@/lib/twilio";

export const metadata = { title: "Admin" };

export default function AdminPage() {
  const voice = isVoiceConfigured();
  const rest = isRestConfigured();

  const integrations = [
    { name: "Twilio Voice (browser SDK)", ok: voice, detail: "Access tokens & in-browser calling" },
    { name: "Twilio REST (parallel dial)", ok: rest, detail: "Server-orchestrated outbound calls" },
    { name: "Call recording", ok: voice, detail: "Dual-channel recordings + callbacks" },
  ];

  return (
    <PageContainer>
      <PageHeader
        title="Administration"
        description="Manage users, campaigns, billing, and platform integrations."
      >
        <Button size="sm" className="gap-2">
          <Plus className="h-4 w-4" />
          New user
        </Button>
      </PageHeader>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Integrations / Twilio status */}
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
                  {it.ok ? "Connected" : "Demo"}
                </Badge>
              </div>
            ))}
          </div>
          {!voice && (
            <p className="mt-4 flex items-start gap-2 rounded-xl bg-warning/10 p-3 text-xs text-warning">
              <Phone className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Add Twilio credentials to <code className="font-mono">.env.local</code> to place live calls. Until then the dialer runs in full simulation mode.
            </p>
          )}
        </SectionCard>

        {/* CSV upload */}
        <SectionCard
          title="Import leads"
          description="Upload a CSV to a campaign"
          className="lg:col-span-2"
        >
          <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-border bg-muted/30 p-10 text-center transition-colors hover:border-primary/40 hover:bg-primary-soft/30">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-solar text-white shadow-glow">
              <UploadCloud className="h-7 w-7" />
            </div>
            <p className="mt-4 font-semibold">Drop your CSV here</p>
            <p className="mt-1 text-sm text-muted-foreground">
              or click to browse — we’ll map columns automatically
            </p>
            <Button variant="outline" size="sm" className="mt-4 gap-2">
              <FileSpreadsheet className="h-4 w-4" />
              Choose file
            </Button>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-3 text-center">
            {["Smart column mapping", "Dedupe on phone", "DNC scrubbing"].map((f) => (
              <div key={f} className="rounded-xl bg-muted p-3 text-xs font-medium text-muted-foreground">
                {f}
              </div>
            ))}
          </div>
        </SectionCard>
      </div>

      {/* Users table */}
      <SectionCard
        title="Team members"
        description={`${reps.length} users · role-based permissions`}
        action={{ label: "Manage roles", href: "/admin" }}
        bodyClassName="p-0"
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <th className="px-5 py-3">User</th>
                <th className="px-5 py-3">Team</th>
                <th className="px-5 py-3">Role</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3 text-right">Calls today</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {reps.length === 0 && (
                <tr>
                  <td
                    colSpan={5}
                    className="px-5 py-10 text-center text-sm text-muted-foreground"
                  >
                    No team members yet — invite your team to get started.
                  </td>
                </tr>
              )}
              {reps.map((rep) => {
                const cfg = repStatusConfig[rep.status];
                return (
                  <tr key={rep.id} className="transition-colors hover:bg-muted/40">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2.5">
                        <Avatar initials={rep.initials} color={rep.avatarColor} size="sm" />
                        <div>
                          <p className="font-semibold">{rep.name}</p>
                          <p className="text-xs text-muted-foreground">{rep.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3 text-muted-foreground">{rep.team}</td>
                    <td className="px-5 py-3">
                      <Badge tone="outline" className="capitalize">
                        <Shield className="h-3 w-3" />
                        {rep.role}
                      </Badge>
                    </td>
                    <td className="px-5 py-3">
                      <Badge tone={cfg.tone} dot>
                        {cfg.label}
                      </Badge>
                    </td>
                    <td className="px-5 py-3 text-right font-semibold tabular">
                      {rep.callsToday}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </SectionCard>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="flex items-center gap-4 p-5">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary-soft text-primary">
            <CreditCard className="h-6 w-6" />
          </div>
          <div className="flex-1">
            <p className="font-semibold">Billing</p>
            <p className="text-sm text-muted-foreground">
              {reps.length} active reps · $15/rep/mo + AI agent
            </p>
          </div>
          <Button variant="outline" size="sm">
            Manage
          </Button>
        </Card>
        <Card className="flex items-center gap-4 p-5">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent-soft text-accent">
            <UserPlus className="h-6 w-6" />
          </div>
          <div className="flex-1">
            <p className="font-semibold">Invite your team</p>
            <p className="text-sm text-muted-foreground">
              Send invites and assign campaigns in seconds
            </p>
          </div>
          <Button variant="outline" size="sm">
            Invite
          </Button>
        </Card>
      </div>
    </PageContainer>
  );
}
