import { NextResponse } from "next/server";
import { classifyLeadsIntoGroups } from "@/lib/ai/classify-leads";
import { listLeadGroups } from "@/lib/db/lead-groups";
import type { ParsedLead } from "@/lib/leads/csv";
import { parseCsvToLeads } from "@/lib/leads/parse-request";
import { getViewer } from "@/lib/org/membership";

export const dynamic = "force-dynamic";

type PreviewLead = ParsedLead & { tempId: string };

/** Same ceiling /api/leads/import enforces, so preview counts equal what lands. */
const MAX_ROWS = 5000;

/**
 * Preview an AI sort WITHOUT inserting anything.
 *
 * Supersedes /api/leads/geo-preview, which could only propose the four fixed
 * geographic buckets. This sorts against the org's OWN groups and honours a
 * `sortLimit`: only the first N rows are sent to the model, and everything past
 * N is returned in the Miscellaneous bucket untouched. That's what makes a
 * 10,000-row file affordable — you sort 2,000 now, import the rest as
 * Miscellaneous, and sort more later from the Leads screen.
 *
 * Nothing is written here. The reviewer confirms, and the client posts each
 * non-empty bucket to /api/leads/import via its `rows` path.
 */
export async function POST(req: Request) {
  const viewer = await getViewer();
  if (!viewer.permissions.includes("leads.import")) {
    return NextResponse.json(
      { error: "You don't have permission to import leads." },
      { status: 403 },
    );
  }

  const body = (await req.json().catch(() => ({}))) as {
    csv?: string;
    sortLimit?: number | null;
  };

  const parsed = await parseCsvToLeads(body.csv ?? "");
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const capped: PreviewLead[] = parsed.leads
    .slice(0, MAX_ROWS)
    .map((l, i) => ({ ...l, tempId: `p${i}` }));

  const groups = await listLeadGroups(viewer.org?.id ?? null);

  // Only the first `sortLimit` rows are classified. 0 / absent = sort them all.
  const requested = Math.floor(Number(body.sortLimit) || 0);
  const limit = requested > 0 ? Math.min(requested, capped.length) : capped.length;
  const toSort = capped.slice(0, limit);
  const deferred = capped.slice(limit);

  const { data, source, chunkFailures } = await classifyLeadsIntoGroups(
    toSort.map((l) => ({
      tempId: l.tempId,
      city: l.city,
      state: l.state,
      zip: l.zip,
      utilityProvider: l.utilityProvider,
      utilityBill: l.utilityBill,
      solarPayment: l.solarPayment,
    })),
    groups,
  );
  const groupOf = new Map(data.map((d) => [d.tempId, d.group]));

  // Bucket by group key; "misc" is the catch-all for anything unplaced AND for
  // every row past the sort limit, which is exactly where the user asked
  // leftovers to go.
  const buckets: Record<string, PreviewLead[]> = { misc: [] };
  for (const g of groups) buckets[g.key] = [];
  for (const l of toSort) {
    const key = groupOf.get(l.tempId);
    if (key && buckets[key]) buckets[key].push(l);
    else buckets.misc.push(l);
  }
  buckets.misc.push(...deferred);

  return NextResponse.json({
    source,
    chunkFailures,
    totalRows: capped.length,
    sortedRows: toSort.length,
    deferredRows: deferred.length,
    groups: groups.map((g) => ({ key: g.key, label: g.label, kind: g.kind })),
    buckets,
    columnSource: parsed.source,
    aiError: parsed.aiError,
    // The review screen posts these back with each bucket's `rows` so AI-sorted
    // imports register their custom columns exactly like direct CSV imports.
    discoveredFields: parsed.discoveredFields,
  });
}
