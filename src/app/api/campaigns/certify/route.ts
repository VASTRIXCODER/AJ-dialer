import { NextResponse } from "next/server";
import { normalizeCampaignId, recordCertification } from "@/lib/legal/campaign-cert";
import { getViewer } from "@/lib/org/membership";

export const dynamic = "force-dynamic";

/**
 * Records the pre-dial compliance certification for a campaign (or the
 * org-wide "no campaign" bucket) — see /api/leads/import's gate. Requires the
 * same leads.import permission as the import it unblocks; a rep who can't
 * import leads has no business certifying a list either.
 */
export async function POST(req: Request) {
  const viewer = await getViewer();
  if (!viewer.user || !viewer.org?.id) {
    return NextResponse.json({ ok: false, error: "Sign in first." }, { status: 401 });
  }
  if (!viewer.permissions.includes("leads.import")) {
    return NextResponse.json(
      { ok: false, error: "You don't have permission to certify a campaign." },
      { status: 403 },
    );
  }

  const body = (await req.json().catch(() => ({}))) as { campaignId?: string | null };
  const campaignId = normalizeCampaignId(body.campaignId);

  const result = await recordCertification({
    orgId: viewer.org.id,
    campaignId,
    certifiedBy: viewer.user.id,
  });
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
