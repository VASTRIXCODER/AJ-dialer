"use client";

import { animate, useInView, useReducedMotion } from "framer-motion";
import * as React from "react";

/**
 * CountUp — animates a number from its previous value to the next when it
 * enters the viewport (and whenever the value changes). Honors tabular figures
 * and reduced-motion. Pass `format` for full control, or prefix/suffix/decimals.
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
  const ref = React.useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "0px 0px -10% 0px" });
  const reduce = useReducedMotion();
  const [display, setDisplay] = React.useState(reduce ? value : 0);
  const from = React.useRef(reduce ? value : 0);

  React.useEffect(() => {
    if (reduce) {
      setDisplay(value);
      return;
    }
    if (!inView) return;
    const controls = animate(from.current, value, {
      duration,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (latest) => setDisplay(latest),
    });
    from.current = value;
    return () => controls.stop();
  }, [inView, value, duration, reduce]);

  const text = format
    ? format(display)
    : `${prefix}${display.toLocaleString("en-US", {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      })}${suffix}`;

  return (
    <span ref={ref} className={className}>
      {text}
    </span>
  );
}
