"use client";

import { motion } from "framer-motion";
import { BatteryCharging, Car, Loader2, Waves, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { Portal } from "@/components/ui/portal";
import { leadStatusConfig } from "@/lib/status";
import type { Lead, LeadStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

// Kept in sync with EDITABLE_STATUSES in /api/leads/update — "appointment" and
// "callback" are excluded because those statuses are backed by rows in the
// appointments/callbacks tables; changing them here would desync the lead's
// status from its pipeline tab. The disposition-override flow handles those.
const EDITABLE_STATUSES: LeadStatus[] = [
  "new",
  "contacted",
  "qualified",
  "not_interested",
  "no_answer",
  "bills_fine",
  "dnc",
];

interface FormState {
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  utilityProvider: string;
  solarProvider: string;
  status: LeadStatus;
  utilityBill: string;
  solarPayment: string;
  hasEV: boolean;
  hasPool: boolean;
  hasBattery: boolean;
  multipleSystems: boolean;
  notes: string;
}

function toForm(lead: Lead): FormState {
  return {
    firstName: lead.firstName,
    lastName: lead.lastName,
    phone: lead.phone,
    email: lead.email ?? "",
    address: lead.address,
    city: lead.city,
    state: lead.state,
    zip: lead.zip,
    utilityProvider: lead.utilityProvider,
    solarProvider: lead.solarProvider,
    status: lead.status,
    utilityBill: lead.utilityBill != null ? String(lead.utilityBill) : "",
    solarPayment: lead.solarPayment != null ? String(lead.solarPayment) : "",
    hasEV: lead.hasEV,
    hasPool: lead.hasPool,
    hasBattery: lead.hasBattery,
    multipleSystems: lead.multipleSystems,
    notes: lead.notes ?? "",
  };
}

function Flag({
  label,
  icon: Icon,
  active,
  onClick,
}: {
  label: string;
  icon: typeof Car;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
        active
          ? "border-primary/50 bg-primary-soft text-primary"
          : "border-border bg-background/40 text-muted-foreground hover:bg-muted",
      )}
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  );
}

/**
 * Edit an existing lead's contact info, address, energy details, status flags,
 * and notes. POSTs a sparse patch to /api/leads/update — the server enforces
 * that the actor owns this lead or is a supervisor in its org.
 */
