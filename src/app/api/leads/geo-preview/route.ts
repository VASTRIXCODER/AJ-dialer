import { NextResponse } from "next/server";
import { classifyLeadsGeography } from "@/lib/ai/geo-classify";
import type { ParsedLead } from "@/lib/leads/csv";
import { parseCsvToLeads } from "@/lib/leads/parse-request";
import { getViewer } from "@/lib/org/membership";

export const dynamic = "force-dynamic";

type PreviewLead = ParsedLead & { tempId: string };
type GroupKey = "fresno" | "houston" | "dallas" | "california" | "unsorted";
const GROUP_KEYS: GroupKey[] = ["fresno", "houston", "dallas", "california", "unsorted"];

/**
 * Preview the "dump & auto-sort" grouping WITHOUT inserting anything — the
 * uploader reviews the proposal (src/components/leads/geo-preview-review.tsx)
 * and only leads that get confirmed are ever written, via /api/leads/import's
 * existing `rows` bypass (one POST per non-empty bucket).
 */
export async function POST(req: Request) {
  const viewer = await getViewer();
  if (!viewer.permissions.includes("leads.import")) {
    return NextResponse.json(
      { error: "You don't have permission to import leads." },
      { status: 403 },
    );
  }

  const { csv } = (await req.json().catch(() => ({}))) as { csv?: string };
  const parsed = await parseCsvToLeads(csv ?? "");
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  // Cap BEFORE classifying, matching /api/leads/import's own cap exactly, so
  // the preview's counts are exactly what Confirm will insert — a 6000-row
  // file must not preview 6000 rows and then silently drop 1000 at confirm.
  const capped: PreviewLead[] = parsed.leads
    .slice(0, 5000)
    .map((l, i) => ({ ...l, tempId: `p${i}` }));

  const { data, source, chunkFailures } = await classifyLeadsGeography(
    capped.map((l) => ({ tempId: l.tempId, city: l.city, state: l.state, zip: l.zip })),
  );
  const groupOf = new Map(data.map((d) => [d.tempId, d.group]));

  const groups: Record<GroupKey, PreviewLead[]> = {
    fresno: [], houston: [], dallas: [], california: [], unsorted: [],
  };
  for (const l of capped) {
    const g = groupOf.get(l.tempId);
    groups[(g ?? "unsorted") as GroupKey].push(l);
  }

  return NextResponse.json({
    source,
    chunkFailures,
    totalRows: capped.length,
    groupKeys: GROUP_KEYS,
    groups,
    columnSource: parsed.source,
    aiError: parsed.aiError,
  });
}
