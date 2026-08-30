"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Button } from "./button";
import { Modal } from "./modal";
import { Z } from "@/lib/z-layers";

// ─────────────────────────────────────────────────────────────────────────────
// Promise-based confirmation dialog — the replacement for every window.confirm.
// Native confirm() blocks the main thread, can't be styled, escapes the focus
// order, and (in some embedded browsers) is silently suppressed, which turned
// destructive actions into no-ops. This renders the app's Modal instead.
//
//   const confirm = useConfirm();
//   if (await confirm({ title: "Delete campaign?", tone: "danger" })) { … }
// ─────────────────────────────────────────────────────────────────────────────

export interface ConfirmOptions {
  title: string;
  /** Supporting copy under the title. */
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** "danger" renders the confirm action destructive-red. */
  tone?: "default" | "danger";
}

const ConfirmContext = createContext<((opts: ConfirmOptions) => Promise<boolean>) | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  const confirm = useCallback((opts: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      // A second confirm while one is open resolves the first as cancelled —
      // stacked confirmations are always a bug, not a feature.
      resolver.current?.(false);
      resolver.current = resolve;
      setCurrent(opts);
    });
  }, []);

  const settle = useCallback((ok: boolean) => {
    resolver.current?.(ok);
    resolver.current = null;
    setCurrent(null);
  }, []);

  const value = useMemo(() => confirm, [confirm]);

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      <Modal
        open={current !== null}
        onClose={() => settle(false)}
        label={current?.title ?? "Confirm"}
        maxWidth="max-w-md"
        zIndex={Z.confirm}
      >
        {current ? (
          <div className="p-6">
            <h2 className="text-base font-semibold text-foreground">{current.title}</h2>
            {current.body ? (
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{current.body}</p>
            ) : null}
            <div className="mt-6 flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => settle(false)}>
                {current.cancelLabel ?? "Cancel"}
              </Button>
              <Button
                variant={current.tone === "danger" ? "danger" : "primary"}
                size="sm"
                onClick={() => settle(true)}
              >
                {current.confirmLabel ?? "Confirm"}
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>
    </ConfirmContext.Provider>
  );
}

/** Promise-based confirm — must be used inside <ConfirmProvider>. */
export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm must be used inside <ConfirmProvider>");
  return ctx;
}
