import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { Lead360Content } from "@/components/leads/lead-360/lead-360-content";
import { PageContainer } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { getLeadPanel } from "@/lib/db/lead-360";
import { getLeadTimeline } from "@/lib/db/lead-timeline";
import { getViewer } from "@/lib/org/membership";
import { orgVocabulary } from "@/lib/org/vocabulary";
import { resolveLeadStatusConfig } from "@/lib/status";
import { formatPhone } from "@/lib/utils";

export const dynamic = "force-dynamic";

// One panel read per request even though metadata + page both need it.
const loadPanel = cache(async (id: string) => getLeadPanel(id));

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const [panel, viewer] = await Promise.all([loadPanel(id), getViewer()]);
  const vocab = orgVocabulary(viewer.org);
  const name = panel
    ? `${panel.lead.firstName} ${panel.lead.lastName}`.trim()
    : "";
  return { title: name ? `${name} · ${vocab.LeadNoun} record` : `${vocab.LeadNoun} record` };
}

/**
 * The Lead 360 as a deep-linkable page — the same assembled record the drawer
 * shows, for sharing, bookmarking, and opening from anywhere a slide-over
 * doesn't fit. Scope-denied and unknown ids both land on notFound(): the page
 * URL must never confirm a foreign lead id exists.
 */
export default async function LeadRecordPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const panel = await loadPanel(id);
  if (!panel) notFound();

  const [timeline, viewer] = await Promise.all([
    getLeadTimeline(id, { limit: 50 }),
    getViewer(),
  ]);
  const vocab = orgVocabulary(viewer.org);
  const statusConfig = resolveLeadStatusConfig(vocab);
  const status = statusConfig[panel.lead.status];
  const name =
    `${panel.lead.firstName} ${panel.lead.lastName}`.trim() ||
    formatPhone(panel.lead.phone);

  return (
    <PageContainer className="max-w-4xl">
      <div className="space-y-1">
        <Link
          href="/leads"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to {vocab.leadNounPlural}
        </Link>
        <div className="flex flex-wrap items-center gap-3 pt-1">
          <h1 className="text-2xl font-bold tracking-tight sm:text-[28px]">{name}</h1>
          <Badge tone={status.tone}>{status.label}</Badge>
        </div>
        {panel.lead.phone && (
          <a
            href={`tel:${panel.lead.phone}`}
            className="inline-block text-sm text-muted-foreground tabular hover:text-foreground"
          >
            {formatPhone(panel.lead.phone)}
          </a>
        )}
      </div>

      <Lead360Content panel={panel} timeline={timeline ?? []} />
    </PageContainer>
  );
}
