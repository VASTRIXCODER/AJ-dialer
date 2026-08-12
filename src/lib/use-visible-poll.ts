"use client";

import { useEffect, useRef } from "react";

/**
 * Poll while visible: run `fn` immediately, then every `ms` — but only while
 * the tab is actually being looked at. On `visibilitychange` to hidden the
 * interval stops (a backgrounded monitor tab was firing 2s fetches forever);
 * on return the hook fires `fn` immediately (no stale board while waiting out
 * the next interval) and restarts the cadence.
 *
 * `fn` is kept in a ref so callers don't have to memoize it.
 *
 * `ignoreHidden` keeps the poll running in a hidden tab — for the one case
 * where the poll IS the safety mechanism (live listen-in audio is stopped by
 * the poll noticing the call ended, and that must work with the tab hidden).
 *
 * NOT for call-lifecycle polling: the dial engine's device-health, presence
 * heartbeat, and answer-detection intervals in use-dialer.ts must keep running
 * in hidden tabs during live calls — never wire those through this hook.
 */
export function useVisiblePoll(
  fn: () => void,
  ms: number,
  opts: { ignoreHidden?: boolean } = {},
) {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const { ignoreHidden = false } = opts;

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer === null) timer = setInterval(() => fnRef.current(), ms);
    };
    const stop = () => {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };
    const onVisibility = () => {
      if (ignoreHidden) return;
      if (document.visibilityState === "visible") {
        fnRef.current();
        start();
      } else {
        stop();
      }
    };

    if (ignoreHidden || document.visibilityState === "visible") {
      fnRef.current();
      start();
    }
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [ms, ignoreHidden]);
}
