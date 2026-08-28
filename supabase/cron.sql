-- ═══════════════════════════════════════════════════════════════════════════
-- SCHEDULED JOBS — pg_cron + pg_net  (kept in sync with the live database)
--
-- WHY THIS FILE EXISTS
--   The production schedule used to live only as hand-applied SQL described in
--   prose in docs/CRON.md — untracked, un-reviewable, unreproducible. This file
--   is now the source of record. docs/CRON.md explains the history (per-minute
--   crons in vercel.json fail the whole deployment on the Hobby plan and
--   silently froze production for ~13 days).
--
-- HOW IT WORKS
--   pg_cron fires each Next.js endpoint through pg_net with the same
--   `Authorization: Bearer $CRON_SECRET` header Vercel Cron would have sent.
--   The secret and the target origin live in Supabase Vault (names
--   'cron_secret' and 'cron_base_url'), seeded once via app_set_cron_secret().
--
-- SETUP / ROTATION
--   select public.app_set_cron_secret('<CRON_SECRET from Vercel>',
--                                     'https://aiatworkdialer.vercel.app');
--   (Deliberately the Vercel host, not www — the www host rides Cloudflare,
--    which can fail independently of Vercel. See docs/CRON.md.)
--
-- This file is idempotent: functions are CREATE OR REPLACE and the schedule
-- block unschedules-then-reschedules by name.
-- ═══════════════════════════════════════════════════════════════════════════

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ───────────────────────────────────────────────────────────────────────────
-- Vault seeding helper. Never returns the secret — just proves both landed.
-- Matches the function live in production (transcribed 2026-08-28).
-- ───────────────────────────────────────────────────────────────────────────
create or replace function public.app_set_cron_secret(p_secret text, p_base_url text)
returns text
language plpgsql
security definer
set search_path to 'public', 'vault'
as $function$
declare
  v_existing uuid;
begin
  select id into v_existing from vault.secrets where name = 'cron_secret';
  if v_existing is null then
    perform vault.create_secret(p_secret, 'cron_secret', 'Bearer token for /api/cron/* endpoints');
  else
    perform vault.update_secret(v_existing, p_secret);
  end if;

  select id into v_existing from vault.secrets where name = 'cron_base_url';
  if v_existing is null then
    perform vault.create_secret(p_base_url, 'cron_base_url', 'Origin the cron jobs POST to');
  else
    perform vault.update_secret(v_existing, p_base_url);
  end if;

  -- Never return the secret. Just prove both landed.
  return 'stored: '
    || (select count(*)::text from vault.secrets where name in ('cron_secret','cron_base_url'))
    || ' secrets';
end;
$function$;

-- ───────────────────────────────────────────────────────────────────────────
-- The dispatcher every job calls. Raises loudly when Vault is unseeded so a
-- misconfigured schedule shows up as FAILED runs in cron.job_run_details
-- instead of silently 401ing forever.
-- Matches the function live in production (transcribed 2026-08-28).
-- ───────────────────────────────────────────────────────────────────────────
create or replace function public.app_fire_cron(p_path text)
returns bigint
language plpgsql
security definer
set search_path to 'public', 'extensions', 'vault'
as $function$
declare
  v_secret text;
  v_base   text;
  v_id     bigint;
begin
  select decrypted_secret into v_secret
    from vault.decrypted_secrets where name = 'cron_secret';
  select decrypted_secret into v_base
    from vault.decrypted_secrets where name = 'cron_base_url';

  if v_secret is null or v_base is null then
    raise exception 'app_fire_cron: cron_secret / cron_base_url missing from Vault';
  end if;

  select net.http_post(
    url     := v_base || p_path,
    headers := jsonb_build_object(
                 'Authorization', 'Bearer ' || v_secret,
                 'Content-Type',  'application/json'
               ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 55000
  ) into v_id;

  return v_id;
end;
$function$;

revoke all on function public.app_fire_cron(text) from public, anon, authenticated;
revoke all on function public.app_set_cron_secret(text, text) from public, anon, authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- The schedule. Unschedule-then-schedule keeps this re-runnable; pg_cron has
-- no "create job if not exists".
--
--   auto-dial      every minute — unattended AI calling for orgs whose
--                  automation window is open (/api/cron/auto-dial).
--   reconcile-ai   every minute — the backstop that guarantees every AI call
--                  reaches a terminal state; also drains the appointment
--                  notification outbox on the same tick (docs/CRON.md).
--   reconcile-data every 15 min — Phase-1 data reconciliation: repairs
--                  leads.attempt_count drift, synthesizes missing call_record
--                  projections from terminal attempts, and logs metric drift
--                  to audit_log (/api/cron/reconcile-data).
--                  >>> Schedule this only once the endpoint has deployed
--                  (Phase B4) — until then it would 404 every 15 minutes. <<<
--
--   /api/cron/notifications exists as a standalone outbox drain but is NOT
--   scheduled — the drain deliberately rides reconcile-ai's tick so there is
--   no separate job for someone to forget. Running both is harmless (rows are
--   claimed before sending) if you ever want the isolation.
-- ───────────────────────────────────────────────────────────────────────────
do $$
begin
  perform cron.unschedule('auto-dial')    where exists (select 1 from cron.job where jobname = 'auto-dial');
  perform cron.unschedule('reconcile-ai') where exists (select 1 from cron.job where jobname = 'reconcile-ai');
  perform cron.schedule('auto-dial',    '* * * * *', $job$ select public.app_fire_cron('/api/cron/auto-dial') $job$);
  perform cron.schedule('reconcile-ai', '* * * * *', $job$ select public.app_fire_cron('/api/cron/reconcile-ai') $job$);
end $$;

-- Phase B4 (run by hand at that checkpoint, alongside deploying the endpoint):
-- select cron.schedule('reconcile-data', '*/15 * * * *',
--   $job$ select public.app_fire_cron('/api/cron/reconcile-data') $job$);

-- ───────────────────────────────────────────────────────────────────────────
-- Diagnostics (copy-paste)
-- ───────────────────────────────────────────────────────────────────────────
-- select jobid, jobname, schedule, active from cron.job;
-- select j.jobname, r.status, r.start_time, r.return_message
--   from cron.job_run_details r join cron.job j using (jobid)
--   order by r.start_time desc limit 20;
-- select id, status_code, content, created from net._http_response
--   order by created desc limit 20;
-- 401 = Vault secret no longer matches Vercel's CRON_SECRET.
-- 503 = CRON_SECRET missing in Vercel entirely.
