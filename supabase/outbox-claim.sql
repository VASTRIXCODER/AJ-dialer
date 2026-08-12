-- ═════════════════════════════════════════════════════════════════════════════
-- ATOMIC NOTIFICATION CLAIM (P3) — run once in the Supabase SQL editor.
--
-- drainOutbox() used to SELECT pending rows, send, THEN flip their status — so
-- the two per-minute crons (reconcile-ai + notifications) selected the SAME rows
-- and sent the SAME appointment email twice (or more). This RPC claims a batch
-- atomically: it flips due rows to 'sending' under FOR UPDATE SKIP LOCKED, so two
-- concurrent callers get disjoint sets and the same row is never sent twice. It
-- also reclaims rows stuck in 'sending' for >5 min (a drain that crashed after
-- claiming but before sending), so nothing is stranded.
--
-- Service-role only (the drain runs with the service key); not exposed via the
-- public anon/authenticated RPC surface. Idempotent; folded into schema.sql.
-- ═════════════════════════════════════════════════════════════════════════════
create or replace function public.app_claim_notifications(p_limit int)
returns setof public.notification_outbox
language sql volatile security definer set search_path = public as $$
  update public.notification_outbox o
  set status = 'sending', updated_at = now()
  from (
    select id
    from public.notification_outbox
    where (status = 'pending' and next_attempt_at <= now())
       or (status = 'sending' and updated_at < now() - interval '5 minutes')
    order by next_attempt_at asc
    limit greatest(p_limit, 0)
    for update skip locked
  ) picked
  where o.id = picked.id
  returning o.*;
$$;

revoke all on function public.app_claim_notifications(int) from public, anon, authenticated;
grant execute on function public.app_claim_notifications(int) to service_role;
