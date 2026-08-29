"use client";

import { createContext, useContext } from "react";
import type { Permission } from "@/lib/permissions";

/**
 * The viewer's effective permissions, available to every Client Component under
 * the app shell. Resolved once on the server (see the (app) layout) and handed
 * down, exactly like the vocabulary beside it — a screen never has to fetch or
 * re-derive them.
 *
 * This is for DISPLAY only: showing a control, or disabling it with a reason.
 * It is not a security boundary and must never be the only check. Every API
 * route re-checks the same permission server-side, because this list arrives in
 * the browser and anything in the browser is a suggestion.
 *
 * The default is empty rather than permissive: a component rendered outside the
 * shell shows nothing it can't prove the viewer may do.
 */
const PermissionsContext = createContext<readonly Permission[]>([]);

export function PermissionsProvider({
  value,
  children,
}: {
  value: readonly Permission[];
  children: React.ReactNode;
}) {
  return (
    <PermissionsContext.Provider value={value}>{children}</PermissionsContext.Provider>
  );
}

export function usePermissions(): readonly Permission[] {
  return useContext(PermissionsContext);
}

/** `const canRecord = useCan("consent.record");` */
export function useCan(permission: Permission): boolean {
  return useContext(PermissionsContext).includes(permission);
}
