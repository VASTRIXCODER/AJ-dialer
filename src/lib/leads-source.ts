import "server-only";
import type { Lead } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Lead source for the dialer queue.
//
// This is the single integration point for real lead data. Wire it to your CRM,
// database, or imported-CSV table and return the leads that should be dialed
// (typically those assigned to the rep with a dial-ready status).
//
// It returns an EMPTY queue by default — the dialer ships with no placeholder
// data and is production-ready as soon as this function is connected.
// ─────────────────────────────────────────────────────────────────────────────

export async function getDialQueue(): Promise<Lead[]> {
  // Example with a database client:
  //
  //   return db.lead.findMany({
  //     where: { assignedRepId: repId, status: { in: ["new", "callback", "no_answer"] } },
  //     orderBy: [{ aiScore: "desc" }, { createdAt: "asc" }],
  //     take: 250,
  //   });
  //
  return [];
}
