import { NextResponse } from "next/server";
import { getAICall, updateAICall } from "@/lib/ai-call-store";
import { getAIConversation, setConversationDisposition } from "@/lib/db/records";
import { viewerCan, viewerOrgId } from "@/lib/org/membership";
import type { CallOutcome } from "@/lib/types";

export const dynamic = "force-dynamic";

const VALID: CallOutcome[] = [
  "appointment_booked",
  "callback_scheduled",
  "qualified",
  "not_interested",
  "no_answer",
  "voicemail",
  "wrong_number",
  "do_not_call",
];

/**
 * Manual disposition override from the per-call mini dashboard. Lets a supervisor
 * correct what the AI filed (or set one the AI couldn't). Updates the live store
 * immediately and persists durably (account-scoped) when Supabase is connected.
 */
export async function POST(req: Request) {
  const { conversationId, outcome, dispositionKey } = (await req
    .json()
    .catch(() => ({}))) as {
    conversationId?: string;
    outcome?: CallOutcome;
    /** The disposition-def key pressed (system key or `x_*` custom). */
    dispositionKey?: string;
  };

  if (!conversationId || !outcome || !VALID.includes(outcome)) {
    return NextResponse.json(
      { error: "conversationId and a valid outcome are required" },
      { status: 400 },
    );
  }

  // AUTH: overriding a call's disposition is a supervisor intervention. This used
  // to mutate the process-global live store BEFORE any check, so an anonymous
  // caller could mark any conversation completed with any outcome. Require
  // monitor.intervene and confirm the conversation belongs to the viewer's org.
  if (!(await viewerCan("monitor.intervene"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const orgId = await viewerOrgId();
  if (!orgId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const store = getAICall(conversationId);
  if (store) {
    if (store.orgId !== orgId)
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  } else if (!(await getAIConversation(conversationId))) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }

  // Live store — immediate UI feedback during the session.
  updateAICall(conversationId, {
    outcome,
    state: "completed",
    endedAt: Date.now(),
  });

  // Durable, account-scoped persistence (best-effort; needs Supabase + session).
  // Shape-guard the pressed key (system key or x_* slug); it rides along on the
  // corrected record while `outcome` stays the canonical fact.
  const key =
    typeof dispositionKey === "string" && /^(x_)?[a-z0-9_]{1,64}$/.test(dispositionKey)
      ? dispositionKey
      : null;
  const result = await setConversationDisposition(conversationId, outcome, key);

  return NextResponse.json({
    ok: true,
    persisted: result.ok,
    ...(result.ok ? {} : { note: result.error }),
  });
}
