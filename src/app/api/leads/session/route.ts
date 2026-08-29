import { NextResponse } from "next/server";
import {
  sanitizeGroups,
  sanitizeSegments,
  type ContactFilter,
  type SessionOrder,
  type SessionSpec,
} from "@/lib/dialer/segments";
import { buildSession, countSession, MAX_SESSION_LEADS } from "@/lib/db/session-builder";

export const dynamic = "force-dynamic";

const CONTACT: ContactFilter[] = ["any", "never", "contacted"];
const ORDER: SessionOrder[] = ["ai_score", "oldest", "least_recent"];

/**
 * Materialise a dial session: the exact, ordered list of leads this run will call.
 *
 * POST with a SessionSpec; get back the leads plus the honest total. `preview:true`
 * returns only the count (no rows), so the widget can show "this will call 4,312
 * leads" as the operator adjusts filters, without shipping 4,312 records per
 * keystroke.
 *
 * DNC leads are stripped SERVER-SIDE (sanitizeSegments) — a hand-rolled request
 * that bypasses the UI still cannot get one into a queue.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    statuses?: string[];
    contact?: string;
    order?: string;
    limit?: number;
    campaignId?: string | null;
    groups?: string[];
    orgWide?: boolean;
    leadIds?: string[];
    preview?: boolean;
  };

  const spec: SessionSpec = {
    statuses: sanitizeSegments(Array.isArray(body.statuses) ? body.statuses : []),
    contact: CONTACT.includes(body.contact as ContactFilter)
      ? (body.contact as ContactFilter)
      : "any",
    // Falls back to upload order, matching the builder's default. ai_score is a
    // moving target (each call rewrites it), so it must be chosen explicitly
    // rather than being what an unspecified request silently gets.
    order: ORDER.includes(body.order as SessionOrder)
      ? (body.order as SessionOrder)
      : "oldest",
    limit: Math.max(1, Math.min(Number(body.limit) || 100, MAX_SESSION_LEADS)),
    campaignId: body.campaignId ?? null,
    groups: sanitizeGroups(body.groups),
    // Supervisor-verified server-side (buildSession/countSession silently
    // own-scope a rep's request) — this flag alone grants nothing.
    orgWide: body.orgWide === true,
    leadIds: Array.isArray(body.leadIds) ? body.leadIds.slice(0, MAX_SESSION_LEADS) : undefined,
  };

  // Preview: just the number, so the summary line stays live while filters change.
  if (body.preview) {
    return NextResponse.json({ available: await countSession(spec), spec });
  }

  const leads = await buildSession(spec);
  return NextResponse.json({ leads, count: leads.length, spec });
}
