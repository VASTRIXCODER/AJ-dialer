"use client";

import { motion } from "framer-motion";
import { Bot, Delete, Phone } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const KEYS = [
  { d: "1", s: "" },
  { d: "2", s: "ABC" },
  { d: "3", s: "DEF" },
  { d: "4", s: "GHI" },
  { d: "5", s: "JKL" },
  { d: "6", s: "MNO" },
  { d: "7", s: "PQRS" },
  { d: "8", s: "TUV" },
  { d: "9", s: "WXYZ" },
  { d: "*", s: "" },
  { d: "0", s: "+" },
  { d: "#", s: "" },
];

export function DialPad({
  onCall,
  onAiCall,
  onDigit,
  compact = false,
  callDisabled = false,
}: {
  onCall?: (number: string) => void;
  onAiCall?: (number: string) => void;
  onDigit?: (digit: string) => void;
  compact?: boolean;
  callDisabled?: boolean;
}) {
  const [value, setValue] = useState("");

  const press = (d: string) => {
    if (onDigit) onDigit(d);
    if (!compact) setValue((v) => v + d);
  };

  return (
    <div className="space-y-4">
      {!compact && (
        <div className="flex items-center gap-2">
          <input
            value={value}
            onChange={(e) => setValue(e.target.value.replace(/[^0-9*#+]/g, ""))}
            placeholder="Enter a number"
            inputMode="tel"
            className="h-12 w-full rounded-xl border border-border bg-background/40 px-4 text-center text-lg font-semibold tracking-wider tabular focus-visible:border-primary/50 focus-visible:bg-background/70 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/15"
          />
          {value && (
            <button
              type="button"
              onClick={() => setValue((v) => v.slice(0, -1))}
              className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-muted-foreground hover:bg-muted"
              aria-label="Delete"
            >
              <Delete className="h-5 w-5" />
            </button>
          )}
        </div>
      )}

      <div className="grid grid-cols-3 gap-2.5">
        {KEYS.map((k) => (
          <motion.button
            key={k.d}
            type="button"
            onClick={() => press(k.d)}
            whileTap={{ scale: 0.9 }}
            whileHover={{ y: -2 }}
            transition={{ type: "spring", stiffness: 500, damping: 24 }}
            className={cn(
              "group flex flex-col items-center justify-center rounded-2xl border border-border bg-surface transition-colors duration-200 hover:border-primary/40 hover:bg-primary-soft",
              compact ? "h-12" : "h-16",
            )}
          >
            <span className={cn("font-semibold", compact ? "text-lg" : "text-2xl")}>
              {k.d}
            </span>
            {!compact && k.s && (
              <span className="text-[11px] font-bold tracking-widest text-muted-foreground">
                {k.s}
              </span>
            )}
          </motion.button>
        ))}
      </div>

      {!compact && (onCall || onAiCall) && (
        <div className="flex gap-2">
          {onAiCall && (
            <Button
              size="lg"
              className="flex-1 gap-2"
              disabled={!value}
              onClick={() => onAiCall(value)}
            >
              <Bot className="h-5 w-5" />
              Call with AI
            </Button>
          )}
          {onCall && (
            <Button
              variant={onAiCall ? "outline" : "success"}
              size="lg"
              className="flex-1 gap-2"
              disabled={!value || callDisabled}
              onClick={() => onCall(value)}
            >
              <Phone className="h-5 w-5" />
              Manual
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
