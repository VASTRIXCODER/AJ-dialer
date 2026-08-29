import { NextResponse } from "next/server";
import { getImportJob, setImportJobStatus } from "@/lib/db/lead-import";
import { getViewer } from "@/lib/org/membership";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Resolve the job IF it belongs to the viewer's workspace. */
async function authorizedJob(id: string) {
  const viewer = await getViewer();
  if (!viewer.permissions.includes("leads.import")) {
    return { error: "You don't have permission to import leads.", status: 403 as const };
  }
  if (!UUID.test(id)) return { error: "Unknown import job.", status: 404 as const };
  const job = await getImportJob(id);
  if (!job || !viewer.org?.id || job.orgId !== viewer.org.id) {
    return { error: "Unknown import job.", status: 404 as const };
  }
  return { job, viewer };
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const res = await authorizedJob(id);
  if ("error" in res) {
    return NextResponse.json({ error: res.error }, { status: res.status });
  }
  return NextResponse.json({ job: res.job });
}

/**
 * Cancel or complete a running job. `cancel` is what the wizard's Cancel button
 * calls between chunks — the import route refuses further chunks the moment the
 * job leaves 'running', so a cancel actually stops the upload rather than
 * decorating it. `complete` stamps finished_at when the last chunk lands.
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const res = await authorizedJob(id);
  if ("error" in res) {
    return NextResponse.json({ error: res.error }, { status: res.status });
  }
  const body = (await req.json().catch(() => ({}))) as { action?: string };
  if (body.action !== "cancel" && body.action !== "complete") {
    return NextResponse.json(
      { error: "action must be 'cancel' or 'complete'." },
      { status: 400 },
    );
  }
  if (res.job.status !== "running") {
    return NextResponse.json(
      { error: "That import job has already finished." },
      { status: 409 },
    );
  }
  const ok = await setImportJobStatus(
    res.job.id,
    body.action === "cancel" ? "canceled" : "completed",
  );
  if (!ok) {
    return NextResponse.json({ error: "Couldn't update the job." }, { status: 500 });
  }
  const job = await getImportJob(res.job.id);
  return NextResponse.json({ ok: true, job });
}
