"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Check, PhoneOff, X } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import type { DialLine } from "@/lib/use-dialer";
import { cn, formatPhone, initials } from "@/lib/utils";

const colors = ["#3B82F6", "#0EA5E9", "#8B5CF6"];

export function ParallelLines({ lines }: { lines: DialLine[] }) {
  // MotionConfig reducedMotion="user" nulls transform animations but leaves
  // opacity running — this infinite ringing pulse needs an explicit guard.
  const reduce = useReducedMotion();
  return (
    <div className="space-y-2.5">
      <AnimatePresence initial={false}>
        {lines.map((line, i) => {
          const name = `${line.lead.firstName} ${line.lead.lastName}`;
          return (
            <motion.div
              key={line.id}
              layout
              initial={{ opacity: 0, y: 8, scale: 0.98 }}
              animate={{
                opacity: line.status === "canceled" ? 0.45 : 1,
                y: 0,
                scale: 1,
              }}
              exit={{ opacity: 0, scale: 0.97 }}
              transition={{ type: "spring", damping: 26, stiffness: 320 }}
              className={cn(
                "flex items-center gap-3 rounded-2xl border p-3 transition-colors",
                line.status === "connected"
                  ? "border-success/40 bg-success/10 shadow-[0_0_28px_-8px_hsl(var(--success)/0.55)]"
                  : line.status === "canceled"
                    ? "border-border/60 bg-muted/40"
                    : "border-border/70 bg-surface/50 backdrop-blur",
              )}
            >
              <span className="relative">
                <Avatar
                  initials={initials(name)}
                  color={colors[i % colors.length]}
                  size="md"
                />
                {line.status === "ringing" && (
                  <span className="absolute inset-0 animate-pulse-ring rounded-full" />
                )}
              </span>

              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{name}</p>
                <p className="truncate text-xs text-muted-foreground tabular">
                  {formatPhone(line.lead.phone)} · {line.lead.city}, {line.lead.state}
                </p>
              </div>

              {line.status === "ringing" && (
                <span className="flex items-center gap-1.5 text-xs font-semibold text-warning">
                  <span className="flex gap-0.5">
                    {[0, 1, 2].map((d) => (
                      <motion.span
                        key={d}
                        className="h-1.5 w-1.5 rounded-full bg-warning"
                        animate={reduce ? { opacity: 0.7 } : { opacity: [0.3, 1, 0.3] }}
                        transition={
                          reduce
                            ? { duration: 0 }
                            : { duration: 1, repeat: Infinity, delay: d * 0.2 }
                        }
                      />
                    ))}
                  </span>
                  Ringing
                </span>
              )}
              {line.status === "connected" && (
                <span className="flex items-center gap-1.5 text-xs font-bold text-success">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-success text-success-foreground">
                    <Check className="h-3 w-3" />
                  </span>
                  Connected
                </span>
              )}
              {line.status === "canceled" && (
                <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <X className="h-3.5 w-3.5" />
                  Released
                </span>
              )}
              {line.status === "no_answer" && (
                <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <PhoneOff className="h-3.5 w-3.5" />
                  No answer
                </span>
              )}
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
