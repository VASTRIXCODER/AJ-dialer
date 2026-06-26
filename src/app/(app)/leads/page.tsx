import { Download, FolderOpen, User as UserIcon, Users } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { LeadsTable } from "@/components/leads/leads-table";
import { CsvImport } from "@/components/leads/csv-import";
import { MetricCard } from "@/components/dashboard/metric-card";
import { EmptyState } from "@/components/shared/empty-state";
import { PageContainer, PageHeader } from "@/components/shared/page-header";
import { Button, buttonVariants } from "@/components/ui/button";
import { CalendarCheck, Sparkles, Zap } from "lucide-react";
import { getLeads, getOrgPoolLeads } from "@/lib/db/leads";
import { getCampaigns } from "@/lib/db/pipeline";
import { getViewer, listMembers } from "@/lib/org/membership";
import { cn, formatNumber } from "@/lib/utils";

export const metadata = { title: "Leads" };
export const dynamic = "force-dynamic";

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const [{ view }, campaigns, viewer] = await Promise.all([
    searchParams,
    getCampaigns(),
    getViewer(),
  ]);
  // Lead management (delete / reassign) is for managers+ (leads.import). Pull the
  // org's members so a supervisor can reassign leads between accounts.
  const canManage = viewer.permissions.includes("leads.import");

  // Org-level gate: when leadsRepAccess is false, reps are blocked from the
  // Leads tab entirely (managers+ are unaffected). All other orgs leave this
  // flag at its default of true so nothing changes for them.
  const leadsRepAccess = viewer.org?.settings.features.leadsRepAccess !== false;
  if (!leadsRepAccess && !canManage) {
    redirect("/dashboard");
  }
  // Reps see their own leads by default but can browse the shared "Org pool" to
  // claim leads to their own name. Supervisors already see the org-wide pool.
  const isRep = !canManage && Boolean(viewer.org);
  const poolMode = isRep && view === "pool";
  const leads = poolMode ? await getOrgPoolLeads() : await getLeads();
  const members =
    canManage && viewer.org
      ? (await listMembers(viewer.org.id)).map((m) => ({ id: m.userId, name: m.name }))
      : [];
  const campaignList = campaigns
    .filter((c) => c.status !== "completed")
    .map((c) => ({ id: c.id, name: c.name }));
  const qualified = leads.filter(
    (l) => l.status === "qualified" || l.status === "appointment",
  ).length;
  const appointmentsCount = leads.filter(
    (l) => l.status === "appointment",
  ).length;
  const avgScore = leads.length
    ? Math.round(leads.reduce((a, l) => a + (l.aiScore ?? 0), 0) / leads.length)
    : 0;

  const header = (
    <PageHeader
      title="Leads"
      description="Every homeowner in your pipeline, scored and ready to dial."
    >
      <CsvImport variant="button" campaigns={campaignList} />
      <Button variant="outline" size="sm" className="gap-2">
        <Download className="h-4 w-4" />
        Export
      </Button>
    </PageHeader>
  );

  // Reps get a "My leads / Org pool" switch — the pool is where they claim leads
  // to their own name. Shown in both the empty and populated states.
  const poolToggle = isRep ? (
    <div className="flex w-fit items-center gap-1 rounded-xl border border-border bg-card p-1">
      <Link
        href="/leads"
        className={cn(
          buttonVariants({ size: "sm", variant: poolMode ? "ghost" : "primary" }),
          "gap-1.5",
        )}
      >
        <UserIcon className="h-4 w-4" />
        My leads
      </Link>
      <Link
        href="/leads?view=pool"
        className={cn(
          buttonVariants({ size: "sm", variant: poolMode ? "primary" : "ghost" }),
          "gap-1.5",
        )}
      >
        <FolderOpen className="h-4 w-4" />
        Org pool
      </Link>
    </div>
  ) : null;

  if (leads.length === 0) {
    return (
      <PageContainer>
        {header}
        {poolToggle}
        <EmptyState
          icon={Users}
          title={poolMode ? "The org pool is empty" : "No leads yet"}
          description={
            poolMode
              ? "There are no shared leads to claim right now."
              : "Import a CSV or connect your CRM to start building your dialing queue."
          }
          action={poolMode ? undefined : { label: "Import leads", href: "/admin" }}
        />
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      {header}
      {poolToggle}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MetricCard label="Total leads" value={formatNumber(leads.length)} icon={Users} accent="primary" />
        <MetricCard label="Qualified" value={formatNumber(qualified)} icon={Zap} accent="success" />
        <MetricCard label="Appointments" value={formatNumber(appointmentsCount)} icon={CalendarCheck} accent="accent" />
        <MetricCard label="Avg AI score" value={String(avgScore)} icon={Sparkles} accent="warning" />
      </div>

      <LeadsTable
        leads={leads}
        campaigns={campaignList}
        canManage={canManage}
        meId={viewer.user?.id ?? null}
        members={members}
        poolMode={poolMode}
      />
    </PageContainer>
  );
}
