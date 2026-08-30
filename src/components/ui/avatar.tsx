import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";

export type AvatarTone =
  | "chart-1"
  | "chart-2"
  | "chart-3"
  | "chart-4"
  | "chart-5"
  | "primary"
  | "accent"
  | "success"
  | "warning"
  | "danger"
  | "muted";

const SEED_TONES: AvatarTone[] = ["chart-1", "chart-2", "chart-3", "chart-4", "chart-5"];

/** Deterministic tone per id — the hash the monitor roster palette used. */
function toneForSeed(seed: string): AvatarTone {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return SEED_TONES[hash % SEED_TONES.length];
}

/**
 * Soft token style: tinted fill + tone-colored initials. Mid-lightness tokens
 * on a faint wash of themselves clear the 3:1 contrast floor in BOTH themes
 * with zero per-color tuning, and re-tint automatically under
 * .superadmin-theme. The hairline is a border (not box-shadow) so it composes
 * with Tailwind ring utilities callers add.
 */
function toneStyle(tone: AvatarTone): CSSProperties {
  if (tone === "muted") {
    return {
      background: "hsl(var(--muted))",
      color: "hsl(var(--muted-foreground))",
      border: "1px solid hsl(var(--border) / 0.7)",
    };
  }
  return {
    background: `hsl(var(--${tone}) / 0.16)`,
    color: `hsl(var(--${tone}))`,
    border: `1px solid hsl(var(--${tone}) / 0.3)`,
  };
}

/** WCAG relative luminance of a #rrggbb color; null when not parseable. */
function luminance(hex: string): number | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const chan = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return (
    0.2126 * chan((n >> 16) & 255) +
    0.7152 * chan((n >> 8) & 255) +
    0.0722 * chan(n & 255)
  );
}

/**
 * Legacy path for STORED colors (profiles.avatar_color and friends) — keeps
 * the original solid-gradient look but computes a readable foreground instead
 * of the old unconditional white, which sat at ~2:1 on amber/emerald/sky.
 * White when it clears the 3:1 graphics floor, otherwise near-black.
 */
function legacyStyle(color: string): CSSProperties {
  const lum = luminance(color);
  const whiteContrast = lum === null ? 21 : 1.05 / (lum + 0.05);
  return {
    background:
      lum === null ? color : `linear-gradient(135deg, ${color}, ${color}cc)`,
    color: whiteContrast >= 3 ? "#ffffff" : "#0c1322",
  };
}

export function Avatar({
  initials,
  color,
  tone,
  seed,
  size = "md",
  className,
  ring = false,
}: {
  initials: string;
  /** Legacy stored color (e.g. profiles.avatar_color). Wins when set. */
  color?: string;
  /** Design-token tone — tracks light/dark and the superadmin re-tint. */
  tone?: AvatarTone;
  /** Stable id — hash-picks a chart tone when no tone/color is given. */
  seed?: string;
  size?: "xs" | "sm" | "md" | "lg";
  className?: string;
  ring?: boolean;
}) {
  const sizes = {
    xs: "h-7 w-7 text-[10px]",
    sm: "h-9 w-9 text-xs",
    md: "h-10 w-10 text-sm",
    lg: "h-12 w-12 text-base",
  };
  const style = color
    ? legacyStyle(color)
    : toneStyle(tone ?? (seed ? toneForSeed(seed) : "primary"));
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-bold",
        sizes[size],
        ring && "ring-2 ring-surface",
        className,
      )}
      style={style}
    >
      {initials}
    </span>
  );
}
