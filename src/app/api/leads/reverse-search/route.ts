import { NextResponse } from "next/server";
import { dncKey, getDncDigits } from "@/lib/db/dnc";
import { getLeadById } from "@/lib/db/leads";
import {
  hasSearchableIdentity,
  isReverseSearchConfigured,
  reverseSearch,
  reverseSearchConfigProblem,
  reverseSearchProviderName,
  type PhoneCandidate,
} from "@/lib/leads/reverse-search";
import { getViewer } from "@/lib/org/membership";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { normalizePhone } from "@/lib/utils";

export const dynamic = "force-dynamic";

interface ResponseCandidate extends PhoneCandidate {
  /** This is the number already on the lead — surfaced as corroboration
   *  ("the vendor agrees with what we have") rather than as a new option. */
  isCurrent: boolean;
}

/**
 * Reverse search (skip trace): a lead's name/address → candidate phone numbers.
 *
 * Deliberately READ-ONLY. It proposes numbers; it never writes one onto the
 * lead. Applying a result is a separate, explicit action through the existing
 * /api/leads/update path, which already carries the row-level authorization
 * (canActOn) and phone normalization. A skip-trace hit is a probabilistic
 * match on a person, not a fact — auto-overwriting a lead's phone with one
 * would silently destroy a known-good number and point the dialer at whoever
 * the data broker guessed.
 *
 * DNC is enforced HERE rather than at dial time: a suppressed number is
 * dropped from the results entirely, so it is never rendered next to a button
 * that would dial it. The count of what was dropped is returned so the UI can
 * explain the gap instead of looking like the search just found less.
 */
export async function POST(req: Request) {
  const viewer = await getViewer();
  if (!viewer.permissions.includes("leads.reverseSearch")) {
    return NextResponse.json(
      { error: "You don't have permission to reverse-search leads." },
      { status: 403 },
    );
  }

  // Skip-trace lookups are metered and billed per query by every vendor, so
  // this is a spend limit as much as an abuse limit — a stuck retry loop on
  // the dialer must not be able to run up a bill.
  const rl = rateLimit(`reverse-search:${viewer.user?.id ?? clientIp(req)}`, 20, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too many lookups in a row — wait a moment and try again." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  const body = (await req.json().catch(() => ({}))) as { leadId?: string };
  if (!body.leadId) {
    return NextResponse.json({ error: "No lead selected." }, { status: 400 });
  }

  // Read the lead SERVER-side rather than trusting a name/address posted by the
  // client: this route spends money per call, so what gets searched has to be a
  // lead the caller can actually see. getLeadById is already scope-checked.
  const lead = await getLeadById(body.leadId);
  if (!lead) {
    return NextResponse.json({ error: "That lead isn't available." }, { status: 404 });
  }

  const input = {
    firstName: lead.firstName,
    lastName: lead.lastName,
    address: lead.address,
    city: lead.city,
    state: lead.state,
    zip: lead.zip,
  };
  if (!hasSearchableIdentity(input)) {
    return NextResponse.json(
      {
        error:
          "Not enough to search on — this lead needs a street address, or a name plus a city, state or ZIP.",
        candidates: [],
      },
      { status: 400 },
    );
  }

  const result = await reverseSearch(input);

  // Drop anything on the org's Do-Not-Call list before it reaches the UI.
  // getDncDigits returns an empty set when Supabase admin isn't configured, so
  // this can be a no-op — that's the same permissive posture the rest of the
  // DNC layer takes, and dial-time scrubbing remains the backstop.
  const dnc = await getDncDigits(viewer.org?.id ?? null);
  const currentPhone = normalizePhone(lead.phone ?? "");
  const kept: ResponseCandidate[] = [];
  let suppressed = 0;
  for (const c of result.candidates) {
    if (dnc.size && dnc.has(dncKey(c.phone))) {
      suppressed++;
      continue;
    }
    kept.push({ ...c, isCurrent: Boolean(currentPhone) && c.phone === currentPhone });
  }

  return NextResponse.json({
    candidates: kept,
    suppressed,
    source: result.source,
    provider: result.provider ?? reverseSearchProviderName(),
    configured: isReverseSearchConfigured(),
    // Names the exact env var that's missing when a provider is half-set-up,
    // so "demo result" doesn't read as "the feature is broken".
    configProblem: reverseSearchConfigProblem(),
    error: result.error,
    // Carried all the way to the UI on purpose: "blocked" must never render as
    // "no numbers found". See the note on ReverseSearchResult.pageState.
    pageState: result.pageState,
    note: result.note,
  });
}
