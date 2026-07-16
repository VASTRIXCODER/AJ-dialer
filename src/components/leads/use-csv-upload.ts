"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { LeadGroup } from "@/lib/types";

export type UploadStatus = { type: "idle" | "working" | "done" | "error"; message?: string };

/**
 * Shared "read a CSV file, POST it to /api/leads/import, report status" logic —
 * extracted from csv-import.tsx so both the legacy single-button importer and
 * the fixed-group upload tiles (group-upload-grid.tsx) share one implementation.
 * `leadGroup` is stamped on every row in the batch when provided (undefined =
 * don't touch the column at all, matching /api/leads/import's own
 * hasOwnProperty distinction between "omitted" and "explicitly null").
 */
export function useCsvUpload(opts: { leadGroup?: LeadGroup | null; campaignId?: string | null } = {}) {
  const router = useRouter();
  const [status, setStatus] = useState<UploadStatus>({ type: "idle" });

  async function handleFile(file: File) {
    setStatus({ type: "working", message: `Reading ${file.name}…` });
    try {
      const text = await file.text();
      if (!text.trim()) {
        setStatus({ type: "error", message: "That file looks empty." });
        return;
      }
      setStatus({ type: "working", message: "Reading your columns…" });
      const res = await fetch("/api/leads/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          csv: text,
          ...(opts.campaignId ? { campaignId: opts.campaignId } : {}),
          ...(opts.leadGroup !== undefined ? { leadGroup: opts.leadGroup } : {}),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.error) {
        setStatus({ type: "error", message: json.error ?? "Import failed." });
        return;
      }
      const skipped = typeof json.invalidPhone === "number" ? json.invalidPhone : 0;
      const skipNote = skipped > 0 ? ` (${skipped} without a valid phone — not dialable)` : "";
      const how = json.source === "ai" ? " — columns mapped by AI" : "";
      if (json.aiError) {
        setStatus({
          type: "error",
          message: `Imported ${json.inserted} leads, but AI column mapping didn't run: ${json.aiError}`,
        });
      } else {
        setStatus({ type: "done", message: `Imported ${json.inserted} leads${skipNote}${how}.` });
      }
      router.refresh();
    } catch {
      setStatus({ type: "error", message: "Couldn't read that file." });
    }
  }

  return { status, handleFile };
}
