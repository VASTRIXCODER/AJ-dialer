import { NextResponse } from "next/server";
import { orgAIContext } from "@/lib/ai/org-context";
import { getSemanticSearch } from "@/lib/ai/services";
import { searchLeadCandidates } from "@/lib/db/leads";
import { formatFieldValue, leadFieldValue } from "@/lib/leads/field-schema";
import { getViewer } from "@/lib/org/membership";
import { orgVocabulary } from "@/lib/org/vocabulary";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export async function POST(req: Request) {
  const { query } = await req.json().catch(() => ({}) as { query?: string });
  if (!query || !query.trim()) {
    return NextResponse.json({ source: "demo", interpretation: "", matches: [] });
  }

  // Require a signed-in user: this embeds the caller's raw query into a Claude
  // prompt, so an anonymous caller could otherwise run up unmetered Anthropic
  // spend (and use it as a prompt-injection surface).
  const viewer = await getViewer();
  if (!viewer.isDemo && !viewer.user) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }
  // Each query is a Claude call — throttle so it can't be run up in a loop.
  const rl = rateLimit(`ai-search:${viewer.user?.id ?? clientIp(req)}`, 30, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { source: "demo", interpretation: "", matches: [] },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }
  // STAGE 1 — retrieve a bounded candidate set in SQL (or the JS twin in demo/
  // degraded mode) instead of pulling the viewer's entire book and slicing the
  // first 80: the whole book is now searchable, and each keystroke batch costs
  // two indexed queries rather than a full-table page-through.
  const leads = await searchLeadCandidates(query);
  // No candidates → nothing to rerank; skip the model call entirely and return
  // the palette's empty shape ("demo" is its well-defined no-model source).
  if (!leads.length) {
    return NextResponse.json({ source: "demo", interpretation: "", matches: [] });
  }
  const ctx = orgAIContext(viewer.org);
  const { data, source, error } = await getSemanticSearch(query, leads, ctx.isSolar, ctx);
  const byId = new Map(leads.map((l) => [l.id, l]));

  // The headline figure on a result row used to be `lead.utilityBill`, hardcoded
  // — so a recruiting workspace saw a homeowner's power bill slot labelled
  // "/mo". Take the org's OWN first money field instead (an insurance org's
  // "Current premium", a recruiter's "Desired pay") and send it pre-labelled and
  // pre-formatted, so the palette renders the org's vocabulary without knowing
  // anything about it.
  const moneyField = ctx.fields.find((f) => f.type === "currency");
  const matches = data.matches
    .map((m) => {
      const l = byId.get(m.id);
      if (!l) return null;
      const raw = moneyField ? leadFieldValue(l, moneyField) : null;
      return {
        id: l.id,
        reason: m.reason,
        name: `${l.firstName} ${l.lastName}`,
        city: l.city,
        state: l.state,
        headline:
          moneyField && raw != null && raw !== "" && raw !== 0
            ? formatFieldValue(raw, moneyField.type)
            : null,
        status: l.status,
      };
    })
    .filter(Boolean);

  return NextResponse.json({
    source,
    error,
    interpretation: data.interpretation,
    matches,
    leadNounPlural: orgVocabulary(viewer.org).LeadNounPlural,
  });
}
