"use client";

import {
  AlertTriangle,
  Check,
  Loader2,
  Mail,
  MailCheck,
  Plus,
  Send,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { SectionCard } from "@/components/shared/section-card";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import type { OrgFull } from "@/lib/org/membership";
import type { NotificationSettings } from "@/lib/org/settings";

// ─────────────────────────────────────────────────────────────────────────────
// Where Brock's address actually gets typed.
//
// Deliberately not an env var: the person who needs to change who gets told about
// a booking is an admin looking at a screen, not an engineer with deploy access.
// APPOINTMENT_NOTIFY_EMAILS survives as a deployment-wide fallback for a workspace
// that has never opened this panel.
// ─────────────────────────────────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function NotificationsSettings({
  org,
  emailConfigured,
  configProblem,
}: {
  org: OrgFull;
  /** Whether RESEND_API_KEY + RESEND_FROM are actually present on the server. */
  emailConfigured: boolean;
  configProblem: string | null;
}) {
  const router = useRouter();
  const current: NotificationSettings = org.settings.notifications;

  const [enabled, setEnabled] = useState(current.appointmentEmail !== false);
  const [emails, setEmails] = useState<string[]>(current.appointmentEmails ?? []);
  const [ccRep, setCcRep] = useState(Boolean(current.ccBookingRep));
  const [fromName, setFromName] = useState(current.fromName ?? "");
  const [entry, setEntry] = useState("");

  const [busy, setBusy] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState("");
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  function addEmail() {
    const value = entry.trim().toLowerCase();
    if (!value) return;
    if (!EMAIL_RE.test(value)) {
      setErr(`"${value}" doesn't look like an email address.`);
      return;
    }
    if (emails.includes(value)) {
      setEntry("");
      return;
    }
    setEmails([...emails, value]);
    setEntry("");
    setErr("");
  }

  async function save() {
    setBusy("save");
    setErr("");
    setSaved(false);
    try {
      // Send the COMPLETE notifications block (updateOrganizationSettings merges
      // one level deep, so a partial object would drop unmentioned keys) — but
      // ONLY the notifications block. This used to spread the entire org.settings
      // snapshot from page load, silently reverting any section a colleague had
      // saved since (a concurrent-editor clobber that reached every section).
      const notifications: NotificationSettings = {
        appointmentEmail: enabled,
        appointmentEmails: emails,
        ccBookingRep: ccRep,
        fromName: fromName.trim(),
      };
      const res = await fetch("/api/org/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ settings: { notifications } }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.ok) {
        setErr(j.error ?? "Could not save.");
        return;
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2200);
      router.refresh();
    } catch {
      setErr("Network error.");
    } finally {
      setBusy(null);
    }
  }

  async function sendTest() {
    setBusy("test");
    setTestResult(null);
    try {
      const res = await fetch("/api/notifications/test", { method: "POST" });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; to?: string[] };
      setTestResult(
        j.ok
          ? { ok: true, message: `Sent to ${(j.to ?? []).join(", ")}. Check the inbox.` }
          : { ok: false, message: j.error ?? "The test send failed." },
      );
    } catch {
      setTestResult({ ok: false, message: "Network error." });
    } finally {
      setBusy(null);
    }
  }

  const canTest = emailConfigured && emails.length > 0;

  return (
    <div className="space-y-5">
      {!emailConfigured && (
        <div className="flex items-start gap-3 rounded-2xl border border-warning/30 bg-warning/10 p-4">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-warning">Email isn&apos;t connected yet</p>
            <p className="text-xs text-muted-foreground">
              {configProblem ?? "Set RESEND_API_KEY and RESEND_FROM."} Until then, appointments still
              book normally — nobody is emailed, and no alerts are raised. Once recipients are set
              below <span className="font-medium text-foreground">and</span> a key is missing, a
              failed send becomes a visible alert rather than silence.
            </p>
          </div>
        </div>
      )}

      <SectionCard
        title="Appointment notifications"
        description="Email the sales lead the moment an appointment is set, moved, or cancelled. Failed sends retry on a backoff and then raise an in-app alert — they never disappear quietly."
      >
        <div className="space-y-5">
          <label className="flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="mt-1 h-4 w-4 rounded border-border accent-primary"
            />
            <span className="min-w-0">
              <span className="block text-sm font-semibold">Send the appointment email</span>
              <span className="block text-xs text-muted-foreground">
                An AI booking is only emailed once a human <em>approves</em> it — proposals don&apos;t
                trigger anything, so the inbox never fills with the agent&apos;s guesses.
              </span>
            </span>
          </label>

          <div>
            <Label htmlFor="notify-email">Recipients</Label>
            <div className="flex gap-2">
              <Input
                id="notify-email"
                value={entry}
                onChange={(e) => setEntry(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addEmail();
                  }
                }}
                placeholder="brock@example.com"
                type="email"
              />
              <Button variant="outline" size="sm" onClick={addEmail} className="shrink-0 gap-1.5">
                <Plus className="h-3.5 w-3.5" /> Add
              </Button>
            </div>

            {emails.length > 0 ? (
              <div className="mt-2.5 flex flex-wrap gap-2">
                {emails.map((e) => (
                  <span
                    key={e}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 bg-muted/60 py-1 pl-2.5 pr-1 text-xs font-medium"
                  >
                    <Mail className="h-3 w-3 text-muted-foreground" />
                    {e}
                    <button
                      type="button"
                      onClick={() => setEmails(emails.filter((x) => x !== e))}
                      aria-label={`Remove ${e}`}
                      className="flex h-5 w-5 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-danger/10 hover:text-danger"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            ) : (
              <p className="mt-2 text-xs text-muted-foreground">
                Nobody is being notified. Add an address, or set{" "}
                <code className="rounded bg-muted px-1 py-0.5">APPOINTMENT_NOTIFY_EMAILS</code> as a
                deployment-wide default.
              </p>
            )}
          </div>

          <label className="flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              checked={ccRep}
              onChange={(e) => setCcRep(e.target.checked)}
              className="mt-1 h-4 w-4 rounded border-border accent-primary"
            />
            <span className="min-w-0">
              <span className="block text-sm font-semibold">Copy the rep who booked it</span>
              <span className="block text-xs text-muted-foreground">
                They get their own paper trail of the review they set.
              </span>
            </span>
          </label>

          <div>
            <Label htmlFor="notify-from">From name</Label>
            <Input
              id="notify-from"
              value={fromName}
              onChange={(e) => setFromName(e.target.value)}
              placeholder={org.name || "AIATWORK Dialer"}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              The display name on the email. The address itself comes from{" "}
              <code className="rounded bg-muted px-1 py-0.5">RESEND_FROM</code> and must be on a
              verified domain.
            </p>
          </div>

          {err && <p className="text-xs font-medium text-danger">{err}</p>}

          {testResult && (
            <p
              className={`flex items-start gap-1.5 rounded-xl px-3 py-2 text-xs font-medium ${
                testResult.ok
                  ? "bg-success/10 text-success"
                  : "bg-danger/10 text-danger"
              }`}
            >
              {testResult.ok ? (
                <MailCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              ) : (
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              )}
              {testResult.message}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-4">
            <Button
              variant="outline"
              size="sm"
              onClick={sendTest}
              disabled={!canTest || busy != null}
              title={
                !emailConfigured
                  ? "Connect Resend first."
                  : !emails.length
                    ? "Add a recipient first."
                    : "Send a real email to the recipients above."
              }
              className="gap-1.5"
            >
              {busy === "test" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Send className="h-3.5 w-3.5" />
              )}
              Send test email
            </Button>

            <Button onClick={save} disabled={busy != null} size="sm" className="ml-auto gap-1.5">
              {busy === "save" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : saved ? (
                <Check className="h-3.5 w-3.5" />
              ) : null}
              {saved ? "Saved" : "Save"}
            </Button>
          </div>
        </div>
      </SectionCard>
    </div>
  );
}
