"use client";

import { motion } from "framer-motion";
import { BatteryCharging, Car, CircleEllipsis, Waves } from "lucide-react";
import { useState } from "react";
import { AiBriefing } from "@/components/ai/lead-briefing";
import { CountUp } from "@/components/motion";
import { Input, Label, Textarea } from "@/components/ui/input";
import type { Lead } from "@/lib/types";
import { cn, formatCurrency } from "@/lib/utils";

function Toggle({
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
    <motion.button
      type="button"
      onClick={onClick}
      whileTap={{ scale: 0.93 }}
      whileHover={{ y: -2 }}
      transition={{ type: "spring", stiffness: 400, damping: 22 }}
      className={cn(
        "flex items-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-medium transition-colors duration-200",
        active
          ? "border-primary/50 bg-primary-soft text-primary shadow-[0_0_18px_-6px_hsl(var(--glow)/0.6)]"
          : "border-border bg-surface text-muted-foreground hover:bg-muted",
      )}
    >
      <Icon className="h-4 w-4" />
      {label}
    </motion.button>
  );
}

export function QualifyPanel({
  lead,
  onNotesChange,
  showSolarPayment = true,
  otherLabel = "Battery",
}: {
  lead: Lead | null;
  onNotesChange?: (notes: string) => void;
  /** Solar orgs show the "Solar payment" field; non-solar tenants hide it. */
  showSolarPayment?: boolean;
  /** Label for the third home-profile toggle (default "Battery"). */
  otherLabel?: string;
}) {
  const [utility, setUtility] = useState("");
  const [solar, setSolar] = useState("");
  const [notes, setNotes] = useState(lead?.notes ?? "");
  const [flags, setFlags] = useState({
    ev: lead?.hasEV ?? false,
    pool: lead?.hasPool ?? false,
    battery: lead?.hasBattery ?? false,
  });

  const u = Number(utility) || lead?.utilityBill || 0;
  const s = Number(solar) || lead?.solarPayment || 0;
  const total = u + s;

  return (
    <div className="space-y-5">
      <AiBriefing leadId={lead?.id ?? null} />

      <div>
        <p className="mb-2.5 text-xs font-bold uppercase tracking-wide text-muted-foreground">
          Billing
        </p>
        <div className={cn("grid gap-3", showSolarPayment ? "grid-cols-2" : "grid-cols-1")}>
          <div>
            <Label>Monthly utility</Label>
            <Input
              inputMode="decimal"
              placeholder={lead?.utilityBill ? `$${lead.utilityBill}` : "$0"}
              value={utility}
              onChange={(e) => setUtility(e.target.value)}
            />
          </div>
          {showSolarPayment && (
            <div>
              <Label>Solar payment</Label>
              <Input
                inputMode="decimal"
                placeholder={lead?.solarPayment ? `$${lead.solarPayment}` : "$0"}
                value={solar}
                onChange={(e) => setSolar(e.target.value)}
              />
            </div>
          )}
        </div>
        {/* With no solar payment the "total" would just echo the utility bill, so
            only show the combined energy-cost line when both figures are present. */}
        {showSolarPayment && (
          <div className="mt-3 flex items-center justify-between rounded-xl bg-muted px-3.5 py-2.5">
            <span className="text-sm text-muted-foreground">Total energy cost</span>
            <span className="text-lg font-bold tabular text-primary">
              <CountUp
                value={total}
                duration={0.5}
                format={(n) => formatCurrency(Math.round(n))}
              />
              <span className="text-xs font-normal text-muted-foreground">/mo</span>
            </span>
          </div>
        )}
      </div>

      <div>
        <p className="mb-2.5 text-xs font-bold uppercase tracking-wide text-muted-foreground">
          Home profile
        </p>
        <div className="grid grid-cols-3 gap-2">
          <Toggle
            label="EV"
            icon={Car}
            active={flags.ev}
            onClick={() => setFlags((f) => ({ ...f, ev: !f.ev }))}
          />
          <Toggle
            label="Pool"
            icon={Waves}
            active={flags.pool}
            onClick={() => setFlags((f) => ({ ...f, pool: !f.pool }))}
          />
          <Toggle
            label={otherLabel}
            icon={otherLabel === "Battery" ? BatteryCharging : CircleEllipsis}
            active={flags.battery}
            onClick={() => setFlags((f) => ({ ...f, battery: !f.battery }))}
          />
        </div>
      </div>

      <div>
        <p className="mb-2.5 text-xs font-bold uppercase tracking-wide text-muted-foreground">
          Notes
        </p>
        <Textarea
          placeholder="Lifestyle changes, objections, follow-ups…"
          value={notes}
          onChange={(e) => {
            setNotes(e.target.value);
            onNotesChange?.(e.target.value);
          }}
        />
      </div>
    </div>
  );
}
