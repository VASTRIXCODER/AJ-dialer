import { NextResponse } from "next/server";
import {
  createImportJob,
  listImportJobs,
  normalizeDedupeMode,
} from "@/lib/db/lead-import";
import { sanitizeColumnPlan } from "@/lib/leads/parse-request";
import { getViewer } from "@/lib/org/membership";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { count } from "@/lib/telemetry";

export const dynamic = "force-dynamic";

/**
 * Import jobs — the ledger every Import Studio run writes against.
 * POST creates one (before the first chunk is sent); GET lists the org's
 * recent 20 so the Upload step can show what happened lately and offer
 * rollback on jobs that still qualify.
 */
export async function POST(req: Request) {
  const viewer = await getViewer();
  if (!viewer.permissions.includes("leads.import")) {
    return NextResponse.json(
      { error: "You don't have permission to import leads." },
      { status: 403 },
    );
  }
  if (!viewer.org?.id) {
    return NextResponse.json(
      { error: "Join a workspace before importing leads." },
      { status: 400 },
    );
  }
  const rl = rateLimit(`import-jobs:${viewer.user?.id ?? clientIp(req)}`, 30, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too many import jobs in a row — wait a moment." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  const body = (await req.json().catch(() => ({}))) as {
    fileName?: string;
    hasHeader?: boolean;
    delimiter?: string;
    dedupeMode?: string;
    destination?: unknown;
    columnPlan?: unknown;
  };

  const DELIMS = new Set([",", ";", "\t", "|"]);
  const job = await createImportJob({
    orgId: viewer.org.id,
    createdBy: viewer.user?.id ?? null,
    fileName: String(body.fileName ?? "Upload").slice(0, 200),
    hasHeader: body.hasHeader !== false,
    delimiter:
      typeof body.delimiter === "string" && DELIMS.has(body.delimiter)
        ? body.delimiter
        : ",",
    dedupeMode: normalizeDedupeMode(body.dedupeMode),
    destination:
      body.destination && typeof body.destination === "object"
        ? (body.destination as Record<string, unknown>)
        : {},
    columnPlan: sanitizeColumnPlan(body.columnPlan),
  });
  if (!job) {
    return NextResponse.json(
      { error: "Connect Supabase to track import jobs." },
      { status: 503 },
    );
  }
  count("import.job_created", 1, { orgId: viewer.org.id });
  return NextResponse.json({ jobId: job.id });
}

export async function GET() {
  const viewer = await getViewer();
  if (!viewer.permissions.includes("leads.import")) {
    return NextResponse.json(
      { error: "You don't have permission to import leads." },
      { status: 403 },
    );
  }
  if (!viewer.org?.id) return NextResponse.json({ jobs: [] });
  const jobs = await listImportJobs(viewer.org.id, 20);
  return NextResponse.json({ jobs });
}
