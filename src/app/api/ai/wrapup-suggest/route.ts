import { NextResponse } from "next/server";
import { orgAIContext } from "@/lib/ai/org-context";
import { getWrapupSuggestion, type SuggestionOption } from "@/lib/ai/services";
import type { WrapupSuggestion } from "@/lib/ai/types";
import { getLeadById } from "@/lib/db/leads";
import { getViewer } from "@/lib/org/membership";
import { orgVocabulary } from "@/lib/org/vocabulary";
import { rateLimit } from "@/lib/rate-limit";
import { filterOutcomeOptionsByKeys, resolveOutcomeOptions } from "@/lib/status";

export const dynamic = "force-dynamic";

/**
 * The wrap-up copilot: suggest which of THIS org's disposition buttons fits
 * the manual call that just ended. The response is advisory — the rep's click
 * in the wrap-up grid is the only thing that ever files a disposition.
 *
 * The recommended key is validated against the org's resolved taxonomy (and
 * the campaign subset, when one is in play) before it leaves the server, so a
 * hallucinated key can never render as a pressable button.
 */
export async function POST(req: Request) {
  // AI spend needs a signed-in caller (demo mode has no key and simulates).
  const viewer = await getViewer();
  if (!viewer.isDemo && !viewer.user) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }
  const rl = rateLimit(`ai:${viewer.user?.id ?? "demo"}`, 30, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Slow down." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  const { leadId, notes, durationSec, allowedKeys } = (await req
    .json()
    .catch(() => ({}))) as {
    leadId?: string;
    notes?: string;
    durationSec?: number;
    /** The campaign's disposition subset, when the queue is campaign-scoped. */
    allowedKeys?: string[];
  };
  const lead = leadId ? await getLeadById(leadId) : null;
  if (!lead) {
    return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  }

  // Exactly the buttons the wrap-up grid renders: the org taxonomy, narrowed
  // by the campaign subset the client is dialing under.
  const vocab = orgVocabulary(viewer.org);
  const resolved = filterOutcomeOptionsByKeys(
    resolveOutcomeOptions(vocab, viewer.org?.settings.dispositions),
    Array.isArray(allowedKeys) ? allowedKeys.filter((k) => typeof k === "string") : [],
  );
  const options: SuggestionOption[] = resolved.map((o) => ({
    key: o.key,
    outcome: o.value,
    label: o.label,
    description: o.description,
  }));

  const result = await getWrapupSuggestion(
    lead,
    {
      notes: typeof notes === "string" ? notes.slice(0, 4000) : undefined,
      durationSec:
        typeof durationSec === "number" && Number.isFinite(durationSec)
          ? Math.max(0, Math.round(durationSec))
          : undefined,
    },
    options,
    orgAIContext(viewer.org),
  );

  // Server-side validation: only a key from the menu survives.
  const picked = options.find((o) => o.key === result.data.recommendedKey) ?? null;
  const data: WrapupSuggestion = {
    recommendedKey: picked?.key ?? "",
    recommendedOutcome: picked?.outcome ?? "qualified",
    recommendedLabel: picked?.label ?? "",
    rationale: String(result.data.rationale ?? "").slice(0, 300),
    quickSummary: String(result.data.quickSummary ?? "").slice(0, 300),
    confidence: Math.min(1, Math.max(0, Number(result.data.confidence) || 0)),
  };
  return NextResponse.json({ data, source: result.source, error: result.error });
}
