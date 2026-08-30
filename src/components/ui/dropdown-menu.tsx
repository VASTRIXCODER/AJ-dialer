"use client";

import {
  Children,
  createContext,
  isValidElement,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentType,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils";
import { Portal } from "./portal";

// ─────────────────────────────────────────────────────────────────────────────
// Menu — the app's one dropdown-menu shape (WAI-ARIA menu-button pattern).
//
//   <Menu>
//     <MenuTrigger className="…">⋯</MenuTrigger>
//     <MenuItem icon={Headphones} onSelect={listen}>Listen live</MenuItem>
//     <MenuSeparator />
//     <MenuItem danger onSelect={end}>End call</MenuItem>
//   </Menu>
//
// The popup renders in a Portal (so it escapes overflow-hidden cards and table
// rows) positioned against the trigger, clamped to the viewport. Keyboard:
// ArrowDown/Up move focus, Home/End jump, Esc closes and restores focus to the
// trigger, Tab closes. Clicking outside closes. Items are real <button>s with
// role="menuitem"; a disabled item stays rendered (aria-disabled) with its
// `title` explaining WHY — capabilities are disabled with a reason, not hidden.
// ─────────────────────────────────────────────────────────────────────────────

interface MenuCtxValue {
  open: boolean;
  setOpen: (open: boolean) => void;
  close: (restoreFocus?: boolean) => void;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  idBase: string;
}

const MenuCtx = createContext<MenuCtxValue | null>(null);

function useMenuCtx(component: string): MenuCtxValue {
  const ctx = useContext(MenuCtx);
  if (!ctx) throw new Error(`<${component}> must be rendered inside <Menu>`);
  return ctx;
}

export function Menu({
  align = "end",
  className,
  children,
}: {
  /** Which trigger edge the popup aligns to ("end" = right edge). */
  align?: "start" | "end";
  className?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const idBase = useId();

  const close = useCallback((restoreFocus = true) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus({ preventScroll: true });
  }, []);

  // Partition children: the MenuTrigger renders inline where the Menu sits;
  // everything else (items, separators, arbitrary headers) goes in the popup.
  const all = Children.toArray(children);
  const trigger = all.find((el) => isValidElement(el) && el.type === MenuTrigger);
  const items = all.filter((el) => el !== trigger);

  return (
    <MenuCtx.Provider value={{ open, setOpen, close, triggerRef, idBase }}>
      <span className={cn("relative inline-flex", className)}>{trigger}</span>
      {open && (
        <Portal>
          <MenuPopup align={align}>{items}</MenuPopup>
        </Portal>
      )}
    </MenuCtx.Provider>
  );
}

export function MenuTrigger({
  className,
  label,
  children,
}: {
  className?: string;
  /** Accessible name when the trigger content isn't text (e.g. a ⋯ icon). */
  label?: string;
  children: ReactNode;
}) {
  const { open, setOpen, triggerRef, idBase } = useMenuCtx("MenuTrigger");
  function onKeyDown(e: ReactKeyboardEvent<HTMLButtonElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setOpen(true);
    }
  }
  return (
    <button
      ref={triggerRef}
      type="button"
      aria-haspopup="menu"
      aria-expanded={open}
      aria-controls={open ? `${idBase}-menu` : undefined}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        setOpen(!open);
      }}
      onKeyDown={onKeyDown}
      className={cn(
        "inline-flex items-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      {children}
    </button>
  );
}

function MenuPopup({
  align,
  children,
}: {
  align: "start" | "end";
  children: ReactNode;
}) {
  const { close, triggerRef, idBase } = useMenuCtx("MenuPopup");
  const popRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  // Position against the trigger, clamped inside the viewport.
  useLayoutEffect(() => {
    const trigger = triggerRef.current;
    const pop = popRef.current;
    if (!trigger || !pop) return;
    const r = trigger.getBoundingClientRect();
    const w = pop.offsetWidth;
    const h = pop.offsetHeight;
    let left = align === "end" ? r.right - w : r.left;
    left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
    let top = r.bottom + 6;
    if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 6);
    setPos({ top, left });
  }, [align, triggerRef]);

  // Focus the first enabled item once positioned.
  useEffect(() => {
    const pop = popRef.current;
    if (!pop) return;
    const first = pop.querySelector<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])');
    first?.focus({ preventScroll: true });
  }, []);

  // Close on any outside pointer press or viewport change.
  useEffect(() => {
    function onPointer(e: PointerEvent) {
      const pop = popRef.current;
      const trigger = triggerRef.current;
      const t = e.target as Node;
      if (pop?.contains(t) || trigger?.contains(t)) return;
      close(false);
    }
    function onScrollOrResize() {
      close(false);
    }
    document.addEventListener("pointerdown", onPointer, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      document.removeEventListener("pointerdown", onPointer, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [close, triggerRef]);

  function onKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    const pop = popRef.current;
    if (!pop) return;
    const items = [...pop.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])')];
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      return;
    }
    if (e.key === "Tab") {
      close(false);
      return;
    }
    if (items.length === 0) return;
    const at = items.indexOf(document.activeElement as HTMLElement);
    let next: number | null = null;
    if (e.key === "ArrowDown") next = (at + 1) % items.length;
    else if (e.key === "ArrowUp") next = (at - 1 + items.length) % items.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = items.length - 1;
    if (next === null) return;
    e.preventDefault();
    items[next].focus();
  }

  return (
    <div
      ref={popRef}
      id={`${idBase}-menu`}
      role="menu"
      onKeyDown={onKeyDown}
      className={cn(
        "fixed z-[130] min-w-44 max-w-72 rounded-xl border border-border/70 bg-card p-1 shadow-lift",
        pos ? "opacity-100" : "opacity-0", // measured off-screen first paint
      )}
      style={pos ?? { top: -9999, left: -9999 }}
    >
      {children}
    </div>
  );
}

export function MenuItem({
  onSelect,
  disabled = false,
  danger = false,
  icon: Icon,
  title,
  className,
  children,
}: {
  onSelect?: () => void;
  disabled?: boolean;
  /** Destructive styling (end call, delete…). */
  danger?: boolean;
  icon?: ComponentType<{ className?: string }>;
  /** Plain-language reason shown on hover — REQUIRED reading when disabled. */
  title?: string;
  className?: string;
  children: ReactNode;
}) {
  const { close } = useMenuCtx("MenuItem");
  return (
    <button
      type="button"
      role="menuitem"
      tabIndex={-1}
      aria-disabled={disabled || undefined}
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        if (disabled) return;
        close(false);
        onSelect?.();
      }}
      className={cn(
        "flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm font-medium transition-colors",
        "focus-visible:outline-none focus:bg-muted/70",
        disabled
          ? "cursor-not-allowed text-ink-3"
          : danger
            ? "text-danger hover:bg-danger/10"
            : "text-foreground hover:bg-muted/70",
        className,
      )}
    >
      {Icon && <Icon className="h-4 w-4 shrink-0" />}
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </button>
  );
}

export function MenuSeparator({ className }: { className?: string }) {
  return <div role="separator" className={cn("my-1 h-px bg-border/70", className)} />;
}
