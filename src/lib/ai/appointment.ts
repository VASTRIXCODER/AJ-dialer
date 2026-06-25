// ─────────────────────────────────────────────────────────────────────────────
// Appointment + date resolution. Pure, dependency-free, safe on client & server.
//
// Turns the natural language in a call transcript ("tomorrow at 6", "Tuesday
// evening", "3 PM") into a CONCRETE, unambiguous slot — anchored to the moment of
// the call and, when known, the homeowner's timezone. Also exposes today's date
// so the agent and the analyzer never have to *guess* what "tomorrow" means.
//
// This replaces the old behavior where a missing/failed Claude call fell back to
// a random canned time (e.g. "Thursday 11:00am") regardless of what was actually
// agreed on the call.
// ─────────────────────────────────────────────────────────────────────────────

import type { CallOutcome } from "../types";

const WEEKDAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;
const WD_LABEL = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
const MON_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
const MON_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const pad = (n: number) => String(n).padStart(2, "0");

interface Parts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  dow: number; // 0 = Sunday
}

/** Wall-clock parts for a Date in a given IANA timezone (falls back to local). */
function partsInTz(date: Date, tz?: string): Parts {
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz || undefined,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      weekday: "short",
    });
    const map: Record<string, string> = {};
    for (const p of fmt.formatToParts(date)) map[p.type] = p.value;
    const dowMap: Record<string, number> = {
      Sun: 0,
      Mon: 1,
      Tue: 2,
      Wed: 3,
      Thu: 4,
      Fri: 5,
      Sat: 6,
    };
    return {
      year: Number(map.year),
      month: Number(map.month),
      day: Number(map.day),
      hour: Number(map.hour) % 24,
      minute: Number(map.minute),
      dow: dowMap[map.weekday] ?? date.getDay(),
    };
  } catch {
    return {
      year: date.getFullYear(),
      month: date.getMonth() + 1,
      day: date.getDate(),
      hour: date.getHours(),
      minute: date.getMinutes(),
      dow: date.getDay(),
    };
  }
}

/** Add days to a calendar date (UTC arithmetic, so DST never shifts the day). */
function addDays(y: number, m: number, d: number, add: number) {
  const base = new Date(Date.UTC(y, m - 1, d));
  base.setUTCDate(base.getUTCDate() + add);
  return {
    y: base.getUTCFullYear(),
    m: base.getUTCMonth() + 1,
    d: base.getUTCDate(),
    dow: base.getUTCDay(),
  };
}

function fmtTime(h: number, m: number): string {
  const period = h < 12 ? "AM" : "PM";
  let hr = h % 12;
  if (hr === 0) hr = 12;
  return `${hr}:${pad(m)} ${period}`;
}

/**
 * Resolve a bare hour ("at 6", "6 o'clock") with no am/pm to a 24h hour using a
 * scheduling-friendly bias: 8–11 → morning, 12 → noon, 1–7 → afternoon/evening.
 */
function bareHour(n: number): number | null {
  if (n < 1 || n > 12) return null;
  if (n === 12) return 12;
  if (n >= 8) return n;
  return n + 12;
}

interface TimeHit {
  idx: number;
  h: number;
  m: number;
}

