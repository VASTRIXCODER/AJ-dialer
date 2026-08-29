// ─────────────────────────────────────────────────────────────────────────────
// A small in-memory stand-in for the PostgREST client, built so the
// orchestration engine can actually be RUN in a test rather than only read.
//
// It implements the subset of the query builder the pipeline uses, and — the
// part that matters — enforces the real UNIQUE constraints from schema.sql,
// returning code "23505" on violation. Exactly-once execution, activation
// dedupe and signal dedupe are all constraint behaviours, so a fake without
// them would prove nothing.
//
// Deliberately NOT a general PostgREST emulator: every operator here is one
// the pipeline actually issues.
// ─────────────────────────────────────────────────────────────────────────────

export type Row = Record<string, unknown>;

interface UniqueDef {
  table: string;
  cols: string[];
  /** Partial-index predicate; absent = a plain unique. */
  where?: (r: Row) => boolean;
}

const LIVE_WORK = new Set(["pending", "reserved", "in_progress", "waiting"]);
const LIVE_INSTANCE = new Set(["active", "waiting"]);

/** The constraints the pipeline's correctness actually rests on. */
const UNIQUES: UniqueDef[] = [
  { table: "playbook_executions", cols: ["idempotency_key"] },
  {
    table: "playbook_instances",
    cols: ["playbook_id", "opportunity_id"],
    where: (r) => LIVE_INSTANCE.has(String(r.status)),
  },
  {
    table: "signals",
    cols: ["org_id", "dedupe_key"],
    where: (r) => r.dedupe_key != null && r.resolved_at == null,
  },
  {
    table: "work_items",
    cols: ["org_id", "dedupe_key"],
    where: (r) => r.dedupe_key != null && LIVE_WORK.has(String(r.status)),
  },
  // PART 41. Without these the messaging tests would pass while enforcing
  // nothing — exactly-once proposal and inbound dedupe are BOTH constraint
  // behaviours, so a fake that omits them proves the opposite of what it claims.
  {
    table: "messages",
    cols: ["org_id", "idempotency_key"],
    where: (r) => r.idempotency_key != null,
  },
  {
    // Globally unique, not per-org: Twilio retries an inbound webhook with the
    // same SID and the dedupe has to hold before we know whose it is.
    table: "messages",
    cols: ["provider_sid"],
    where: (r) => r.provider_sid != null,
  },
  {
    table: "message_threads",
    cols: ["org_id", "contact_digits", "channel"],
  },
  {
    table: "consent_state",
    cols: ["org_id", "phone_digits", "channel"],
  },
];

/**
 * CHECK constraints worth modelling. Only one so far, and it is the one the
 * whole messaging design rests on: a message cannot reach a sendable status
 * without a named human. A fake that let it would let a test prove auto-send
 * is impossible while auto-sending.
 */
const SENDABLE = new Set(["approved", "queued", "sending", "sent", "delivered"]);
const CHECKS: { table: string; name: string; ok: (r: Row) => boolean }[] = [
  {
    table: "messages",
    name: "messages_approved_by_required",
    ok: (r) => !SENDABLE.has(String(r.status)) || r.approved_by != null,
  },
];

type Filter = (r: Row) => boolean;

/** `default now()` columns, so inserts behave like the real schema. */
const DEFAULTS: Record<string, string[]> = {
  playbook_instances: ["started_at", "updated_at"],
  playbook_executions: ["created_at"],
  work_items: ["created_at", "updated_at"],
  signals: ["detected_at", "last_seen_at", "created_at"],
  opportunity_events: ["created_at"],
  messages: ["created_at", "updated_at"],
  message_threads: ["created_at", "updated_at"],
  consent_events: ["captured_at", "created_at"],
};

/**
 * Postgres parses an offset-less timestamp in the SESSION timezone, which is
 * UTC for the service-role connection — so "2026-08-29T17:00:00" is 17:00Z.
 * JavaScript's Date.parse would read the same string as machine-local time,
 * which would make every floating-timestamp test depend on where it runs.
 */
const asTime = (v: unknown): number => {
  const s = String(v ?? "");
  if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(s)) {
    return Date.parse(`${s.replace(" ", "T")}Z`);
  }
  return Date.parse(s);
};

/** PostgREST compares timestamps and strings; both work as string compares for
 *  ISO values, but real time ordering needs Date.parse for mixed precision. */
function cmpValues(a: unknown, b: unknown): number {
  const ta = asTime(a);
  const tb = asTime(b);
  if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return ta < tb ? -1 : 1;
  const sa = String(a ?? "");
  const sb = String(b ?? "");
  return sa === sb ? 0 : sa < sb ? -1 : 1;
}

/** Parse the `("a","b")` list form PostgREST uses inside not(...,'in',...). */
function parseList(raw: string): string[] {
  return raw
    .replace(/^\(|\)$/g, "")
    .split(",")
    .map((s) => s.trim().replace(/^"|"$/g, ""))
    .filter(Boolean);
}

