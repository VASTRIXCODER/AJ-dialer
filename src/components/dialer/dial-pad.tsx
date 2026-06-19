"use client";

import { Delete, Phone } from "lucide-react";
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
  onDigit,
  compact = false,
  callDisabled = false,
}: {
  onCall?: (number: string) => void;
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
          <button
            key={k.d}
            type="button"
            onClick={() => press(k.d)}
            className={cn(
              "group flex flex-col items-center justify-center rounded-2xl border border-border bg-surface transition-all duration-150 hover:border-primary/40 hover:bg-primary-soft active:scale-95",
              compact ? "h-12" : "h-16",
            )}
          >
            <span className={cn("font-semibold", compact ? "text-lg" : "text-2xl")}>
              {k.d}
            </span>
            {!compact && k.s && (
              <span className="text-[9px] font-bold tracking-widest text-muted-foreground">
                {k.s}
              </span>
            )}
          </button>
        ))}
      </div>

      {!compact && onCall && (
        <Button
          variant="success"
          size="lg"
          className="w-full gap-2"
          disabled={!value || callDisabled}
          onClick={() => onCall(value)}
        >
          <Phone className="h-5 w-5" />
          Call
        </Button>
      )}
    </div>
  );
}
