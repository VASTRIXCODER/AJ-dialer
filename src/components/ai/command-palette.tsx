"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowRight,
  CornerDownLeft,
  Loader2,
  PhoneCall,
  Search,
  Sparkles,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AiSourceBadge } from "@/components/ai/source-badge";
import { navGroups, navLabel } from "@/components/layout/nav";
import { useVocabulary } from "@/components/layout/vocabulary";
import { useLead360 } from "@/components/leads/lead-360/lead-360-provider";
import { cn } from "@/lib/utils";

type LeadMatch = {
  id: string;
  reason: string;
  name: string;
  city: string;
  state: string;
  /** The org's own headline figure, pre-labelled and formatted server-side. */
  headline: string | null;
  status: string;
};

type Item =
  | { type: "command"; label: string; href: string; hint: string }
  | { type: "lead"; match: LeadMatch };

/** Open the palette from anywhere: window.dispatchEvent(new Event("open-command-palette")). */
export function CommandPalette() {
  const router = useRouter();
  const vocab = useVocabulary();
  const lead360 = useLead360();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [interpretation, setInterpretation] = useState("");
  const [matches, setMatches] = useState<LeadMatch[]>([]);
  const [source, setSource] = useState<"claude" | "demo" | null>(null);
  const [sourceError, setSourceError] = useState<string | undefined>();
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const commands = useMemo(
    () =>
      navGroups.flatMap((g) =>
        // The palette must search the labels the sidebar actually shows: a
        // recruiter typing "candidates" was finding nothing, because the nav
        // item's static label is "Leads".
        g.items.map((i) => ({ label: navLabel(i, vocab), href: i.href, hint: g.label })),
      ),
    [vocab],
  );

  const filteredCommands = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((c) => c.label.toLowerCase().includes(q));
  }, [commands, query]);

  const items: Item[] = useMemo(
    () => [
      ...filteredCommands.map((c) => ({ type: "command" as const, ...c })),
      ...matches.map((m) => ({ type: "lead" as const, match: m })),
    ],
    [filteredCommands, matches],
  );

  // Toggle with ⌘K / Ctrl+K and an app-wide custom event.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    }
    function onOpen() {
      setOpen(true);
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("open-command-palette", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("open-command-palette", onOpen);
    };
  }, []);

  useEffect(() => {
    if (open) {
      const t = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
    setQuery("");
    setMatches([]);
    setInterpretation("");
    setSource(null);
    setActive(0);
  }, [open]);

  useEffect(() => setActive(0), [query]);

  // Debounced Claude semantic search.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 3) {
      setMatches([]);
      setInterpretation("");
      setSource(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch("/api/ai/search", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ query: q }),
          signal: ctrl.signal,
        });
        const json = await res.json();
        setMatches(json.matches ?? []);
        setInterpretation(json.interpretation ?? "");
        setSource(json.source ?? null);
        setSourceError(json.error);
      } catch {
        /* aborted or failed — leave previous results */
      } finally {
        setLoading(false);
      }
    }, 350);
    return () => {
      ctrl.abort();
      clearTimeout(t);
    };
  }, [query]);

  const select = useCallback(
    (item: Item | undefined) => {
      if (!item) return;
      setOpen(false);
      if (item.type === "command") {
        router.push(item.href);
        return;
      }
      // A lead result opens its Lead 360 drawer in place — picking "Maria S."
      // used to push a bare /dialer that forgot who you searched for. Matches
      // without an id (defensive: demo/AI output) fall back to a name search.
      if (item.match.id) {
        lead360.open(item.match.id);
      } else {
        router.push(`/leads?q=${encodeURIComponent(item.match.name)}`);
      }
    },
    [router, lead360],
  );

  function onInputKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      select(items[active]);
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[100] flex items-start justify-center p-4 pt-[12vh]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.div
            className="absolute inset-0 bg-background/60 backdrop-blur-xl"
            onClick={() => setOpen(false)}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          />

          <motion.div
            initial={{ opacity: 0, y: -16, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 360, damping: 30 }}
            className="glass relative w-full max-w-2xl overflow-hidden rounded-2xl border border-border/60 shadow-lift"
          >
            {/* Input */}
            <div className="flex items-center gap-3 border-b border-border/60 px-4">
              {loading ? (
                <Loader2 className="h-5 w-5 shrink-0 animate-spin text-primary" />
              ) : (
                <Search className="h-5 w-5 shrink-0 text-muted-foreground" />
              )}
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onInputKey}
                placeholder={`Search or ask AI — “${vocab.leadNounPlural} worth calling first”…`}
                className="h-14 w-full bg-transparent text-[15px] outline-none placeholder:text-muted-foreground/70"
              />
              <kbd className="hidden shrink-0 rounded-md border border-border/70 bg-muted/60 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground sm:inline-flex">
                ESC
              </kbd>
            </div>

            <div className="max-h-[52vh] overflow-y-auto p-2">
              {/* AI interpretation banner */}
              {query.trim().length >= 3 && (interpretation || loading) && (
                <div className="mb-1 flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
                  <Sparkles className="h-3.5 w-3.5 text-accent" />
                  <span className="flex-1 truncate">
                    {loading ? "Interpreting your query…" : interpretation}
                  </span>
                  {source && !loading && (
                    <AiSourceBadge source={source} error={sourceError} />
                  )}
                </div>
              )}

              {/* Commands */}
              {filteredCommands.length > 0 && (
                <div className="mb-1">
                  <p className="px-3 pb-1 pt-2 text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground/60">
                    Go to
                  </p>
                  {filteredCommands.map((c, i) => {
                    const idx = i;
                    return (
                      <button
                        key={c.href}
                        type="button"
                        onMouseEnter={() => setActive(idx)}
                        onClick={() => select(items[idx])}
                        className={cn(
                          "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-colors",
                          active === idx ? "bg-primary-soft text-primary" : "hover:bg-muted/60",
                        )}
                      >
                        <ArrowRight className="h-4 w-4 shrink-0 opacity-70" />
                        <span className="flex-1 font-medium">{c.label}</span>
                        <span className="text-[11px] text-muted-foreground">{c.hint}</span>
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Lead matches */}
              {matches.length > 0 && (
                <div>
                  <p className="px-3 pb-1 pt-2 text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground/60">
                    {vocab.LeadNounPlural}
                  </p>
                  {matches.map((m, i) => {
                    const idx = filteredCommands.length + i;
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onMouseEnter={() => setActive(idx)}
                        onClick={() => select(items[idx])}
                        className={cn(
                          "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors",
                          active === idx ? "bg-primary-soft" : "hover:bg-muted/60",
                        )}
                      >
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
                          <PhoneCall className="h-4 w-4" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold">{m.name}</span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {m.city}, {m.state} · {m.reason}
                          </span>
                        </span>
                        {m.headline && (
                          <span className="shrink-0 text-xs font-bold tabular text-muted-foreground">
                            {m.headline}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Empty state */}
              {!loading &&
                query.trim().length >= 3 &&
                items.length === 0 && (
                  <p className="px-3 py-8 text-center text-sm text-muted-foreground">
                    No matches for “{query.trim()}”.
                  </p>
                )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between border-t border-border/60 px-4 py-2 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <Sparkles className="h-3 w-3 text-accent" />
                Semantic search
              </span>
              <span className="flex items-center gap-1">
                <CornerDownLeft className="h-3 w-3" /> to open
              </span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
