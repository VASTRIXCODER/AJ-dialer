"use client";

import { Check, ChevronsUpDown } from "lucide-react";
import {
  useCallback,
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
// SelectMenu — choosing ONE value from a known set.
//
// `Select` in ui/input.tsx is a styled native <select>, which the UI spec bans
// product-wide: it cannot be tokenised, its popup ignores the app's light/dark
// theme, it can't show an icon or a disabled reason, and on Windows it renders
// a system list that looks nothing like the rest of the product.
//
// This is NOT the Menu primitive with a checkmark. A menu is a list of ACTIONS;
// a select holds a VALUE, and the difference is announced: role="listbox" with
// role="option" + aria-selected tells a screen-reader user what is currently
// chosen, which role="menuitem" cannot express. Same portal, positioning and
// outside-click behaviour as Menu — deliberately duplicated rather than shared,
// because factoring it out would touch every one of Menu's call sites.
//
//   <SelectMenu
//     label="Owner"
//     value={owner}
//     onChange={setOwner}
//     options={[{ value: "all", label: "Everyone" }, …]}
//   />
//
// Keyboard: Enter/Space/ArrowDown open, arrows move, Home/End jump, typing
// jumps to a matching label, Enter selects, Esc closes and restores focus.
// ─────────────────────────────────────────────────────────────────────────────

export interface SelectOption<T extends string = string> {
  value: T;
  label: string;
  /** Secondary line under the label — a count, a scope, a consequence. */
  hint?: string;
  icon?: ComponentType<{ className?: string }>;
  disabled?: boolean;
  /** Why this option can't be picked. Required reading when `disabled`. */
  disabledReason?: string;
}

export function SelectMenu<T extends string = string>({
  value,
  onChange,
  options,
  label,
  placeholder = "Select…",
  align = "start",
  size = "md",
  disabled = false,
  disabledReason,
  className,
  triggerClassName,
}: {
  value: T | null;
  onChange: (value: T) => void;
  options: SelectOption<T>[];
  /** Accessible name. Rendered as a quiet prefix when the trigger has room. */
  label: string;
  placeholder?: string;
  align?: "start" | "end";
  size?: "sm" | "md";
  disabled?: boolean;
  /** Why the whole control is unavailable — shown on hover, never hidden. */
  disabledReason?: string;
  className?: string;
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const idBase = useId();
  const selected = options.find((o) => o.value === value) ?? null;

  const close = useCallback((restoreFocus = true) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus({ preventScroll: true });
  }, []);

  function onTriggerKeyDown(e: ReactKeyboardEvent<HTMLButtonElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === " " || e.key === "Enter") {
      e.preventDefault();
      setOpen(true);
    }
  }

  return (
    <span className={cn("relative inline-flex", className)}>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${idBase}-listbox` : undefined}
        aria-label={label}
        disabled={disabled}
        // A disabled control states its reason rather than going silent.
        title={disabled ? disabledReason : undefined}
        onClick={() => !disabled && setOpen(!open)}
        onKeyDown={onTriggerKeyDown}
        className={cn(
          "inline-flex items-center gap-2 rounded-xl border border-input bg-background/40 font-medium text-foreground transition-all duration-200",
          "focus-visible:border-primary/50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/15",
          "disabled:cursor-not-allowed disabled:opacity-60",
          size === "sm" ? "px-2.5 py-1.5 text-xs" : "px-3.5 py-2.5 text-sm",
          triggerClassName,
        )}
      >
        {selected?.icon && <selected.icon className="h-4 w-4 shrink-0" />}
        <span className={cn("min-w-0 flex-1 truncate text-left", !selected && "text-muted-foreground")}>
          {selected ? selected.label : placeholder}
        </span>
        <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      </button>

      {open && (
        <Portal>
          <SelectPopup
            idBase={idBase}
            align={align}
            label={label}
            options={options}
            value={value}
            triggerRef={triggerRef}
            onPick={(v) => {
              close(true);
              onChange(v);
            }}
            onDismiss={close}
          />
        </Portal>
      )}
    </span>
  );
}

function SelectPopup<T extends string>({
  idBase,
  align,
  label,
  options,
  value,
  triggerRef,
  onPick,
  onDismiss,
}: {
  idBase: string;
  align: "start" | "end";
  label: string;
  options: SelectOption<T>[];
  value: T | null;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  onPick: (value: T) => void;
  onDismiss: (restoreFocus?: boolean) => void;
}) {
  const popRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number; minWidth: number } | null>(null);
  // Typeahead: successive keystrokes within a second compose one search.
  const typed = useRef<{ text: string; at: number }>({ text: "", at: 0 });

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
    setPos({ top, left, minWidth: r.width });
  }, [align, triggerRef]);

  // Open on the current value, so arrows move from where you are.
  useEffect(() => {
    const pop = popRef.current;
    if (!pop) return;
    const current = pop.querySelector<HTMLElement>('[aria-selected="true"]');
    const first = pop.querySelector<HTMLElement>('[role="option"]:not([aria-disabled="true"])');
    (current ?? first)?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    function onPointer(e: PointerEvent) {
      const t = e.target as Node;
      if (popRef.current?.contains(t) || triggerRef.current?.contains(t)) return;
      onDismiss(false);
    }
    function onViewportChange() {
      onDismiss(false);
    }
    document.addEventListener("pointerdown", onPointer, true);
    window.addEventListener("resize", onViewportChange);
    return () => {
      document.removeEventListener("pointerdown", onPointer, true);
      window.removeEventListener("resize", onViewportChange);
    };
  }, [onDismiss, triggerRef]);

  function focusable(): HTMLElement[] {
    const pop = popRef.current;
    if (!pop) return [];
    return [...pop.querySelectorAll<HTMLElement>('[role="option"]:not([aria-disabled="true"])')];
  }

  function onKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      onDismiss(true);
      return;
    }
    if (e.key === "Tab") {
      onDismiss(false);
      return;
    }
    const items = focusable();
    if (!items.length) return;
    const at = items.indexOf(document.activeElement as HTMLElement);
    let next: number | null = null;
    if (e.key === "ArrowDown") next = (at + 1) % items.length;
    else if (e.key === "ArrowUp") next = (at - 1 + items.length) % items.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = items.length - 1;
    else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
      const now = Date.now();
      typed.current =
        now - typed.current.at < 1000
          ? { text: typed.current.text + e.key.toLowerCase(), at: now }
          : { text: e.key.toLowerCase(), at: now };
      const hit = items.findIndex((el) =>
        (el.dataset.label ?? "").toLowerCase().startsWith(typed.current.text),
      );
      if (hit >= 0) next = hit;
    }
    if (next === null) return;
    e.preventDefault();
    items[next].focus();
  }

  return (
    <div
      ref={popRef}
      id={`${idBase}-listbox`}
      role="listbox"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={cn(
        "fixed z-[130] max-h-80 min-w-44 max-w-80 overflow-y-auto rounded-xl border border-border/70 bg-card p-1 shadow-lift",
        pos ? "opacity-100" : "opacity-0",
      )}
      style={
        pos
          ? { top: pos.top, left: pos.left, minWidth: Math.max(176, pos.minWidth) }
          : { top: -9999, left: -9999 }
      }
    >
      {options.map((o) => {
        const isSelected = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="option"
            tabIndex={-1}
            data-label={o.label}
            aria-selected={isSelected}
            aria-disabled={o.disabled || undefined}
            title={o.disabled ? o.disabledReason : undefined}
            onClick={() => {
              if (o.disabled) return;
              onPick(o.value);
            }}
            className={cn(
              "flex w-full items-start gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors",
              "focus-visible:outline-none focus:bg-muted/70",
              o.disabled
                ? "cursor-not-allowed text-muted-foreground"
                : "text-foreground hover:bg-muted/70",
            )}
          >
            <span className="flex h-5 w-4 shrink-0 items-center justify-center">
              {isSelected ? (
                <Check className="h-3.5 w-3.5 text-primary" />
              ) : o.icon ? (
                <o.icon className="h-3.5 w-3.5 text-muted-foreground" />
              ) : null}
            </span>
            <span className="min-w-0 flex-1">
              <span className={cn("block truncate", isSelected ? "font-semibold" : "font-medium")}>
                {o.label}
              </span>
              {(o.hint || (o.disabled && o.disabledReason)) && (
                <span className="block truncate text-xs text-muted-foreground">
                  {o.disabled && o.disabledReason ? o.disabledReason : o.hint}
                </span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function renderSelectValue<T extends string>(
  options: SelectOption<T>[],
  value: T | null,
): string {
  return options.find((o) => o.value === value)?.label ?? "";
}
