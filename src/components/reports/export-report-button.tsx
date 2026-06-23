"use client";

import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface CsvSection {
  title: string;
  headers: string[];
  rows: (string | number)[][];
}

/** Client-side CSV export — builds a multi-section CSV from the report data and
 *  triggers a download. No round-trip needed; works fully offline. */
export function ExportReportButton({
  filename,
  sections,
}: {
  filename: string;
  sections: CsvSection[];
}) {
  function download() {
    const esc = (v: string | number) => {
      const s = String(v ?? "");
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines: string[] = [];
    for (const sec of sections) {
      lines.push(sec.title);
      lines.push(sec.headers.map(esc).join(","));
      for (const row of sec.rows) lines.push(row.map(esc).join(","));
      lines.push("");
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
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
