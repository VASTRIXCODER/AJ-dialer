"use client";

import { Bot, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { useDialerContextOptional } from "./dialer-context";
import type { KnownInfo } from "@/lib/use-dialer";

/** The core slots this dialog can collect beyond name/address. */
type KnownInfoField = "utilityProvider" | "solarProvider" | "utilityBill" | "solarPayment";
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
  // The four data fields here are core schema slots, so render them from the
  // org's OWN resolved schema rather than from four hardcoded solar labels with
  // an `isSolar &&` around two of them. An insurance workspace now asks for
  // "Current carrier" and "Current premium ($/mo)"; a workspace that hides a
  // slot simply doesn't ask for it.
  const ctx = useDialerContextOptional();
  const schema = ctx?.config.leadFields ?? [];
  const extraFields = (
    ["utilityProvider", "solarProvider", "utilityBill", "solarPayment"] as const
  )
    .map((key) => {
      const def = schema.find((d) => d.key === key);
      return def ? { key, label: def.label, money: def.type === "currency" } : null;
    })
    .filter((d): d is { key: KnownInfoField; label: string; money: boolean } => Boolean(d));
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
    <Modal onClose={onClose} label={`AI call · ${formatPhone(phone)}`}>
      <div className="flex items-start justify-between gap-3 border-b border-border/60 p-5">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand text-white shadow-glow">
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
            {extraFields.map((d) => (
              <label key={d.key} className="space-y-1">
                <span className="text-xs font-medium text-muted-foreground">{d.label}</span>
                <input
                  className={field}
                  {...(d.money
                    ? { type: "number" as const, inputMode: "numeric" as const }
                    : {})}
                  value={f[d.key] ?? ""}
                  onChange={(e) => set(d.key, e.target.value)}
                />
              </label>
            ))}
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
    </Modal>
  );
}
