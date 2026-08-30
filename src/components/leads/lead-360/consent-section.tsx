"use client";

import { Loader2, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Label, Textarea } from "@/components/ui/input";
import { SelectMenu } from "@/components/ui/select-menu";
import { useToast } from "@/components/ui/toast";
import {
  CONSENT_SOURCE_LABEL,
  consentSummary,
  isConsentSource,
  type ConsentScope,
  type ConsentSnapshot,
} from "@/lib/consent/state";
import { relativeTime } from "@/lib/utils";
import { PanelSection } from "./section-shell";

// ─────────────────────────────────────────────────────────────────────────────
// Permission to message this person — and the way to record it.
//
// This section exists because almost every record in an imported book is in the
// same state: nobody ever asked. That is not the same as "they said no", and
// the copy is careful about the difference — a rep who reads "no consent" on a
// record nobody ever asked will stop asking.
//
// The capture control REQUIRES the words. A grant with an empty evidence field
// is a checkbox, and a checkbox proves nothing when someone disputes it later.
// The server enforces the same rule; this just refuses to waste the round trip.
// ─────────────────────────────────────────────────────────────────────────────

const MIN_EVIDENCE = 8;

const SCOPE_OPTIONS = [
  {
    value: "transactional" as ConsentScope,
    label: "Replies and their own appointment",
    hint: "Confirmations, reminders, answering them",
  },
  {
    value: "promotional" as ConsentScope,
    label: "Offers as well",
    hint: "Requires an explicit yes to marketing",
  },
];

export function ConsentSection({
  leadId,
  consent,
  canRecord,
  onRecorded,
}: {
  leadId: string;
  consent: ConsentSnapshot;
  canRecord: boolean;
  /** Called after a successful write so the host re-reads the panel. */
  onRecorded?: () => void;
}) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<ConsentScope>("transactional");
  const [evidence, setEvidence] = useState("");
  const [busy, setBusy] = useState(false);

  const summary = consentSummary(consent);
  const sourceLabel = isConsentSource(consent.source)
    ? CONSENT_SOURCE_LABEL[consent.source]
    : consent.source;

  async function confirmRevoke() {
    const ok = await confirm({
      title: "Record that they asked to stop?",
      body: "This goes on the permanent record and stops every message to this number. Only they can lift it, by texting START.",
      confirmLabel: "Record the opt-out",
      tone: "danger",
    });
    if (ok) await submit("revoked");
  }

  async function submit(action: "granted" | "revoked") {
    if (action === "granted" && evidence.trim().length < MIN_EVIDENCE) {
      toast({
        title: "Write down what they agreed to",
        description: "In their words. A grant with nothing behind it proves nothing.",
        tone: "danger",
      });
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/consent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ leadId, channel: "sms", action, scope, evidence }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast({ title: j.error ?? "Couldn't record that.", tone: "danger" });
        return;
      }
      toast({
        title: action === "granted" ? "Consent recorded" : "Opt-out recorded",
        description:
          action === "granted"
            ? "Their words are on the record with your name and the time."
            : "They will not be messaged again.",
        tone: "success",
      });
      setOpen(false);
      setEvidence("");
      onRecorded?.();
    } catch {
      toast({ title: "Couldn't record that.", tone: "danger" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <PanelSection title="Messaging consent">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={summary.tone}>{summary.label}</Badge>
        {consent.capturedAt && (
          <span className="text-xs text-muted-foreground">
            {relativeTime(consent.capturedAt)}
            {sourceLabel ? ` · ${sourceLabel.toLowerCase()}` : ""}
          </span>
        )}
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{summary.detail}</p>

      {!open ? (
        <div className="mt-2.5">
          <Button
            size="sm"
            variant="secondary"
            disabled={!canRecord}
            title={canRecord ? undefined : "Your role can't record consent."}
            onClick={() => setOpen(true)}
          >
            <ShieldCheck className="mr-1.5 h-3.5 w-3.5" />
            {consent.status === "granted" ? "Update" : "Record consent"}
          </Button>
          {canRecord && consent.status !== "revoked" && (
            // Deliberately NOT beside the button above, and deliberately
            // confirmed. This writes an append-only ledger row that only the
            // customer can reverse, and a one-click destructive control
            // adjacent to a constructive one is a mis-click the record keeps
            // for five years.
            <p className="mt-2 border-t border-border/70 pt-2 text-xs text-muted-foreground">
              If they asked not to be messaged,{" "}
              <button
                type="button"
                disabled={busy}
                onClick={() => void confirmRevoke()}
                className="font-semibold text-danger underline underline-offset-2 hover:opacity-80 disabled:opacity-50"
              >
                record their opt-out
              </button>
              . This cannot be undone from here.
            </p>
          )}
        </div>
      ) : (
        // Inline, never a modal: the rep is reading the record while typing
        // about it, and covering it up is how the note ends up wrong.
        <div className="mt-3 space-y-2.5">
          <div>
            {/* No htmlFor: SelectMenu renders a button, not a form control
                with an id, and carries this same text as its aria-label. A
                dangling htmlFor is worse than none — it tells a screen reader
                to look for something that isn't there. */}
            <Label>What did they agree to?</Label>
            <SelectMenu
              label="What did they agree to?"
              value={scope}
              onChange={(v) => setScope(v as ConsentScope)}
              options={SCOPE_OPTIONS}
              className="w-full"
              triggerClassName="w-full"
            />
          </div>
          <div>
            <Label htmlFor="consent-evidence">In their words</Label>
            <Textarea
              id="consent-evidence"
              value={evidence}
              onChange={(e) => setEvidence(e.target.value)}
              placeholder="e.g. Asked us to text her the appointment time and any reminders."
              rows={3}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Stored exactly as written, with your name and the time. This is what
              gets produced if anyone questions it later.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={busy} onClick={() => void submit("granted")}>
              {busy && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Record consent
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setOpen(false);
                setEvidence("");
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </PanelSection>
  );
}
