import { toE164 } from "../utils";

// ─────────────────────────────────────────────────────────────────────────────
// Lane dedupe — PURE phone-level duplicate guard for a parallel dial round.
//
// The reservation engine already guarantees two lanes can never hold the same
// LEAD — but nothing stops two DIFFERENT lead rows from carrying the same phone
// number (re-imports, spouses sharing a landline, a broker list overlapping an
// older one). Dialing both in one round rings the same phone on two lanes
// simultaneously: the person answers one, the other keeps ringing them — the
// exact "same homeowner rung twice" failure nextLeads() fixed for a wrapped
// queue, resurfacing through data instead of a cursor bug.
//
// The guard keeps the FIRST occurrence of each normalized (E.164) number and
// drops the rest. Numbers that don't normalize (junk, short, placeholder text)
// are NOT treated as duplicates of each other — "" is not a phone number, and
// validity is another guard's job (the queue/import layers already filter
// undialable phones; the Twilio route drops empty targets).
// ─────────────────────────────────────────────────────────────────────────────

export interface PhoneDedupeResult<T> {
  /** The round to actually dial — first occurrence of each number, in order. */
  kept: T[];
  /** Later occurrences of an already-seen number, in order. */
  dropped: T[];
}

/** Split `leads` into the dialable round and the phone-duplicates to drop. */
export function dedupeLeadsByPhone<T extends { phone: string }>(
  leads: readonly T[],
): PhoneDedupeResult<T> {
  const seen = new Set<string>();
  const kept: T[] = [];
  const dropped: T[] = [];
  for (const lead of leads) {
    const key = toE164(lead.phone ?? "");
    if (key && seen.has(key)) {
      dropped.push(lead);
      continue;
    }
    if (key) seen.add(key);
    kept.push(lead);
  }
  return { kept, dropped };
}
