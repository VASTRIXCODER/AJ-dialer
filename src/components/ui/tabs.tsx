"use client";

import {
  createContext,
  useCallback,
  useContext,
  useId,
  useRef,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────────────────
// Tabs — the WAI-ARIA tabs pattern, controlled.
//
//   <Tabs value={tab} onChange={setTab}>
//     <TabList label="Lead sections">
//       <Tab value="overview">Overview</Tab>
//       <Tab value="timeline">Timeline</Tab>
//     </TabList>
//     <TabPanel value="overview">…</TabPanel>
//     <TabPanel value="timeline">…</TabPanel>
//   </Tabs>
//
// Roving tabindex: only the selected tab is in the Tab order; Arrow keys move
// AND select (selection follows focus, the recommended behavior for panels
// that render instantly), Home/End jump to the ends. Panels stay mounted and
// are toggled with `hidden`, so their state (scroll, inputs) survives a switch.
// ─────────────────────────────────────────────────────────────────────────────

interface TabsContextValue {
  value: string;
  onChange: (value: string) => void;
  idBase: string;
  registerTab: (value: string) => void;
  order: () => string[];
}

const TabsContext = createContext<TabsContextValue | null>(null);

function useTabsContext(component: string): TabsContextValue {
  const ctx = useContext(TabsContext);
  if (!ctx) throw new Error(`<${component}> must be rendered inside <Tabs>`);
  return ctx;
}

export function Tabs({
  value,
  onChange,
  className,
  children,
}: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  children: ReactNode;
}) {
  const idBase = useId();
  // Tab order is registered by render order — what the arrows navigate.
  const orderRef = useRef<string[]>([]);
  orderRef.current = [];
  const registerTab = useCallback((v: string) => {
    if (!orderRef.current.includes(v)) orderRef.current.push(v);
  }, []);
  const order = useCallback(() => orderRef.current, []);
  return (
    <TabsContext.Provider value={{ value, onChange, idBase, registerTab, order }}>
      <div className={className}>{children}</div>
    </TabsContext.Provider>
  );
}

export function TabList({
  label,
  className,
  children,
}: {
  /** Accessible name for the tab strip. */
  label: string;
  className?: string;
  children: ReactNode;
}) {
  const { value, onChange, order } = useTabsContext("TabList");

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const values = order();
    if (!values.length) return;
    const current = Math.max(0, values.indexOf(value));
    let next: number | null = null;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (current + 1) % values.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp")
      next = (current - 1 + values.length) % values.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = values.length - 1;
    if (next === null) return;
    e.preventDefault();
    onChange(values[next]);
    // Selection follows focus — move focus to the newly selected tab.
    const el = (e.currentTarget as HTMLElement).querySelector<HTMLElement>(
      `[data-tab-value="${CSS.escape(values[next])}"]`,
    );
    el?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={cn(
        "inline-flex items-center gap-1 rounded-xl bg-muted/60 p-1",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function Tab({
  value,
  className,
  children,
}: {
  value: string;
  className?: string;
  children: ReactNode;
}) {
  const ctx = useTabsContext("Tab");
  ctx.registerTab(value);
  const selected = ctx.value === value;
  return (
    <button
      type="button"
      role="tab"
      id={`${ctx.idBase}-tab-${value}`}
      aria-selected={selected}
      aria-controls={`${ctx.idBase}-panel-${value}`}
      tabIndex={selected ? 0 : -1}
      data-tab-value={value}
      onClick={() => ctx.onChange(value)}
      className={cn(
        "rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        selected
          ? "bg-card text-foreground shadow-soft"
          : "text-muted-foreground hover:text-foreground",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function TabPanel({
  value,
  className,
  children,
}: {
  value: string;
  className?: string;
  children: ReactNode;
}) {
  const ctx = useTabsContext("TabPanel");
  const selected = ctx.value === value;
  return (
    <div
      role="tabpanel"
      id={`${ctx.idBase}-panel-${value}`}
      aria-labelledby={`${ctx.idBase}-tab-${value}`}
      hidden={!selected}
      tabIndex={0}
      className={cn("focus-visible:outline-none", className)}
    >
      {children}
    </div>
  );
}
