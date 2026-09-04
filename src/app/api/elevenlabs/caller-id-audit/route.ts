import { NextResponse } from "next/server";
import {
  auditRotationPool,
  elevenLabsConfig,
  isAIBridgeConfigured,
  isElevenLabsConfigured,
} from "@/lib/elevenlabs";
import { getViewer, viewerCan } from "@/lib/org/membership";
import { getPlatformPool, PLATFORM_POOL_LOCKED } from "@/lib/dialer/rotation-server";
import { restrictToAssignedNumbers } from "@/lib/dialer/rotation";
import { normalizePhone } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * "Why isn't my number showing / dialing?"
 *
 * A number has to clear FOUR independent gates before an AI call leaves on it,
 * and nothing in the UI showed which one it was stuck behind:
 *
 *   1. It's in the effective pool. When TWILIO_CALLER_IDS is set the pool is
 *      platform-LOCKED and the org's own Admin → Dialing list is ignored
 *      entirely — numbers added there silently do nothing.
 *   2. It survives per-rep assignment. A rep with caller_ids pinned only ever
 *      sees those; owners/admins/managers see the whole pool.
 *   3. The rep hasn't toggled it off in the dialer's caller-ID picker.
 *   4. For AI calls in direct mode, it's IMPORTED into ElevenLabs. Pointing its
 *      Twilio voice webhook at the app does nothing for this — that governs
 *      inbound and the human dialer, not ElevenLabs origination.
 *
 * Pass ?number=+1XXXXXXXXXX to ask about one specific number and get the gate
 * it's failing by name.
 */
export async function GET(req: Request) {
  const viewer = await getViewer();
  if (!viewer || !(await viewerCan("admin.access"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { pool, rotateEvery } = getPlatformPool(viewer.org?.settings);
  const visibleToYou = restrictToAssignedNumbers(pool, viewer.role, viewer.callerIds);
  const orgConfigured = viewer.org?.settings.dialing.callerIds ?? [];
  const bridge = isAIBridgeConfigured();

  const source = PLATFORM_POOL_LOCKED
    ? "env TWILIO_CALLER_IDS (platform-locked — Admin → Dialing is IGNORED)"
    : orgConfigured.length
      ? "org settings (Admin → Organization → Dialing)"
      : "single number (settings.callerId / TWILIO_CALLER_ID)";

  // ElevenLabs only matters for AI calls placed directly. In bridge mode Twilio
  // dials the homeowner with the rotated number, so the import list is moot.
  let imported: string[] = pool;
  let missing: string[] = [];
  if (!bridge && isElevenLabsConfigured()) {
    ({ imported, missing } = await auditRotationPool(pool));
  }

  const inPool = (n: string) =>
    pool.some((p) => normalizePhone(p) === normalizePhone(n));

  /** The first gate this number fails, in the order a call actually hits them. */
  const whyMissing = (raw: string): string => {
    const n = normalizePhone(raw) || raw;
    if (!inPool(n)) {
      return PLATFORM_POOL_LOCKED
        ? `Not in the pool. The pool is locked to the TWILIO_CALLER_IDS env var, so adding ${n} under Admin → Dialing does nothing — add it to TWILIO_CALLER_IDS in Vercel and redeploy.`
        : `Not in the pool. Add ${n} under Admin → Organization → Dialing → Caller ID rotation pool.`;
    }
    if (!visibleToYou.some((p) => normalizePhone(p) === n)) {
      return `In the org pool, but not assigned to you. Your role sees only the numbers pinned to your membership — an owner or admin can change that under Admin → Members.`;
    }
    if (!bridge && missing.some((p) => normalizePhone(p) === n)) {
      return `In the pool and assigned to you, but NOT imported into ElevenLabs — AI calls that rotate onto it go out on the default number instead. Import it under Conversational AI → Phone Numbers, or POST /api/superadmin/provision-numbers.`;
    }
    return "Ready — in the pool, visible to you, and dialable.";
  };

  const asked = new URL(req.url).searchParams.get("number");

  return NextResponse.json({
    mode: bridge ? "bridge" : "direct",
    source,
    platformLocked: PLATFORM_POOL_LOCKED,
    rotateEvery,
    /** The org-wide pool actually in effect. */
    pool,
    /** What THIS viewer's dialer will offer, after per-rep assignment. */
    visibleToYou,
    assignedToYou: viewer.callerIds,
    /** What Admin → Dialing has saved — ignored entirely when platformLocked. */
    orgConfigured,
    /** AI/direct mode only. */
    importedInElevenLabs: bridge ? null : imported,
    missingFromElevenLabs: bridge ? null : missing,
    defaultNumberId: elevenLabsConfig.agentPhoneNumberId || null,
    ...(asked ? { number: asked, verdict: whyMissing(asked) } : {}),
    hint: "Add ?number=+18175082598 to ask about one number.",
  });
}
