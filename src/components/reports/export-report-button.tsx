"use client";

import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CSV_BOM, CSV_EOL, csvLine } from "@/lib/csv-safety";

export interface CsvSection {
  title: string;
  headers: string[];
  rows: (string | number)[][];
}

/** Client-side CSV export — builds a multi-section CSV from the report data and
 *  triggers a download. No round-trip needed; works fully offline.
 *
 *  Cells go through the shared csv-safety encoder: report rows carry lead names
 *  that originate in customer CSVs, so this export needs the same
 *  formula-injection neutralization the leads export has. BOM + CRLF so Excel
 *  reads accents and row breaks correctly. */
export function ExportReportButton({
  filename,
  sections,
}: {
  filename: string;
  sections: CsvSection[];
}) {
  function download() {
    const lines: string[] = [];
    for (const sec of sections) {
      lines.push(csvLine([sec.title]));
      lines.push(csvLine(sec.headers));
      for (const row of sec.rows) lines.push(csvLine(row));
      lines.push("");
    }
    const blob = new Blob([CSV_BOM + lines.join(CSV_EOL)], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Button variant="outline" size="sm" className="gap-2" onClick={download}>
      <Download className="h-4 w-4" />
      Export CSV
    </Button>
  );
}
