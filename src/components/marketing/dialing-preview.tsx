"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Check, PhoneCall, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

const leads = [
  { name: "Robert Hayes", city: "Fresno, CA", color: "#F97316" },
  { name: "Linda Powell", city: "Bakersfield, CA", color: "#0EA5E9" },
  { name: "Carlos Mendez", city: "Riverside, CA", color: "#8B5CF6" },
];

// Loop: dialing (0) → connected (1) → talking (2) → reset
export function DialingPreview() {
  const [phase, setPhase] = useState(0);
  const winner = 0;

  useEffect(() => {
    const timings = [2200, 3200, 2600];
    const t = setTimeout(
      () => setPhase((p) => (p + 1) % 3),
      timings[phase],
    );
    return () => clearTimeout(t);
  }, [phase]);

  return (
    <div className="relative w-full max-w-md">
      {/* glow */}
      <div className="absolute -inset-6 -z-10 rounded-[2rem] bg-solar opacity-20 blur-3xl" />

      <div className="overflow-hidden rounded-3xl border border-border bg-card shadow-lift">
        <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-solar text-white">
              <PhoneCall className="h-3.5 w-3.5" />
            </span>
            <span className="text-sm font-semibold">Power Dialer</span>
          </div>
          <span className="flex items-center gap-1.5 rounded-full bg-success/10 px-2.5 py-1 text-[11px] font-bold text-success">
            <span className="h-1.5 w-1.5 rounded-full bg-success" />
            3X PARALLEL
          </span>
        </div>

        <div className="space-y-2.5 p-5">
          {leads.map((lead, i) => {
            const isWinner = i === winner;
            const state =
              phase === 0
                ? "ringing"
                : isWinner
                  ? "connected"
                  : "released";
            return (
              <motion.div
                key={lead.name}
                layout
                animate={{ opacity: state === "released" ? 0.4 : 1 }}
                className={cn(
                  "flex items-center gap-3 rounded-2xl border p-3 transition-colors",
                  state === "connected"
                    ? "border-success/40 bg-success/10"
                    : "border-border bg-surface",
                )}
              >
                <span className="relative">
                  <Avatar
                    initials={lead.name.split(" ").map((n) => n[0]).join("")}
                    color={lead.color}
                    size="sm"
                  />
                  {state === "ringing" && (
                    <span className="absolute inset-0 animate-pulse-ring rounded-full" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{lead.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{lead.city}</p>
                </div>
                {state === "ringing" && (
                  <span className="flex gap-0.5">
                    {[0, 1, 2].map((d) => (
                      <motion.span
                        key={d}
                        className="h-1.5 w-1.5 rounded-full bg-warning"
                        animate={{ opacity: [0.3, 1, 0.3] }}
                        transition={{ duration: 1, repeat: Infinity, delay: d * 0.2 }}
                      />
                    ))}
                  </span>
                )}
                {state === "connected" && (
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-success text-white">
                    <Check className="h-3 w-3" />
                  </span>
                )}
              </motion.div>
            );
          })}

          <AnimatePresence>
            {phase === 2 && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="rounded-2xl border border-accent/30 bg-accent-soft/60 p-3"
              >
                <div className="flex items-center gap-2 text-accent">
                  <Sparkles className="h-4 w-4" />
                  <span className="text-xs font-bold">AI ASSIST</span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Robert pays a $189 solar loan <span className="font-semibold text-foreground">and</span> a $248 utility bill. Strong overpayment signal — lead with the true-up review.
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
