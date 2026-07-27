"use client";

import { motion, useReducedMotion } from "framer-motion";
import { Loader2, ShieldCheck, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Portal } from "@/components/ui/portal";
import { CAMPAIGN_CERT_TEXT } from "@/lib/legal/versions";

/**
 * The compliance checkpoint /api/leads/import blocks an uncertified campaign
 * behind. Opens the moment an import comes back with certificationRequired;
 * on confirm it POSTs the certification and hands back to the caller, which
 * retries the ORIGINAL import with the same body — the rep never has to
 * re-pick or re-drop the file.
 */
export function CampaignCertificationDialog({
  campaignId,
  onCertified,
  onCancel,
}: {
  campaignId: string | null;
  onCertified: () => void;
  onCancel: () => void;
}) {
  const reduce = useReducedMotion();
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function confirm() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/campaigns/certify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ campaignId }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.ok === false) {
        setError(json.error ?? "Couldn't record the certification.");
        return;
      }
      onCertified();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Portal>
      <div className="fixed inset-0 z-[100] flex items-end justify-center sm:items-center sm:p-4">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="absolute inset-0 bg-background/70 backdrop-blur-xl"
          onClick={onCancel}
        />
        <motion.div
          initial={reduce ? { opacity: 0 } : { opacity: 0, y: 24, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ type: "spring", stiffness: 320, damping: 30 }}
          className="glass relative max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-2xl border border-border/60 shadow-lift sm:rounded-2xl"
        >
          <div className="flex items-start gap-3 border-b border-border/60 p-5">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary">
              <ShieldCheck className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-semibold">Compliance certification required</h2>
              <p className="text-sm text-muted-foreground">
                Before this campaign can be dialed, confirm the following.
              </p>
            </div>
            <button
              type="button"
              onClick={onCancel}
              aria-label="Close"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="space-y-4 p-5">
            <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-border/60 bg-surface/50 p-4 text-sm leading-relaxed">
              <input
                type="checkbox"
                checked={checked}
                onChange={(e) => setChecked(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 rounded border-input accent-primary"
              />
              <span>{CAMPAIGN_CERT_TEXT}</span>
            </label>
            {error && <p className="text-sm font-medium text-danger">{error}</p>}
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-border/60 p-4">
            <Button variant="outline" size="sm" onClick={onCancel} disabled={busy}>
              Cancel
            </Button>
            <Button size="sm" onClick={confirm} disabled={!checked || busy} className="gap-1.5">
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
              Certify &amp; continue
            </Button>
          </div>
        </motion.div>
      </div>
    </Portal>
  );
}
