"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { Lead360Drawer } from "./lead-360-drawer";

// ─────────────────────────────────────────────────────────────────────────────
// Lead 360 opener — one context any surface can call to slide the drawer over
// whatever screen is showing.
//
// The open lead rides in the URL (?lead=<id>) so a drawer view is shareable
// and survives a refresh — but it's written with history.replaceState, NOT
// router.push/replace. Next 15 syncs a replaceState into useSearchParams
// without an RSC refetch, and that's the load-bearing property here: opening a
// lead from the dialer MID-CALL must not re-render the server tree or unmount
// anything (the Twilio device, the call timer). A router navigation would.
// ─────────────────────────────────────────────────────────────────────────────

interface Lead360ContextValue {
  open: (leadId: string) => void;
  close: () => void;
}

// Safe no-op default: a surface rendered outside the provider (tests, stories,
// an unwired page) simply does nothing rather than crashing.
const Lead360Context = createContext<Lead360ContextValue>({
  open: () => {},
  close: () => {},
});

export function useLead360(): Lead360ContextValue {
  return useContext(Lead360Context);
}

function writeLeadParam(id: string | null) {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set("lead", id);
  else url.searchParams.delete("lead");
  // Preserve Next's history state — replacing it with null breaks back/forward.
  window.history.replaceState(window.history.state, "", url.toString());
}

/**
 * Mount ONCE inside the app shell (integration wires this). Renders the drawer
 * itself, restores an open lead from ?lead= on first mount, and keeps the URL
 * in sync as leads are opened/closed.
 */
export function Lead360Provider({ children }: { children: ReactNode }) {
  const [leadId, setLeadId] = useState<string | null>(null);

  const open = useCallback((id: string) => {
    writeLeadParam(id);
    setLeadId(id);
  }, []);

  const close = useCallback(() => {
    writeLeadParam(null);
    setLeadId(null);
  }, []);

  // Deep-link restore: an arriving ?lead= opens the drawer once on mount.
  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("lead");
    if (fromUrl) setLeadId(fromUrl);
  }, []);

  return (
    <Lead360Context.Provider value={{ open, close }}>
      {children}
      <Lead360Drawer leadId={leadId} onClose={close} />
    </Lead360Context.Provider>
  );
}
