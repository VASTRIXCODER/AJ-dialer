"use client";

import { motion } from "framer-motion";
import { Bot, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Portal } from "@/components/ui/portal";
import { useDialerContextOptional } from "./dialer-context";
import type { KnownInfo } from "@/lib/use-dialer";
import { formatPhone } from "@/lib/utils";

/**
 * Before AI-dialing an ad-hoc number we don't have a lead for, collect whatever
 * the user knows. The agent personalizes with what's provided and works with the
 * rest — nothing is required.
 */
export function KnownInfoDialog({
  phone,
  onSubmit,
  onClose,
}: {
  phone: string;
  onSubmit: (info: KnownInfo) => void;
  onClose: () => void;
}) {
  // Solar-only fields disappear for non-solar tenants. qualifyShowSolarPayment
  // already carries both signals (the org's vertical AND its qualify setting) —
  // see the dialerConfig assembled in app/(app)/layout.tsx.
  const ctx = useDialerContextOptional();
  const isSolar = ctx?.config.qualifyShowSolarPayment !== false;
  const [f, setF] = useState<KnownInfo>({});
  const set = (k: keyof KnownInfo, v: string) =>
    setF((prev) => ({
      ...prev,
      [k]:
        k === "utilityBill" || k === "solarPayment"
          ? v === ""
            ? undefined
            : Number(v)
          : v,
    }));

  const field =
    "h-10 w-full rounded-lg border border-border bg-background/50 px-3 text-sm focus-visible:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/15";

  return (
    <Portal>
      <motion.div
        className="fixed inset-0 z-[100] flex items-end justify-center sm:items-center sm:p-4"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      >
        <motion.div
          className="absolute inset-0 bg-background/70 backdrop-blur-xl"
          onClick={onClose}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
        />
        <motion.div
          initial={{ opacity: 0, y: 20, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 16, scale: 0.98 }}
          transition={{ type: "spring", stiffness: 320, damping: 30 }}
          className="glass relative flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border border-border/60 shadow-lift sm:max-h-[88vh] sm:rounded-2xl"
        >
          <div className="flex items-start justify-between gap-3 border-b border-border/60 p-5">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-solar text-white shadow-glow">
                <Bot className="h-5 w-5" />
              </span>
              <div>
                <p className="text-base font-semibold leading-tight">
                  AI call · {formatPhone(phone)}
                </p>
                <p className="text-xs text-muted-foreground">
                  Tell the agent what you know — everything is optional.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3 overflow-y-auto p-5">
            <label className="space-y-1">
              <span className="text-xs font-medium text-muted-foreground">First name</span>
              <input className={field} value={f.firstName ?? ""} onChange={(e) => set("firstName", e.target.value)} />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-medium text-muted-foreground">Last name</span>
              <input className={field} value={f.lastName ?? ""} onChange={(e) => set("lastName", e.target.value)} />
            </label>
            <label className="col-span-2 space-y-1">
              <span className="text-xs font-medium text-muted-foreground">Address</span>
              <input className={field} value={f.address ?? ""} onChange={(e) => set("address", e.target.value)} />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-medium text-muted-foreground">City</span>
              <input className={field} value={f.city ?? ""} onChange={(e) => set("city", e.target.value)} />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-medium text-muted-foreground">State</span>
              <input className={field} value={f.state ?? ""} onChange={(e) => set("state", e.target.value)} />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-medium text-muted-foreground">Utility provider</span>
              <input className={field} value={f.utilityProvider ?? ""} onChange={(e) => set("utilityProvider", e.target.value)} />
            </label>
            {isSolar && (
              <label className="space-y-1">
                <span className="text-xs font-medium text-muted-foreground">Solar provider</span>
                <input className={field} value={f.solarProvider ?? ""} onChange={(e) => set("solarProvider", e.target.value)} />
              </label>
            )}
            <label className="space-y-1">
              <span className="text-xs font-medium text-muted-foreground">Utility bill ($/mo)</span>
              <input className={field} type="number" inputMode="numeric" value={f.utilityBill ?? ""} onChange={(e) => set("utilityBill", e.target.value)} />
            </label>
            {isSolar && (
              <label className="space-y-1">
                <span className="text-xs font-medium text-muted-foreground">Solar payment ($/mo)</span>
                <input className={field} type="number" inputMode="numeric" value={f.solarPayment ?? ""} onChange={(e) => set("solarPayment", e.target.value)} />
              </label>
            )}
            <label className="col-span-2 space-y-1">
              <span className="text-xs font-medium text-muted-foreground">Notes for the agent</span>
              <textarea
                className={field.replace("h-10", "min-h-[64px] py-2")}
                value={f.notes ?? ""}
                onChange={(e) => set("notes", e.target.value)}
              />
            </label>
          </div>

          <div className="flex gap-2 border-t border-border/60 p-5">
            <Button variant="ghost" className="flex-1" onClick={onClose}>
              Cancel
            </Button>
            <Button className="flex-1 gap-2" onClick={() => onSubmit(f)}>
              <Bot className="h-4 w-4" />
              Start AI call
            </Button>
          </div>
        </motion.div>
      </motion.div>
    </Portal>
  );
}
