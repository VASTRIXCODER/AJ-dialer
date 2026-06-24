import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(value: number, opts: { cents?: boolean } = {}) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: opts.cents ? 2 : 0,
    maximumFractionDigits: opts.cents ? 2 : 0,
  }).format(value);
}

export function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

export function formatPercent(value: number, digits = 0) {
  return `${value.toFixed(digits)}%`;
}

export function formatDuration(totalSeconds: number) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

export function formatPhone(raw: string) {
  const digits = raw.replace(/\D/g, "");
  const local = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (local.length === 10) {
    return `(${local.slice(0, 3)}) ${local.slice(3, 6)}-${local.slice(6)}`;
  }
  return raw;
}

/**
 * Normalize a raw phone string to a dialable E.164 number, or "" when the input
 * isn't a usable number. This is the single source of truth for "is this phone
 * callable" — every dial path and the CSV importer run through it.
 *
 *  • 10 digits           → +1XXXXXXXXXX (US, country code added)
 *  • 11 digits, "1"-led  → +1XXXXXXXXXX (US with country code already present)
 *  • starts with "+"     → kept if it has a plausible E.164 length (8–15 digits)
 *  • anything else       → "" (too few digits, placeholder text like "N/A",
 *                              merged address junk, etc. — NOT safe to dial)
 *
 * Returning "" for junk is what stops a meaningless "+" reaching Twilio (which
 * rejects it with "The phone number ... + ... is not valid").
 */
export function normalizePhone(raw: string): string {
  if (!raw) return "";
  const trimmed = String(raw).trim();
  const hadPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  // Explicit international number with a credible E.164 length.
  if (hadPlus && digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  // 12–15 bare digits with no "+" is more likely merged junk than a real
  // number, but accept a clean country-coded form when it's the only reading.
  return "";
}

/** True when `raw` yields a dialable phone number. */
export function isValidPhone(raw: string): boolean {
  return normalizePhone(raw).length > 0;
}

/**
 * Best-effort conversion to E.164 for dialing. Delegates to {@link normalizePhone},
 * so invalid input yields "" — callers already guard with a digit-count check or
 * (in the Twilio route) filter empty targets before placing the call.
 */
export function toE164(raw: string) {
  return normalizePhone(raw);
}

export function relativeTime(iso: string, now: Date = new Date()) {
  const then = new Date(iso).getTime();
  const diffMs = then - now.getTime();
  const abs = Math.abs(diffMs);
  const mins = Math.round(abs / 60000);
  const hours = Math.round(abs / 3600000);
  const days = Math.round(abs / 86400000);
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  if (mins < 1) return "just now";
  const sign = diffMs < 0 ? -1 : 1;
  if (mins < 60) return rtf.format(sign * mins, "minute");
  if (hours < 24) return rtf.format(sign * hours, "hour");
  return rtf.format(sign * days, "day");
}

export function formatClock(iso: string) {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatDay(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export function secondsSince(iso: string, now: number = Date.now()) {
  return Math.max(0, Math.floor((now - new Date(iso).getTime()) / 1000));
}

export function initials(name: string) {
  return name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

/**
 * Convert a hex color (#rgb / #rrggbb) to the `"H S% L%"` channel string our
 * design tokens use, so an organization's brand color can drive `--primary` etc.
 * Returns null for anything that isn't a valid hex color.
 */
export function hexToHslChannels(hex: string): string | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let s = 0;
  let hue = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) hue = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) hue = (b - r) / d + 2;
    else hue = (r - g) / d + 4;
    hue /= 6;
  }
  return `${Math.round(hue * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}
