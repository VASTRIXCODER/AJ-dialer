import { NextResponse } from "next/server";
import { insertLeads, type LeadInput } from "@/lib/db/leads";
import { hasCurrentCertification, normalizeCampaignId } from "@/lib/legal/campaign-cert";
import type { ParsedLead } from "@/lib/leads/csv";
import { parseCsvToLeads } from "@/lib/leads/parse-request";
import { isValidGroupKey } from "@/lib/db/lead-groups";
import { createPacks, planPacks, pruneEmptyPacks, setPackSizes } from "@/lib/db/lead-packs";
import type { LeadGroup } from "@/lib/types";
import { getViewer } from "@/lib/org/membership";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/** Reject CSV payloads larger than this (bytes) before we ever parse them. */
const MAX_CSV_BYTES = 2_000_000;

/**
 * Import leads from a CSV.
 *
 * Preferred: send the raw file text as `csv`. The server parses it, tries the
 * fast deterministic header mapper, and — when that can't confidently read the
 * file (no header row, broker exports, exotic layouts) — falls back to Claude to
 * infer the column mapping. Either way every field is extracted and phone numbers
 * are normalized to E.164.
 *
 * Back-compat: callers may still send pre-parsed `rows`.
 */
export async function POST(req: Request) {
  const viewer = await getViewer();
  if (!viewer.permissions.includes("leads.import")) {
    return NextResponse.json(
      { inserted: 0, error: "You don't have permission to import leads." },
      { status: 403 },
    );
  }

  // Throttle imports: each one can trigger CSV parsing + a Claude column-mapping
  // call, so a loop would be a CPU + token DoS. Generous for real use.
  const rl = rateLimit(`import:${viewer.user?.id ?? clientIp(req)}`, 12, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { inserted: 0, error: "Too many imports in a row — wait a moment and try again." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  const body = (await req.json().catch(() => ({}))) as {
    csv?: string;
    rows?: LeadInput[];
    campaignId?: string | null;
    leadGroup?: LeadGroup | null;
    /** Cut this import into numbered packs of roughly this many leads. */
    packSize?: number | null;
    /** Label the packs carry — normally the source file name. */
    packBatch?: string | null;
  };

  // Reject an oversized CSV before parsing: parseCsvToLeads walks the whole string
  // character by character and the AI fallback ships the grid to Claude, so the
  // cap has to come BEFORE that work (the 5,000-row slice below happens after it).
  if (typeof body.csv === "string" && body.csv.length > MAX_CSV_BYTES) {
    return NextResponse.json(
      {
        inserted: 0,
        error:
          "That file is too large to import at once. Split it into smaller CSVs " +
          "(under ~2 MB each) and import them in batches.",
      },
      { status: 413 },
    );
  }

  const hasGroup = Object.prototype.hasOwnProperty.call(body, "leadGroup");
  // Group keys are per-org now, so validity is "does THIS org have it" rather
  // than membership of a global list.
  if (hasGroup && body.leadGroup !== null) {
    const ok = await isValidGroupKey(viewer.org?.id ?? null, body.leadGroup);
    if (!ok) {
      return NextResponse.json(
        { inserted: 0, error: "That lead group doesn't exist in this workspace." },
        { status: 400 },
      );
    }
  }

  // Compliance gate: a list can't be dialed until someone has certified this
  // specific campaign (or the org-wide "no campaign" bucket) has the legal
  // right to be contacted, at the current certification version. Checked
  // BEFORE parsing so an uncertified import never spends an AI column-mapping
  // call on a file that's about to be blocked anyway.
  const certCampaignId = normalizeCampaignId(body.campaignId);
  if (viewer.org?.id) {
    const certified = await hasCurrentCertification(viewer.org.id, certCampaignId);
    if (!certified) {
      return NextResponse.json(
        {
          inserted: 0,
          error: "This campaign needs a compliance certification before you can import leads into it.",
          certificationRequired: true,
          campaignId: certCampaignId,
        },
        { status: 403 },
      );
    }
  }

  let leads: ParsedLead[] | LeadInput[] = [];
  let source: "headers" | "ai" | "rows" = "rows";
  let aiError: string | null = null;

  if (typeof body.csv === "string" && body.csv.trim()) {
    const parsed = await parseCsvToLeads(body.csv);
    if ("error" in parsed) {
      return NextResponse.json({ inserted: 0, error: parsed.error }, { status: 400 });
    }
    leads = parsed.leads;
    source = parsed.source;
    aiError = parsed.aiError;
  } else if (Array.isArray(body.rows)) {
    leads = body.rows;
  }

  if (!leads.length) {
    return NextResponse.json(
      {
        inserted: 0,
        error:
          aiError ??
          "Couldn't find any leads in that file. Make sure it has a phone or name column.",
      },
      { status: 400 },
    );
  }

  // Assign the whole batch to the chosen campaign (if any) and/or fixed intake
  // group (if any). `hasGroup` distinguishes "leadGroup: null" (explicit
  // "unsorted") from the key being omitted entirely (legacy callers that never
  // mention groups, whose rows keep whatever lead_group they'd otherwise get).
  const capped = leads.slice(0, 5000);

  // ── Packs ────────────────────────────────────────────────────────────────
  // Cut the batch into numbered slices so a big list can be dealt out a pack
  // at a time. The pack rows are created up front (we need their ids to stamp
  // each lead), then sized and pruned after the insert — dedupe and invalid
  // rows mean the final counts aren't knowable until the write lands.
  const packSize = Number(body.packSize) || 0;
  const wantsPacks = packSize > 0 && Boolean(viewer.org?.id);
  let packIds: string[] = [];
  let assignedPackOf: (index: number) => string | null = () => null;

  if (wantsPacks && viewer.org?.id) {
    const { packCount, effectiveSize } = planPacks(capped.length, packSize);
    const packs = await createPacks(viewer.org.id, {
      batch: (body.packBatch || "Upload").toString(),
      packCount,
      createdBy: viewer.user?.id ?? null,
    });
    if (packs.length) {
      packIds = packs.map((p) => p.id);
      assignedPackOf = (i) => packs[Math.min(packs.length - 1, Math.floor(i / effectiveSize))].id;
    }
  }

  const rows: LeadInput[] = capped.map((r, i) => ({
    ...r,
    ...(body.campaignId ? { campaignId: body.campaignId } : {}),
    ...(hasGroup ? { leadGroup: body.leadGroup } : {}),
    ...(packIds.length ? { leadPackId: assignedPackOf(i) } : {}),
  }));

  const result = await insertLeads(rows);

  if (packIds.length && viewer.org?.id) {
    // Count what actually landed per pack rather than what we intended, then
    // drop any pack that ended up empty (a fully-duplicate tail slice).
    const counts = new Map<string, number>();
    if (!result.error) {
      rows.forEach((r) => {
        const id = r.leadPackId;
        if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
      });
    }
    await setPackSizes(
      viewer.org.id,
      packIds.map((id) => ({ id, size: counts.get(id) ?? 0 })),
    );
    await pruneEmptyPacks(viewer.org.id, packIds);
  }

  return NextResponse.json(
    { ...result, source, aiError, packs: packIds.length },
    { status: result.error ? 400 : 200 },
  );
}
