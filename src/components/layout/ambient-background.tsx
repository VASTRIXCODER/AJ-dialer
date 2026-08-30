"use client";

import * as React from "react";

// ─────────────────────────────────────────────────────────────────────────────
// The ambient field — the one cinematic layer in the product.
//
// Three rendered plates of volumetric light at different Z depths, drifting
// slowly and shifting with the pointer. The plates are real images rather than
// CSS gradients, which is what gives the layer depth a radial-gradient cannot
// fake; they are composited with `screen` on dark and `multiply` on light, so
// the flat area of each plate contributes nothing and no alpha channel is
// needed. Total weight for all six: 17 KB.
//
// It replaced a permanently-running CSS aurora, an animated mesh, three
// pulsing glow orbs and sixteen rising particles, all of which ran forever, on
// every route, whether or not anyone was looking at them.
//
// The contract this layer must honour:
//
//   · Renders ONLY behind the app ground. Never behind a card, never behind
//     text. It is mounted on Stage routes — sign-in, /hub, the marketing page,
//     the maintenance and paywall locks — and is deliberately absent from the
//     app shell.
//   · Caps at 30fps. Motion this slow gains nothing from 60 and costs twice
//     the frames.
//   · Pauses when the tab is hidden, and whenever `paused` is set — which is
//     how the dialer will silence it the instant a call connects.
//   · Under prefers-reduced-motion, renders one static frame and stops. Not a
//     slower drift: no drift at all, and no rAF loop scheduled.
//
// The whole loop is transform-only on three composited layers, which keeps it
// off the main thread's paint path and inside the 10ms-per-frame budget that
// leaves the browser its ~6ms to render.
// ─────────────────────────────────────────────────────────────────────────────

/** Depth of each plate. Higher index = nearer = moves further. */
const PLATES = [
  { drift: 0.006, parallax: 6, opacity: 0.7 },
  { drift: 0.011, parallax: 13, opacity: 0.45 },
  { drift: 0.017, parallax: 22, opacity: 0.5 },
] as const;

const FRAME_MS = 1000 / 30;

export function AmbientBackground({
  /** Set while a call is live: the Stage goes dark and stays out of the way. */
  paused = false,
}: {
  paused?: boolean;
}) {
  const layers = React.useRef<(HTMLDivElement | null)[]>([]);
  // Read once, not subscribed: this decides whether a loop is ever scheduled.
  const [reduced, setReduced] = React.useState(true);

  React.useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReduced(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  React.useEffect(() => {
    if (reduced || paused) return;

    let raf = 0;
    let last = 0;
    let t = 0;
    // Pointer offset, eased toward the target so the field never snaps.
    let mx = 0;
    let my = 0;
    let tx = 0;
    let ty = 0;

    function onMove(e: PointerEvent) {
      tx = e.clientX / window.innerWidth - 0.5;
      ty = e.clientY / window.innerHeight - 0.5;
    }

    function frame(now: number) {
      raf = requestAnimationFrame(frame);
      if (now - last < FRAME_MS) return;
      last = now;

      // Nothing to composite while the tab is hidden — keep the loop alive but
      // do no work, so returning to the tab does not jump.
      if (document.hidden) return;

      t += 1;
      mx += (tx - mx) * 0.06;
      my += (ty - my) * 0.06;

      for (let i = 0; i < PLATES.length; i++) {
        const el = layers.current[i];
        if (!el) continue;
        const p = PLATES[i];
        // Drift is a slow horizontal crawl with a gentler vertical component,
        // so the layers separate over time instead of moving as one sheet.
        const x = t * p.drift + mx * p.parallax;
        const y = Math.sin(t * p.drift * 0.05) * 8 + my * p.parallax;
        el.style.transform = `translate3d(${x % 60}px, ${y}px, 0)`;
      }
    }

    window.addEventListener("pointermove", onMove, { passive: true });
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
    };
  }, [reduced, paused]);

  return (
    <div aria-hidden className="ambient-field pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      {PLATES.map((p, i) => (
        <div
          key={i}
          ref={(el) => {
            layers.current[i] = el;
          }}
          className={`ambient-plate ambient-plate-${i + 1}`}
          style={{ opacity: p.opacity }}
        />
      ))}
      {/* Grain last, over the top, so the plates do not band on wide gradients. */}
      <div className="bg-noise absolute inset-0 opacity-[0.02] mix-blend-overlay dark:opacity-[0.04]" />
    </div>
  );
}
