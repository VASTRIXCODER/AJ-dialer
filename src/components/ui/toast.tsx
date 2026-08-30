"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils";
import { Portal } from "./portal";
import { Z } from "@/lib/z-layers";

// ─────────────────────────────────────────────────────────────────────────────
// App-wide toasts. Mounted once in the root layout so every surface (app shell,
// hub, superadmin console) can announce results without hand-rolled banners.
// The stack is an aria-live="polite" region, so screen readers hear outcomes
// without focus theft.
// ─────────────────────────────────────────────────────────────────────────────

export type ToastTone = "default" | "success" | "danger";

export interface ToastOptions {
  title: string;
  description?: string;
  tone?: ToastTone;
  /** ms before auto-dismiss; 0 keeps it until closed. Default 5000. */
  duration?: number;
}

interface ToastItem extends Required<Pick<ToastOptions, "title" | "tone">> {
  id: number;
  description?: string;
}

const ToastContext = createContext<{ toast: (opts: ToastOptions) => void } | null>(null);

const TONE_STYLE: Record<ToastTone, { icon: typeof Info; ring: string; iconClass: string }> = {
  default: { icon: Info, ring: "ring-border/70", iconClass: "text-accent" },
  success: { icon: CheckCircle2, ring: "ring-success/40", iconClass: "text-success" },
  danger: { icon: AlertTriangle, ring: "ring-danger/40", iconClass: "text-danger" },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const reduce = useReducedMotion();

  const dismiss = useCallback((id: number) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (opts: ToastOptions) => {
      const id = nextId.current++;
      setItems((prev) => [
        // Cap the stack — old news scrolls away rather than covering the screen.
        ...prev.slice(-3),
        { id, title: opts.title, description: opts.description, tone: opts.tone ?? "default" },
      ]);
      const duration = opts.duration ?? 5000;
      if (duration > 0) setTimeout(() => dismiss(id), duration);
    },
    [dismiss],
  );

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <Portal>
        <div
          aria-live="polite"
          aria-label="Notifications"
          // Below `sm` the stack is centred, which is exactly where the call
          // bar sits — a toast used to land on top of End call and Mute during
          // a live call. `--callbar-h` is published by GlobalCallBar only while
          // it is up, so this is a plain 1rem the rest of the time.
          className="pointer-events-none fixed inset-x-0 flex flex-col items-center gap-2 px-4 sm:items-end sm:pr-6"
          style={{ zIndex: Z.toast, bottom: "calc(1rem + var(--callbar-h, 0px))" }}
        >
          <AnimatePresence>
            {items.map((t) => {
              const tone = TONE_STYLE[t.tone];
              const Icon = tone.icon;
              return (
                <motion.div
                  key={t.id}
                  // Opacity only. A toast reports the outcome of something the
                  // rep just did on a working surface, often over a data grid;
                  // it used to spring in on a translate and a scale, and stack
                  // with framer's `layout` so the whole column re-flowed each
                  // time one arrived or left.
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: reduce ? 0 : 0.12, ease: "linear" }}
                  className={cn(
                    "pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-2xl border border-border/60 bg-surface-1 p-3.5 shadow-2 ring-1 ring-inset",
                    tone.ring,
                  )}
                >
                  <Icon className={cn("mt-0.5 h-4.5 w-4.5 shrink-0", tone.iconClass)} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-foreground">{t.title}</p>
                    {t.description ? (
                      <p className="mt-0.5 text-xs text-muted-foreground">{t.description}</p>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    onClick={() => dismiss(t.id)}
                    aria-label="Dismiss notification"
                    className="rounded-lg p-1 text-muted-foreground transition hover:bg-muted/70 hover:text-foreground"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden />
                  </button>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      </Portal>
    </ToastContext.Provider>
  );
}

/** `const { toast } = useToast()` → `toast({ title, tone: "success" })`. */
export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}
