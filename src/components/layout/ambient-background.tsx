"use client";

import { motion, useMotionValue, useReducedMotion, useSpring } from "framer-motion";
import * as React from "react";

type Particle = {
  left: number;
  size: number;
  delay: number;
  duration: number;
  opacity: number;
};

function makeParticles(n: number): Particle[] {
  return Array.from({ length: n }, () => ({
    left: Math.random() * 100,
    size: 1 + Math.random() * 2.4,
    delay: -Math.random() * 22,
    duration: 16 + Math.random() * 16,
    opacity: 0.12 + Math.random() * 0.32,
  }));
}

/**
 * AmbientBackground — the app's living atmosphere. A slowly evolving mesh,
 * glow orbs that drift with the pointer (parallax depth), faint rising
 * particles, and structural grain. Fully decorative and reduced-motion aware.
 */
export function AmbientBackground() {
  const reduce = useReducedMotion();
  const [particles, setParticles] = React.useState<Particle[]>([]);

  const px = useMotionValue(0);
  const py = useMotionValue(0);
  const sx = useSpring(px, { stiffness: 60, damping: 20, mass: 0.6 });
  const sy = useSpring(py, { stiffness: 60, damping: 20, mass: 0.6 });

  // Particles are random, so generate them after mount to avoid SSR mismatch.
  React.useEffect(() => {
    if (reduce) return;
    setParticles(makeParticles(16));
  }, [reduce]);

  React.useEffect(() => {
    if (reduce) return;
    function onMove(e: PointerEvent) {
      px.set((e.clientX / window.innerWidth - 0.5) * 28);
      py.set((e.clientY / window.innerHeight - 0.5) * 28);
    }
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, [reduce, px, py]);

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-aurora"
    >
      {/* Living mesh — the atmosphere slowly breathes and rotates */}
      <div className="bg-mesh animate-mesh absolute inset-0 opacity-70" />

      {/* Glow orbs drift gently with the pointer for parallax depth */}
      <motion.div
        className="absolute inset-0"
        style={reduce ? undefined : { x: sx, y: sy }}
      >
        <div className="glow-orb animate-aurora absolute -left-32 -top-40 h-[34rem] w-[34rem] opacity-70" />
        <div
          className="glow-orb animate-aurora absolute -right-40 top-1/4 h-[30rem] w-[30rem] opacity-50"
          style={{ animationDelay: "-8s" }}
        />
        <div
          className="glow-orb animate-aurora absolute bottom-[-12rem] left-1/3 h-[36rem] w-[36rem] opacity-40"
          style={{ animationDelay: "-16s" }}
        />
      </motion.div>

      {/* Rising atmospheric particles */}
      {particles.map((p, i) => (
        <span
          key={i}
          className="animate-rise absolute bottom-0 rounded-full bg-primary"
          style={{
            left: `${p.left}%`,
            width: p.size,
            height: p.size,
            opacity: p.opacity,
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.duration}s`,
          }}
        />
      ))}

      {/* Structural grid + film grain for depth without flatness */}
      <div className="bg-grid absolute inset-0 opacity-[0.5]" />
      <div className="bg-noise absolute inset-0 opacity-[0.015] mix-blend-overlay dark:opacity-[0.03]" />
    </div>
  );
}
