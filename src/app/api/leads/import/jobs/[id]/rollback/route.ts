import { NextResponse } from "next/server";
import { getImportJob, rollbackImportJob } from "@/lib/db/lead-import";
import { getViewer } from "@/lib/org/membership";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Roll an import job back: delete ONLY its provably-untouched rows (still
 * status 'new', never contacted, zero attempts, and nothing references them)
 * and report exactly what was removed vs. kept. Worked leads always survive —
 * a rollback undoes an import, never a rep's afternoon.
 *
 * Allowed for the job's creator or an org admin/owner (both must also hold
 * leads.import): a manager can undo their own mistake, but can't quietly
 * unwind a colleague's import.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const viewer = await getViewer();
  if (!viewer.permissions.includes("leads.import")) {
    return NextResponse.json(
      { error: "You don't have permission to import leads." },
      { status: 403 },
    );
  }
  const rl = rateLimit(`import-rollback:${viewer.user?.id ?? clientIp(req)}`, 10, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too many rollbacks in a row — wait a moment." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  const { id } = await params;
  if (!UUID.test(id)) {
    return NextResponse.json({ error: "Unknown import job." }, { status: 404 });
  }
  const job = await getImportJob(id);
  if (!job || !viewer.org?.id || job.orgId !== viewer.org.id) {
    return NextResponse.json({ error: "Unknown import job." }, { status: 404 });
  }

  const isCreator = Boolean(viewer.user?.id && job.createdBy === viewer.user.id);
  const isAdmin = viewer.role === "admin" || viewer.role === "owner";
  if (!isCreator && !isAdmin) {
    return NextResponse.json(
      { error: "Only the importer or an admin can roll this import back." },
      { status: 403 },
    );
  }
  if (job.status === "rolled_back") {
    return NextResponse.json(
      { error: "This import has already been rolled back." },
      { status: 409 },
    );
  }
  if (job.status === "running") {
    return NextResponse.json(
      { error: "Cancel the import before rolling it back." },
      { status: 409 },
    );
  }

  const result = await rollbackImportJob(job.id, viewer.org.id);
  if (result.error) {
    return NextResponse.json(
      { error: result.error, removed: result.removed, keptWorked: result.keptWorked },
      { status: 500 },
    );
  }
  return NextResponse.json({
    ok: true,
    removed: result.removed,
    keptWorked: result.keptWorked,
  });
}
