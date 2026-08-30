"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  Bot,
  Loader2,
  MessageSquarePlus,
  PanelLeft,
  Send,
  Sparkles,
  Trash2,
  User,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Msg = { role: "user" | "assistant"; content: string };
type Convo = { id: string; title: string; messages: Msg[]; updatedAt: number };

const KEY = "aiatwork.chat.v1";

const SUGGESTIONS = [
  "Brief me on today's performance",
  "Which leads should I call first?",
  "How do I start an AI calling session?",
  "Summarize my appointments & callbacks",
];

const uid = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `c-${Date.now()}-${Math.random().toString(36).slice(2)}`;

function upsert(list: Convo[], convo: Convo): Convo[] {
  return [convo, ...list.filter((c) => c.id !== convo.id)];
}

// ── Lightweight markdown for assistant replies (bold, code, bullets, headings) ─
function inline(s: string, k: string) {
  const out: React.ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push(s.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("**"))
      out.push(<strong key={`${k}-${i++}`}>{tok.slice(2, -2)}</strong>);
    else
      out.push(
        <code key={`${k}-${i++}`} className="rounded bg-muted px-1 py-0.5 text-[0.85em]">
          {tok.slice(1, -1)}
        </code>,
      );
    last = m.index + tok.length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}

function RichText({ text }: { text: string }) {
  const lines = text.split("\n");
  const blocks: React.ReactNode[] = [];
  let bullets: string[] = [];
  const flush = (key: string) => {
    if (bullets.length) {
      blocks.push(
        <ul key={`ul-${key}`} className="my-1 ml-1 space-y-1">
          {bullets.map((b, i) => (
            <li key={i} className="flex gap-2">
              <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-current opacity-50" />
              <span>{inline(b, `${key}-${i}`)}</span>
            </li>
          ))}
        </ul>,
      );
      bullets = [];
    }
  };
  lines.forEach((raw, idx) => {
    const line = raw.trimEnd();
    if (/^\s*[-•]\s+/.test(line)) {
      bullets.push(line.replace(/^\s*[-•]\s+/, ""));
    } else if (/^#{1,3}\s+/.test(line)) {
      flush(`h${idx}`);
      blocks.push(
        <p key={`h-${idx}`} className="mt-2 font-semibold">
          {inline(line.replace(/^#{1,3}\s+/, ""), `h${idx}`)}
        </p>,
      );
    } else if (line.trim() === "") {
      flush(`s${idx}`);
    } else {
      flush(`p${idx}`);
      blocks.push(
        <p key={`p-${idx}`} className="leading-relaxed">
          {inline(line, `p${idx}`)}
        </p>,
      );
    }
  });
  flush("end");
  return <div className="space-y-1.5">{blocks}</div>;
}

export function ChatAssistant() {
  const [convos, setConvos] = useState<Convo[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Convo[];
        if (Array.isArray(parsed)) {
          setConvos(parsed);
          setActiveId(parsed[0]?.id ?? null);
        }
      }
    } catch {
      /* ignore */
    }
  }, []);

  const persist = useCallback((next: Convo[]) => {
    setConvos(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next.slice(0, 50)));
    } catch {
      /* ignore quota */
    }
  }, []);

  const active = convos.find((c) => c.id === activeId) ?? null;

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [active?.messages.length, sending]);

  const send = useCallback(
    async (text: string) => {
      const content = text.trim();
      if (!content || sending) return;
      setInput("");

      const base: Convo =
        active ?? { id: uid(), title: content.slice(0, 48), messages: [], updatedAt: Date.now() };
      const withUser: Convo = {
        ...base,
        title: base.messages.length === 0 ? content.slice(0, 48) : base.title,
        messages: [...base.messages, { role: "user", content }],
        updatedAt: Date.now(),
      };
      const list1 = upsert(convos, withUser);
      setActiveId(withUser.id);
      persist(list1);
      setSending(true);

      try {
        const res = await fetch("/api/ai/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ messages: withUser.messages }),
        });
        const j = (await res.json().catch(() => ({}))) as { reply?: string };
        const reply = j.reply || "Sorry, I couldn't generate a response.";
        persist(
          upsert(list1, {
            ...withUser,
            messages: [...withUser.messages, { role: "assistant", content: reply }],
            updatedAt: Date.now(),
          }),
        );
      } catch {
        persist(
          upsert(list1, {
            ...withUser,
            messages: [
              ...withUser.messages,
              { role: "assistant", content: "Network error — please try again." },
            ],
          }),
        );
      } finally {
        setSending(false);
      }
    },
    [active, convos, persist, sending],
  );

  function remove(id: string) {
    const next = convos.filter((c) => c.id !== id);
    persist(next);
    if (activeId === id) setActiveId(next[0]?.id ?? null);
  }

  return (
    <div className="glass flex h-[600px] overflow-hidden rounded-2xl border border-border/60">
      {/* Conversation list */}
      <aside
        className={cn(
          "absolute z-20 flex h-[600px] w-64 shrink-0 flex-col border-r border-border/60 bg-card transition-transform sm:static sm:translate-x-0",
          listOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="p-3">
          <Button
            size="sm"
            className="w-full gap-2"
            onClick={() => {
              setActiveId(null);
              setInput("");
              setListOpen(false);
            }}
          >
            <MessageSquarePlus className="h-4 w-4" />
            New chat
          </Button>
        </div>
        <div className="flex-1 space-y-1 overflow-y-auto px-2 pb-3">
          {convos.length === 0 && (
            <p className="px-3 py-6 text-center text-xs text-muted-foreground">
              Your conversations appear here.
            </p>
          )}
          {convos.map((c) => (
            <div
              key={c.id}
              className={cn(
                "group flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm transition-colors",
                c.id === activeId ? "bg-primary-soft text-primary" : "hover:bg-muted/60",
              )}
            >
              <button
                type="button"
                onClick={() => {
                  setActiveId(c.id);
                  setListOpen(false);
                }}
                className="min-w-0 flex-1 truncate text-left"
              >
                {c.title || "New chat"}
              </button>
              <button
                type="button"
                onClick={() => remove(c.id)}
                aria-label="Delete chat"
                className="opacity-0 transition-opacity hover:text-danger group-hover:opacity-100"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      </aside>

      {/* Chat panel */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-border/60 px-4 py-3">
          <button
            type="button"
            onClick={() => setListOpen((v) => !v)}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted sm:hidden"
            aria-label="Toggle conversations"
          >
            <PanelLeft className="h-4 w-4" />
          </button>
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand text-white shadow-glow">
            <Sparkles className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold leading-tight">AI Command Center</p>
            <p className="truncate text-xs text-muted-foreground">
              Briefs you, oversees the floor & answers anything
            </p>
          </div>
        </div>

        <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto p-4">
          {!active || active.messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-5 text-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand text-white shadow-glow">
                <Bot className="h-7 w-7" />
              </span>
              <div>
                <p className="text-base font-semibold">How can I help you run the floor?</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Ask for a brief, who to call next, or how anything works.
                </p>
              </div>
              <div className="grid w-full max-w-md grid-cols-1 gap-2 sm:grid-cols-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => send(s)}
                    className="rounded-xl border border-border/70 bg-surface/50 px-3 py-2.5 text-left text-sm transition-colors hover:border-primary/40 hover:bg-primary-soft"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <AnimatePresence initial={false}>
              {active.messages.map((m, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={cn("flex gap-3", m.role === "user" ? "justify-end" : "justify-start")}
                >
                  {m.role === "assistant" && (
                    <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand text-white">
                      <Bot className="h-4 w-4" />
                    </span>
                  )}
                  <div
                    className={cn(
                      "max-w-[80%] rounded-2xl px-4 py-2.5 text-sm",
                      m.role === "user"
                        ? "rounded-br-md bg-brand text-white"
                        : "rounded-bl-md bg-muted text-foreground",
                    )}
                  >
                    {m.role === "assistant" ? (
                      <RichText text={m.content} />
                    ) : (
                      <span className="whitespace-pre-wrap">{m.content}</span>
                    )}
                  </div>
                  {m.role === "user" && (
                    <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                      <User className="h-4 w-4" />
                    </span>
                  )}
                </motion.div>
              ))}
              {sending && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex gap-3">
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand text-white">
                    <Bot className="h-4 w-4" />
                  </span>
                  <div className="flex items-center gap-1 rounded-2xl rounded-bl-md bg-muted px-4 py-3">
                    {[0, 1, 2].map((d) => (
                      <span
                        key={d}
                        className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/60"
                        style={{ animationDelay: `${d * 0.15}s` }}
                      />
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          )}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
          className="flex items-end gap-2 border-t border-border/60 p-3"
        >
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
            rows={1}
            placeholder="Ask the AI command center…"
            className="max-h-32 min-h-[44px] w-full resize-none rounded-xl border border-border/70 bg-background/50 px-3.5 py-2.5 text-sm outline-none focus-visible:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary/15"
          />
          <Button type="submit" size="icon" disabled={!input.trim() || sending} aria-label="Send">
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </form>
      </div>
    </div>
  );
}
