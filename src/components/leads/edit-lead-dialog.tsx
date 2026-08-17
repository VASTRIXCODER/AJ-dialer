"use client";

import { BatteryCharging, Car, Loader2, Waves, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import {
  parseFieldValue,
  type LeadFieldDef,
  type LeadFieldType,
} from "@/lib/leads/field-schema";
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

/** HTML input types per field type — anything unlisted is a plain text input. */
const INPUT_TYPES: Partial<Record<LeadFieldType, string>> = {
  number: "number",
  currency: "number",
  date: "date",
  email: "email",
  url: "url",
  phone: "tel",
};

/** Custom values are stored as loose strings; <input type="date"> wants yyyy-mm-dd. */
function toDateInputValue(v: string): string {
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  const t = Date.parse(v);
  if (Number.isNaN(t)) return "";
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
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
  showSolarPayment = true,
  fields = [],
}: {
  lead: Lead;
  onClose: () => void;
  /** Show solar-specific fields (per-tenant — off for non-solar orgs). */
  showSolarPayment?: boolean;
  /** The org's resolved lead-field schema — its CUSTOM defs render as the
   *  "More fields" section, writing through updateLead's customFields merge. */
  fields?: LeadFieldDef[];
}) {
  const router = useRouter();
  const [f, setF] = useState<FormState>(() => toForm(lead));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  // Every custom def gets an input here — including the ones the table's
  // 4-column cap keeps out of the list view; this dialog is where they live.
  const customDefs = useMemo(() => fields.filter((d) => d.source === "custom"), [fields]);
  const initialCustom = useMemo(() => {
    const init: Record<string, string | boolean> = {};
    for (const def of customDefs) {
      const v = lead.customFields?.[def.key];
      if (def.type === "boolean") init[def.key] = v === true;
      else if (def.type === "date") init[def.key] = v == null ? "" : toDateInputValue(String(v));
      else init[def.key] = v == null ? "" : String(v);
    }
    return init;
  }, [customDefs, lead]);
  const [custom, setCustom] = useState<Record<string, string | boolean>>(initialCustom);
  const setCustomField = (key: string, v: string | boolean) =>
    setCustom((prev) => ({ ...prev, [key]: v }));

  const statusLocked = lead.status === "appointment" || lead.status === "callback";

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setF((prev) => ({ ...prev, [k]: v }));

  async function save() {
    setBusy(true);
    setErr("");
    // Only the custom keys the user actually touched go into the patch —
    // updateLead merges per key, so untouched values can't be clobbered.
    // Clearing an input deletes its key (null).
    const customPatch: Record<string, string | number | boolean | null> = {};
    for (const def of customDefs) {
      const v = custom[def.key];
      if (v === initialCustom[def.key]) continue;
      if (def.type === "boolean") customPatch[def.key] = v === true;
      else {
        const s = String(v ?? "").trim();
        customPatch[def.key] = s === "" ? null : parseFieldValue(s, def.type);
      }
    }
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
          ...(Object.keys(customPatch).length > 0 ? { customFields: customPatch } : {}),
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
    <Modal onClose={onClose} label={`Edit ${name}`} maxWidth="max-w-2xl" dismissible={!busy}>
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
          {showSolarPayment && (
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
          {showSolarPayment && (
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
          {showSolarPayment && (
            <label className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={f.multipleSystems}
                onChange={(e) => set("multipleSystems", e.target.checked)}
                className="h-4 w-4 rounded border-border"
              />
              Multiple solar systems on the property
            </label>
          )}
        </div>

        {customDefs.length > 0 && (
          <div>
            <Label>More fields</Label>
            <div className="grid grid-cols-2 gap-3">
              {customDefs
                .filter((def) => def.type !== "boolean")
                .map((def) => (
                  <div key={def.key}>
                    <Label>{def.label}</Label>
                    <Input
                      type={INPUT_TYPES[def.type] ?? "text"}
                      inputMode={
                        def.type === "currency" || def.type === "number"
                          ? "decimal"
                          : undefined
                      }
                      maxLength={500}
                      value={String(custom[def.key] ?? "")}
                      onChange={(e) => setCustomField(def.key, e.target.value)}
                    />
                  </div>
                ))}
            </div>
            {customDefs.some((def) => def.type === "boolean") && (
              <div className="mt-3 grid grid-cols-2 gap-2">
                {customDefs
                  .filter((def) => def.type === "boolean")
                  .map((def) => (
                    <label
                      key={def.key}
                      className="flex items-center gap-2 rounded-xl border border-border bg-background/40 px-3.5 py-2.5 text-sm"
                    >
                      <input
                        type="checkbox"
                        checked={custom[def.key] === true}
                        onChange={(e) => setCustomField(def.key, e.target.checked)}
                        className="h-4 w-4 rounded border-border"
                      />
                      {def.label}
                    </label>
                  ))}
              </div>
            )}
            <p className="mt-1.5 text-xs text-muted-foreground">
              Extra fields captured from your imports — saved with this lead.
            </p>
          </div>
        )}

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
    </Modal>
  );
}
