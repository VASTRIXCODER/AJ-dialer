// ─────────────────────────────────────────────────────────────────────────────
// Seed message templates — PURE. Configurable starting points a workspace
// clones, never hard-coded behaviour, and never published automatically: they
// install as DRAFTS so a human reads every word before a customer does.
//
// Two rules every one of these obeys, and they are why the set is short:
//
// 1. NO INDUSTRY NOUN. `{{appointmentNoun}}` resolves to whatever this
//    workspace books — an account review, a showing, an interview. A template
//    that said "solar consultation" would be wrong for nine of the ten
//    verticals and embarrassing in front of the tenth's competitor.
//
// 2. TRANSACTIONAL BY DEFAULT. Every one of these is about something the
//    person already did: an appointment they booked, a call they asked for.
//    That is the scope almost anyone can consent to, and it is the only kind
//    of message worth sending to a book whose consent provenance is unknown.
//    Exactly one promotional template ships, and it is the one that needs a
//    real opt-in before the gate will let it move.
// ─────────────────────────────────────────────────────────────────────────────

export interface SeedMessageTemplate {
  key: string;
  name: string;
  scope: "transactional" | "promotional";
  body: string;
  /** What this is for, shown to whoever is deciding whether to publish it. */
  purpose: string;
}

export const SEED_MESSAGE_TEMPLATES: SeedMessageTemplate[] = [
  {
    key: "appointment_confirmation",
    name: "Appointment confirmation",
    scope: "transactional",
    purpose:
      "Sent once a booking is made. The single highest-value message in the set — a confirmed time is kept far more often than an unconfirmed one.",
    body:
      "Hi {{firstName}}, your {{appointmentNoun}} with {{orgName}} is confirmed for {{appointmentDate}} at {{appointmentTime}}. Reply here if you need to change it.",
  },
  {
    key: "appointment_reminder",
    name: "Appointment reminder",
    scope: "transactional",
    purpose: "Sent the day before. Reduces no-shows without asking for anything.",
    body:
      "Hi {{firstName}}, a reminder about your {{appointmentNoun}} tomorrow at {{appointmentTime}}. Reply here if the time no longer works.",
  },
  {
    key: "no_show_first_touch",
    name: "No-show recovery",
    scope: "transactional",
    purpose:
      "Sent shortly after a missed booking. Deliberately assumes something came up rather than that they changed their mind — because usually something came up.",
    body:
      "Hi {{firstName}}, sorry we missed each other today. Happy to find another time that suits you better — just reply here.",
  },
  {
    key: "missed_call_follow_up",
    name: "Missed call follow-up",
    scope: "transactional",
    purpose:
      "Sent after an attempt that did not connect. Gives someone who cannot take a call a way to answer on their own terms.",
    body:
      "Hi {{firstName}}, {{repName}} from {{orgName}} tried to reach you just now. Reply here whenever suits and we'll pick it up.",
  },
  {
    key: "reactivation_check_in",
    name: "Reactivation check-in",
    scope: "promotional",
    purpose:
      "The only promotional template. Sending it needs a real, recorded opt-in — the gate refuses it for anyone whose consent is transactional or unknown, which is nearly everyone in an imported book.",
    body:
      "Hi {{firstName}}, it's {{orgName}}. We spoke a while back — worth another look now? Reply here and I'll send over the details.",
  },
];

/** Which variables each seed uses, so a renderer gap is visible at install. */
export function seedVariables(body: string): string[] {
  const out: string[] = [];
  for (const m of body.matchAll(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g)) {
    if (!out.includes(m[1])) out.push(m[1]);
  }
  return out;
}
