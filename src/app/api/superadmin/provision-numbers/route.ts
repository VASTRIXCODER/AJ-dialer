import { NextResponse } from "next/server";
import { isAIBridgeConfigured, importTwilioPhoneNumber } from "@/lib/elevenlabs";
import { isSuperadmin } from "@/lib/superadmin";
import {
  getPublicBaseUrl,
  getRestClient,
  setNumberSmsWebhook,
  setNumberVoiceWebhook,
  twilioConfig,
} from "@/lib/twilio";

export const dynamic = "force-dynamic";

interface NumberResult {
  number: string;
  webhook: "ok" | "error" | "skipped";
  webhookError?: string;
  sms: "ok" | "error" | "skipped";
  smsError?: string;
  elevenlabs: "ok" | "error" | "skipped";
  elevenlabsError?: string;
}

/**
 * One-time (repeatable) onboarding action: given a list of Twilio numbers
 * already purchased on this account, point each one's Voice webhook at the
 * app and — when not running in Twilio-bridge mode — import it into
 * ElevenLabs so it's eligible for AI-agent outbound calls. Safe to re-run;
 * each step is independently best-effort per number.
 */
export async function POST(req: Request) {
  if (!(await isSuperadmin()))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as { numbers?: string[]; label?: string };
  const numbers = (body.numbers ?? []).map((n) => n.trim()).filter(Boolean);
  if (!numbers.length)
    return NextResponse.json({ ok: false, error: "numbers[] required" }, { status: 400 });

  const client = await getRestClient();
  if (!client)
    return NextResponse.json({ ok: false, error: "Twilio REST client not configured" }, { status: 400 });

  // Use the same single-hop origin the dialer's callbacks use, NOT the
  // NEXT_PUBLIC_APP_URL that a stale Vercel alias silently broke callbacks with
  // (see getPublicBaseUrl). Fall back to appUrl only if no request origin exists.
  const base = (getPublicBaseUrl(req) ?? twilioConfig.appUrl).replace(/\/+$/, "");
  const voiceUrl = `${base}/api/twilio/voice`;
  const smsUrl = `${base}/api/twilio/sms`;
  const bridgeActive = isAIBridgeConfigured();

  const results: NumberResult[] = [];
  for (const number of numbers) {
    const result: NumberResult = {
      number,
      webhook: "skipped",
      sms: "skipped",
      elevenlabs: "skipped",
    };

    try {
      await setNumberVoiceWebhook(number, voiceUrl);
      result.webhook = "ok";
    } catch (err) {
      result.webhook = "error";
      result.webhookError = err instanceof Error ? err.message : String(err);
    }

    // Point Messaging at our STOP handler so opt-outs are honored (and stop
    // 404ing at a stale URL, the error.txt symptom).
    try {
      await setNumberSmsWebhook(number, smsUrl);
      result.sms = "ok";
    } catch (err) {
      result.sms = "error";
      result.smsError = err instanceof Error ? err.message : String(err);
    }

    if (!bridgeActive) {
      try {
        await importTwilioPhoneNumber({
          phoneNumber: number,
          label: body.label?.trim() || number,
          twilioAccountSid: twilioConfig.accountSid,
          twilioAuthToken: twilioConfig.authToken,
        });
        result.elevenlabs = "ok";
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // ElevenLabs 400s when the number is already imported — treat as success.
        result.elevenlabs = /already exists|already imported/i.test(message) ? "ok" : "error";
        if (result.elevenlabs === "error") result.elevenlabsError = message;
      }
    }

    results.push(result);
  }

  return NextResponse.json({ ok: true, bridgeActive, results });
}
