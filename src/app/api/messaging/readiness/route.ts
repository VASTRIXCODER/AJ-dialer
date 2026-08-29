import { NextResponse } from "next/server";
import { getMessagingReadiness } from "@/lib/messaging/readiness";
import { getViewer } from "@/lib/org/membership";
import { rateLimit } from "@/lib/rate-limit";
import { getPublicBaseUrl, setNumberSmsWebhook } from "@/lib/twilio";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * What is actually true about this workspace's ability to message people.
 *
 * Every line is checked against Twilio at read time rather than stored. The
 * failure this exists to catch is already in the data: every dialing number's
 * Messaging webhook points at ElevenLabs, which 404s inbound SMS, and
 * `dnc_numbers` contains zero rows sourced from a text message across the
 * platform's whole history. A stored checkbox saying "configured" would have
 * been ticked that entire time.
 *
 * The credentials live only in the deployment and cannot be pulled to a
 * developer machine, so asking the running application is the only way to find
 * this out — which is precisely why it belongs in the product.
 */
export async function GET() {
  const viewer = await getViewer();
  if (!viewer.permissions.includes("admin.access")) {
    return NextResponse.json({ error: "Not permitted." }, { status: 403 });
  }
  const readiness = await getMessagingReadiness(viewer.org);
  return NextResponse.json({
    ...readiness,
    expectedWebhook: `${getPublicBaseUrl() ?? ""}/api/twilio/sms`,
  });
}

/**
 * Point a number's MESSAGING webhook here.
 *
 * Deliberately narrow: it sets `smsUrl` and touches nothing else. The existing
 * "provision numbers" action also repoints Voice, which for these numbers
 * targets ElevenLabs on purpose — repointing it as a side effect of fixing SMS
 * would silently break inbound calls. One knob, one consequence.
 */
export async function POST(req: Request) {
  const viewer = await getViewer();
  if (!viewer.permissions.includes("org.edit")) {
    return NextResponse.json(
      { error: "You don't have permission to change number settings." },
      { status: 403 },
    );
  }
  const rl = rateLimit(`msg-readiness:${viewer.user?.id ?? "anon"}`, 20, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Slow down." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  const body = (await req.json().catch(() => ({}))) as { phoneNumber?: string };
  const phoneNumber = String(body.phoneNumber ?? "").trim();
  if (!phoneNumber) {
    return NextResponse.json({ error: "Which number?" }, { status: 422 });
  }

  // Only a number this workspace actually claims. Without this an admin could
  // repoint any number on the shared Twilio account, including another
  // workspace's.
  const pool = new Set(
    [
      ...(viewer.org?.settings.dialing.callerIds ?? []),
      viewer.org?.settings.dialing.callerId ?? "",
    ]
      .map((n) => n.replace(/\D/g, "").slice(-10))
      .filter(Boolean),
  );
  if (!pool.has(phoneNumber.replace(/\D/g, "").slice(-10))) {
    return NextResponse.json(
      { error: "That number isn't in this workspace's pool." },
      { status: 404 },
    );
  }

  const base = getPublicBaseUrl();
  if (!base) {
    return NextResponse.json(
      {
        error:
          "No publicly reachable URL resolved, so Twilio would have nowhere to send replies.",
      },
      { status: 400 },
    );
  }

  try {
    await setNumberSmsWebhook(phoneNumber, `${base}/api/twilio/sms`);
    return NextResponse.json({ ok: true, smsUrl: `${base}/api/twilio/sms` });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: (e as { message?: string })?.message ?? "Twilio refused the change." },
      { status: 502 },
    );
  }
}
