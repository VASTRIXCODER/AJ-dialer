import {
  ArrowLeft,
  CalendarCheck,
  Pencil,
  PhoneCall,
  PhoneOutgoing,
  Target,
  Users,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CampaignFunnel, type FunnelStageView } from "@/components/campaigns/campaign-funnel";
import { MetricCard } from "@/components/dashboard/metric-card";
import { LeadOpenLink } from "@/components/leads/lead-360/lead-open-link";
import { ReportFunnel } from "@/components/reports/report-sections";
import { PageContainer, PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  FUNNEL_STAGES,
  FUNNEL_STAGE_META,
  stageFilter,
} from "@/lib/campaign-policy";
import { isScriptTestRunning } from "@/lib/campaign-scripts";
import { getLeadsPage } from "@/lib/db/leads";
import { getCampaign, getCampaignFunnel, getCampaignRecentCalls } from "@/lib/db/pipeline";
import { encodeFilterParam } from "@/lib/leads/filter-spec";
import { getViewer } from "@/lib/org/membership";
import { orgVocabulary } from "@/lib/org/vocabulary";
import {
  campaignStatusConfig,
  resolveLeadStatusConfig,
  resolveOutcomeConfig,
} from "@/lib/status";
import {
  cn,
  formatDuration,
  formatNumber,
  leadDisplayName,
  relativeTime,
} from "@/lib/utils";
import { CELL } from "@/lib/ui-density";

export const dynamic = "force-dynamic";

