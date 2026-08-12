import { NextResponse } from "next/server";
import { isElevenLabsConfigured, listPhoneNumbers } from "@/lib/elevenlabs";
import { isSuperadmin } from "@/lib/superadmin";

export const dynamic = "force-dynamic";

/**
 * Lists the phone numbers imported into ElevenLabs so you can find the correct
 * ELEVENLABS_AGENT_PHONE_NUMBER_ID (the `id`, not the phone number).
 *
 * Superadmin-only: the ElevenLabs account is shared across every org, so this
 * lists every tenant's outbound numbers — platform infrastructure, not org data.
 */
export async function GET() {
  if (!(await isSuperadmin())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!isElevenLabsConfigured()) {
    return NextResponse.json(
      { error: "ElevenLabs is not configured" },
      { status: 503 },
    );
  }
  try {
    const numbers = await listPhoneNumbers();
    return NextResponse.json({
      numbers: numbers.map((n) => ({
        id: n.phone_number_id ?? n.id ?? null,
        phone_number: n.phone_number ?? null,
        label: n.label ?? null,
      })),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to list phone numbers" },
      { status: 502 },
    );
  }
}
