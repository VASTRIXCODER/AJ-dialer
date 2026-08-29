import { NextResponse } from "next/server";
import {
  detectDelimiter,
  guessHasHeader,
  mapHeader,
  parseSheet,
  type Field,
} from "@/lib/leads/csv";
import { parseCsvToLeads, type ColumnPlan } from "@/lib/leads/parse-request";
import { getViewer } from "@/lib/org/membership";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/** The head of the file the wizard sends for inspection — enough rows to judge
 *  every column, small enough to be a fast round trip. */
const MAX_HEAD_BYTES = 512 * 1024;

/** What the wizard's mapping step shows per column. */
interface ColumnInspection {
  index: number;
  /** The header cell (or "Column N" when the file has none). */
  header: string;
  /** Up to 6 non-empty data values, for the human to eyeball. */
  samples: string[];
  /** What the resolved plan proposes this column is. */
  proposal:
    | { kind: "core"; field: string }
    | { kind: "custom"; key: string; label: string; type: string }
    | { kind: "dnc" }
    | { kind: "ignore" };
  /** high = mapped by its own header name; medium = inferred from the data
   *  (sniffed phone, AI mapping, custom capture); low = nothing claimed it. */
  confidence: "high" | "medium" | "low";
}

/**
 * Inspect the head of a file: resolve the column plan the import would use
 * (the same deterministic-vs-AI head-to-head the import itself runs), and
 * return it per column with samples so the Import Studio's mapping step can
 * show — and let a human correct — every decision before any row is written.
 */
export async function POST(req: Request) {
  const viewer = await getViewer();
  if (!viewer.permissions.includes("leads.import")) {
    return NextResponse.json(
      { error: "You don't have permission to import leads." },
      { status: 403 },
    );
  }
  const rl = rateLimit(`import-inspect:${viewer.user?.id ?? clientIp(req)}`, 30, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too many files inspected in a row — wait a moment." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  const body = (await req.json().catch(() => ({}))) as {
    csvHead?: string;
    hasHeader?: boolean;
    delimiter?: string;
  };
  if (typeof body.csvHead !== "string" || !body.csvHead.trim()) {
    return NextResponse.json({ error: "That file looks empty." }, { status: 400 });
  }
  if (body.csvHead.length > MAX_HEAD_BYTES) {
    return NextResponse.json(
      { error: "Send only the head of the file for inspection (≤512 KB)." },
      { status: 413 },
    );
  }

  const DELIMS = new Set([",", ";", "\t", "|"]);
  const delimiter =
    typeof body.delimiter === "string" && DELIMS.has(body.delimiter)
      ? body.delimiter
      : undefined;
  const hasHeader = typeof body.hasHeader === "boolean" ? body.hasHeader : undefined;

  const firstLine = body.csvHead.replace(/^﻿/, "").split(/\r?\n/, 1)[0] ?? "";
  const usedDelimiter = delimiter ?? detectDelimiter(firstLine);
  const grid = parseSheet(body.csvHead, usedDelimiter);
  if (!grid.length) {
    return NextResponse.json({ error: "That file looks empty." }, { status: 400 });
  }

  const guessedHasHeader = guessHasHeader(grid);
  const effectiveHasHeader = hasHeader ?? guessedHasHeader;

  // Reuse the import's own head-to-head parse to produce the plan — the wizard
  // previews exactly what the import would do, not a parallel implementation.
  const parsed = await parseCsvToLeads(body.csvHead, {
    hasHeader: effectiveHasHeader,
    delimiter: usedDelimiter,
  });

  const width = grid.reduce((m, r) => Math.max(m, r.length), 0);
  const dataStart = effectiveHasHeader ? 1 : 0;
  const sampleOf = (col: number): string[] => {
    const out: string[] = [];
    for (let r = dataStart; r < grid.length && out.length < 6; r++) {
      const v = (grid[r]?.[col] ?? "").trim();
      if (v) out.push(v.slice(0, 80));
    }
    return out;
  };

  // Per-column proposals from the resolved plan (when parsing succeeded).
  const plan: ColumnPlan | null = "error" in parsed ? null : parsed.plan;
  const proposals = new Map<number, ColumnInspection["proposal"]>();
  const strong = new Set<number>(); // header-name matches — high confidence
  if (plan?.kind === "headers") {
    plan.header.forEach((field: Field, i) => {
      if (field) proposals.set(i, { kind: "core", field });
    });
    if (effectiveHasHeader) {
      // Which of those came from the header's own words (vs. data sniffing)?
      (grid[0] ?? []).forEach((h, i) => {
        if (mapHeader(h) && proposals.has(i)) strong.add(i);
      });
    }
  } else if (plan?.kind === "ai") {
    const m = plan.mapping;
    const core: [number, string][] = [
      [m.firstNameCol, "firstName"],
      [m.lastNameCol, "lastName"],
      [m.fullNameCol, "name"],
      [m.addressCol, "address"],
      [m.address2Col, "address2"],
      [m.cityCol, "city"],
      [m.stateCol, "state"],
      [m.zipCol, "zip"],
      [m.utilityBillCol, "utilityBill"],
    ];
    for (const [col, field] of core) {
      if (col >= 0) proposals.set(col, { kind: "core", field });
    }
    m.emailCols.forEach((c) => {
      if (c >= 0 && !proposals.has(c)) proposals.set(c, { kind: "core", field: "email" });
    });
    m.phoneCols.forEach((p) => {
      if (p.numberCol >= 0) proposals.set(p.numberCol, { kind: "core", field: "phone" });
      if (p.dncCol >= 0 && !proposals.has(p.dncCol)) proposals.set(p.dncCol, { kind: "dnc" });
    });
  }
  for (const cap of plan?.captures ?? []) {
    if (!proposals.has(cap.col)) {
      proposals.set(cap.col, {
        kind: "custom",
        key: cap.key,
        label: cap.label,
        type: cap.type,
      });
    }
  }

  const columns: ColumnInspection[] = Array.from({ length: width }, (_, i) => {
    const proposal = proposals.get(i) ?? { kind: "ignore" as const };
    return {
      index: i,
      header: effectiveHasHeader
        ? (grid[0]?.[i] ?? "").trim() || `Column ${i + 1}`
        : `Column ${i + 1}`,
      samples: sampleOf(i),
      proposal,
      confidence:
        proposal.kind === "ignore" ? "low" : strong.has(i) ? "high" : "medium",
    };
  });

  return NextResponse.json({
    plan,
    columns,
    guessedHasHeader,
    delimiter: usedDelimiter,
    source: "error" in parsed ? null : parsed.source,
    aiError: "error" in parsed ? null : parsed.aiError,
    // A parse failure is still an inspectable file — the human may just need to
    // flip the header toggle or the delimiter and inspect again.
    error: "error" in parsed ? parsed.error : null,
    rows: Math.max(0, grid.length - dataStart),
  });
}