export class FakeSupabase {
  tables = new Map<string, Row[]>();
  /** Every query issued, for assertions about what the code actually asked. */
  log: { table: string; op: string }[] = [];
  /** Server clock, so `default now()` lines up with the tick's `now`. */
  clock = new Date("2026-08-29T15:00:00.000Z");
  private seq = 0;

  now(): Date {
    return this.clock;
  }

  seed(table: string, rows: Row[]): void {
    this.tables.set(table, rows.map((r) => ({ ...r })));
  }

  rows(table: string): Row[] {
    if (!this.tables.has(table)) this.tables.set(table, []);
    return this.tables.get(table) as Row[];
  }

  nextId(prefix: string): string {
    this.seq += 1;
    return `${prefix}-${this.seq}`;
  }

  /** The first CHECK constraint this row fails, or null. */
  failedCheck(table: string, row: Row): string | null {
    for (const c of CHECKS) {
      if (c.table === table && !c.ok(row)) return c.name;
    }
    return null;
  }

  /** Internal to the fake, but the query builder is a separate class. */
  violates(table: string, row: Row): boolean {
    for (const u of UNIQUES) {
      if (u.table !== table) continue;
      if (u.where && !u.where(row)) continue;
      const clash = this.rows(table).some((existing) => {
        if (u.where && !u.where(existing)) return false;
        return u.cols.every((c) => existing[c] != null && existing[c] === row[c]);
      });
      if (clash) return true;
    }
    return false;
  }

  from(table: string) {
    return new FakeQuery(this, table);
  }

  // The engine never calls rpc(); present so a client shape mismatch surfaces
  // as an explicit failure rather than a silent undefined.
  rpc(): never {
    throw new Error("FakeSupabase.rpc() called — the pipeline should not use RPC here");
  }
}

class FakeQuery implements PromiseLike<{ data: unknown; error: unknown; count?: number }> {
  private filters: Filter[] = [];
  private mode: "select" | "insert" | "update" | "delete" = "select";
  private payload: Row[] = [];
  private patch: Row = {};
  private wantSingle = false;
  private headOnly = false;
  private wantCount = false;
  private limitN: number | null = null;
  private orderBy: { col: string; asc: boolean; nullsFirst: boolean }[] = [];
  private selected = true;

  constructor(
    private db: FakeSupabase,
    private table: string,
  ) {}

  select(_cols?: string, opts?: { count?: string; head?: boolean }) {
    if (this.mode === "select") this.db.log.push({ table: this.table, op: "select" });
    this.selected = true;
    this.headOnly = opts?.head === true;
    this.wantCount = opts?.count === "exact";
    return this;
  }

  insert(rows: Row | Row[]) {
    this.mode = "insert";
    this.selected = false;
    this.payload = Array.isArray(rows) ? rows.map((r) => ({ ...r })) : [{ ...rows }];
    this.db.log.push({ table: this.table, op: "insert" });
    return this;
  }

  update(patch: Row) {
    this.mode = "update";
    this.selected = false;
    this.patch = { ...patch };
    this.db.log.push({ table: this.table, op: "update" });
    return this;
  }

  delete() {
    this.mode = "delete";
    this.selected = false;
    this.db.log.push({ table: this.table, op: "delete" });
    return this;
  }

