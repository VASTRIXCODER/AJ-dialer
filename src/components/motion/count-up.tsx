"use client";

import { animate, useReducedMotion } from "framer-motion";
import * as React from "react";

/**
 * CountUp — renders `value` immediately, then animates between values whenever
 * the value CHANGES.
 *
 * It used to initialise at 0 and count up on first paint. Every KPI in the
 * product renders through here — 47 tiles — so every one of them displayed a
 * literal `0` for up to 1.2 seconds before showing its real number.
 *
 * That is the worst possible placeholder, because zero is a legitimate answer.
 * A rep glancing at the dashboard mid-animation cannot tell "no calls yet" from
 * "still arriving", and the two mean opposite things. The house rule is that a
 * number is either correct or visibly absent; it is never briefly wrong.
 *
 * The count-on-scroll-into-view behaviour went with it, deliberately — starting
 * from 0 was the only thing that behaviour required, and a KPI is a surface a
 * rep reads under time pressure, not one that performs on arrival. Live updates
 * still animate, which is the case where the movement carries meaning: it says
 * this number just changed.
 */
export function CountUp({
  value,
  duration = 1.2,
  decimals = 0,
  prefix = "",
  suffix = "",
  format,
  className,
}: {
  value: number;
  duration?: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  format?: (n: number) => string;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const [display, setDisplay] = React.useState(value);
  const from = React.useRef(value);

  React.useEffect(() => {
    // First paint (from === value) and reduced motion both land here, so the
    // real number is on screen without a frame of animation in either case.
    if (reduce || from.current === value) {
      from.current = value;
      setDisplay(value);
      return;
    }
    const controls = animate(from.current, value, {
      duration,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (latest) => setDisplay(latest),
    });
    from.current = value;
    return () => controls.stop();
  }, [value, duration, reduce]);

  const text = format
    ? format(display)
    : `${prefix}${display.toLocaleString("en-US", {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      })}${suffix}`;

  return <span className={className}>{text}</span>;
}