export function EditLeadDialog({
  lead,
  onClose,
  isSolar = true,
}: {
  lead: Lead;
  onClose: () => void;
  /** Solar-only fields are hidden for other verticals (lib/org/vertical.ts). */
  isSolar?: boolean;
}) {
  const router = useRouter();
  const [f, setF] = useState<FormState>(() => toForm(lead));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const statusLocked = lead.status === "appointment" || lead.status === "callback";

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setF((prev) => ({ ...prev, [k]: v }));

  async function save() {
    setBusy(true);
    setErr("");
    try {
      const res = await fetch("/api/leads/update", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: lead.id,
          firstName: f.firstName,
          lastName: f.lastName,
          phone: f.phone,
          email: f.email,
          address: f.address,
          city: f.city,
          state: f.state,
          zip: f.zip,
          utilityProvider: f.utilityProvider,
          solarProvider: f.solarProvider,
          // Locked (appointment/callback) leads keep their status — omitting it
          // means "don't touch" server-side, so other fields still save.
          ...(statusLocked ? {} : { status: f.status }),
          utilityBill: f.utilityBill,
          solarPayment: f.solarPayment,
          hasEV: f.hasEV,
          hasPool: f.hasPool,
          hasBattery: f.hasBattery,
          multipleSystems: f.multipleSystems,
          notes: f.notes,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) {
        setErr(json.error ?? "Couldn't save changes.");
        return;
      }
      router.refresh();
      onClose();
    } catch {
      setErr("Network error while saving.");
    } finally {
      setBusy(false);
    }
  }

  const name = `${lead.firstName} ${lead.lastName}`.trim() || "this lead";

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
          onClick={busy ? undefined : onClose}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
        />
        <motion.div
          initial={{ opacity: 0, y: 20, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 16, scale: 0.98 }}
          transition={{ type: "spring", stiffness: 320, damping: 30 }}
          className="glass relative flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl border border-border/60 shadow-lift sm:max-h-[88vh] sm:rounded-2xl"
        >
          <div className="flex items-start justify-between gap-3 border-b border-border/60 p-5">
            <div>
              <p className="text-base font-semibold leading-tight">Edit {name}</p>
              <p className="text-xs text-muted-foreground">
                Changes save immediately and apply across the app.
              </p>
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

          <div className="space-y-4 overflow-y-auto p-5">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>First name</Label>
                <Input value={f.firstName} onChange={(e) => set("firstName", e.target.value)} />
              </div>
              <div>
                <Label>Last name</Label>
                <Input value={f.lastName} onChange={(e) => set("lastName", e.target.value)} />
              </div>
              <div>
                <Label>Phone</Label>
                <Input value={f.phone} onChange={(e) => set("phone", e.target.value)} />
              </div>
              <div>
                <Label>Email</Label>
                <Input
                  type="email"
                  value={f.email}
                  onChange={(e) => set("email", e.target.value)}
                />
              </div>
              <div className="col-span-2">
                <Label>Address</Label>
                <Input value={f.address} onChange={(e) => set("address", e.target.value)} />
              </div>
              <div>
                <Label>City</Label>
                <Input value={f.city} onChange={(e) => set("city", e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>State</Label>
                  <Input value={f.state} onChange={(e) => set("state", e.target.value)} />
                </div>
                <div>
                  <Label>ZIP</Label>
                  <Input value={f.zip} onChange={(e) => set("zip", e.target.value)} />
                </div>
              </div>
              <div>
                <Label>Utility provider</Label>
                <Input
                  value={f.utilityProvider}
                  onChange={(e) => set("utilityProvider", e.target.value)}
                />
              </div>
              {isSolar && (
                <div>
                  <Label>Solar provider</Label>
                  <Input
                    value={f.solarProvider}
                    onChange={(e) => set("solarProvider", e.target.value)}
                  />
                </div>
              )}
              <div>
                <Label>Utility bill ($/mo)</Label>
                <Input
                  type="number"
                  inputMode="decimal"
                  value={f.utilityBill}
                  onChange={(e) => set("utilityBill", e.target.value)}
                />
              </div>
              {isSolar && (
                <div>
                  <Label>Solar payment ($/mo)</Label>
                  <Input
                    type="number"
                    inputMode="decimal"
                    value={f.solarPayment}
                    onChange={(e) => set("solarPayment", e.target.value)}
                  />
                </div>
              )}
              <div className="col-span-2">
                <Label>Status</Label>
                {statusLocked ? (
                  <>
                    <div className="flex h-10 items-center rounded-xl border border-border bg-muted/40 px-3.5 text-sm text-muted-foreground">
                      {leadStatusConfig[lead.status].label} (locked)
                    </div>
                    <p className="mt-1.5 text-xs text-muted-foreground">
                      This lead has a scheduled {lead.status === "appointment" ? "appointment" : "callback"}.
                      Change its status from the{" "}
                      {lead.status === "appointment" ? "Appointments" : "Callbacks"} tab instead.
                    </p>
                  </>
                ) : (
                  <>
                    <Select
                      value={f.status}
                      onChange={(e) => set("status", e.target.value as LeadStatus)}
                    >
                      {EDITABLE_STATUSES.map((value) => (
                        <option key={value} value={value}>
                          {leadStatusConfig[value].label}
                        </option>
                      ))}
                    </Select>
                    <p className="mt-1.5 text-xs text-muted-foreground">
                      To book an appointment or callback, use "Change disposition" from the dialer
                      or pipeline tabs — it needs a scheduled time too.
                    </p>
                  </>
                )}
              </div>
            </div>

            <div>
              <Label>Home profile</Label>
              <div className="grid grid-cols-3 gap-2">
                <Flag label="EV" icon={Car} active={f.hasEV} onClick={() => set("hasEV", !f.hasEV)} />
                <Flag
                  label="Pool"
                  icon={Waves}
                  active={f.hasPool}
                  onClick={() => set("hasPool", !f.hasPool)}
                />
                <Flag
                  label="Battery"
                  icon={BatteryCharging}
                  active={f.hasBattery}
                  onClick={() => set("hasBattery", !f.hasBattery)}
                />
              </div>
              <label className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
                <input
                  type="checkbox"
                  checked={f.multipleSystems}
                  onChange={(e) => set("multipleSystems", e.target.checked)}
                  className="h-4 w-4 rounded border-border"
                />
                {isSolar ? "Multiple solar systems on the property" : "Multiple systems on the property"}
              </label>
            </div>

            <div>
              <Label>Notes</Label>
              <Textarea value={f.notes} onChange={(e) => set("notes", e.target.value)} rows={3} />
            </div>
          </div>

          <div className="flex items-center gap-2 border-t border-border/60 p-5">
            {err && <p className="mr-auto text-sm font-medium text-danger">{err}</p>}
            <Button variant="ghost" className="flex-1" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button className="flex-1 gap-2" onClick={save} disabled={busy}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              Save changes
            </Button>
          </div>
        </motion.div>
      </motion.div>
    </Portal>
  );
}
