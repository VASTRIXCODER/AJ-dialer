"use client";

import {
  AlertTriangle,
  CheckCircle2,
  FileSpreadsheet,
  Loader2,
  UploadCloud,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn, isValidPhone, normalizePhone } from "@/lib/utils";

type LeadInput = {
  firstName: string;
  lastName: string;
  phone: string;
  email?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  utilityProvider?: string;
  solarProvider?: string;
  utilityBill?: number;
  solarPayment?: number;
  notes?: string;
};

/** Result of turning a sheet into leads, with counts so we can report skips. */
type ParseResult = {
  leads: LeadInput[];
  /** Rows that had data but no dialable phone number. */
  noPhone: number;
  /** Whether any column mapped to a phone at all (catches bad delimiters). */
  sawPhoneColumn: boolean;
};

/** Detect the most likely delimiter from the header line (comma/semicolon/tab/pipe). */
function detectDelimiter(firstLine: string): string {
  const candidates = [",", ";", "\t", "|"];
  let best = ",";
  let bestCount = 0;
  for (const d of candidates) {
    // Count delimiters that sit outside quotes — good enough for a header row.
    const count = firstLine.split(d).length - 1;
    if (count > bestCount) {
      bestCount = count;
      best = d;
    }
  }
  return best;
}

/** RFC-4180-ish parser that honors a chosen delimiter (handles quotes + escapes). */
function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === delimiter) {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (ch !== "\r") field += ch;
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim().length));
}

/** Parse a spreadsheet, auto-detecting the delimiter and stripping any BOM. */
function parseSheet(raw: string): string[][] {
  const text = raw.replace(/^﻿/, "");
  const nl = text.indexOf("\n");
  const firstLine = nl === -1 ? text : text.slice(0, nl);
  return parseDelimited(text, detectDelimiter(firstLine));
}

/**
 * Map a column header to a lead field. Phone is checked FIRST and matches a wide
 * range of names (phone, mobile, cell, tel, contact number, etc.) so a customer's
 * column never silently fails to map — the usual cause of un-dialable imports.
 */
function mapHeader(h: string): keyof LeadInput | "name" | null {
  const n = h.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!n) return null;
  // ── Phone (broad, checked before everything else) ──
  if (
    n.includes("phone") ||
    n.includes("mobile") ||
    n.includes("cell") ||
    n.includes("telephone") ||
    n === "tel" ||
    n === "ph" ||
    n === "phno" ||
    n === "number" ||
    n === "msisdn" ||
    n.includes("contactnumber") ||
    n.includes("contactno") ||
    n.includes("phonenumber") ||
    n.includes("wireless")
  )
    return "phone";
  // ── Name parts ──
  if (n.includes("firstname") || n === "first" || n === "fname" || n === "givenname")
    return "firstName";
  if (
    n.includes("lastname") ||
    n === "last" ||
    n === "lname" ||
    n === "surname" ||
    n === "familyname"
  )
    return "lastName";
  if (
    n === "name" ||
    n === "fullname" ||
    n === "homeowner" ||
    n === "customer" ||
    n === "customername" ||
    n === "contact" ||
    n === "contactname" ||
    n === "leadname"
  )
    return "name";
  // ── Contact + address ──
  if (n.includes("email") || n === "mail") return "email";
  if (
    n.includes("street") ||
    n === "address" ||
    n === "address1" ||
    n === "streetaddress" ||
    n.includes("addr")
  )
    return "address";
  if (n === "city" || n === "town") return "city";
  if (n === "state" || n === "st" || n.includes("province") || n === "region") return "state";
  if (n.includes("zip") || n.includes("postal") || n === "postcode") return "zip";
  // ── Solar economics ──
  if (
    (n.includes("utility") || n.includes("electric") || n.includes("power")) &&
    (n.includes("bill") || n.includes("amount") || n.includes("cost"))
  )
    return "utilityBill";
  if (
    n.includes("solar") &&
    (n.includes("payment") || n.includes("pmt") || n.includes("loan") || n.includes("lease"))
  )
    return "solarPayment";
  if (n.includes("utility") || n === "provider") return "utilityProvider";
  if (n.includes("solar")) return "solarProvider";
  // ── Free text ──
  if (n.includes("note") || n.includes("comment") || n.includes("remark")) return "notes";
  return null;
}

function rowsToLeads(grid: string[][]): ParseResult {
  if (grid.length < 2) return { leads: [], noPhone: 0, sawPhoneColumn: false };
  const header = grid[0].map(mapHeader);
  const sawPhoneColumn = header.includes("phone");
  const out: LeadInput[] = [];
  let noPhone = 0;
  for (let r = 1; r < grid.length; r++) {
    const cells = grid[r];
    const lead: LeadInput = { firstName: "", lastName: "", phone: "" };
    header.forEach((key, c) => {
      const val = (cells[c] ?? "").trim();
      if (!key || !val) return;
      if (key === "name") {
        // Only split a combined name into the parts we don't already have.
        const parts = val.split(/\s+/);
        lead.firstName = lead.firstName || parts[0] || "";
        lead.lastName = lead.lastName || parts.slice(1).join(" ");
      } else if (key === "utilityBill" || key === "solarPayment") {
        const num = Number(val.replace(/[^0-9.]/g, ""));
        if (!Number.isNaN(num) && num > 0) lead[key] = num;
      } else if (key === "phone") {
        // Normalize to E.164 right here so storage + dialing are consistent.
        // Keep the original when it can't be normalized so the row still imports
        // (it just won't be dialable) — preserving the user's data.
        lead.phone = normalizePhone(val) || val;
      } else {
        lead[key] = val;
      }
    });
    const hasName = Boolean(lead.firstName || lead.lastName);
    if (!lead.phone && !hasName) continue; // truly empty row
    if (lead.phone && !isValidPhone(lead.phone)) noPhone++;
    out.push(lead);
  }
  return { leads: out, noPhone, sawPhoneColumn };
}

