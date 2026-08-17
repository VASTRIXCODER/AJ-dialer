import "server-only";

import { createAdminClient, isAdminConfigured } from "../supabase/admin";
import { createClient } from "../supabase/server";

// ─────────────────────────────────────────────────────────────────────────────
// Lead packs — numbered slices of one upload.
//
// A 10,000-row list is not a unit of work anybody can be handed. Packs cut it
// into dealable pieces ("Jan list · Pack 7", 100 leads) so a manager can give
// rep A packs 1-5 and rep B packs 6-10 without splitting the file by hand or
// inventing a campaign per hundred rows.
//
// Deliberately a SEPARATE axis from groups: a lead carries both, so "the North
// Texas leads in Pack 7" is a real query, and re-packing never disturbs how the
// book is grouped.
// ─────────────────────────────────────────────────────────────────────────────

export interface LeadPack {
  id: string;
  /** The upload these packs were cut from, e.g. "jan-list.csv". */
  batch: string;
  /** 1-based position within that batch. */
  seq: number;
  label: string;
  size: number;
  createdAt: string;
}

/** Hard ceiling on packs per upload, so a 1-lead pack size can't create 10,000 rows. */
export const MAX_PACKS_PER_UPLOAD = 500;
/** Smallest pack worth dealing. */
export const MIN_PACK_SIZE = 10;

function rowToPack(r: Record<string, unknown>): LeadPack {
  return {
    id: String(r.id),
    batch: String(r.batch ?? ""),
    seq: Number(r.seq ?? 1),
    label: String(r.label ?? ""),
    size: Number(r.size ?? 0),
    createdAt: String(r.created_at ?? ""),
  };
}

/**
 * How many packs `total` leads cut at `packSize` would produce, clamped so a
 * silly pack size can't spawn an unbounded number of rows. Returns the EFFECTIVE
 * size too, because clamping the count means the size has to grow to match —
 * otherwise leads past the last pack would silently go unpacked.
 */
export function planPacks(
  total: number,
  packSize: number,
): { packCount: number; effectiveSize: number } {
  const requested = Math.max(MIN_PACK_SIZE, Math.floor(packSize) || MIN_PACK_SIZE);
  if (total <= 0) return { packCount: 0, effectiveSize: requested };
  let size = requested;
  let count = Math.ceil(total / size);
  if (count > MAX_PACKS_PER_UPLOAD) {
    count = MAX_PACKS_PER_UPLOAD;
    size = Math.ceil(total / count);
  }
  return { packCount: count, effectiveSize: size };
}

export async function listLeadPacks(orgId: string | null, limit = 200): Promise<LeadPack[]> {
  if (!orgId) return [];
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("lead_packs")
      .select("*")
      .eq("org_id", orgId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error || !data) return [];
    return data.map(rowToPack);
  } catch {
    return [];
  }
}

/**
 * Create the pack rows for one upload up front, so the importer can stamp each
 * lead with its pack id as it inserts. `batch` labels them all with the source
 * file, which is what makes "Jan list · Pack 7" readable months later.
 */
export async function createPacks(
  orgId: string,
  opts: { batch: string; packCount: number; createdBy?: string | null },
): Promise<LeadPack[]> {
  if (!isAdminConfigured() || opts.packCount <= 0) return [];
  const admin = createAdminClient();
  const batch = (opts.batch || "Upload").trim().slice(0, 80);
  const rows = Array.from({ length: Math.min(opts.packCount, MAX_PACKS_PER_UPLOAD) }, (_, i) => ({
    org_id: orgId,
    batch,
    seq: i + 1,
    label: `${batch} · Pack ${i + 1}`,
    size: 0,
    created_by: opts.createdBy ?? null,
  }));
  const { data, error } = await admin.from("lead_packs").insert(rows).select("*");
  if (error || !data) return [];
  return data.map(rowToPack).sort((a, b) => a.seq - b.seq);
}

/** Write the final lead count onto each pack once the import has landed. */
export async function setPackSizes(
  orgId: string,
  sizes: { id: string; size: number }[],
): Promise<void> {
  if (!isAdminConfigured() || !sizes.length) return;
  const admin = createAdminClient();
  await Promise.all(
    sizes.map((s) =>
      admin
        .from("lead_packs")
        .update({ size: s.size })
        .eq("id", s.id)
        .eq("org_id", orgId)
        .then(() => undefined),
    ),
  );
}

/** Drop packs that ended up with no leads (the tail of a short final slice). */
export async function pruneEmptyPacks(orgId: string, packIds: string[]): Promise<void> {
  if (!isAdminConfigured() || !packIds.length) return;
  const admin = createAdminClient();
  await admin
    .from("lead_packs")
    .delete()
    .eq("org_id", orgId)
    .eq("size", 0)
    .in("id", packIds);
}
