// ─────────────────────────────────────────────────────────────────────────────
// Transcript-relay helpers — PURE and isomorphic (the relay route diffs with
// them on the server; the live pane dedupes with them in the browser; the tests
// exercise them directly). No I/O, no env reads.
//
// The contract that makes the relay idempotent end to end:
//   • A turn's identity is its INDEX in the provider's transcript array —
//     ElevenLabs appends, never reorders, so position is stable.
//   • diffNewTurns() consumes indexes even for empty/whitespace turns (the
//     provider emits them for silence); they're skipped in the OUTPUT but the
//     cursor still advances past them, or the same empty turn would be
//     re-diffed forever.
//   • dedupeByTurnIndex() lets a segment arrive twice (broadcast + poll, or
//     two racing relay instances) and render once — last write wins, ordered.
// ─────────────────────────────────────────────────────────────────────────────

/** One provider transcript turn (fetchConversation's normalized shape). */
export interface RelayTurn {
  role: string;
  message: string;
  secs: number | null;
}

/** One stored/broadcast transcript segment, keyed by provider turn index. */
export interface RelaySegment {
  turnIndex: number;
  role: string;
  message: string;
  secs: number | null;
  /** False only while a provider may still revise the turn (EL never does here). */
  final: boolean;
}

/**
 * Which provider turns are NEW past the cursor? `lastTurn` is the highest turn
 * index already persisted (-1 = nothing yet). Returns renderable segments only
 * (empty messages skipped), but callers must advance the cursor to
 * `turns.length - 1`, not to the last RETURNED index — see maxTurnIndex.
 */
export function diffNewTurns(turns: RelayTurn[], lastTurn: number): RelaySegment[] {
  const out: RelaySegment[] = [];
  for (let i = Math.max(0, lastTurn + 1); i < turns.length; i++) {
    const t = turns[i];
    const message = (t?.message ?? "").trim();
    if (!message) continue; // silence — consumed, not rendered
    out.push({
      turnIndex: i,
      role: String(t.role || "agent"),
      message,
      secs: typeof t.secs === "number" && Number.isFinite(t.secs) ? t.secs : null,
      final: true,
    });
  }
  return out;
}

/** The cursor position after seeing `turns` (-1 when the transcript is empty). */
export function maxTurnIndex(turns: RelayTurn[]): number {
  return turns.length - 1;
}

/**
 * Merge `incoming` segments over `existing`, keyed by turnIndex — duplicates
 * collapse (incoming wins, so a finalized revision replaces its earlier copy)
 * and the result is sorted by turn order for rendering.
 */
export function dedupeByTurnIndex(
  existing: RelaySegment[],
  incoming: RelaySegment[],
): RelaySegment[] {
  if (incoming.length === 0) return existing;
  const byIndex = new Map<number, RelaySegment>();
  for (const s of existing) byIndex.set(s.turnIndex, s);
  for (const s of incoming) {
    if (!s || !Number.isFinite(s.turnIndex)) continue;
    byIndex.set(s.turnIndex, s);
  }
  return [...byIndex.values()].sort((a, b) => a.turnIndex - b.turnIndex);
}
