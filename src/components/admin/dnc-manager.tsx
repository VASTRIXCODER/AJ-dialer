"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PhoneOff, Trash2, Upload, Download, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatPhone, relativeTime, cn } from "@/lib/utils";
import { CELL } from "@/lib/ui-density";

interface DncEntry {
  id: string;
  phoneDigits: string;
  reason: string;
  source: string;
  createdAt: string;
}

/** Pull every plausible phone number (10+ digits) out of pasted/CSV text. */
function extractPhones(text: string): string[] {
  const out: string[] = [];
  for (const token of text.split(/[\s,;]+/)) {
    const digits = token.replace(/\D/g, "");
    if (digits.length >= 10) out.push(digits);
  }
  return out;
}

const SOURCE_LABEL: Record<string, string> = {
  rep_disposition: "Rep call",
  ai_disposition: "AI call",
  sms_stop: "SMS STOP",
  import: "Import",
  manual: "Manual",
};

export function DncManager({ canManage }: { canManage: boolean }) {
  const [entries, setEntries] = useState<DncEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/dnc");
      const data = await res.json();
      if (!res.ok) {
        // An empty table on this screen reads as "nobody has asked us to stop
        // calling them". That is the one thing it must never say by accident.
        setLoadError(
          typeof data?.error === "string"
            ? data.error
            : "Couldn't read the Do-Not-Call list just now.",
        );
        setEntries([]);
        return;
      }
      setLoadError(null);
      setEntries(Array.isArray(data.entries) ? data.entries : []);
    } catch {
      setLoadError("Couldn't reach the server to read the Do-Not-Call list.");
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const addOne = useCallback(async () => {
    if (!phone.trim() || busy) return;
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/dnc", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phone, reason: "Added manually" }),
      });
      const data = await res.json();
      if (data.ok) {
        setPhone("");
        await load();
      } else {
        setNote(data.error ?? "Couldn’t add that number.");
      }
    } finally {
      setBusy(false);
    }
  }, [phone, busy, load]);

  const importText = useCallback(
    async (text: string) => {
      const phones = extractPhones(text);
      if (!phones.length) {
        setNote("No phone numbers found in that file.");
        return;
      }
      setBusy(true);
      setNote(null);
      try {
        const res = await fetch("/api/dnc", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ phones }),
        });
        const data = await res.json();
        setNote(`Imported ${data.added ?? 0} number${data.added === 1 ? "" : "s"}.`);
        await load();
      } finally {
        setBusy(false);
      }
    },
    [load],
  );

  const onFile = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const text = await file.text();
      await importText(text);
      if (fileRef.current) fileRef.current.value = "";
    },
    [importText],
  );

  const remove = useCallback(
    async (digits: string) => {
      setBusy(true);
      try {
        await fetch(`/api/dnc?phone=${encodeURIComponent(digits)}`, { method: "DELETE" });
        await load();
      } finally {
        setBusy(false);
      }
    },
    [load],
  );

  const exportCsv = useCallback(() => {
    const lines = ["phone,source,reason,added", ...entries.map(
      (e) => `${e.phoneDigits},${e.source},"${(e.reason || "").replace(/"/g, "''")}",${e.createdAt}`,
    )];
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "do-not-call.csv";
    a.click();
    URL.revokeObjectURL(url);
  }, [entries]);

  return (
    <Card className="space-y-4 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-danger/10 text-danger">
            <PhoneOff className="h-5 w-5" />
          </span>
          <div>
            <h3 className="text-base font-semibold">Do Not Call list</h3>
            <p className="text-sm text-muted-foreground">
              Numbers here are scrubbed from every dial (manual, AI, and auto-dialer) and on import.
            </p>
          </div>
        </div>
        {/* "0 suppressed" and "we could not ask" are the two answers this
            badge most needs to keep apart. */}
        <Badge tone={loadError ? "warning" : "neutral"} className="tabular">
          {loadError ? "Count unavailable" : `${entries.length} suppressed`}
        </Badge>
      </div>

      {loadError && (
        <p className="rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-sm font-medium text-warning">
          {loadError}
        </p>
      )}

      {canManage && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex-1 min-w-[200px]">
            <Input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addOne()}
              placeholder="Add a number, e.g. (555) 123-4567"
              inputMode="tel"
            />
          </div>
          <Button onClick={addOne} disabled={busy || !phone.trim()}>
            <Plus className="mr-1 h-4 w-4" /> Add
          </Button>
          <Button variant="secondary" onClick={() => fileRef.current?.click()} disabled={busy}>
            <Upload className="mr-1 h-4 w-4" /> Import CSV
          </Button>
          <Button variant="secondary" onClick={exportCsv} disabled={!entries.length}>
            <Download className="mr-1 h-4 w-4" /> Export
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.txt"
            className="hidden"
            onChange={onFile}
          />
        </div>
      )}

      {note && <p className="text-sm text-muted-foreground">{note}</p>}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No suppressed numbers yet. They’re added automatically whenever a call is marked
          “do not call” or a homeowner texts STOP.
        </p>
      ) : (
        <div className="max-h-80 overflow-y-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-surface-muted text-left text-muted-foreground">
              <tr>
                <th className={cn(CELL, "font-medium")}>Number</th>
                <th className={cn(CELL, "font-medium")}>Source</th>
                <th className={cn(CELL, "font-medium")}>Reason</th>
                {/* The table is already ORDERED by this and never showed it —
                    the one screen that lists suppressions was the only place
                    that hid when they happened. */}
                <th className={cn(CELL, "font-medium")}>Added</th>
                {canManage && <th className={cn(CELL)} />}
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} className="border-t border-border">
                  <td className={cn(CELL, "tabular")}>{formatPhone(e.phoneDigits)}</td>
                  <td className={cn(CELL, "text-muted-foreground")}>
                    {SOURCE_LABEL[e.source] ?? (e.source || "—")}
                  </td>
                  <td className={cn(CELL, "text-muted-foreground")}>{e.reason || "—"}</td>
                  <td
                    className={cn(CELL, "whitespace-nowrap text-muted-foreground")}
                    title={e.createdAt || undefined}
                  >
                    {e.createdAt ? relativeTime(e.createdAt) : "—"}
                  </td>
                  {canManage && (
                    <td className={cn(CELL, "text-right")}>
                      <button
                        type="button"
                        onClick={() => remove(e.phoneDigits)}
                        disabled={busy}
                        aria-label={`Remove ${formatPhone(e.phoneDigits)}`}
                        className="text-muted-foreground transition-colors hover:text-danger"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
