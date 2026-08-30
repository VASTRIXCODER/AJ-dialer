"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { DEFAULT_DENSITY, isDensity, type Density } from "@/lib/ui-density";

// ─────────────────────────────────────────────────────────────────────────────
// One density setting, carried by the shell.
//
// Seeded server-side from the viewer's own profile preferences, so the first
// paint is already at the density they chose — no flash of comfortable rows
// before a localStorage read catches up.
//
// Written to two places, deliberately:
//   · the profile, so the setting follows the rep to their other machine
//   · localStorage, so it still works in demo mode and when the write fails
//
// The read prefers the server value. localStorage is only consulted when there
// ISN'T one — an unconfigured or demo workspace — and only inside an effect,
// because reading it during render would disagree with what the server just
// rendered and React would call that a hydration mismatch.
// ─────────────────────────────────────────────────────────────────────────────

const STORAGE_KEY = "aj:density";

/** Remember the choice in both places. Neither failure undoes it on screen. */
function persist(next: Density): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, next);
  } catch {
    /* storage can be blocked (private mode) */
  }
  // Fire-and-forget: the setting has already taken effect, and a failed write
  // must not block or revert it. It simply will not follow the rep elsewhere.
  void fetch("/api/profile", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ preferences: { density: next } }),
    keepalive: true,
  }).catch(() => {});
}

/** This browser's remembered choice, or null. Effect-only — see above. */
function readStored(): Density | null {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return isDensity(stored) ? stored : null;
  } catch {
    return null;
  }
}

interface DensityContextValue {
  density: Density;
  setDensity: (next: Density) => void;
}

const Ctx = createContext<DensityContextValue | null>(null);

export function DensityProvider({
  /** The viewer's stored preference, resolved server-side. Null = never set. */
  initial,
  children,
}: {
  initial: Density | null;
  children: React.ReactNode;
}) {
  const [density, setState] = useState<Density>(initial ?? DEFAULT_DENSITY);

  useEffect(() => {
    if (initial) return;
    const stored = readStored();
    if (stored) setState(stored);
  }, [initial]);

  const setDensity = useCallback((next: Density) => {
    setState(next);
    persist(next);
  }, []);

  const value = useMemo(() => ({ density, setDensity }), [density, setDensity]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/**
 * The workspace's display density.
 *
 * Falls back to a browser-local value outside a provider rather than throwing:
 * the same grids render on the Hub and in the superadmin Console, which are
 * their own route groups and do not mount the app shell.
 */
export function useDensity(): DensityContextValue {
  const ctx = useContext(Ctx);
  const [fallback, setFallback] = useState<Density>(DEFAULT_DENSITY);

  useEffect(() => {
    if (ctx) return;
    const stored = readStored();
    if (stored) setFallback(stored);
  }, [ctx]);

  const fallbackValue = useMemo(
    () => ({
      density: fallback,
      setDensity: (next: Density) => {
        setFallback(next);
        persist(next);
      },
    }),
    [fallback],
  );

  return ctx ?? fallbackValue;
}
