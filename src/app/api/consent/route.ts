import { NextResponse } from "next/server";
import {
  CONSENT_CHANNELS,
  CONSENT_SCOPES,
  type ConsentChannel,
  type ConsentScope,
} from "@/lib/consent/state";
import { getConsent, getConsentHistory, recordConsent } from "@/lib/db/consent";
import { getScopedLeadRow } from "@/lib/db/lead-360";
import { rateLimit } from "@/lib/rate-limit";
import { getViewer } from "@/lib/org/membership";

export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────────────────────
// Capture, withdraw, and read permission to contact someone.
//
// The evidence is the point. A grant with no words behind it is a checkbox
// somebody ticked, which proves nothing when it is questioned — so this route
// REFUSES a grant with no evidence, rather than storing an empty string and
// letting the record look complete.
//
// Scoped through getScopedLeadRow: consent is keyed on the number, but it is
// always captured while looking at a record, and the person capturing it must
// be allowed to see that record.
// ─────────────────────────────────────────────────────────────────────────────

const MIN_EVIDENCE = 8;

function isChannel(v: unknown): v is ConsentChannel {
  return typeof v === "string" && (CONSENT_CHANNELS as readonly string[]).includes(v);
}
function isScope(v: unknown): v is ConsentScope {
  return typeof v === "string" && (CONSENT_SCOPES as readonly string[]).includes(v);
}

export async function GET(req: Request) {
  const leadId = new URL(req.url).searchParams.get("leadId") ?? "";
  const access = await getScopedLeadRow(leadId);
  if (!access.ok) {
    return NextResponse.json(
      { error: access.reason },
      { status: access.reason === "unauthenticated" ? 401 : access.reason === "denied" ? 403 : 404 },
    );
  }
  const phone = String((access.row as { phone?: unknown }).phone ?? "");
  const orgId = String((access.row as { org_id?: unknown }).org_id ?? "") || null;
  const [state, history] = await Promise.all([
    getConsent(orgId, phone, "sms"),
    getConsentHistory(orgId, phone, "sms"),
  ]);
  return NextResponse.json({ state, history });
}

export async function POST(req: Request) {
  const viewer = await getViewer();
  if (!viewer.isDemo && !viewer.user) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }
  if (!viewer.permissions.includes("consent.record")) {
    return NextResponse.json(
      { error: "You don't have permission to record consent." },
      { status: 403 },
    );
  }

  const body = (await req.json().catch(() => ({}))) as {
    leadId?: string;
    channel?: string;
    action?: string;
    scope?: string;
    evidence?: string;
  };

  const access = await getScopedLeadRow(String(body.leadId ?? ""));
  if (!access.ok) {
    return NextResponse.json(
      { error: access.reason },
      { status: access.reason === "unauthenticated" ? 401 : access.reason === "denied" ? 403 : 404 },
    );
  }
  const { scope: viewerScope, row } = access;

  const rl = rateLimit(`consent:${viewerScope.userId}`, 60, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Slow down." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  const channel = isChannel(body.channel) ? body.channel : "sms";
  const action = body.action === "revoked" ? "revoked" : "granted";
  const scope = isScope(body.scope) ? body.scope : "transactional";
  const evidence = String(body.evidence ?? "").trim();

  // A grant has to carry the words. Withdrawal does not: someone saying stop is
  // honoured whether or not the rep typed a sentence about it, and adding a
  // hurdle to recording a "no" is the wrong direction to make anything harder.
  if (action === "granted" && evidence.length < MIN_EVIDENCE) {
    return NextResponse.json(
      {
        error:
          "Record what they actually agreed to, in their words. A grant with no evidence behind it proves nothing when it's questioned.",
      },
      { status: 422 },
    );
  }

  const phone = String((row as { phone?: unknown }).phone ?? "");
  const orgId = String((row as { org_id?: unknown }).org_id ?? "");
  if (!phone || !orgId) {
    return NextResponse.json(
      { error: "This record has no phone number to attach consent to." },
      { status: 422 },
    );
  }

  const ok = await recordConsent({
    orgId,
    phone,
    channel,
    action,
    scope,
    source: "call_wrapup",
    evidence,
    leadId: String((row as { id?: unknown }).id ?? "") || null,
    actorId: viewerScope.userId,
  });
  if (!ok) {
    return NextResponse.json({ error: "Couldn't record that right now." }, { status: 500 });
  }

  const state = await getConsent(orgId, phone, channel);
  return NextResponse.json({ ok: true, state });
}
