import { CheckCircle2, Phone, PhoneCall, Users, Zap } from "lucide-react";
import Link from "next/link";
import { MetricCard } from "@/components/dashboard/metric-card";
import { RowActions } from "@/components/pipeline/row-actions";
import { EmptyState } from "@/components/shared/empty-state";
import { PageContainer, PageHeader } from "@/components/shared/page-header";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { getBillsFine } from "@/lib/db/pipeline";
import { getViewer } from "@/lib/org/membership";
import { formatCurrency, formatPhone, initials, relativeTime } from "@/lib/utils";

export const metadata = { title: "Bills Are Fine" };
export const dynamic = "force-dynamic";

const BF_STATUS_OPTIONS = [
  { value: "callback_scheduled", label: "Schedule callback" },
  { value: "not_interested", label: "Not interested" },
  { value: "do_not_call", label: "Add to DNC" },
];

export default async function BillsFinePage() {
  const [leads, viewer] = await Promise.all([getBillsFine(), getViewer()]);
  const isSolar = viewer.org?.dialerTemplate === "solar";
  const secondPaymentLabel = isSolar ? "Solar" : "Other";

  if (leads.length === 0) {
    return (
      <PageContainer>
        <PageHeader
          title="Bills Are Fine"
          description="Homeowners who said their bills are currently manageable — worth revisiting when rates change."
        />
        <EmptyState
          icon={CheckCircle2}
          title="No 'Bills are fine' leads yet"
          description="When a rep or the AI agent marks a homeowner as 'Bills are fine', they'll appear here for follow-up."
        />
      </PageContainer>
    );
  }

  const teamWide = leads[0]?.teamWide;
  const withBills = leads.filter((l) => l.utilityBill && l.solarPayment).length;
  const avgTotal =
    withBills > 0
      ? leads
          .filter((l) => l.utilityBill && l.solarPayment)
          .reduce((sum, l) => sum + (l.utilityBill ?? 0) + (l.solarPayment ?? 0), 0) /
        withBills
      : 0;

  return (
    <PageContainer>
      <PageHeader
        title="Bills Are Fine"
        description="These homeowners aren't feeling the pain yet — but rate increases may change that. Re-engage when the timing is right."
      >
        {teamWide && (
          <Badge tone="primary" className="gap-1">
            <Users className="h-3 w-3" /> Team-wide
          </Badge>
        )}
      </PageHeader>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MetricCard label="Total" value={String(leads.length)} icon={CheckCircle2} accent="warning" />
        <MetricCard label="With bill data" value={String(withBills)} icon={Zap} accent="accent" />
        <MetricCard
          label="Avg energy cost"
          value={avgTotal > 0 ? formatCurrency(Math.round(avgTotal)) : "—"}
          icon={Zap}
          accent="success"
        />
        <MetricCard label="Ready to re-dial" value={String(leads.length)} icon={Phone} accent="primary" />
      </div>

      <Card className="overflow-hidden">
        <div className="border-b border-border px-5 py-4">
          <h3 className="font-semibold">All leads</h3>
          <p className="text-xs text-muted-foreground">
            Sorted by last contacted date — oldest potential first.
          </p>
        </div>
        <div className="divide-y divide-border">
          {leads.map((lead) => (
            <div key={lead.id} className="flex items-center gap-3 px-5 py-4">
              <Avatar initials={initials(lead.leadName)} color="#F59E0B" size="sm" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{lead.leadName}</p>
                <p className="truncate text-xs text-muted-foreground tabular">
                  {lead.phone ? formatPhone(lead.phone) : "—"}
                  {lead.utilityProvider && <span> · {lead.utilityProvider}</span>}
                  {lead.repName && <span> · {lead.repName}</span>}
                </p>
                {(lead.utilityBill || lead.solarPayment) && (
                  <p className="mt-0.5 text-xs text-muted-foreground tabular">
                    {lead.utilityBill ? `Utility: ${formatCurrency(lead.utilityBill)}/mo` : ""}
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
                  href={
                    lead.phone
                      ? `/dialer?dial=${encodeURIComponent(lead.phone)}&name=${encodeURIComponent(lead.leadName)}`
                      : "/dialer"
                  }
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
      </Card>
    </PageContainer>
  );
}
