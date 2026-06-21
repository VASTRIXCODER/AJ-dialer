"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Render children at the document root so overlays/modals escape any ancestor
 * that creates a containing block for `position: fixed` — e.g. cards using
 * `backdrop-filter` (.surface-glass). Without this, a modal opened from inside a
 * card is positioned relative to the card and appears out of place.
 */
export function Portal({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return createPortal(children, document.body);
}
