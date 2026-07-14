// ─────────────────────────────────────────────────────────────────────────────
// Who may change an appointment. PURE — no server-only, no DB — so the rule can
// be unit-tested directly (scripts/verify-appointments.ts) rather than inferred
// from whether a route happened to return 403.
//
// ── Why appointments don't just use canActOn() like everything else ──────────
// The app has always had two uncoordinated authorization axes:
//
//   • Permissions (`viewer.permissions`)    — may you use this FEATURE?
//   • Scope       (`getScope().supervisor`) — which ROWS may you touch?
//
// …and `supervisor` is derived from the denormalized `profiles.role`, NOT from
// permissions. So a per-member override had zero effect on which rows a member
// could reach: revoking someone's calendar access in the Admin UI hid the buttons
// and changed nothing else — a hand-crafted POST still worked.
//
// Here, permissions are the single source of truth. `manage` gates every write;
// `team` decides own-rows-vs-the-whole-floor for BOTH reads and writes, so the
// two finally agree. The role defaults in permissions.ts grant `appointments.team`
// to owner/admin/manager — exactly the set `supervisor` already covered — so this
// reproduces the old behavior on day one, and an override now genuinely means
// something in both directions.
// ─────────────────────────────────────────────────────────────────────────────

export interface ApptScope {
  userId: string;
  orgId: string | null;
  /** appointments.manage — without it, every mutation refuses. */
  manage: boolean;
  /** appointments.team — see & manage the whole org's calendar. */
  team: boolean;
}

/** May this actor modify an appointment owned by `ownerId` in org `orgId`? */
export function canActOnAppt(
  s: ApptScope,
  ownerId: string | null,
  orgId: string | null,
): boolean {
  if (!s.manage) return false; // no manage permission ⇒ no write, ever
  // An appointment stamped with a DIFFERENT org than the one the actor is
  // currently active in is never actionable, even if they booked it — it
  // must not follow them into whatever org they're active in now.
  if (orgId && orgId !== s.orgId) return false;
  if (ownerId && ownerId === s.userId) return true; // your own booking
  return Boolean(s.team && s.orgId && orgId && orgId === s.orgId); // the floor's
}
