-- ─────────────────────────────────────────────────────────────────────────────
-- One-time cleanup: wipe ALL operational data from the UNRG workspace so new
-- members onboard into a genuine clean slate.
--
-- Run manually in the Supabase SQL editor (NOT part of schema.sql, so applying
-- migrations never destroys live data). Safe to run repeatedly — it removes
-- nothing once the workspace is already empty.
--
-- Scoped strictly to UNRG via org_id. It leaves the organization itself, its
-- settings (paywall + AI-only), and any existing memberships intact — only the
-- per-org data is cleared: leads, call records, appointments, callbacks, AI
-- conversations, campaigns, companies and live-call presence.
--
-- ⚠️ Destructive. Double-check you want UNRG emptied before running.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  unrg uuid;
begin
  select id into unrg from public.organizations where slug = 'unrg';
  if unrg is null then
    raise notice 'UNRG organization not found — nothing to wipe.';
    return;
  end if;

  -- Delete rows that reference leads/campaigns first to avoid FK conflicts.
  delete from public.call_records     where org_id = unrg;
  delete from public.ai_conversations where org_id = unrg;
  delete from public.appointments     where org_id = unrg;
  delete from public.callbacks        where org_id = unrg;
  delete from public.live_calls       where org_id = unrg;
  delete from public.leads            where org_id = unrg;
  delete from public.campaigns        where org_id = unrg;
  delete from public.companies        where org_id = unrg;

  raise notice 'UNRG workspace wiped — clean slate ready for onboarding.';
end $$;

-- Optional: also remove every member so the roster starts empty too. Uncomment
-- to reset onboarding entirely (people then re-join with the org's join code).
-- do $$
-- declare unrg uuid;
-- begin
--   select id into unrg from public.organizations where slug = 'unrg';
--   if unrg is null then return; end if;
--   update public.profiles set org_id = null where org_id = unrg;
--   delete from public.organization_members where org_id = unrg;
-- end $$;