export default async function CampaignDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [viewer, [c, leadsPage, recentCalls]] = await Promise.all([
    getViewer(),
    Promise.all([
      getCampaign(id),
      getLeadsPage({ page: 1, pageSize: 25, campaignId: id }),
      getCampaignRecentCalls(id),
    ]),
  ]);
  if (!c) notFound();
  // Accurate, mutually-exclusive current-state buckets (one RPC scan). After
  // the campaign check so a bad id 404s without paying for the scan.
  const funnel = await getCampaignFunnel(viewer.org?.id ?? null, id);

  // The workspace's own nouns and disposition wording.
  const vocab = orgVocabulary(viewer.org);
  const leadStatusConfig = resolveLeadStatusConfig(vocab);
  const outcomeConfig = resolveOutcomeConfig(vocab);

  // Every funnel segment drills into /leads?f=… — the stage's FilterSpec is
  // encoded server-side so the link IS the filter that ran (stageFilter maps
  // each bucket to the closest spec; call-derived buckets carry a tooltip).
  const funnelStages: FunnelStageView[] = FUNNEL_STAGES.map((key) => {
    const meta = FUNNEL_STAGE_META[key];
    const spec = stageFilter(id, key, { maxAttempts: c.retryPolicy?.maxAttempts });
    return {
      key,
      // The appointment stage speaks the workspace's own noun.
      label:
        key === "appointment"
          ? vocab.appointmentNounPlural.charAt(0).toUpperCase() +
            vocab.appointmentNounPlural.slice(1)
          : meta.label,
      description: meta.description,
      approximate: meta.approximate,
      count: funnel[key],
      href: `/leads?f=${encodeFilterParam(spec)}`,
    };
  });

  const st = c.stats;
  const cfg = campaignStatusConfig[c.status];
  const apptRate = st.connects
    ? Math.round((st.appointments / st.connects) * 1000) / 10
    : 0;
  // Show the A/B split while a test is running, and keep showing it for
  // campaigns with historical variant rows even after a script was cleared.
  const scriptTest = c.scriptTest;
  const showScriptTest =
    isScriptTestRunning(c) || scriptTest.a.calls > 0 || scriptTest.b.calls > 0;

  return (
    <PageContainer>
      <Link
        href="/campaigns"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        All campaigns
      </Link>

      <div className="flex items-center gap-3">
        <span className="h-10 w-2 rounded-full" style={{ background: c.color }} />
        {/* Vertical-neutral: the description (or targeting value) speaks for the
            campaign — never one industry's noun. */}
        <PageHeader
          title={c.name}
          description={c.description || c.objective || c.utilityProvider || "All segments"}
        >
          <Badge tone={cfg.tone} dot>
            {cfg.label}
          </Badge>
          {c.archivedAt && <Badge tone="warning">Archived</Badge>}
          <Link
            href={`/campaigns/${c.id}/edit`}
            className={buttonVariants({ variant: "outline", size: "sm", className: "gap-2" })}
          >
            <Pencil className="h-4 w-4" />
            Edit campaign
          </Link>
          <Link
            href={`/dialer?campaign=${c.id}`}
            className={buttonVariants({ size: "sm", className: "gap-2" })}
          >
            <PhoneCall className="h-4 w-4" />
            Dial this campaign
          </Link>
        </PageHeader>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        {/* Three of the five reasons these carried no definitionKey are now
            gone, and the fixes are recorded here because the reasons were:

              · they were computed over a CAPPED, id-ordered prefix of the org's
                call history — an arbitrary sample, since `id` is a random uuid.
                Now counted in SQL (app_campaign_call_counts), no ceiling.
              · "Contacted" was `status !== "new"`, which counted a lead
                imported straight onto the do-not-call list as somebody the
                floor had spoken to. Now `last_contacted_at`, the same signal
                the Assignments board uses.
              · "Connect rate" was the one connect rate in the product that did
                not go through isConnectedRecord. Now it does.

            Two remain, and both are about what the LABELS claim rather than
            what the math does: the scope is org-wide for every viewer including
            a plain rep (campaigns are shared, but `scope="campaign"` does not
            disclose that), and "Dialable status" counts a status without
            re-checking DNC or the calling window — which is why it is named
            after the status rather than after readiness to dial. */}
        <MetricCard
          label="Leads"
          value={formatNumber(st.totalLeads)}
          window="all_time"
          scope="campaign"
          icon={Users}
          accent="primary"
        />
        <MetricCard
          label="Dialable status"
          // Named after what it counts. It is a status test — it does not
          // re-check the do-not-call list, the calling window, or whether the
          // number has ten digits, all of which the dialer applies at load.
          // "Dialable" promised a readiness this number does not measure.
          sub="not re-checked against DNC"
          value={formatNumber(st.dialableLeads)}
          window="current"
          scope="campaign"
          icon={PhoneOutgoing}
          accent="accent"
        />
        <MetricCard
          label="Contacted"
          value={formatNumber(st.contactedLeads)}
          window="current"
          scope="campaign"
          icon={Users}
          accent="primary"
        />
        <MetricCard
          label="Calls"
          value={formatNumber(st.calls)}
          window="all_time"
          scope="campaign"
          icon={PhoneCall}
          accent="warning"
        />
        <MetricCard
          label="Connect rate"
          value={`${st.connectRate}%`}
          window="all_time"
          scope="campaign"
          icon={Zap}
          accent="accent"
        />
        <MetricCard
          label="Appointments"
          value={formatNumber(st.appointments)}
          window="all_time"
          scope="campaign"
          icon={CalendarCheck}
          accent="success"
        />
      </div>

      <SectionCard
        title="Campaign funnel"
        description={`Where every ${vocab.leadNoun} stands right now — mutually-exclusive stages, each one a click into the ${vocab.LeadNounPlural} view.`}
      >
        <CampaignFunnel stages={funnelStages} total={funnel.total} />
      </SectionCard>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <SectionCard title="Conversion funnel" description="Calls → connects → appointments">
          <ReportFunnel
            funnel={{
              dials: st.calls,
              connects: st.connects,
              appointments: st.appointments,
              connectRate: st.connectRate,
              apptRate,
            }}
          />
        </SectionCard>

        <SectionCard title="Lead pipeline" description="How this campaign's leads are progressing">
          <div className="space-y-3">
            <PipeRow label="Total leads" value={st.totalLeads} of={st.totalLeads} icon={Users} />
            <PipeRow label="Contacted" value={st.contactedLeads} of={st.totalLeads} icon={PhoneCall} />
            <PipeRow label="Still dialable" value={st.dialableLeads} of={st.totalLeads} icon={PhoneOutgoing} />
            <PipeRow label="Appointments" value={st.appointments} of={st.totalLeads} icon={Target} />
          </div>
          {st.totalLeads === 0 && (
            <p className="mt-3 text-sm text-muted-foreground">
              No leads assigned yet — assign some from the Leads tab or on CSV import.
            </p>
          )}
        </SectionCard>
      </div>

      {showScriptTest && (
        <SectionCard
          title="Script test"
          description="A vs B across calls where a script was shown — auto-filed calls (e.g. parallel-dial no-answers) carry no variant and sit outside this split."
        >
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className={cn(CELL, "font-semibold")}>Variant</th>
                  <th className={cn(CELL, "font-semibold")}>Calls</th>
                  <th className={cn(CELL, "font-semibold")}>Connects</th>
                  <th className={cn(CELL, "font-semibold")}>Connect rate</th>
                  <th className={cn(CELL, "font-semibold")}>Appointments</th>
                  <th className={cn(CELL, "font-semibold")}>Appt rate</th>
                </tr>
              </thead>
              <tbody>
                {(["a", "b"] as const).map((v) => {
                  const vs = scriptTest[v];
                  return (
                    <tr key={v} className="border-b border-border/60 last:border-0">
                      <td className={cn(CELL)}>
                        <Badge tone={v === "a" ? "primary" : "accent"}>
                          Script {v.toUpperCase()}
                        </Badge>
                      </td>
                      <td className={cn(CELL, "tabular")}>{formatNumber(vs.calls)}</td>
                      <td className={cn(CELL, "tabular")}>{formatNumber(vs.connects)}</td>
                      <td className={cn(CELL, "tabular")}>{vs.connectRate}%</td>
                      <td className={cn(CELL, "tabular")}>{formatNumber(vs.appointments)}</td>
                      <td className={cn(CELL, "tabular")}>{vs.apptRate}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {scriptTest.a.calls === 0 && scriptTest.b.calls === 0 && (
            <p className="mt-3 text-sm text-muted-foreground">
              No scripted calls yet — dial this campaign and dispositions will split here.
            </p>
          )}
        </SectionCard>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <SectionCard
          className="lg:col-span-2"
          title="Leads in this campaign"
          description={
            leadsPage.total > leadsPage.leads.length
              ? `Showing ${leadsPage.leads.length} of ${formatNumber(leadsPage.total)}`
              : `${formatNumber(leadsPage.total)} assigned`
          }
          action={{ label: "View all in Leads", href: `/leads?campaign=${c.id}` }}
        >
          {leadsPage.leads.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No leads assigned yet — select some in the Leads tab and assign them to this
              campaign.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className={cn(CELL, "font-semibold")}>Lead</th>
                    <th className={cn(CELL, "font-semibold")}>Status</th>
                    <th className={cn(CELL, "font-semibold")}>AI score</th>
                    <th className={cn(CELL, "font-semibold")}>Last contacted</th>
                  </tr>
                </thead>
                <tbody>
                  {leadsPage.leads.map((l) => {
                    const lc = leadStatusConfig[l.status];
                    return (
                      <tr key={l.id} className="border-b border-border/60 last:border-0">
                        <td className={cn(CELL, "max-w-[220px] font-medium")}>
                          {/* Name → Lead 360, over this page. */}
                          <LeadOpenLink leadId={l.id}>
                            {leadDisplayName(`${l.firstName} ${l.lastName}`, l.phone, vocab.leadNoun)}
                          </LeadOpenLink>
                        </td>
                        <td className={cn(CELL)}>
                          <Badge tone={lc.tone} icon={lc.icon}>{lc.label}</Badge>
                        </td>
                        <td className={cn(CELL, "tabular")}>{l.aiScore ?? "—"}</td>
                        <td className={cn(CELL, "whitespace-nowrap text-muted-foreground")}>
                          {l.lastContactedAt ? relativeTime(l.lastContactedAt) : "Never"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>

        <SectionCard title="Recent calls" description="Latest dials against this campaign">
          {recentCalls.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No calls logged for this campaign yet.
            </p>
          ) : (
            <div className="space-y-4">
              {recentCalls.map((r) => {
                const oc = (r.outcome ? outcomeConfig[r.outcome] : undefined) ?? {
                  label: "No outcome",
                  tone: "neutral" as const,
                  icon: undefined,
                };
                return (
                  <div key={r.id} className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      {/* Nameless records read as the org's own noun, not a
                          hardcoded vertical's. */}
                      <p className="truncate text-sm font-medium">
                        {r.leadName || vocab.LeadNoun}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground tabular">
                        {formatDuration(r.durationSec)} · {relativeTime(r.startedAt)}
                      </p>
                    </div>
                    <Badge tone={oc.tone} icon={oc.icon}>{oc.label}</Badge>
                  </div>
                );
              })}
            </div>
          )}
        </SectionCard>
      </div>
    </PageContainer>
  );
}

function PipeRow({
  label,
  value,
  of,
  icon: Icon,
}: {
  label: string;
  value: number;
  of: number;
  icon: typeof Users;
}) {
  const pct = of > 0 ? Math.round((value / of) * 100) : 0;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-sm">
        <span className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-muted-foreground" />
          {label}
        </span>
        <span className="font-semibold tabular">{formatNumber(value)}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