type Status = { type: "idle" | "working" | "done" | "error"; message?: string };

export function CsvImport({
  variant = "dropzone",
  campaigns = [],
}: {
  variant?: "dropzone" | "button";
  campaigns?: { id: string; name: string }[];
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<Status>({ type: "idle" });
  const [dragOver, setDragOver] = useState(false);
  const [campaignId, setCampaignId] = useState("");

  async function handleFile(file: File) {
    setStatus({ type: "working", message: `Reading ${file.name}…` });
    try {
      const text = await file.text();
      const { leads, noPhone, sawPhoneColumn } = rowsToLeads(parseSheet(text));
      if (!leads.length) {
        setStatus({
          type: "error",
          message: sawPhoneColumn
            ? "No leads found — check your CSV has data rows under the headers."
            : "No phone column detected. Add a column named Phone / Mobile / Cell.",
        });
        return;
      }
      const res = await fetch("/api/leads/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rows: leads, campaignId: campaignId || null }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.error) {
        setStatus({ type: "error", message: json.error ?? "Import failed." });
        return;
      }
      // Surface how many rows imported without a dialable number so the user
      // isn't surprised when those leads don't appear in the dial queue.
      const skipped = typeof json.invalidPhone === "number" ? json.invalidPhone : noPhone;
      const suffix = skipped > 0 ? ` (${skipped} without a valid phone — not dialable)` : "";
      setStatus({ type: "done", message: `Imported ${json.inserted} leads${suffix}.` });
      router.refresh();
    } catch {
      setStatus({ type: "error", message: "Couldn’t read that file." });
    }
  }

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) handleFile(f);
    e.target.value = "";
  };

  const hiddenInput = (
    <input
      ref={inputRef}
      type="file"
      accept=".csv,text/csv"
      className="hidden"
      onChange={onPick}
    />
  );

  const campaignPicker = campaigns.length > 0 && (
    <select
      value={campaignId}
      onChange={(e) => setCampaignId(e.target.value)}
      className="h-9 rounded-xl border border-border bg-background/60 px-2.5 text-sm text-foreground transition-colors focus-visible:border-primary/50 focus-visible:outline-none"
      title="Assign imported leads to a campaign"
    >
      <option value="">No campaign</option>
      {campaigns.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
    </select>
  );

  const statusLine = status.message && (
    <p
      className={cn(
        "mt-3 flex items-center justify-center gap-1.5 text-xs",
        status.type === "error"
          ? "text-danger"
          : status.type === "done"
            ? "text-success"
            : "text-muted-foreground",
      )}
    >
      {status.type === "working" ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : status.type === "error" ? (
        <AlertTriangle className="h-3.5 w-3.5" />
      ) : status.type === "done" ? (
        <CheckCircle2 className="h-3.5 w-3.5" />
      ) : null}
      {status.message}
    </p>
  );

  if (variant === "button") {
    return (
      <>
        {hiddenInput}
        <div className="flex items-center gap-2">
          {campaignPicker}
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={() => inputRef.current?.click()}
            disabled={status.type === "working"}
          >
            {status.type === "working" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <UploadCloud className="h-4 w-4" />
            )}
            Import CSV
          </Button>
        </div>
        {statusLine}
      </>
    );
  }

  return (
    <div>
      {hiddenInput}
      {campaignPicker && <div className="mb-3 flex justify-center">{campaignPicker}</div>}
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const f = e.dataTransfer.files?.[0];
          if (f) handleFile(f);
        }}
        className={cn(
          "flex w-full flex-col items-center justify-center rounded-2xl border-2 border-dashed p-10 text-center transition-colors",
          dragOver
            ? "border-primary bg-primary-soft/40"
            : "border-border bg-muted/30 hover:border-primary/40 hover:bg-primary-soft/30",
        )}
      >
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-solar text-white shadow-glow">
          <UploadCloud className="h-7 w-7" />
        </div>
        <p className="mt-4 font-semibold">Drop your CSV here</p>
        <p className="mt-1 text-sm text-muted-foreground">
          or click to browse — columns are mapped automatically
        </p>
        <span className="mt-4 inline-flex items-center gap-2 rounded-xl border border-border/70 px-3 py-1.5 text-sm font-medium">
          <FileSpreadsheet className="h-4 w-4" />
          Choose file
        </span>
      </button>
      {statusLine}
    </div>
  );
}
