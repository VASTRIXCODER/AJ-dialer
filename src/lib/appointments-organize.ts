// ─────────────────────────────────────────────────────────────────────────────
// Pure organization logic for the Appointments tab. Buckets each appointment for
// the review/approval workflow and applies the toolbar filters. No React/DB so it
// can be unit-tested; the view + page compose it.
// ─────────────────────────────────────────────────────────────────────────────

export type ApptBucket =
  | "review" // AI proposal awaiting human approval
  | "overdue" // approved, scheduled time already passed, not yet completed
  | "today"
  | "tomorrow"
  | "week"
  | "later" // approved but no exact time, or > 7 days out
  | "past" // completed / no-show
  | "cancelled";

export interface ApptLike {
  id: string;
  status: string;
  approved: boolean;
  source: string;
  /** "primary" = Agent 1, "secondary" = Agent 2; null for rep/legacy. */
  agent?: "primary" | "secondary" | null;
  scheduledAt: string | null;
  createdAt: string;
  repName?: string;
  leadName?: string;
  phone?: string;
  notes?: string;
}

const DAY = 86_400_000;
const startOfDay = (now: number) => {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

/** Which section an appointment belongs to. */
export function bucketOf(a: ApptLike, now: number = Date.now()): ApptBucket {
  if (a.status === "cancelled") return "cancelled";
  if (a.status === "completed" || a.status === "no_show") return "past";
  if (!a.approved) return "review";
  const t = a.scheduledAt ? new Date(a.scheduledAt).getTime() : null;
  if (t == null || Number.isNaN(t)) return "later";
  const day0 = startOfDay(now);
  if (t < day0) return "overdue";
  if (t < day0 + DAY) return "today";
  if (t < day0 + 2 * DAY) return "tomorrow";
  if (t < day0 + 7 * DAY) return "week";
  return "later";
}

export interface ApptFilters {
  source?: "all" | "ai" | "rep" | "agent1" | "agent2";
  rep?: string; // "all" or a rep name
  search?: string;
}

export function matchesFilters(a: ApptLike, f: ApptFilters): boolean {
  if (f.source && f.source !== "all") {
    // Agent tabs: only AI bookings closed by that specific persona.
    if (f.source === "agent1") {
      if (!(a.source === "ai" && a.agent === "primary")) return false;
    } else if (f.source === "agent2") {
      if (!(a.source === "ai" && a.agent === "secondary")) return false;
    } else if (a.source !== f.source) {
      // "ai" (legacy) or "rep"
      return false;
    }
  }
  if (f.rep && f.rep !== "all" && (a.repName ?? "") !== f.rep) return false;
  const q = (f.search ?? "").trim().toLowerCase();
  if (q) {
    const hay = `${a.leadName ?? ""} ${a.phone ?? ""} ${a.notes ?? ""}`.toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

/** Sort key within a bucket: upcoming soonest-first, others newest-first. */
export function sortInBucket(bucket: ApptBucket, a: ApptLike, b: ApptLike): number {
  const upcoming = ["overdue", "today", "tomorrow", "week", "later"].includes(bucket);
  const ta = a.scheduledAt ? new Date(a.scheduledAt).getTime() : null;
  const tb = b.scheduledAt ? new Date(b.scheduledAt).getTime() : null;
  if (upcoming) {
    if (ta != null && tb != null) return ta - tb;
    if (ta != null) return -1;
    if (tb != null) return 1;
  }
  return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
}

/** Group filtered appointments into ordered buckets. */
export function organizeAppointments<T extends ApptLike>(
  appts: T[],
  filters: ApptFilters,
  now: number = Date.now(),
): Record<ApptBucket, T[]> {
  const out: Record<ApptBucket, T[]> = {
    review: [],
    overdue: [],
    today: [],
    tomorrow: [],
    week: [],
    later: [],
    past: [],
    cancelled: [],
  };
  for (const a of appts) {
    if (!matchesFilters(a, filters)) continue;
    out[bucketOf(a, now)].push(a);
  }
  for (const k of Object.keys(out) as ApptBucket[])
    out[k].sort((a, b) => sortInBucket(k, a, b));
  return out;
}