/** The LAST time reference in the text (the confirmed slot, near the close). */
function findTime(text: string): TimeHit | null {
  const hits: TimeHit[] = [];

  // 6pm · 6 pm · 6:30 p.m. · 11 a.m.
  for (const m of text.matchAll(/\b(\d{1,2})(?::(\d{2}))?\s*([ap])\.?\s?m\.?/gi)) {
    let h = Number(m[1]) % 12;
    if (m[3].toLowerCase() === "p") h += 12;
    hits.push({ idx: m.index ?? 0, h, m: Number(m[2] ?? 0) });
  }
  // "at 6", "at 6:30", "around 7", "about 6", "by 5", "like 6"
  for (const m of text.matchAll(
    /\b(?:at|around|about|roughly|by|like)\s+(\d{1,2})(?::(\d{2}))?\b/gi,
  )) {
    const h = bareHour(Number(m[1]));
    if (h == null) continue;
    hits.push({ idx: m.index ?? 0, h, m: Number(m[2] ?? 0) });
  }
  // "6 o'clock"
  for (const m of text.matchAll(/\b(\d{1,2})(?::(\d{2}))?\s*o'?clock\b/gi)) {
    const h = bareHour(Number(m[1]));
    if (h == null) continue;
    hits.push({ idx: m.index ?? 0, h, m: Number(m[2] ?? 0) });
  }
  // noon / evening / etc.
  const words: Record<string, [number, number]> = {
    noon: [12, 0],
    midnight: [0, 0],
    morning: [10, 0],
    afternoon: [14, 0],
    evening: [18, 0],
    tonight: [18, 0],
  };
  for (const m of text.matchAll(
    /\b(noon|midnight|morning|afternoon|evening|tonight)\b/gi,
  )) {
    const [h, mm] = words[m[1].toLowerCase()];
    hits.push({ idx: m.index ?? 0, h, m: mm });
  }

  if (!hits.length) return null;
  hits.sort((a, b) => a.idx - b.idx);
  return hits[hits.length - 1];
}

interface DayHit {
  idx: number;
  off: number; // days from today
}

/** The LAST day reference in the text, resolved to an offset from today. */
function findDay(text: string, today: Parts): DayHit | null {
  const todayDow = today.dow;
  const hits: DayHit[] = [];

  for (const m of text.matchAll(/\bday after tomorrow\b/gi))
    hits.push({ idx: m.index ?? 0, off: 2 });
  for (const m of text.matchAll(/\btomorrow\b/gi))
    hits.push({ idx: m.index ?? 0, off: 1 });
  for (const m of text.matchAll(
    /\b(today|tonight|this (?:afternoon|evening|morning))\b/gi,
  ))
    hits.push({ idx: m.index ?? 0, off: 0 });

  for (const m of text.matchAll(
    /\b(next\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/gi,
  )) {
    const target = WEEKDAYS.indexOf(
      m[2].toLowerCase() as (typeof WEEKDAYS)[number],
    );
    let off = (target - todayDow + 7) % 7;
    if (off === 0) off = 7; // same weekday name spoken today → the next one
    if (m[1]) off = ((target - todayDow + 7) % 7) + 7; // "next <day>" → following week
    hits.push({ idx: m.index ?? 0, off });
  }

  const nums: Record<string, number> = {
    a: 1,
    an: 1,
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
  };
  for (const m of text.matchAll(
    /\bin\s+(a|an|one|two|three|four|five|six|seven|\d{1,2})\s+days?\b/gi,
  )) {
    const n = nums[m[1].toLowerCase()] ?? Number(m[1]);
    if (n > 0 && n < 60) hits.push({ idx: m.index ?? 0, off: n });
  }

  // Explicit calendar dates: "June 29", "June 29th", "29 June", "29th of June",
  // "6/29". Resolved to the next occurrence on/after today.
  const MON_RE = "(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*";
  const monIdx = (name: string) =>
    MON_SHORT.findIndex((s) => s.toLowerCase() === name.toLowerCase().slice(0, 3));
  for (const m of text.matchAll(
    new RegExp(`\\b${MON_RE}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`, "gi"),
  )) {
    const off = dateOffset(today, monIdx(m[1]) + 1, Number(m[2]));
    if (off != null) hits.push({ idx: m.index ?? 0, off });
  }
  for (const m of text.matchAll(
    new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MON_RE}\\b`, "gi"),
  )) {
    const off = dateOffset(today, monIdx(m[2]) + 1, Number(m[1]));
    if (off != null) hits.push({ idx: m.index ?? 0, off });
  }
  for (const m of text.matchAll(/\b(\d{1,2})\/(\d{1,2})(?:\/\d{2,4})?\b/g)) {
    const off = dateOffset(today, Number(m[1]), Number(m[2]));
    if (off != null) hits.push({ idx: m.index ?? 0, off });
  }

  if (!hits.length) return null;
  hits.sort((a, b) => a.idx - b.idx);
  return hits[hits.length - 1];
}

/** Days from `today` to the next occurrence of month/day (this year or next). */
function dateOffset(today: Parts, month: number, day: number): number | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const todayUTC = Date.UTC(today.year, today.month - 1, today.day);
  let year = today.year;
  let tUTC = Date.UTC(year, month - 1, day);
  if (tUTC < todayUTC) {
    year++;
    tUTC = Date.UTC(year, month - 1, day);
  }
  const off = Math.round((tUTC - todayUTC) / 86400000);
  return off >= 0 && off < 400 ? off : null;
}

export interface ResolvedAppointment {
  /** A concrete slot exists AND there's a day reference or booking language. */
  requested: boolean;
  /** Human, unambiguous: "Tomorrow — Tue, Jun 23 at 6:00 PM" (or "" if none). */
  when: string;
  /** Machine form: "2026-06-23T18:00:00" (local wall-clock, no tz suffix). */
  iso: string;
  notes: string;
}

/**
 * Extract the agreed appointment from a transcript, anchored to `now` (and the
 * homeowner's timezone when provided). Returns an empty result when no concrete
 * time is present — a passing mention of a day alone is never treated as a slot.
 */
export function resolveAppointment(
  transcript: string,
  now: Date = new Date(),
  tz?: string,
): ResolvedAppointment {
  const empty: ResolvedAppointment = {
    requested: false,
    when: "",
    iso: "",
    notes: "",
  };
  if (!transcript || !transcript.trim()) return empty;

  const today = partsInTz(now, tz);
  const time = findTime(transcript);
  if (!time) return empty; // no concrete time → nothing bookable
  const day = findDay(transcript, today);

  // Day: use the explicit reference; otherwise infer (today if the time is still
  // ahead of now, else tomorrow).
  let off: number;
  if (day) off = day.off;
  else {
    const nowMin = today.hour * 60 + today.minute;
    const tMin = time.h * 60 + time.m;
    off = tMin > nowMin + 5 ? 0 : 1;
  }

  const tgt = addDays(today.year, today.month, today.day, off);
  const label =
    off === 0 ? "Today" : off === 1 ? "Tomorrow" : WD_LABEL[tgt.dow];
  const when = `${label} — ${WD_LABEL[tgt.dow].slice(0, 3)}, ${
    MON_SHORT[tgt.m - 1]
  } ${tgt.d} at ${fmtTime(time.h, time.m)}`;
  const iso = `${tgt.y}-${pad(tgt.m)}-${pad(tgt.d)}T${pad(time.h)}:${pad(
    time.m,
  )}:00`;

  const intent =
    /\b(works|sounds good|that works|perfect|book|schedul|appointment|come (by|out)|account manager|got you (in|down)|see you|lock (it|that) in|set (it|that) up|let'?s do)\b/i.test(
      transcript,
    );
  const requested = Boolean(day) || intent;

  return {
    requested,
    when,
    iso,
    notes: "Homeowner agreed to a no-cost account review.",
  };
}

export interface DateContext {
  day: string; // "Monday"
  date: string; // "Monday, June 22, 2026"
  time: string; // "2:30 PM"
  tomorrowDay: string; // "Tuesday"
  tomorrowDate: string; // "Tuesday, June 23, 2026"
  iso: string; // "2026-06-22"
}

/** Today's date, ready for the agent's prompt variables and the analyzer. */
export function currentDateContext(
  now: Date = new Date(),
  tz?: string,
): DateContext {
  const t = partsInTz(now, tz);
  const tom = addDays(t.year, t.month, t.day, 1);
  const longDate = (y: number, m: number, d: number, dow: number) =>
    `${WD_LABEL[dow]}, ${MON_LONG[m - 1]} ${d}, ${y}`;
  return {
    day: WD_LABEL[t.dow],
    date: longDate(t.year, t.month, t.day, t.dow),
    time: fmtTime(t.hour, t.minute),
    tomorrowDay: WD_LABEL[tom.dow],
    tomorrowDate: longDate(tom.y, tom.m, tom.d, tom.dow),
    iso: `${t.year}-${pad(t.month)}-${pad(t.day)}`,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Speaker-aware transcript reading.
//
// The disposition MUST be based on what the HOMEOWNER said, not on the agent's
// own filler. The agent says "perfect", "great", and — crucially — "you're all
// set" in her close; reading those as the customer's words is exactly what made a
// booked appointment get filed as "not interested". So we split the transcript by
// speaker and read intent from each side correctly: declines/DNC/callbacks come
// from the customer; the booking confirmation comes from the agent. This runs in
// BOTH demo mode (the simulator) and live mode (a deterministic safety net over
// the model's answer), so an obvious booking is never mis-filed.
// ─────────────────────────────────────────────────────────────────────────────

/** A transcript split into concatenated customer text vs agent text. */
export function splitSpeakers(transcript: string): { customer: string; agent: string } {
  const customer: string[] = [];
  const agent: string[] = [];
  for (const line of (transcript || "").split("\n")) {
    const m = line.match(/^\s*([a-z_]+)\s*:\s*(.*)$/i);
    if (!m) continue; // unlabeled line → ignore (never let it pollute either side)
    const role = m[1].toLowerCase();
    const isAgent =
      role.startsWith("agent") ||
      role.startsWith("assistant") ||
      role === "ai" ||
      role === "bot" ||
      role === "emily";
    (isAgent ? agent : customer).push(m[2]);
  }
  return { customer: customer.join("  "), agent: agent.join("  ") };
}

export interface CallRead {
  dnc: boolean;
  declined: boolean;
  callback: boolean;
  accepted: boolean;
  /** The agent confirmed a booking (she only does this AFTER the customer agrees). */
  agentConfirmedBooking: boolean;
  /** A real appointment was agreed. */
  booked: boolean;
  appointment: ResolvedAppointment;
  outcome: CallOutcome;
  sentiment: "positive" | "neutral" | "negative";
}

/**
 * Deterministically read a connected call's disposition from its transcript,
 * speaker-aware. Used by the demo simulator and as a high-precision override in
 * the live pipeline (a clear booking/DNC in the words beats a mislabeled result).
 */
export function readCall(
  transcript: string,
  now: Date = new Date(),
  tz?: string,
): CallRead {
  const { customer, agent } = splitSpeakers(transcript);
  const c = ` ${customer.toLowerCase()} `;
  const a = ` ${agent.toLowerCase()} `;

  const dnc =
    /\b(do not call|don'?t call (?:me|us)(?: again)?|take me off|remove me from|stop calling me|lose my number|unsubscribe)\b/.test(
      c,
    );
  // Hard, unambiguous declines from the CUSTOMER only.
  const declined =
    /\b(not interested|no thanks|no thank you|i'?m not interested|we'?re not interested|i'?m good|we'?re good|don'?t need (?:this|it|that)|do not need|leave me alone|waste of (?:my )?time|not gonna happen)\b/.test(
      c,
    );
  const callback =
    /\b(call (?:me )?back|another time|some other time|reschedul|busy right now|not a good time|catch me later|try (?:me|again) later|circle back)\b/.test(
      c,
    );
  // Loose acceptance (incl. bare "yes/yeah") — used for SENTIMENT only.
  const accepted =
    /\b(that works|works for me|sounds (?:good|great|fine)|that'?s (?:good|fine|perfect|great)|\byes\b|\byeah\b|\byep\b|\bsure\b|\bokay\b|\bok\b|let'?s do (?:it|that)|book it|see you (?:then|there)|noon works)\b/.test(
      c,
    );
  // Strong acceptance — required (with a concrete slot) to BOOK off the customer
  // alone, so a bare "yeah" to an unrelated question can't fake an appointment.
  const acceptedStrong =
    /\b(that works|works for me|that'?ll work|that would work|sounds (?:good|great|fine)|that'?s (?:good|fine|perfect|great)|let'?s do (?:it|that)|book it|set it up|see you (?:then|there)|that time works|noon works|that day works)\b/.test(
      c,
    );
  // The agent confirms ONLY after agreement (per script), so this is a strong
  // booking signal on its own.
  const agentConfirmedBooking =
    /\b(got you (?:in|down)|i'?ve got you (?:in|down)|you'?re all set|all set for|booked you|i'?ll get you (?:in|down)|down for (?:today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|the)|locked? (?:it|that) in|see you (?:then|on) )\b/.test(
      a,
    );

  const appointment = resolveAppointment(transcript, now, tz);
  const booked =
    !dnc && (agentConfirmedBooking || (acceptedStrong && appointment.when !== ""));

  const outcome: CallOutcome = dnc
    ? "do_not_call"
    : booked
      ? "appointment_booked"
      : declined
        ? "not_interested"
        : callback
          ? "callback_scheduled"
          : "qualified";

  const sentiment: CallRead["sentiment"] =
    dnc || declined ? "negative" : booked || accepted ? "positive" : "neutral";

  return {
    dnc,
    declined,
    callback,
    accepted,
    agentConfirmedBooking,
    booked,
    appointment,
    outcome,
    sentiment,
  };
}
