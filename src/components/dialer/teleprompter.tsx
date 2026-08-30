"use client";

import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Pause,
  Play,
  ScrollText,
  Split,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
  buildTeleprompterSections,
  type ScriptSection,
  type ScriptToken,
} from "@/lib/dialer/teleprompter";
import type { LeadFieldDef } from "@/lib/leads/field-schema";
import type { ScriptVariant } from "@/lib/campaign-scripts";
import type { Lead } from "@/lib/types";
import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────────────────
// Teleprompter (E3) — replaces the static script card whenever a campaign
// script exists. Sections with a nav rail, {{field}} interpolation against the
// CURRENT lead (missing values are amber ⟨field⟩ chips — never guessed),
// font-size and auto-scroll controls, objection branch (the campaign's other
// script) swapping the pane, and one-tap copy-to-notes on interpolated values.
// The text engine is pure (src/lib/dialer/teleprompter.ts) — this renders it.
// ─────────────────────────────────────────────────────────────────────────────

type FontSize = "s" | "m" | "l";
const FONT_KEY = "aj:teleprompter:font";
const FONT_CLASS: Record<FontSize, string> = {
  s: "text-xs leading-relaxed",
  m: "text-sm leading-relaxed",
  l: "text-base leading-relaxed",
};
/** Pixels per tick per speed step (50ms tick). */
const SCROLL_SPEEDS = [0.5, 1, 2] as const;

function readFontSize(): FontSize {
  if (typeof window === "undefined") return "m";
  try {
    const v = window.localStorage.getItem(FONT_KEY);
    return v === "s" || v === "l" ? v : "m";
  } catch {
    return "m";
  }
}

function TokenSpan({
  token,
  onCopyToNotes,
}: {
  token: ScriptToken;
  onCopyToNotes?: (line: string) => void;
}) {
  if (token.kind === "text") return <>{token.text}</>;
  if (token.value === null) {
    // Missing value — an honest amber chip naming the field, NEVER a guess.
    return (
      <span
        title={`No value for “${token.label}” on this lead — ask and fill it in.`}
        className="mx-0.5 inline-flex items-center rounded-md border border-warning/40 bg-warning/10 px-1.5 py-0.5 text-[0.85em] font-semibold text-warning"
      >
        ⟨{token.label}⟩
      </span>
    );
  }
  const line = `${token.label} — ${token.value}`;
  return (
    <button
      type="button"
      onClick={onCopyToNotes ? () => onCopyToNotes(line) : undefined}
      title={onCopyToNotes ? `Copy to notes: ${line}` : token.label}
      className={cn(
        "mx-0.5 inline-flex items-center rounded-md border border-primary/30 bg-primary-soft px-1.5 py-0.5 text-[0.85em] font-semibold text-primary",
        onCopyToNotes && "transition-colors hover:border-primary/60",
      )}
    >
      {token.value}
    </button>
  );
}