  eq(col: string, val: unknown) {
    this.filters.push((r) => String(r[col] ?? "") === String(val ?? ""));
    return this;
  }
  neq(col: string, val: unknown) {
    this.filters.push((r) => String(r[col] ?? "") !== String(val ?? ""));
    return this;
  }
  in(col: string, vals: unknown[]) {
    const set = new Set(vals.map((v) => String(v)));
    this.filters.push((r) => set.has(String(r[col] ?? "")));
    return this;
  }
  is(col: string, val: unknown) {
    if (val === null) {
      this.filters.push((r) => r[col] == null);
    } else {
      this.filters.push((r) => r[col] === val);
    }
    return this;
  }
  not(col: string, op: string, val: unknown) {
    if (op === "is" && val === null) {
      this.filters.push((r) => r[col] != null);
    } else if (op === "in") {
      const set = new Set(parseList(String(val)));
      this.filters.push((r) => !set.has(String(r[col] ?? "")));
    } else {
      throw new Error(`FakeSupabase: unsupported not(${op})`);
    }
    return this;
  }
  /** `%` is the only wildcard the codebase uses; `_` is not modelled. */
  ilike(col: string, pattern: string) {
    const rx = new RegExp(
      `^${String(pattern)
        .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
        .replace(/%/g, ".*")}$`,
      "i",
    );
    this.filters.push((r) => rx.test(String(r[col] ?? "")));
    return this;
  }
  lte(col: string, val: unknown) {
    this.filters.push((r) => r[col] != null && cmpValues(r[col], val) <= 0);
    return this;
  }
  lt(col: string, val: unknown) {
    this.filters.push((r) => r[col] != null && cmpValues(r[col], val) < 0);
    return this;
  }
  gte(col: string, val: unknown) {
    this.filters.push((r) => r[col] != null && cmpValues(r[col], val) >= 0);
    return this;
  }
  gt(col: string, val: unknown) {
    this.filters.push((r) => r[col] != null && cmpValues(r[col], val) > 0);
    return this;
  }
  or(expr: string) {
    // Only the shapes the pipeline uses: comma-separated `col.op.value` terms.
    const terms = expr.split(",").map((t) => t.trim());
    this.filters.push((r) =>
      terms.some((t) => {
        const [col, op, ...rest] = t.split(".");
        const val = rest.join(".");
        if (op === "is" && val === "null") return r[col] == null;
        if (op === "eq") return String(r[col] ?? "") === val;
        if (op === "gt") return r[col] != null && cmpValues(r[col], val) > 0;
        if (op === "lt") return r[col] != null && cmpValues(r[col], val) < 0;
        return false;
      }),
    );
    return this;
  }
  order(col: string, opts?: { ascending?: boolean; nullsFirst?: boolean }) {
    this.orderBy.push({
      col,
      asc: opts?.ascending !== false,
      nullsFirst: opts?.nullsFirst === true,
    });
    return this;
  }
  limit(n: number) {
    this.limitN = n;
    return this;
  }
  range(from: number, to: number) {
    this.limitN = to - from + 1;
    return this;
  }
  maybeSingle() {
    this.wantSingle = true;
    return this;
  }

  private matching(): Row[] {
    return this.db.rows(this.table).filter((r) => this.filters.every((f) => f(r)));
  }

  private sorted(rows: Row[]): Row[] {
    if (!this.orderBy.length) return rows;
    return [...rows].sort((a, b) => {
      for (const o of this.orderBy) {
        const av = a[o.col];
        const bv = b[o.col];
        if (av == null && bv == null) continue;
        if (av == null) return o.nullsFirst ? -1 : 1;
        if (bv == null) return o.nullsFirst ? 1 : -1;
        const c = cmpValues(av, bv);
        if (c !== 0) return o.asc ? c : -c;
      }
      return 0;
    });
  }

  private run(): { data: unknown; error: unknown; count?: number } {
    if (this.mode === "insert") {
      const inserted: Row[] = [];
      for (const raw of this.payload) {
        const row: Row = { id: this.db.nextId(this.table), ...raw };
        for (const col of DEFAULTS[this.table] ?? []) {
          if (row[col] == null) row[col] = this.db.now().toISOString();
        }
        const check = this.db.failedCheck(this.table, row);
        if (check) {
          // 23514 is Postgres' check_violation, and the real database returns
          // it here — a fake that let the row through would let a test claim
          // auto-send is impossible while auto-sending.
          return {
            data: null,
            error: { code: "23514", message: `new row violates check constraint "${check}"` },
          };
        }
        if (this.db.violates(this.table, row)) {
          return {
            data: null,
            error: { code: "23505", message: `duplicate key on ${this.table}` },
          };
        }
        this.db.rows(this.table).push(row);
        inserted.push(row);
      }
      const data = this.wantSingle ? (inserted[0] ?? null) : inserted;
      return { data: this.selected ? data : null, error: null };
    }

    if (this.mode === "delete") {
      const hit = this.matching();
      const keep = this.db.rows(this.table).filter((r) => !hit.includes(r));
      this.db.tables.set(this.table, keep);
      return { data: this.selected ? hit : null, error: null };
    }

    if (this.mode === "update") {
      const hit = this.matching();
      for (const r of hit) Object.assign(r, this.patch);
      const data = this.wantSingle ? (hit[0] ?? null) : hit;
      return { data: this.selected ? data : null, error: null };
    }

    const all = this.matching();
    const count = all.length;
    if (this.headOnly) return { data: null, error: null, count };
    let rows = this.sorted(all);
    if (this.limitN != null) rows = rows.slice(0, this.limitN);
    const data = this.wantSingle ? (rows[0] ?? null) : rows;
    return { data, error: null, ...(this.wantCount ? { count } : {}) };
  }

  then<T1 = { data: unknown; error: unknown; count?: number }, T2 = never>(
    onfulfilled?:
      | ((v: { data: unknown; error: unknown; count?: number }) => T1 | PromiseLike<T1>)
      | null,
    onrejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null,
  ): PromiseLike<T1 | T2> {
    try {
      return Promise.resolve(this.run()).then(onfulfilled, onrejected);
    } catch (e) {
      return Promise.reject(e).then(onfulfilled, onrejected);
    }
  }
}
