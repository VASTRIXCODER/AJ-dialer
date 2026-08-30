/**
 * Reading a count honestly.
 *
 * supabase-js does not throw when a query fails. It RESOLVES with
 * `{ data: null, count: null, error }` — which means the codebase's defensive
 * idiom, `try { return res.count ?? 0 } catch { … }`, is wrong twice over: the
 * catch is unreachable for query failures, and the `?? 0` converts "we could
 * not ask" into "the answer is none".
 *
 * Those are different facts and they lead to opposite actions. A supervisor
 * reading `0 overdue callbacks` stops looking. A rep reading `0 dials today`
 * concludes they have not started. Both are the wrong conclusion when the real
 * story is that a query failed.
 *
 * So: ask the error, and let `null` mean "unknown" all the way to the tile,
 * which renders an em dash rather than a number nobody can trust.
 *
 * @example
 *   const dials = askedCount(dialsRes);   // number | null
 */
export function askedCount(res: { count: number | null; error: unknown }): number | null {
  return res.error ? null : (res.count ?? 0);
}

/**
 * Sum of the counts that could actually be read, plus whether any could not.
 *
 * For the places that add several counts together — a "needs attention" total,
 * a badge over a tab. Treating an unknown as 0 there is how a partly-broken
 * screen renders as a calm one.
 */
export function sumKnown(counts: (number | null)[]): { total: number; unknown: number } {
  let total = 0;
  let unknown = 0;
  for (const c of counts) {
    if (c === null) unknown += 1;
    else total += c;
  }
  return { total, unknown };
}
