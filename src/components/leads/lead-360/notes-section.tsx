"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";

/**
 * The lead's CURRENT note (leads.notes — each call's disposition overwrites
 * it; per-call notes live on the call records in the timeline). Saves through
 * the same /api/leads/update path the edit dialog uses, optimistically: the
 * text stays as typed, a toast confirms, and a failure restores edit state.
 */
export function NotesSection({
  leadId,
  notes,
  onSaved,
}: {
  leadId: string;
  notes: string;
  onSaved?: () => void;
}) {
  const { toast } = useToast();
  const [value, setValue] = useState(notes);
  const [savedValue, setSavedValue] = useState(notes);
  const [busy, setBusy] = useState(false);

  // A background refresh may bring newer notes — adopt them ONLY when the rep
  // isn't mid-edit (their draft always wins over a poll). The ref mirrors
  // savedValue so the updater below stays pure.
  const savedRef = useRef(notes);
  useEffect(() => {
    setValue((prev) => (prev === savedRef.current ? notes : prev));
    savedRef.current = notes;
    setSavedValue(notes);
  }, [notes]);

  const dirty = value !== savedValue;

  async function save() {
    setBusy(true);
    const next = value;
    try {
      const res = await fetch("/api/leads/update", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: leadId, notes: next }),
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) {
        toast({
          title: "Couldn't save the note",
          description: json.error ?? "Something went wrong — your text is still here.",
          tone: "danger",
        });
        return;
      }
      setSavedValue(next);
      toast({ title: "Note saved", tone: "success" });
      onSaved?.();
    } catch {
      toast({
        title: "Couldn't save the note",
        description: "Network error — your text is still here.",
        tone: "danger",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <Textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        rows={3}
        placeholder="Notes about this record — overwritten by each call's wrap-up notes."
        aria-label="Lead notes"
      />
      <div className="mt-2 flex items-center justify-end gap-2">
        {dirty && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setValue(savedValue)}
            disabled={busy}
          >
            Discard
          </Button>
        )}
        <Button size="sm" onClick={() => void save()} disabled={busy || !dirty} className="gap-1.5">
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Save note
        </Button>
      </div>
    </div>
  );
}
