import { NextResponse } from "next/server";
import { breakerStatus } from "@/lib/ai-call-breaker";
import {
  countKillSignature24h,
  countStuckAIConversations,
} from "@/lib/db/records";
import {
  buildOverridePayload,
  elevenLabsConfig,
  fetchOverridePolicy,
  fetchQuota,
  isAIBridgeConfigured,
  isElevenLabsConfigured,
  NO_OVERRIDES,
} from "@/lib/elevenlabs";
import { getViewer } from "@/lib/org/membership";

export const dynamic = "force-dynamic";

/**
 * AI-calling preflight. The one URL that answers "will my next call survive?"
 * WITHOUT placing a call.
 *
 * The zero-connect outage happened because the app sent the ElevenLabs agent a
 * conversation_config_override it wasn't allowed to accept, so every call was
 * answered and then killed within ~2 seconds. Nothing anywhere said so — the
 * calls were filed as "no answer" and the floor kept dialing for days.
 *
 * `wouldDrop` is the alarm. If it is non-empty, the app wants to send override
 * fields the agent forbids. We now omit them (fail closed) rather than die on
 * connect — so calls still work, but the agent is running its dashboard script
 * instead of the app's. Enable those fields under Agent → Security → Overrides,
 * or accept the dashboard script deliberately.
 *
 * Run this before any test batch. Green = `wouldDrop: []` and `stuck: 0`.
 */
export async function GET() {
  // Config, backlog and failure counts are operational internals — not for reps.
  const viewer = await getViewer();
  if (!viewer.permissions.includes("admin.access")) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  if (!isElevenLabsConfigured()) {
    return NextResponse.json({
      configured: false,
      hint: "Set ELEVENLABS_API_KEY, ELEVENLABS_AGENT_ID and ELEVENLABS_AGENT_PHONE_NUMBER_ID.",
    });
  }

  const policy = elevenLabsConfig.useDashboardPrompt
    ? NO_OVERRIDES
    : await fetchOverridePolicy({ force: true });

  // Exactly what a real call would try to send. The fields are what
  // /api/elevenlabs/call and the personalization webhook always pass.
  const built = buildOverridePayload(
    {
      promptOverride: "<system prompt>",
      firstMessage: "<first message>",
      language: "en",
      voiceSpeed: 1,
    },
    policy,
  );

  const [stuck, killSignature24h, quota] = await Promise.all([
    countStuckAIConversations(),
    countKillSignature24h(),
    fetchQuota({ force: true }),
  ]);
  const breaker = breakerStatus();

  const problems: string[] = [];

  // Credits first — this is the one that silently burns real leads.
  if (quota?.exhausted) {
    problems.push(
      `OUT OF CREDITS (0 of ${quota.limit} remaining). AI calls will be placed, the homeowner will ` +
        "answer, and the provider will hang up on them mid-greeting. Dialing is blocked until you top up." +
        (quota.resetsAt ? ` Allowance resets ${new Date(quota.resetsAt).toLocaleString()}.` : ""),
    );
  } else if (quota?.low) {
    problems.push(
      `LOW CREDITS — only ${quota.remaining} of ${quota.limit} left. A bulk batch will run dry ` +
        "partway through and start hanging up on homeowners mid-greeting.",
    );
  }
  if (quota && quota.status !== "active" && quota.status !== "trialing") {
    problems.push(`ElevenLabs subscription status is "${quota.status}" — calls may be refused.`);
  }
  if (breaker.open) {
    problems.push(
      `AI dialing is HALTED by the circuit breaker (${breaker.reason}). ${breaker.message} ` +
        "Fix the provider, then reset from Admin.",
    );
  }

  if (policy === null) {
    problems.push(
      "Could not read the agent's override policy from ElevenLabs. Sending NO overrides " +
        "for safety — calls will connect but will use the agent's dashboard script.",
    );
  }
  if (built.dropped.length) {
    problems.push(
      `The app wants to override [${built.dropped.join(", ")}] but the agent forbids it. ` +
        "These are being dropped so the call survives. To use the app's script, enable them " +
        "under Agent → Security → Overrides in the ElevenLabs dashboard.",
    );
  }
  if (killSignature24h > 0) {
    problems.push(
      `${killSignature24h} call(s) in the last 24h were ANSWERED and then killed within seconds ` +
        "with no transcript. That is the disallowed-override signature — calls are still dying.",
    );
  }
  if (stuck > 100) {
    problems.push(
      `${stuck} AI conversations have never been finalized. Check that the cron ` +
        "(/api/cron/reconcile-ai) is running and that CRON_SECRET is set.",
    );
  }

  const healthy = problems.length === 0;
  return NextResponse.json(
    {
      configured: true,
      healthy,
      canDial: !quota?.exhausted && !breaker.open,
      problems,
      quota,
      breaker,
      agentId: elevenLabsConfig.agentId,
      bridgeMode: isAIBridgeConfigured(),
      useDashboardPrompt: elevenLabsConfig.useDashboardPrompt,
      overridePolicy: policy,
      wouldSend: built.sent,
      wouldDrop: built.dropped,
      webhookSecretConfigured: Boolean(elevenLabsConfig.webhookSecret),
      stuckConversations: stuck,
      killSignature24h,
    },
    { status: healthy ? 200 : 503 },
  );
}