export function Teleprompter({
  scriptText,
  branchText,
  variant,
  testRunning,
  lead,
  fields,
  onCopyToNotes,
}: {
  /** The assigned variant's script text (already resolved for this lead). */
  scriptText: string;
  /** The campaign's OTHER script, if any — offered as an objection branch. */
  branchText?: string | null;
  variant: ScriptVariant | null;
  /** Both scripts set ⇒ an A/B test is splitting leads (badge context). */
  testRunning: boolean;
  lead: Lead | null;
  fields: LeadFieldDef[];
  /** Append "Label — value" to the rep's in-call notes. */
  onCopyToNotes?: (line: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const [fontSize, setFontSize] = useState<FontSize>("m");
  const [onBranch, setOnBranch] = useState(false);
  const [scrolling, setScrolling] = useState(false);
  const [speedIdx, setSpeedIdx] = useState(1);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [activeSection, setActiveSection] = useState(0);
  const paneRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    setFontSize(readFontSize());
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => {
      setReducedMotion(mq.matches);
      // Auto-scroll must be OFF by default under reduced motion — and a flip
      // to reduced mid-session stops a running scroll rather than fighting it.
      if (mq.matches) setScrolling(false);
    };
    apply();
    mq.addEventListener?.("change", apply);
    return () => mq.removeEventListener?.("change", apply);
  }, []);

  const pickFont = (size: FontSize) => {
    setFontSize(size);
    try {
      window.localStorage.setItem(FONT_KEY, size);
    } catch {
      /* preference just won't persist */
    }
  };

  const branchVariant: ScriptVariant | null = branchText
    ? variant === "b"
      ? "a"
      : "b"
    : null;
  const activeText = onBranch && branchText ? branchText : scriptText;
  const sections: ScriptSection[] = useMemo(
    () => buildTeleprompterSections(activeText, lead, fields),
    [activeText, lead, fields],
  );

  // Reset scroll + section when the pane content changes (lead advance, branch).
  useEffect(() => {
    setActiveSection(0);
    if (paneRef.current) paneRef.current.scrollTop = 0;
  }, [activeText, lead?.id]);

  // Auto-scroll: a steady crawl of the pane. Interval-driven so speed is exact;
  // stops at the bottom instead of spinning forever.
  useEffect(() => {
    if (!scrolling) return;
    const pane = paneRef.current;
    if (!pane) return;
    const step = SCROLL_SPEEDS[speedIdx] ?? 1;
    const id = setInterval(() => {
      pane.scrollTop += step;
      if (pane.scrollTop + pane.clientHeight >= pane.scrollHeight - 1) {
        setScrolling(false);
      }
    }, 50);
    return () => clearInterval(id);
  }, [scrolling, speedIdx]);

  const jumpTo = (i: number) => {
    setActiveSection(i);
    setScrolling(false);
    sectionRefs.current[i]?.scrollIntoView({
      behavior: reducedMotion ? "auto" : "smooth",
      block: "start",
    });
  };

  if (!scriptText.trim()) return null;

  return (
    <div className="border-b border-border">
      {/* Header row — same collapse affordance the old script card had */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-5 py-3 text-left transition-colors hover:bg-muted/50"
      >
        <ScrollText className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-semibold">Script</span>
        {testRunning && variant && !onBranch && (
          <Badge tone={variant === "a" ? "primary" : "accent"}>
            Variant {variant.toUpperCase()}
          </Badge>
        )}
        {onBranch && branchVariant && (
          <Badge tone="warning">Branch {branchVariant.toUpperCase()}</Badge>
        )}
        {/* The glyph swaps; it does not rotate. A rotation is a transform,
            and this panel sits beside the live call. */}
        {open ? (
          <ChevronUp className="ml-auto h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="ml-auto h-4 w-4 text-muted-foreground" />
        )}
      </button>

      {open && (
        <div className="px-5 pb-4">
          {/* Controls: branch, font size, auto-scroll */}
          <div className="mb-2 flex flex-wrap items-center gap-2">
            {branchVariant &&
              (onBranch ? (
                <button
                  type="button"
                  onClick={() => setOnBranch(false)}
                  className="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-2 py-0.5 text-[11px] font-semibold text-muted-foreground transition-colors hover:bg-muted"
                >
                  <ArrowLeft className="h-3 w-3" />
                  Back to script
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setOnBranch(true)}
                  title="Swap to the campaign's other script — e.g. an objection track."
                  className="inline-flex items-center gap-1 rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-[11px] font-semibold text-warning transition-colors hover:bg-warning/15"
                >
                  <Split className="h-3 w-3" />
                  Branch {branchVariant.toUpperCase()}
                </button>
              ))}
            <span className="ml-auto inline-flex items-center gap-0.5 rounded-full border border-border bg-surface p-0.5">
              {(["s", "m", "l"] as const).map((size) => (
                <button
                  key={size}
                  type="button"
                  onClick={() => pickFont(size)}
                  aria-pressed={fontSize === size}
                  title={`${size.toUpperCase()} text`}
                  className={cn(
                    "rounded-full px-1.5 py-0.5 text-[11px] font-bold uppercase transition-colors",
                    fontSize === size
                      ? "bg-primary-soft text-primary"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {size}
                </button>
              ))}
            </span>
            <span className="inline-flex items-center gap-1">
              <button
                type="button"
                onClick={() => setScrolling((v) => !v)}
                aria-pressed={scrolling}
                title={
                  scrolling
                    ? "Pause auto-scroll"
                    : "Auto-scroll the script while you read (off by default)"
                }
                className={cn(
                  "inline-flex h-6 w-6 items-center justify-center rounded-full border transition-colors",
                  scrolling
                    ? "border-primary/60 bg-primary-soft text-primary"
                    : "border-border bg-surface text-muted-foreground hover:bg-muted",
                )}
              >
                {scrolling ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
              </button>
              <button
                type="button"
                onClick={() => setSpeedIdx((i) => (i + 1) % SCROLL_SPEEDS.length)}
                title="Auto-scroll speed"
                className="rounded-full border border-border bg-surface px-1.5 py-0.5 text-[11px] font-semibold text-muted-foreground transition-colors hover:bg-muted"
              >
                {SCROLL_SPEEDS[speedIdx]}×
              </button>
            </span>
          </div>

          <div className="flex gap-3">
            {/* Section nav rail — only when there's more than one section */}
            {sections.length > 1 && (
              <nav aria-label="Script sections" className="w-24 shrink-0 space-y-0.5">
                {sections.map((s, i) => (
                  <button
                    key={`${s.title}-${i}`}
                    type="button"
                    onClick={() => jumpTo(i)}
                    title={s.title}
                    className={cn(
                      "block w-full truncate rounded-lg border-l-2 px-2 py-1 text-left text-[11px] font-medium transition-colors",
                      i === activeSection
                        ? "border-primary bg-primary-soft text-primary"
                        : "border-transparent text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}
                  >
                    {s.title}
                  </button>
                ))}
              </nav>
            )}

            <div
              ref={paneRef}
              className={cn("max-h-64 min-w-0 flex-1 overflow-y-auto pr-1", FONT_CLASS[fontSize])}
            >
              {sections.map((s, i) => (
                <div
                  key={`${s.title}-${i}`}
                  ref={(el) => {
                    sectionRefs.current[i] = el;
                  }}
                  className={i > 0 ? "mt-4" : undefined}
                >
                  {sections.length > 1 && (
                    <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                      {s.title}
                    </p>
                  )}
                  <p className="whitespace-pre-wrap text-muted-foreground">
                    {s.tokens.map((t, j) => (
                      <TokenSpan key={j} token={t} onCopyToNotes={onCopyToNotes} />
                    ))}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
