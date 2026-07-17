-- Performance indexes — run once in the Supabase SQL editor.
--
-- These are NOT required for correctness; they remove two classes of slow query
-- surfaced by pg_stat_statements / the Supabase performance advisor:
--
--   1. The ai_score-ordered lead lists (dialer queue, leads screen) were doing a
--      sort with no supporting index — averaging ~1.7 s per load for busy reps.
--   2. Twelve foreign keys had no covering index; the high-traffic `lead_id`
--      joins/cascades on the big tables are the ones worth covering.
--
-- `create index concurrently` builds without locking writes, so this is safe to
-- run against production while the app is live. Run each statement individually
-- (CONCURRENTLY cannot run inside a transaction block).

-- 1. Serve `WHERE owner_id = ? ORDER BY ai_score DESC NULLS LAST` (per-rep queue)
create index concurrently if not exists leads_owner_ai_score_idx
  on public.leads (owner_id, ai_score desc nulls last);

-- ...and the supervisor / org-wide equivalent used by the dial queue.
create index concurrently if not exists leads_org_ai_score_idx
  on public.leads (org_id, ai_score desc nulls last);

-- 2. Covering indexes for the high-traffic unindexed foreign keys (lead_id).
create index concurrently if not exists call_records_lead_id_idx
  on public.call_records (lead_id);
create index concurrently if not exists ai_conversations_lead_id_idx
  on public.ai_conversations (lead_id);
create index concurrently if not exists callbacks_lead_id_idx
  on public.callbacks (lead_id);
create index concurrently if not exists appointments_lead_id_idx
  on public.appointments (lead_id);
