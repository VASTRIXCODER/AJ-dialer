-- ═════════════════════════════════════════════════════════════════════════════
-- RLS READ LOCKDOWN (P0.4) — run once in the Supabase SQL editor.
--
-- The original "orgs read" / "companies read" policies used
-- `using (auth.uid() is not null)`, so ANY signed-in user could read EVERY
-- tenant's organization row via the public anon key — exposing each org's
-- join_code, dialing.callerIds, ai.systemPrompt, notifications emails and
-- billing. Harvesting a join_code then allowed joining another org (and, when
-- that org auto-approves, reaching its entire shared lead pool).
--
-- This restricts organization/company reads to members (+ superadmin), serves
-- the onboarding directory of joinable orgs through a SECURITY DEFINER function
-- that returns only safe columns, and scopes the leads shared-pool policies to
-- the caller's ACTIVE org so a dual-org member can't reach the other org's leads.
--
-- Idempotent: safe to re-run. Already folded into schema.sql.
-- ═════════════════════════════════════════════════════════════════════════════

-- Onboarding directory: only non-sensitive columns, for active + joinable orgs.
-- SECURITY DEFINER so it still works under the tightened table policy below.
create or replace function public.app_list_joinable_orgs()
returns table (id uuid, name text, industry text, slug text, require_approval boolean)
language sql stable security definer set search_path = public as $$
  select id, name, industry, slug, coalesce(require_approval, true)
  from public.organizations
  where status = 'active' and coalesce(allow_join, true) = true
  order by name asc;
$$;
grant execute on function public.app_list_joinable_orgs() to anon, authenticated;

-- Organizations: your currently-active org (covers the member-row-less
-- "resilience bridge" where profiles.org_id is set directly), every org you're
-- an active member of (the Hub workspace switcher), or superadmin. No one else.
drop policy if exists "orgs read" on public.organizations;
create policy "orgs read" on public.organizations for select using (
  public.app_is_superadmin()
  or id = public.app_active_org()
  or public.app_is_org_member(id)
);

-- Companies: members of the company's org (or your active org) only. In
-- production these are read with the service-role client anyway; this closes the
-- RLS path.
drop policy if exists "companies read" on public.companies;
create policy "companies read" on public.companies for select using (
  public.app_is_superadmin()
  or org_id = public.app_active_org()
  or public.app_is_org_member(org_id)
);

-- Leads read/update: scope the shared-pool branch to the caller's ACTIVE org, so
-- a user who belongs to two orgs can't read/write the OTHER org's leads while
-- active in one. (The owner branch was already active-org scoped.)
drop policy if exists "leads read" on public.leads;
create policy "leads read" on public.leads for select using (
  public.app_is_superadmin() or (public.app_is_active() and (
    (owner_id = auth.uid() and (org_id is null or org_id = public.app_active_org()))
    or (org_id is not null and org_id = public.app_active_org() and public.app_is_org_member(org_id)))));

drop policy if exists "leads update" on public.leads;
create policy "leads update" on public.leads for update
  using (public.app_is_superadmin() or (public.app_is_active() and (
    (owner_id = auth.uid() and (org_id is null or org_id = public.app_active_org()))
    or (org_id is not null and org_id = public.app_active_org() and public.app_is_org_member(org_id)))))
  with check (public.app_is_superadmin() or (public.app_is_active() and (
    (owner_id = auth.uid() and (org_id is null or org_id = public.app_active_org()))
    or (org_id is not null and org_id = public.app_active_org() and public.app_is_org_member(org_id)))));
