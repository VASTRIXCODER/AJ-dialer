import { NextResponse } from "next/server";
import {
  auditRotationPool,
  elevenLabsConfig,
  isAIBridgeConfigured,
  isElevenLabsConfigured,
} from "@/lib/elevenlabs";
import { getViewer, viewerCan } from "@/lib/org/membership";
import { getPlatformPool } from "@/lib/dialer/rotation-server";

export const dynamic = "force-dynamic";

/**
 * Why is every AI call going out on the same number?
 *
 * Because the caller-ID pool and ElevenLabs are two different lists. Rotation
 * picks a number from the org's pool; in DIRECT mode ElevenLabs places the call
 * and can only originate from a number IMPORTED into its own account. Anything
 * else falls back to ELEVENLABS_AGENT_PHONE_NUMBER_ID — silently, until now.
 *
 * Pointing a number's Twilio voice webhook at the app does nothing for this
 * path: that governs INBOUND and the human dialer, not ElevenLabs origination.
 *
 * This compares the two lists and names the numbers that aren't pulling weight.
 */
export async function GET() {
  const viewer = await getViewer();
  if (!viewer || !(await viewerCan("admin.access"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { pool, rotateEvery, isLocked } = getPlatformPool(viewer.org?.settings);
  const bridge = isAIBridgeConfigured();

  // Bridge mode dials the homeowner from Twilio with the rotated number, so the
  // ElevenLabs import list is irrelevant and rotation already works.
  if (bridge) {
    return NextResponse.json({
      mode: "bridge",
      rotationWorks: true,
      pool,
      rotateEvery,
      isLocked,
      imported: pool,
      missing: [],
      note:
        "Bridge mode: Twilio places the homeowner leg with the rotated caller ID, " +
        "so every number in the pool is already in use. No ElevenLabs import needed.",
    });
  }

  if (!isElevenLabsConfigured()) {
    return NextResponse.json(
      { error: "ElevenLabs is not configured" },
      { status: 503 },
    );
  }

  const { imported, missing } = await auditRotationPool(pool);

  return NextResponse.json({
    mode: "direct",
    rotationWorks: missing.length === 0 && imported.length > 1,
    pool,
    rotateEvery,
    isLocked,
    imported,
    missing,
    defaultNumberId: elevenLabsConfig.agentPhoneNumberId || null,
    note: missing.length
      ? `${missing.length} of ${pool.length} pool numbers are not imported into ` +
        `ElevenLabs. AI calls that rotate onto them go out on the default number ` +
        `instead. Import them (Conversational AI → Phone Numbers, or POST ` +
        `/api/superadmin/provision-numbers with these numbers).`
      : imported.length > 1
        ? "Every pool number is imported — AI dials rotate across all of them."
        : "Only one number is available, so there is nothing to rotate across.",
  });
}
