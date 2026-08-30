import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Phone,
  PhoneCall,
  Search,
  Users,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { MetricCard } from "@/components/dashboard/metric-card";
import { LeadOpenLink } from "@/components/leads/lead-360/lead-open-link";
import { RowActions } from "@/components/pipeline/row-actions";
import { EmptyState } from "@/components/shared/empty-state";
import { PageContainer, PageHeader } from "@/components/shared/page-header";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { getBillsFine } from "@/lib/db/pipeline";
import { dialDeepLink } from "@/lib/dialer/deep-link";
import { resolveLeadFields } from "@/lib/leads/field-schema";
import { getViewer } from "@/lib/org/membership";
import { templateProfile } from "@/lib/org/templates";
import { orgVocabulary } from "@/lib/org/vocabulary";
import {
  formatCurrency,
  formatPhone,
  initials,
  leadDisplayName,
  relativeTime,
} from "@/lib/utils";

// The stored status key stays `bills_fine` (it is on historical leads and call
// records); every WORD on this page comes from the workspace's vertical, so a
// recruiting team reads "Not looking right now" rather than a solar sentence.
export const metadata = { title: "Set aside" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

const BF_STATUS_OPTIONS = [
  { value: "callback_scheduled", label: "Schedule callback" },
  { value: "not_interested", label: "Not interested" },
  { value: "do_not_call", label: "Add to DNC" },
];

export default async function BillsFinePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  // A repeated query param arrives as an array — take the first, never crash.
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const q = (one(sp.q) ?? "").trim().slice(0, 60);
  const page = Math.max(1, Math.floor(Number(one(sp.page)) || 1));

  const [{ rows: leads, total, withBills, avgEnergyCost, teamWide }, viewer] = await Promise.all([
    getBillsFine({ page, pageSize: PAGE_SIZE, q }),
    getViewer(),
  ]);
  const vocab = orgVocabulary(viewer.org);
  // Money labels come from the org's own field schema — "Utility"/"Solar" were
  // one tenant's column names printed on everyone's screen.
  const fields = resolveLeadFields(
    viewer.org?.settings.leadFields,
    templateProfile(viewer.org?.dialerTemplate).fields,
  );
  const bare = (label: string) => label.replace(/\s*\([^)]*\)\s*$/, "").trim() || label;
  const primaryLabel = bare(fields.find((f) => f.key === "utilityBill")?.label ?? "Monthly bill");
  const secondPayment = fields.find((f) => f.key === "solarPayment");
  const secondPaymentLabel = secondPayment ? bare(secondPayment.label) : "Other";

  // Only the truly-empty book gets the full empty state — an empty SEARCH (or
  // an out-of-range page) still renders the header, KPIs, and the search box.
  if (total === 0 && !q) {
    return (
      <PageContainer>
        <PageHeader
          title={vocab.noNeedLabel}
          description={`${vocab.LeadNounPlural} who don't need you right now — worth revisiting when their situation changes.`}
        />
        <EmptyState
          icon={CheckCircle2}
          title={`Nothing set aside yet`}
          description={`When a rep or the AI agent marks a ${vocab.leadNoun} as “${vocab.noNeedLabel}”, they'll appear here for follow-up.`}
        />
      </PageContainer>
    );
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageHref = (p: number) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (p > 1) params.set("page", String(p));
    const qs = params.toString();
    return qs ? `/bills-fine?${qs}` : "/bills-fine";
  };
  const pagerLink = (target: number, disabled: boolean, label: string, dir: "prev" | "next") => {
    const cls = buttonVariants({ size: "sm", variant: "outline", className: "gap-1" });
    const arrows = (
      <>
        {dir === "prev" && <ChevronLeft className="h-3.5 w-3.5" />}
        {label}
        {dir === "next" && <ChevronRight className="h-3.5 w-3.5" />}
      </>
    );
    return disabled ? (
      <span aria-disabled="true" className={`${cls} pointer-events-none opacity-50`}>
        {arrows}
      </span>
    ) : (
      <Link href={pageHref(target)} className={cls}>
        {arrows}
      </Link>
    );
  };

  return (
    <PageContainer>
      <PageHeader
        title={vocab.noNeedLabel}
        description={`These ${vocab.leadNounPlural} said no for now — not never. Re-engage when the timing is right.`}
      >
        {teamWide && (
          <Badge tone="primary" className="gap-1">
            <Users className="h-3 w-3" /> Team-wide
          </Badge>
        )}
      </PageHeader>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MetricCard label="Total" value={String(total)} icon={CheckCircle2} accent="warning" />
        <MetricCard label={`With ${primaryLabel.toLowerCase()} data`} value={String(withBills)} icon={Zap} accent="accent" />
        <MetricCard
          label="Avg monthly spend"
          value={
            avgEnergyCost && avgEnergyCost > 0 ? formatCurrency(Math.round(avgEnergyCost)) : "—"
          }
          icon={Zap}
          accent="success"
        />
        <MetricCard label="Ready to re-dial" value={String(total)} icon={Phone} accent="primary" />
      </div>

      <Card className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="font-semibold">All leads</h3>
            <p className="text-xs text-muted-foreground">
              {q
                ? `${total} match${total === 1 ? "" : "es"} for “${q}”`
                : "Sorted by last contacted date — oldest potential first."}
            </p>
          </div>
          {/* GET form: submitting replaces the query string, resetting to page 1. */}
          <form method="get" action="/bills-fine" className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" />
            <Input
              type="search"
              name="q"
              defaultValue={q}
              placeholder="Search name or phone…"
              aria-label="Search leads by name or phone"
              className="h-9 py-0 pl-9 text-sm"
            />
          </form>
        </div>
        <div className="divide-y divide-border">
          {leads.length === 0 && (
            <p className="p-8 text-center text-sm text-muted-foreground">
              {q ? "No leads match this search." : "Nothing on this page."}
            </p>
          )}
          {leads.map((lead) => (
            <div key={lead.id} className="flex items-center gap-3 px-5 py-4">
              <Avatar initials={initials(lead.leadName)} tone="warning" size="sm" />
              <div className="min-w-0 flex-1">
                {/* Name → Lead 360, over this page. */}
                <LeadOpenLink leadId={lead.id} className="block truncate text-sm font-semibold">
                  {leadDisplayName(lead.leadName, lead.phone, vocab.leadNoun)}
                </LeadOpenLink>
                <p className="truncate text-xs text-muted-foreground tabular">
                  {lead.phone ? formatPhone(lead.phone) : "—"}
                  {lead.utilityProvider && <span> · {lead.utilityProvider}</span>}
                  {lead.repName && <span> · {lead.repName}</span>}
                </p>
                {(lead.utilityBill || lead.solarPayment) && (
                  <p className="mt-0.5 text-xs text-muted-foreground tabular">
                    {lead.utilityBill ? `${primaryLabel}: ${formatCurrency(lead.utilityBill)}/mo` : ""}
                    {lead.utilityBill && lead.solarPayment ? " · " : ""}
                    {lead.solarPayment
                      ? `${secondPaymentLabel}: ${formatCurrency(lead.solarPayment)}/mo`
                      : ""}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-3">
                {lead.lastContactedAt && (
                  <span className="text-xs text-muted-foreground">
                    {relativeTime(lead.lastContactedAt)}
                  </span>
                )}
                <Link
                  href={dialDeepLink({ phone: lead.phone, name: lead.leadName })}
                  className={buttonVariants({ size: "sm", variant: "outline", className: "gap-1.5" })}
                >
                  <PhoneCall className="h-3.5 w-3.5" />
                  Re-dial
                </Link>
                <RowActions
                  kind="lead"
                  id={lead.id}
                  leadId={lead.id}
                  statusOptions={BF_STATUS_OPTIONS}
                />
              </div>
            </div>
          ))}
        </div>
        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-border px-5 py-3">
            {pagerLink(page - 1, page <= 1, "Previous", "prev")}
            <span className="text-xs text-muted-foreground tabular">
              Page {Math.min(page, totalPages)} of {totalPages}
            </span>
            {pagerLink(page + 1, page >= totalPages, "Next", "next")}
          </div>
        )}
      </Card>
    </PageContainer>
  );
}
