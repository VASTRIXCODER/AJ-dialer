"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
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
export function useCsvUpload(
  opts: {
    leadGroup?: LeadGroup | null;
    campaignId?: string | null;
    /** Cut this import into numbered packs of roughly this many leads. 0 = off. */
    packSize?: number;
    /** What the packs are named after — normally the source file. */
    packBatch?: string;
  } = {},
) {
  const router = useRouter();
  const [status, setStatus] = useState<UploadStatus>({ type: "idle" });
  // Set when /api/leads/import blocks on an uncertified campaign — the file's
  // already-read text is kept so the dialog's "certify" can retry the SAME
  // import without asking the rep to re-pick or re-drop the file.
  const [certPrompt, setCertPrompt] = useState<{ campaignId: string | null } | null>(null);
  const pendingTextRef = useRef<string | null>(null);

  async function runImport(text: string) {
    const res = await fetch("/api/leads/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        csv: text,
        ...(opts.campaignId ? { campaignId: opts.campaignId } : {}),
        ...(opts.leadGroup !== undefined ? { leadGroup: opts.leadGroup } : {}),
        ...(opts.packSize && opts.packSize > 0
          ? { packSize: opts.packSize, packBatch: opts.packBatch ?? "Upload" }
          : {}),
      }),
    });
    const json = await res.json().catch(() => ({}));

    if (json.certificationRequired) {
      pendingTextRef.current = text;
      setCertPrompt({ campaignId: json.campaignId ?? null });
      setStatus({ type: "idle" });
      return;
    }
    if (!res.ok || json.error) {
      setStatus({ type: "error", message: json.error ?? "Import failed." });
      return;
    }
    const skipped = typeof json.invalidPhone === "number" ? json.invalidPhone : 0;
    const duplicates = typeof json.duplicates === "number" ? json.duplicates : 0;
    const notes = [
      skipped > 0 ? `${skipped} without a valid phone — not dialable` : "",
      duplicates > 0 ? `${duplicates} already in your org's leads — skipped` : "",
    ].filter(Boolean);
    const skipNote = notes.length ? ` (${notes.join("; ")})` : "";
    const how = json.source === "ai" ? " — columns mapped by AI" : "";
    const packNote =
      typeof json.packs === "number" && json.packs > 0
        ? ` · ${json.packs} pack${json.packs === 1 ? "" : "s"}`
        : "";
    if (json.aiError) {
      setStatus({
        type: "error",
        message: `Imported ${json.inserted} leads, but AI column mapping didn't run: ${json.aiError}`,
      });
    } else {
      setStatus({
        type: "done",
        message: `Imported ${json.inserted} leads${skipNote}${how}${packNote}.`,
      });
    }
    router.refresh();
  }

  async function handleFile(file: File) {
    setStatus({ type: "working", message: `Reading ${file.name}…` });
    try {
      const text = await file.text();
      if (!text.trim()) {
        setStatus({ type: "error", message: "That file looks empty." });
        return;
      }
      setStatus({ type: "working", message: "Reading your columns…" });
      await runImport(text);
    } catch {
      setStatus({ type: "error", message: "Couldn't read that file." });
    }
  }

  async function certifyAndRetry() {
    const text = pendingTextRef.current;
    if (!text) return;
    setCertPrompt(null);
    setStatus({ type: "working", message: "Reading your columns…" });
    try {
      await runImport(text);
    } catch {
      setStatus({ type: "error", message: "Couldn't read that file." });
    }
  }

  function cancelCert() {
    pendingTextRef.current = null;
    setCertPrompt(null);
    setStatus({ type: "idle" });
  }

  return { status, handleFile, certPrompt, certifyAndRetry, cancelCert };
}
