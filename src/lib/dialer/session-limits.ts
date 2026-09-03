// Pure, client-safe session limits.
//
// The ceiling lived in src/lib/db/session-builder.ts, which reaches for the
// Supabase server + service-role clients — so the session builder (a client
// component) couldn't import it and repeated the number as a literal instead.
// That's how the size presets came to stop at 1,000 while the input accepted
// 10,000: two copies of one rule, drifting.

/** The most leads one dialing session may hold. Guards the browser as much as
 *  the database — a session is materialised into memory and dialed in order. */
export const MAX_SESSION_LEADS = 10_000;
