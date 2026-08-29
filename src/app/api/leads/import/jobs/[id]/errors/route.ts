import { CSV_BOM, CSV_EOL, csvLine } from "@/lib/csv-safety";
import { getImportJob } from "@/lib/db/lead-import";
import { getViewer } from "@/lib/org/membership";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The job's error rows as a downloadable CSV — file row number + what went
 * wrong — through the shared csv-safety encoder so a hostile cell in an error
 * message can never become a formula on someone's spreadsheet.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const viewer = await getViewer();
  if (!viewer.permissions.includes("leads.import")) {
    return new Response("You don't have permission to import leads.", { status: 403 });
  }
  const { id } = await params;
  if (!UUID.test(id)) return new Response("Unknown import job.", { status: 404 });
  const job = await getImportJob(id);
  if (!job || !viewer.org?.id || job.orgId !== viewer.org.id) {
    return new Response("Unknown import job.", { status: 404 });
  }

  const lines = [
    csvLine(["Row", "Error"]),
    ...job.errorRows.map((e) =>
      csvLine([e.row >= 0 ? e.row + 1 : "", String(e.message ?? "")]),
    ),
  ];
  const csv = CSV_BOM + lines.join(CSV_EOL) + CSV_EOL;
  const safeName = (job.fileName || "import").replace(/[^\w.-]+/g, "_").slice(0, 80);
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${safeName}-errors.csv"`,
      "cache-control": "no-store",
    },
  });
}
