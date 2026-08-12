-- ─────────────────────────────────────────────────────────────────────────────
-- AIATWORK Solar Resolution Dialer — Supabase schema
--
-- Run this in the Supabase SQL editor (or `supabase db push`). It creates the
-- account-scoped tables behind the power dialer and locks them down with
-- row-level security so every account only ever sees its own data.
-- Safe to re-run (idempotent).
-- ─────────────────────────────────────────────────────────────────────────────

create extension if not exists "pgcrypto";

-- ── Profiles (1:1 with auth.users) ───────────────────────────────────────────
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text,
  team        text default 'AIATWORK',
  role        text default 'manager',
  avatar_color text default '#3B82F6',
  created_at  timestamptz not null default now()
);

-- Auto-create a profile row whenever a new auth user signs up.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── Leads ────────────────────────────────────────────────────────────────────
create table if not exists public.leads (
  id               uuid primary key default gen_random_uuid(),
  owner_id         uuid not null references auth.users (id) on delete cascade,
  first_name       text not null default '',
  last_name        text not null default '',
  phone            text not null default '',
  email            text,
  address          text default '',
  city             text default '',
  state            text default '',
  zip              text default '',
  utility_provider text default '',
  solar_provider   text default '',
  status           text not null default 'new',
  campaign_id      text,
  assigned_rep_id  text,
  solar_payment    numeric,
  utility_bill     numeric,
  has_ev           boolean not null default false,
  has_pool         boolean not null default false,
  has_battery      boolean not null default false,
  multiple_systems boolean not null default false,
  notes            text,
  ai_score         int,
  timezone         text default 'America/Los_Angeles',
  last_contacted_at timestamptz,
  created_at       timestamptz not null default now()
);
create index if not exists leads_owner_idx on public.leads (owner_id);
create index if not exists leads_owner_status_idx on public.leads (owner_id, status);

-- ── Call records ─────────────────────────────────────────────────────────────
create table if not exists public.call_records (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null references auth.users (id) on delete cascade,
  lead_id         uuid references public.leads (id) on delete set null,
  lead_name       text default '',
  phone           text default '',
  duration_sec    int not null default 0,
  outcome         text,
  disposition     text,
  channel         text not null default 'human', -- 'human' | 'ai'
  conversation_id text,                            -- ElevenLabs conversation id
  recording_url   text,
  summary         text,
  sentiment       text,
  started_at      timestamptz not null default now()
);
create index if not exists call_records_owner_idx on public.call_records (owner_id, started_at desc);

-- ── Appointments ─────────────────────────────────────────────────────────────
create table if not exists public.appointments (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null references auth.users (id) on delete cascade,
  lead_id       uuid references public.leads (id) on delete set null,
  lead_name     text default '',
  scheduled_at  timestamptz,
  scheduled_label text,                -- e.g. "Tomorrow 2:00pm" when no exact ts
  status        text not null default 'scheduled',
  notes         text,
  source        text not null default 'ai', -- 'ai' | 'rep'
  created_at    timestamptz not null default now()
);
create index if not exists appointments_owner_idx on public.appointments (owner_id, created_at desc);

-- ── Callbacks ────────────────────────────────────────────────────────────────
create table if not exists public.callbacks (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references auth.users (id) on delete cascade,
  lead_id     uuid references public.leads (id) on delete set null,
  lead_name   text default '',
  phone       text default '',
  due_at      timestamptz,
  reason      text,
  status      text not null default 'due',
  created_at  timestamptz not null default now()
);
create index if not exists callbacks_owner_idx on public.callbacks (owner_id, due_at);

-- ── AI conversations (ElevenLabs) ────────────────────────────────────────────
create table if not exists public.ai_conversations (
  conversation_id text primary key,
  owner_id        uuid references auth.users (id) on delete cascade,
  lead_id         uuid references public.leads (id) on delete set null,
  lead_name       text default '',
  phone           text default '',
  call_sid        text,
  state           text not null default 'initiated',
  sentiment       text default 'neutral',
  outcome         text,
  summary         text,
  duration_sec    int,
  appointment     jsonb,
  started_at      timestamptz not null default now(),
  ended_at        timestamptz
);
create index if not exists ai_conversations_owner_idx on public.ai_conversations (owner_id, started_at desc);

-- ── Row-level security ───────────────────────────────────────────────────────
alter table public.profiles         enable row level security;
alter table public.leads            enable row level security;
alter table public.call_records     enable row level security;
alter table public.appointments     enable row level security;
alter table public.callbacks        enable row level security;
alter table public.ai_conversations enable row level security;

-- Profiles: a user can read/update only their own profile.
drop policy if exists "profiles self" on public.profiles;
create policy "profiles self" on public.profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);

-- Helper: one owner_id policy per data table.
drop policy if exists "leads owner" on public.leads;
create policy "leads owner" on public.leads
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

drop policy if exists "call_records owner" on public.call_records;
create policy "call_records owner" on public.call_records
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

drop policy if exists "appointments owner" on public.appointments;
create policy "appointments owner" on public.appointments
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

drop policy if exists "callbacks owner" on public.callbacks;
create policy "callbacks owner" on public.callbacks
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

drop policy if exists "ai_conversations owner" on public.ai_conversations;
create policy "ai_conversations owner" on public.ai_conversations
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

-- ── Campaigns ────────────────────────────────────────────────────────────────
create table if not exists public.campaigns (
  id               uuid primary key default gen_random_uuid(),
  owner_id         uuid not null references auth.users (id) on delete cascade,
  name             text not null,
  utility_provider text default '',
  status           text not null default 'active', -- active | paused | completed
  color            text default '#3B82F6',
  created_at       timestamptz not null default now()
);
create index if not exists campaigns_owner_idx on public.campaigns (owner_id, created_at desc);

alter table public.campaigns enable row level security;
drop policy if exists "campaigns owner" on public.campaigns;
create policy "campaigns owner" on public.campaigns
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

-- ── Team members (User Management — roster, roles, access & permissions) ──────
create table if not exists public.team_members (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null references auth.users (id) on delete cascade,
  email        text not null,
  name         text default '',
  role         text not null default 'rep',       -- admin | manager | rep
  access_level text not null default 'standard',  -- full | standard | limited
  permissions  jsonb not null default '{}'::jsonb,
  status       text not null default 'invited',   -- invited | active | disabled
  created_at   timestamptz not null default now()
);
create index if not exists team_members_owner_idx on public.team_members (owner_id, created_at desc);

alter table public.team_members enable row level security;
drop policy if exists "team_members owner" on public.team_members;
create policy "team_members owner" on public.team_members
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

-- ── Superadmin: account suspension + app-wide controls ───────────────────────
-- A disabled account is blocked from the app shell by the (app) layout.
alter table public.profiles add column if not exists disabled boolean not null default false;

-- Global app settings (maintenance / kill switch). Single 'global' row. RLS on
-- with no policies → only the service-role (superadmin) client can touch it.
create table if not exists public.app_settings (
  id          text primary key default 'global',
  maintenance boolean not null default false,
  message     text default '',
  updated_at  timestamptz not null default now()
);
alter table public.app_settings enable row level security;
insert into public.app_settings (id) values ('global') on conflict (id) do nothing;

-- ── Organizations & companies (multi-tenant) ─────────────────────────────────
-- The dialer is a general product; each organization is one specialization
-- (this instance ships under "Sunrun"). Organizations contain companies and
-- members (accounts). Managed from the superadmin console.
create table if not exists public.organizations (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  slug       text unique,
  industry   text default '',
  status     text not null default 'active',  -- active | suspended
  created_at timestamptz not null default now()
);

create table if not exists public.companies (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations (id) on delete cascade,
  name       text not null,
  created_at timestamptz not null default now()
);
create index if not exists companies_org_idx on public.companies (org_id);

-- Each account belongs to an organization (and optionally a company within it).
alter table public.profiles add column if not exists org_id uuid references public.organizations (id) on delete set null;
alter table public.profiles add column if not exists company_id uuid references public.companies (id) on delete set null;

-- Any signed-in user may READ orgs/companies (to show their org); all WRITES are
-- service-role only (the superadmin console).
alter table public.organizations enable row level security;
drop policy if exists "orgs read" on public.organizations;
create policy "orgs read" on public.organizations for select using (auth.uid() is not null);

alter table public.companies enable row level security;
drop policy if exists "companies read" on public.companies;
create policy "companies read" on public.companies for select using (auth.uid() is not null);

-- Seed the Sunrun organization for this instance + assign existing accounts.
insert into public.organizations (name, slug, industry)
  values ('Sunrun', 'sunrun', 'Residential Solar')
  on conflict (slug) do nothing;
update public.profiles
  set org_id = (select id from public.organizations where slug = 'sunrun')
  where org_id is null;

-- ── Organization customization, membership & approvals ───────────────────────
-- The dialer is a general AI auto-dialer; each organization specializes it.
-- These columns + the settings JSONB make an org deeply customizable by its
-- managers, and organization_members drives join-codes, roles & approvals.
alter table public.organizations add column if not exists join_code       text;
alter table public.organizations add column if not exists require_approval boolean not null default true;
alter table public.organizations add column if not exists allow_join      boolean not null default true;
alter table public.organizations add column if not exists description     text default '';
alter table public.organizations add column if not exists product_name    text default '';
alter table public.organizations add column if not exists tagline         text default '';
alter table public.organizations add column if not exists website         text default '';
alter table public.organizations add column if not exists logo_url        text default '';
alter table public.organizations add column if not exists brand_color     text default '';
alter table public.organizations add column if not exists accent_color    text default '';
alter table public.organizations add column if not exists timezone        text default 'America/Los_Angeles';
alter table public.organizations add column if not exists dialer_template text not null default 'general';
alter table public.organizations add column if not exists default_role    text not null default 'rep';
alter table public.organizations add column if not exists owner_id        uuid references auth.users (id) on delete set null;
alter table public.organizations add column if not exists settings        jsonb not null default '{}'::jsonb;

create unique index if not exists organizations_join_code_idx
  on public.organizations (join_code) where join_code is not null;

-- Give every existing org a join code, and specialize Sunrun for solar.
update public.organizations
  set join_code = upper(substr(md5(random()::text || id::text), 1, 7))
  where join_code is null;
update public.organizations set
  dialer_template = 'solar',
  product_name = coalesce(nullif(product_name, ''), 'Sunrun Resolution Dialer'),
  tagline      = coalesce(nullif(tagline, ''), 'AI-powered solar resolution calling')
  where slug = 'sunrun';

-- ── UNRG: AI-only workspace behind the platform paywall ──────────────────────
-- A white-label organization with manual (human) browser dialing turned OFF and
-- access gated behind the superadmin-controlled paywall until it's marked paid.
-- Only partial settings are stored; mergeSettings() fills the rest from defaults,
-- so AI calling and live listening stay enabled. The price + unlock are managed
-- from the superadmin console (App Control → the org's Billing section).
insert into public.organizations
    (name, slug, industry, dialer_template, product_name, tagline, settings)
  values (
    'UNRG', 'unrg', 'AI Sales', 'general',
    'UNRG Dialer', 'AI-powered outbound calling',
    jsonb_build_object(
      'features', jsonb_build_object('manualDialer', false),
      'billing',  jsonb_build_object(
        'paywall',  true,
        'active',   false,
        'price',    0,
        'currency', 'USD',
        'interval', 'month',
        'note',     ''
      )
    )
  )
  on conflict (slug) do nothing;
update public.organizations
  set join_code = upper(substr(md5(random()::text || id::text), 1, 7))
  where slug = 'unrg' and join_code is null;

-- ── Donny: manual-only workspace; AI dialing locked behind a paywall ─────────
-- The inverse of UNRG: human (browser) dialing is ON for everyone, but the AI
-- dialer feature is turned OFF, so it surfaces as a locked premium upgrade for
-- every member regardless of role. Flip `features.aiDialer` to true (from the
-- owner's settings) to unlock AI calling once they're on the paid plan.
insert into public.organizations
    (name, slug, industry, dialer_template, product_name, tagline, settings)
  values (
    'Donny', 'donny', 'Sales', 'general',
    'Donny Dialer', 'Manual outbound calling',
    jsonb_build_object(
      'features', jsonb_build_object('aiDialer', false, 'manualDialer', true)
    )
  )
  on conflict (slug) do nothing;
update public.organizations
  set join_code = upper(substr(md5(random()::text || id::text), 1, 7))
  where slug = 'donny' and join_code is null;

-- Membership = who is in an org, their role, their approval status, and any
-- per-member permission overrides. One active membership per user per org.
create table if not exists public.organization_members (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  email        text default '',
  name         text default '',
  role         text not null default 'rep',      -- owner | admin | manager | rep
  permissions  jsonb not null default '{}'::jsonb, -- granular per-member overrides
  status       text not null default 'pending',  -- pending | active | rejected | removed
  requested_at timestamptz not null default now(),
  decided_at   timestamptz,
  decided_by   uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  unique (org_id, user_id)
);
create index if not exists org_members_org_idx  on public.organization_members (org_id, status);
create index if not exists org_members_user_idx on public.organization_members (user_id);

-- A user may read only their own membership rows; all cross-member reads and all
-- writes (approvals, role changes) go through the service-role server engine,
-- which enforces the role hierarchy in application code.
alter table public.organization_members enable row level security;
drop policy if exists "org_members self read" on public.organization_members;
create policy "org_members self read" on public.organization_members
  for select using (auth.uid() = user_id);

-- Backfill: everyone already assigned to an org becomes an active member with
-- their current profile role; the earliest member of each org becomes its owner.
insert into public.organization_members (org_id, user_id, name, role, status, decided_at)
  select p.org_id, p.id, coalesce(p.full_name, ''),
         coalesce(nullif(p.role, ''), 'manager'), 'active', now()
  from public.profiles p
  where p.org_id is not null
  on conflict (org_id, user_id) do nothing;

update public.organization_members m set role = 'owner', decided_at = now()
  where m.id in (
    select distinct on (o.id) mm.id
    from public.organizations o
    join public.organization_members mm on mm.org_id = o.id and mm.status = 'active'
    order by o.id, mm.created_at asc
  );

update public.organizations o set owner_id = (
    select m.user_id from public.organization_members m
    where m.org_id = o.id and m.role = 'owner' order by m.created_at asc limit 1
  ) where o.owner_id is null;

-- Keep the denormalized profile role in sync with the owner backfill.
update public.profiles p set role = 'owner'
  from public.organization_members m
  where m.user_id = p.id and m.role = 'owner' and m.status = 'active';

-- ═════════════════════════════════════════════════════════════════════════════
-- PART 2 — SECURITY & HIERARCHY UPGRADE  (idempotent; safe to re-run)
--
-- • Hidden platform superadmin tied to your real account (no separate password).
-- • Account suspension enforced at the database, not just in app code.
-- • Org-level data isolation: supervisors (manager/admin/owner) see their org's
--   leads/calls/etc.; reps see only their own. Enforced by RLS, not just the UI.
-- • Self privilege-escalation is blocked (users can't grant themselves a role,
--   un-suspend themselves, or move orgs without a validated server path).
-- • Audit log for sensitive actions.
-- ═════════════════════════════════════════════════════════════════════════════

-- ── Profile additions ────────────────────────────────────────────────────────
alter table public.profiles add column if not exists preferences jsonb not null default '{}'::jsonb;

-- ── Hidden platform superadmins ──────────────────────────────────────────────
-- Service-role-only table (RLS on, no policies) so a user can NEVER grant
-- themselves platform access. Membership here = superadmin (in addition to the
-- SUPERADMIN_EMAILS env allowlist, which is the un-lock-out-able bootstrap).
create table if not exists public.platform_admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  note       text default '',
  created_at timestamptz not null default now()
);
alter table public.platform_admins enable row level security;

-- ── Audit log (service-role only) ────────────────────────────────────────────
create table if not exists public.audit_log (
  id          uuid primary key default gen_random_uuid(),
  actor_id    uuid,
  actor_kind  text not null default 'user',   -- user | superadmin | system
  action      text not null,
  target_id   text,
  target_kind text,
  org_id      uuid,
  detail      jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists audit_log_created_idx on public.audit_log (created_at desc);
alter table public.audit_log enable row level security;

-- ── Org scoping on all account data ──────────────────────────────────────────
alter table public.leads            add column if not exists org_id uuid references public.organizations (id) on delete set null;
alter table public.call_records     add column if not exists org_id uuid references public.organizations (id) on delete set null;
alter table public.appointments     add column if not exists org_id uuid references public.organizations (id) on delete set null;
alter table public.callbacks        add column if not exists org_id uuid references public.organizations (id) on delete set null;
alter table public.ai_conversations add column if not exists org_id uuid references public.organizations (id) on delete set null;
alter table public.campaigns        add column if not exists org_id uuid references public.organizations (id) on delete set null;

create index if not exists leads_org_idx            on public.leads (org_id);
-- The supervisor dial-queue (org_id + status IN dialable, ordered by ai_score) and
-- the bills-fine scan (org_id + status = 'bills_fine') both filter org_id AND status;
-- a composite lets Postgres range-scan instead of filtering status in-heap after the
-- org_id index. ai_score in the index also serves the dial-queue's ORDER BY.
create index if not exists leads_org_status_idx      on public.leads (org_id, status, ai_score desc);
create index if not exists call_records_org_idx     on public.call_records (org_id, started_at desc);
create index if not exists appointments_org_idx     on public.appointments (org_id, created_at desc);
create index if not exists callbacks_org_idx        on public.callbacks (org_id);
create index if not exists ai_conversations_org_idx on public.ai_conversations (org_id, started_at desc);
create index if not exists campaigns_org_idx        on public.campaigns (org_id);

-- Performance indexes (also shipped standalone in supabase/perf-indexes.sql).
-- Serve the ai_score-ordered lead lists (dialer queue / leads screen) so they
-- index-scan instead of sorting, and cover the high-traffic lead_id foreign keys.
create index if not exists leads_owner_ai_score_idx    on public.leads (owner_id, ai_score desc nulls last);
create index if not exists leads_org_ai_score_idx      on public.leads (org_id, ai_score desc nulls last);
create index if not exists call_records_lead_id_idx    on public.call_records (lead_id);
create index if not exists ai_conversations_lead_id_idx on public.ai_conversations (lead_id);
create index if not exists callbacks_lead_id_idx       on public.callbacks (lead_id);
create index if not exists appointments_lead_id_idx    on public.appointments (lead_id);

-- Backfill org_id from each row's owner profile.
update public.leads            t set org_id = p.org_id from public.profiles p where p.id = t.owner_id and t.org_id is null;
update public.call_records     t set org_id = p.org_id from public.profiles p where p.id = t.owner_id and t.org_id is null;
update public.appointments     t set org_id = p.org_id from public.profiles p where p.id = t.owner_id and t.org_id is null;
update public.callbacks        t set org_id = p.org_id from public.profiles p where p.id = t.owner_id and t.org_id is null;
update public.ai_conversations t set org_id = p.org_id from public.profiles p where p.id = t.owner_id and t.org_id is null;
update public.campaigns        t set org_id = p.org_id from public.profiles p where p.id = t.owner_id and t.org_id is null;

-- ── Security-definer helpers (bypass RLS to evaluate the checks) ─────────────
create or replace function public.app_is_active()
returns boolean language sql stable security definer set search_path = public as $$
  select not coalesce((select disabled from public.profiles where id = auth.uid()), false);
$$;

create or replace function public.app_is_superadmin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.platform_admins where user_id = auth.uid());
$$;

-- Is the caller an ACTIVE manager/admin/owner of the given org?
create or replace function public.app_is_org_supervisor(target_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = target_org
      and m.status = 'active'
      and m.role in ('owner','admin','manager')
  );
$$;

-- The caller's CURRENTLY ACTIVE org (profiles.org_id). Rows a user owns from an
-- org they've since left/switched away from must NOT follow them into whatever
-- org they're active in now — "you own it" only counts while org_id still
-- matches where you're actively working (or the row predates org scoping and
-- has no org_id at all). Without this, a fresh organization can appear to show
-- another org's leads/calls/appointments simply because the same account owns
-- rows in both.
create or replace function public.app_active_org()
returns uuid language sql stable security definer set search_path = public as $$
  select org_id from public.profiles where id = auth.uid();
$$;

-- ── Stamp org_id on insert from the owner's profile (app code can't forget) ──
create or replace function public.stamp_org_id()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.org_id is null then
    new.org_id := (select org_id from public.profiles where id = new.owner_id);
  end if;
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['leads','call_records','appointments','callbacks','ai_conversations','campaigns']
  loop
    execute format('drop trigger if exists stamp_org_id on public.%I', t);
    execute format('create trigger stamp_org_id before insert on public.%I for each row execute function public.stamp_org_id()', t);
  end loop;
end $$;

-- ── Freeze privileged profile columns against self-escalation ────────────────
-- Ordinary end-users (jwt role 'authenticated') can edit name/team/avatar/prefs
-- but NOT their role, suspension flag, or org pointer. The service-role server
-- paths (org switch, approvals, superadmin) bypass this guard.
create or replace function public.guard_profile_columns()
returns trigger language plpgsql security definer set search_path = public as $$
declare jwt_role text;
begin
  jwt_role := coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '');
  if jwt_role = 'authenticated' then
    new.role       := old.role;
    new.disabled   := old.disabled;
    new.org_id     := old.org_id;
    new.company_id := old.company_id;
  end if;
  return new;
end;
$$;
drop trigger if exists guard_profile_columns on public.profiles;
create trigger guard_profile_columns before update on public.profiles
  for each row execute function public.guard_profile_columns();

-- ── Profiles RLS: read self (or superadmin); update self (guarded columns) ───
drop policy if exists "profiles self" on public.profiles;
drop policy if exists "profiles self read" on public.profiles;
drop policy if exists "profiles self update" on public.profiles;
create policy "profiles self read" on public.profiles for select
  using (id = auth.uid() or public.app_is_superadmin());
create policy "profiles self update" on public.profiles for update
  using (id = auth.uid()) with check (id = auth.uid());

-- ── Data RLS: superadmin can do all; otherwise the account must be ACTIVE and
--    either own the row (read+write) or supervise its org (read only). Suspended
--    users are blocked everywhere (except superadmins, who can't be locked out). ─
-- leads
drop policy if exists "leads owner" on public.leads;
drop policy if exists "leads read" on public.leads;
drop policy if exists "leads write" on public.leads;
create policy "leads read" on public.leads for select using (
  public.app_is_superadmin() or (public.app_is_active() and (
    owner_id = auth.uid()
    or (org_id is not null and public.app_is_org_supervisor(org_id)))));
create policy "leads write" on public.leads for all
  using (public.app_is_superadmin() or (public.app_is_active() and owner_id = auth.uid()))
  with check (public.app_is_superadmin() or (public.app_is_active() and owner_id = auth.uid()));

-- call_records
drop policy if exists "call_records owner" on public.call_records;
drop policy if exists "call_records read" on public.call_records;
drop policy if exists "call_records write" on public.call_records;
create policy "call_records read" on public.call_records for select using (
  public.app_is_superadmin() or (public.app_is_active() and (
    (owner_id = auth.uid() and (org_id is null or org_id = public.app_active_org()))
    or (org_id is not null and public.app_is_org_supervisor(org_id)))));
create policy "call_records write" on public.call_records for all
  using (public.app_is_superadmin() or (public.app_is_active() and owner_id = auth.uid() and (org_id is null or org_id = public.app_active_org())))
  with check (public.app_is_superadmin() or (public.app_is_active() and owner_id = auth.uid() and (org_id is null or org_id = public.app_active_org())));

-- appointments
drop policy if exists "appointments owner" on public.appointments;
drop policy if exists "appointments read" on public.appointments;
drop policy if exists "appointments write" on public.appointments;
create policy "appointments read" on public.appointments for select using (
  public.app_is_superadmin() or (public.app_is_active() and (
    (owner_id = auth.uid() and (org_id is null or org_id = public.app_active_org()))
    or (org_id is not null and public.app_is_org_supervisor(org_id)))));
create policy "appointments write" on public.appointments for all
  using (public.app_is_superadmin() or (public.app_is_active() and owner_id = auth.uid() and (org_id is null or org_id = public.app_active_org())))
  with check (public.app_is_superadmin() or (public.app_is_active() and owner_id = auth.uid() and (org_id is null or org_id = public.app_active_org())));

-- callbacks
drop policy if exists "callbacks owner" on public.callbacks;
drop policy if exists "callbacks read" on public.callbacks;
drop policy if exists "callbacks write" on public.callbacks;
create policy "callbacks read" on public.callbacks for select using (
  public.app_is_superadmin() or (public.app_is_active() and (
    (owner_id = auth.uid() and (org_id is null or org_id = public.app_active_org()))
    or (org_id is not null and public.app_is_org_supervisor(org_id)))));
create policy "callbacks write" on public.callbacks for all
  using (public.app_is_superadmin() or (public.app_is_active() and owner_id = auth.uid() and (org_id is null or org_id = public.app_active_org())))
  with check (public.app_is_superadmin() or (public.app_is_active() and owner_id = auth.uid() and (org_id is null or org_id = public.app_active_org())));

-- ai_conversations
drop policy if exists "ai_conversations owner" on public.ai_conversations;
drop policy if exists "ai_conversations read" on public.ai_conversations;
drop policy if exists "ai_conversations write" on public.ai_conversations;
create policy "ai_conversations read" on public.ai_conversations for select using (
  public.app_is_superadmin() or (public.app_is_active() and (
    (owner_id = auth.uid() and (org_id is null or org_id = public.app_active_org()))
    or (org_id is not null and public.app_is_org_supervisor(org_id)))));
create policy "ai_conversations write" on public.ai_conversations for all
  using (public.app_is_superadmin() or (public.app_is_active() and owner_id = auth.uid() and (org_id is null or org_id = public.app_active_org())))
  with check (public.app_is_superadmin() or (public.app_is_active() and owner_id = auth.uid() and (org_id is null or org_id = public.app_active_org())));

-- campaigns
drop policy if exists "campaigns owner" on public.campaigns;
drop policy if exists "campaigns read" on public.campaigns;
drop policy if exists "campaigns write" on public.campaigns;
create policy "campaigns read" on public.campaigns for select using (
  public.app_is_superadmin() or (public.app_is_active() and (
    (owner_id = auth.uid() and (org_id is null or org_id = public.app_active_org()))
    or (org_id is not null and public.app_is_org_supervisor(org_id)))));
create policy "campaigns write" on public.campaigns for all
  using (public.app_is_superadmin() or (public.app_is_active() and owner_id = auth.uid() and (org_id is null or org_id = public.app_active_org())))
  with check (public.app_is_superadmin() or (public.app_is_active() and owner_id = auth.uid() and (org_id is null or org_id = public.app_active_org())));

-- ── Bootstrap the platform superadmin by email (edit to your address) ────────
-- This makes YOU a hidden superadmin tied to your real Supabase login. It is not
-- shown on your profile. Re-run safe.
insert into public.platform_admins (user_id, note)
  select id, 'bootstrap' from auth.users where lower(email) = lower('pmtosiri@gmail.com')
  on conflict (user_id) do nothing;

-- ═════════════════════════════════════════════════════════════════════════════
-- PART 3 — LIVE CALL PRESENCE  (idempotent; safe to re-run)
--
-- Shared, cross-instance presence for in-progress human (manual) rep↔customer
-- calls so the Live Monitor is consistent on serverless (Vercel): the rep's
-- browser writes a row when a call starts/connects/ends, and every supervisor
-- instance reads the same rows. Without this table the app falls back to
-- per-instance memory, which makes a call flicker in/out of the monitor.
--
-- Service-role only (RLS on, no policies): the server engine scopes reads to the
-- viewer's org in application code, exactly like organization management.
-- ═════════════════════════════════════════════════════════════════════════════
create table if not exists public.live_calls (
  id         text primary key,                 -- the client-generated humanId
  org_id     uuid,
  owner_id   uuid,
  rep_name   text not null default '',
  lead_name  text not null default 'Manual call',
  city       text not null default '',
  phone      text not null default '',
  state      text not null default 'ringing',  -- ringing | connected
  started_at timestamptz not null default now()
);
create index if not exists live_calls_org_idx on public.live_calls (org_id, started_at desc);
alter table public.live_calls enable row level security;

-- ═════════════════════════════════════════════════════════════════════════════
-- PART 4 — CAMPAIGN ATTRIBUTION  (idempotent; safe to re-run)
--
-- Tag each call with the campaign of the lead it was for, so reports + the
-- campaigns tab can slice performance per campaign. Leads already carry
-- campaign_id; this adds the same to call_records.
-- ═════════════════════════════════════════════════════════════════════════════
alter table public.call_records add column if not exists campaign_id text;
create index if not exists call_records_campaign_idx on public.call_records (campaign_id);
create index if not exists leads_campaign_idx on public.leads (campaign_id);

-- ═════════════════════════════════════════════════════════════════════════════
-- PART 5 — APPOINTMENT APPROVAL LAYER  (idempotent; safe to re-run)
--
-- AI-booked appointments are PROPOSALS until a human approves them. Reps' own
-- appointments are auto-approved. Existing rows default to approved (true) so
-- nothing retroactively lands back in the review queue.
-- ═════════════════════════════════════════════════════════════════════════════
alter table public.appointments add column if not exists approved boolean not null default true;
alter table public.appointments add column if not exists reviewed_by uuid references auth.users (id) on delete set null;
alter table public.appointments add column if not exists reviewed_at timestamptz;
create index if not exists appointments_approved_idx on public.appointments (org_id, approved);

-- ── Add call_sid to call_records (manual call recording linkage) ─────────────
-- The rep's Twilio Voice SDK call SID is written here when the disposition is
-- saved. The recording-status webhook then uses it to back-fill recording_url.
alter table public.call_records add column if not exists call_sid text;
create index if not exists call_records_call_sid_idx on public.call_records (call_sid) where call_sid is not null;

-- ═════════════════════════════════════════════════════════════════════════════
-- PART 6 — MANUAL CALL RECORDING LINKAGE  (idempotent; safe to re-run)
--
-- A manual (human) call is a Twilio CONFERENCE, so its recording-status webhook
-- carries the ConferenceSid, NOT the rep's CallSid — matching by call_sid never
-- works for these. Instead we tag the call record with its conference room name
-- (`hc-<id>`) and the webhook passes the same room back, so the two always link.
--
-- Because the recording webhook can fire BEFORE the rep finishes wrap-up (i.e.
-- before the call record exists), a recording that arrives early is parked in
-- `pending_recordings` keyed by room and claimed when the record is written.
-- ═════════════════════════════════════════════════════════════════════════════
alter table public.call_records add column if not exists room text;
create index if not exists call_records_room_idx on public.call_records (room) where room is not null;

create table if not exists public.pending_recordings (
  room          text primary key,
  recording_url text not null,
  created_at    timestamptz not null default now()
);
-- Service-role only (no policies) — written by the webhook, claimed on insert.
alter table public.pending_recordings enable row level security;

-- Twilio's own verdict on the call (answered? which error code?) races the call
-- record the exact same way, and for the exact same reason: `completed` fires the
-- instant the call ends, while the record isn't written until the rep saves the
-- disposition. Keyed by room and claimed on insert, just like the recording above.
-- Without this the verdict update matches zero rows on every call and these
-- columns stay null forever — which is how 21210/21212 (bad caller ID), 21610
-- (blocked) and 13224 (geo) failures become invisible.
create table if not exists public.pending_call_verdicts (
  room               text primary key,
  twilio_call_status text,
  twilio_error_code  integer,
  answered_by        text,
  created_at         timestamptz not null default now()
);
-- Service-role only (no policies) — written by the webhook, claimed on insert.
alter table public.pending_call_verdicts enable row level security;

-- ═════════════════════════════════════════════════════════════════════════════
-- PART 7 — SHARED ORG LEAD POOL  (idempotent; safe to re-run)
--
-- Leads become a single shared pool per organization: every active member sees
-- and works the same leads (not just their own imports). Reads + updates are
-- open to any active org member (so any rep can dial and disposition any lead);
-- deletes are limited to supervisors (manager/admin/owner). Inserts stay
-- owner-stamped (you create leads you own; the org_id trigger shares them).
-- ═════════════════════════════════════════════════════════════════════════════

-- Active member (ANY role) of the given org?
create or replace function public.app_is_org_member(target_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = target_org
      and m.status = 'active'
  );
$$;

-- Replace the owner-only leads policies with shared-pool policies.
drop policy if exists "leads owner"  on public.leads;
drop policy if exists "leads read"   on public.leads;
drop policy if exists "leads write"  on public.leads;
drop policy if exists "leads insert" on public.leads;
drop policy if exists "leads update" on public.leads;
drop policy if exists "leads delete" on public.leads;

-- Read: any active member of the lead's org (shared pool), the owner (while
-- still active in that lead's org — see app_active_org()), or superadmin.
create policy "leads read" on public.leads for select using (
  public.app_is_superadmin() or (public.app_is_active() and (
    (owner_id = auth.uid() and (org_id is null or org_id = public.app_active_org()))
    or (org_id is not null and public.app_is_org_member(org_id)))));

-- Insert: you create leads you own (the stamp_org_id trigger fills org_id).
create policy "leads insert" on public.leads for insert with check (
  public.app_is_superadmin() or (public.app_is_active() and owner_id = auth.uid()));

-- Update: any active org member (so any rep can disposition any shared lead).
create policy "leads update" on public.leads for update
  using (public.app_is_superadmin() or (public.app_is_active() and (
    (owner_id = auth.uid() and (org_id is null or org_id = public.app_active_org()))
    or (org_id is not null and public.app_is_org_member(org_id)))))
  with check (public.app_is_superadmin() or (public.app_is_active() and (
    (owner_id = auth.uid() and (org_id is null or org_id = public.app_active_org()))
    or (org_id is not null and public.app_is_org_member(org_id)))));

-- Delete: the owner (while still active in that lead's org), or a supervisor
-- (manager/admin/owner) of the lead's org.
create policy "leads delete" on public.leads for delete using (
  public.app_is_superadmin() or (public.app_is_active() and (
    (owner_id = auth.uid() and (org_id is null or org_id = public.app_active_org()))
    or (org_id is not null and public.app_is_org_supervisor(org_id)))));

-- ─────────────────────────────────────────────────────────────────────────────
-- PART 9 — Caller-ID rotation  (per-rep, shared-pool)
--
-- A generic atomic counter keyed by an arbitrary string. The dialer keys it by
-- the rep's USER id, so every rep cycles the shared pool of outbound numbers on
-- their OWN sequence (rep A's calls never advance rep B's number). The pool +
-- cadence live in organizations.settings.dialing (or env vars). The function
-- returns the next value atomically, so concurrent power-dials never collide.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.dial_counters (
  key text primary key,
  seq bigint not null default 0
);
-- Service-role only (RLS on, no policies) — only the server engine touches it.
alter table public.dial_counters enable row level security;

-- Replace the old per-org (uuid) counter with the keyed (text) one.
drop function if exists public.app_next_dial_seq(uuid);
alter table public.organizations drop column if exists dial_seq;

create or replace function public.app_next_dial_seq(p_key text)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare v bigint;
begin
  insert into public.dial_counters (key, seq) values (p_key, 1)
  on conflict (key) do update set seq = public.dial_counters.seq + 1
  returning seq into v;
  return coalesce(v, 1);
end;
$$;

grant execute on function public.app_next_dial_seq(text)
  to anon, authenticated, service_role;
-- PART 10 — AI CALL FORENSICS  (idempotent; safe to re-run)
--
-- Added after the zero-connect incident, in which 283 calls that the homeowner
-- ANSWERED and the agent then killed after ~2s were all filed as "no answer",
-- and 6,164 calls were never finalized at all. Nothing in the schema recorded
-- WHY a call produced no conversation, so a total outage of the AI agent was
-- indistinguishable from a run of bad luck on the lead list.
--
-- `failure_kind` is the fix: it separates a fact about the HOMEOWNER (outcome:
-- no_answer / voicemail / wrong_number) from a fact about OUR SYSTEM (the agent
-- hung up, the provider errored, the call was never placed). A row with
-- outcome IS NULL AND failure_kind IS NOT NULL is "not a real call" — it is
-- excluded from every connect-rate denominator instead of deflating it.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.call_records     add column if not exists failure_kind        text;
alter table public.call_records     add column if not exists termination_reason  text;
alter table public.call_records     add column if not exists twilio_call_status  text;   -- completed|no-answer|busy|failed|canceled
alter table public.call_records     add column if not exists twilio_error_code   int;    -- e.g. 21210 / 21212 / 21610
alter table public.call_records     add column if not exists answered_by         text;   -- Twilio AMD, when enabled

alter table public.ai_conversations add column if not exists failure_kind        text;
alter table public.ai_conversations add column if not exists termination_reason  text;
alter table public.ai_conversations add column if not exists override_mode       text;   -- what we were allowed to send

-- The reconciler drains stuck calls OLDEST-first; without this index that scan
-- degrades as the backlog grows (and the backlog is exactly when it must be fast).
create index if not exists ai_conversations_stuck_idx
  on public.ai_conversations (state, started_at)
  where state in ('initiated', 'in_progress');

create index if not exists call_records_failure_idx
  on public.call_records (failure_kind)
  where failure_kind is not null;

-- Joining an AI call back to its Twilio leg / recording webhook.
create index if not exists call_records_call_sid_idx
  on public.call_records (call_sid)
  where call_sid is not null;

-- ═════════════════════════════════════════════════════════════════════════════
-- PART 9 — LIVE CALL STATE  (idempotent; safe to re-run)
--
-- The Live Monitor could not tell "ringing" from "connected": a call sat in one
-- lumped "in progress" state from the moment it was placed until something
-- finalized it — which, for a homeowner who never picked up, could be twelve
-- minutes later or never. Twilio always knew the difference. We just never asked
-- it, and had nowhere to put the answer.
--
-- The lifecycle is now monotonic and can only move forward:
--   initiated ──► ringing ──► in_progress ──► completed | failed
--   (placed)     (their      (they picked    (terminal, with an outcome)
--                 phone is    up — the talk
--                 ringing)    timer starts here)
-- ═════════════════════════════════════════════════════════════════════════════

-- ringing_at / connected_at are the moments Twilio reported each transition.
-- connected_at is what the on-call timer counts from: it previously counted from
-- started_at, so a call that was merely ringing already displayed a running talk
-- duration, which is precisely the lie this fixes.
alter table public.ai_conversations add column if not exists ringing_at   timestamptz;
alter table public.ai_conversations add column if not exists connected_at timestamptz;

-- The homeowner's Twilio leg (bridge mode). The status webhook arrives carrying
-- only a CallSid; without this column we cannot map it back to a conversation
-- when the query param is lost, and the event is discarded.
alter table public.ai_conversations add column if not exists customer_call_sid text;

create index if not exists ai_conversations_customer_sid_idx
  on public.ai_conversations (customer_call_sid)
  where customer_call_sid is not null;

-- CRITICAL: the stuck-call reconciler finds work through this partial index. It
-- was `state in ('initiated','in_progress')`. Adding a 'ringing' state without
-- adding it here would make every ringing call INVISIBLE to the reconciler — the
-- exact class of "stuck forever" bug this whole change exists to kill. The index
-- must be recreated, not just re-declared: `create index if not exists` is a
-- no-op against the old definition and would silently leave the gap open.
drop index if exists public.ai_conversations_stuck_idx;
create index ai_conversations_stuck_idx
  on public.ai_conversations (state, started_at)
  where state in ('initiated', 'ringing', 'in_progress');

-- Human calls get the same treatment. 'calling' is the pre-ring state (we've
-- asked Twilio to dial, the phone isn't ringing yet); connected_at again anchors
-- the talk timer instead of started_at.
--   calling ──► ringing ──► connected  (row is deleted on hangup)
alter table public.live_calls add column if not exists connected_at timestamptz;
comment on column public.live_calls.state is 'calling | ringing | connected';

-- Which lead actually picked up, in a parallel ("3X") dial. One room has N legs;
-- the losing legs are force-released and report `completed`/`canceled` moments
-- after the winner answers. Without knowing WHICH leg answered, a losing leg's
-- terminal event would delete the row and yank a live, connected call off the
-- monitor while the rep is still talking. We only end the row on a terminal event
-- for the leg recorded here.
alter table public.live_calls add column if not exists answered_lead_id text;

-- ═════════════════════════════════════════════════════════════════════════════
-- PART 11 — LIVE USER PRESENCE  (idempotent; safe to re-run)
--
-- The manager-level Team Status roster needs to know who is currently active —
-- not just who's on a call. `live_calls` only has a row while a call is ringing
-- or connected (deleted on hangup), so an idle-but-present rep is invisible to
-- it. This is presence, one row per USER (upserted on every heartbeat from the
-- dialer), not per call — status mirrors DialerStatus (idle | dialing | live |
-- wrapup | ai) and is simply overwritten as the rep moves between states.
--
-- Same trust model as `live_calls`: RLS on, no policies. The server (service
-- role) writes the caller's OWN row (identity from the session, never the
-- client) and reads scoped to the viewer's org + monitor.roster permission,
-- both enforced in application code. name/role are intentionally NOT stored
-- here — the read side joins organization_members so a display-name change
-- can't leave a stale row behind.
-- ═════════════════════════════════════════════════════════════════════════════
create table if not exists public.user_presence (
  user_id         uuid primary key,
  org_id          uuid,
  status          text not null default 'idle',   -- idle | dialing | live | wrapup | ai
  lead_name       text,
  lead_city       text,
  lead_phone      text,
  ai_active_count int not null default 0,
  updated_at      timestamptz not null default now(), -- last heartbeat (staleness)
  status_since    timestamptz not null default now()  -- when `status` last CHANGED (roster timer)
);
create index if not exists user_presence_org_idx on public.user_presence (org_id, updated_at desc);
alter table public.user_presence enable row level security;

-- Atomic upsert that preserves `status_since` when the status hasn't actually
-- changed (a heartbeat every ~20s would otherwise reset a "Live · 4:12" timer
-- back to :00 on every tick). A plain client-side .upsert() can't express this
-- "keep old value unless X changed" logic in one round trip without a race
-- between concurrent heartbeats, so it's a function like app_next_dial_seq.
create or replace function public.app_upsert_presence(
  p_user_id uuid,
  p_org_id uuid,
  p_status text,
  p_lead_name text,
  p_lead_city text,
  p_lead_phone text,
  p_ai_active_count int
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.user_presence
    (user_id, org_id, status, lead_name, lead_city, lead_phone, ai_active_count, updated_at, status_since)
  values
    (p_user_id, p_org_id, p_status, p_lead_name, p_lead_city, p_lead_phone, p_ai_active_count, now(), now())
  on conflict (user_id) do update set
    org_id           = excluded.org_id,
    status           = excluded.status,
    lead_name        = excluded.lead_name,
    lead_city        = excluded.lead_city,
    lead_phone       = excluded.lead_phone,
    ai_active_count  = excluded.ai_active_count,
    updated_at       = now(),
    status_since     = case
                          when public.user_presence.status = excluded.status
                          then public.user_presence.status_since
                          else now()
                        end;
end;
$$;

grant execute on function public.app_upsert_presence(uuid, uuid, text, text, text, text, int)
  to service_role;
-- CREATE FUNCTION grants PUBLIC execute by default — the grant above is
-- additive, not a replacement. Unlike app_next_dial_seq (an arbitrary atomic
-- counter, safe for anon/authenticated), this function trusts p_user_id /
-- p_org_id with no auth.uid() check, so it must ONLY ever be reachable via the
-- service-role client. Revoke the implicit PUBLIC grant explicitly.
revoke execute on function public.app_upsert_presence(uuid, uuid, text, text, text, text, int) from public;
revoke execute on function public.app_upsert_presence(uuid, uuid, text, text, text, text, int) from anon;
revoke execute on function public.app_upsert_presence(uuid, uuid, text, text, text, text, int) from authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- PART 12 — APPOINTMENTS & CALENDAR  (idempotent; safe to re-run)
--
-- The appointments table was a flat list: a lead name, a nullable timestamp, a
-- status. That is enough to render a list and nothing else. A calendar needs an
-- END time (duration), a PLACE, a person it belongs to that is distinct from the
-- person who booked it, and a memory of what it used to be. It also needs to be
-- able to exist WITHOUT a call behind it — a manager scheduling a review by hand.
--
-- ── The one invariant everything here depends on ────────────────────────────
-- `scheduled_at` is declared timestamptz but it is NOT a true instant. It is a
-- FLOATING WALL-CLOCK time: the app writes an offset-less string
-- ("2026-06-23T18:00:00"), Postgres reads it as UTC, and the app strips the +00
-- again on the way out (`toFloatingLocal`). "6pm" means 6pm on whatever wall
-- clock the appointment belongs to — which is what `timezone` now records.
--
-- Do NOT "fix" this into real UTC without backfilling every existing row and
-- rewriting every reader. It is deliberate, it is consistent, and a half-done
-- migration would silently shift every appointment in the database by hours.
-- The single source of truth for reading/writing it is src/lib/appointments/time.ts.
--
-- `scheduled_at` is also NULLABLE and always will be — an AI call that books
-- "sometime next week" has a label and no timestamp. Those rows live in the
-- "later" bucket and never appear on the grid.
-- ═════════════════════════════════════════════════════════════════════════════
alter table public.appointments add column if not exists duration_min     int not null default 60;
alter table public.appointments add column if not exists location         text default '';
alter table public.appointments add column if not exists timezone         text;
alter table public.appointments add column if not exists assigned_to      uuid references auth.users (id) on delete set null;
alter table public.appointments add column if not exists created_by       uuid references auth.users (id) on delete set null;
alter table public.appointments add column if not exists call_record_id   uuid references public.call_records (id) on delete set null;
alter table public.appointments add column if not exists title            text default '';
alter table public.appointments add column if not exists cancel_reason    text;
alter table public.appointments add column if not exists rescheduled_from timestamptz;
alter table public.appointments add column if not exists reschedule_count int not null default 0;
alter table public.appointments add column if not exists notified_at      timestamptz;
alter table public.appointments add column if not exists updated_at       timestamptz not null default now();

-- The calendar's only range query: "every appointment in this org between X and Y".
create index if not exists appointments_calendar_idx on public.appointments (org_id, scheduled_at);
-- The per-rep calendar filter (a rep's own day/week).
create index if not exists appointments_assigned_idx on public.appointments (assigned_to, scheduled_at);

-- Every pre-existing row belongs to whoever booked it.
update public.appointments set assigned_to = owner_id where assigned_to is null;

-- Fill in the derivable columns so app code can never forget them: an unassigned
-- appointment belongs to its owner, and its wall clock is the lead's timezone.
create or replace function public.appointments_before_write()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.assigned_to is null then
    new.assigned_to := new.owner_id;
  end if;
  if coalesce(new.timezone, '') = '' and new.lead_id is not null then
    new.timezone := nullif((select timezone from public.leads where id = new.lead_id), '');
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists appointments_before_write on public.appointments;
create trigger appointments_before_write before insert or update on public.appointments
  for each row execute function public.appointments_before_write();

-- ═════════════════════════════════════════════════════════════════════════════
-- PART 13 — NOTIFICATION OUTBOX  (idempotent; safe to re-run)
--
-- "Email the sales lead whenever an appointment is set, and never fail silently."
--
-- The enqueue is a TRIGGER, not application code, and that is the whole point.
-- supabase-js has no transactions: an app-level "insert the appointment, then
-- insert the outbox row" can lose the second write to a cold lambda, a network
-- blip, or an unhandled throw — and a dropped notification is exactly what this
-- feature exists to prevent. A trigger is atomic with the INSERT by construction,
-- and it cannot be forgotten by whatever new booking path someone adds next year.
--
-- WHEN it fires is a product decision, not a technical one:
--   • INSERT with approved = true          → the rep booked it. It's real. Send.
--   • UPDATE approved false → true         → a human approved the AI's proposal.
--                                            THAT is when an AI booking becomes
--                                            real. Firing on the AI's raw proposal
--                                            would email a guess.
--   • scheduled_at changed, already notified → rescheduled. Tell them.
--   • status → cancelled, already notified   → cancelled. Tell them.
-- `notified_at` makes "set" at-most-once, so a re-approve can't double-send.
--
-- The trigger records only WHAT happened and the data to render it. WHO receives
-- it is resolved at SEND time by the drain (org settings → APPOINTMENT_NOTIFY_EMAILS
-- env fallback), because Postgres cannot see the app's environment.
--
-- Same trust model as user_presence: RLS on, NO policies. Service-role only,
-- org-scoped in application code.
-- ═════════════════════════════════════════════════════════════════════════════
create table if not exists public.notification_outbox (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid references public.organizations (id) on delete cascade,
  -- appointment_set | appointment_rescheduled | appointment_cancelled
  kind            text not null,
  appointment_id  uuid references public.appointments (id) on delete cascade,
  -- Everything the email needs, snapshotted at enqueue time. The drain does no joins.
  payload         jsonb not null default '{}'::jsonb,
  -- pending → sent | failed (retries exhausted) | skipped (nobody to email — benign)
  status          text not null default 'pending',
  attempts        int not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error      text,
  sent_at         timestamptz,
  provider_id     text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- The drain's ONLY query — "what is due?". Partial so it stays tiny no matter how
-- many thousands of sent rows accumulate behind it.
create index if not exists notification_outbox_due_idx
  on public.notification_outbox (next_attempt_at)
  where status = 'pending';
-- The alert surfaces ("has anything failed for this org?") and the audit trail.
create index if not exists notification_outbox_org_idx
  on public.notification_outbox (org_id, status, created_at desc);

alter table public.notification_outbox enable row level security;

create or replace function public.enqueue_appointment_notification()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  k text;
  l record;
begin
  -- Our own `set notified_at` UPDATE below re-enters this trigger. Bail out of any
  -- nested invocation rather than relying on the branch conditions to be a fixed
  -- point — cheaper to reason about, and it can't loop.
  if pg_trigger_depth() > 1 then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.approved and new.status = 'scheduled' then
      k := 'appointment_set';
    end if;
  else
    if new.status = 'cancelled' and coalesce(old.status, '') <> 'cancelled'
       and old.notified_at is not null then
      k := 'appointment_cancelled';
    elsif new.approved and not coalesce(old.approved, false)
          and new.status = 'scheduled' and old.notified_at is null then
      k := 'appointment_set';
    elsif old.notified_at is not null and new.status = 'scheduled'
          and new.scheduled_at is distinct from old.scheduled_at then
      k := 'appointment_rescheduled';
    end if;
  end if;

  if k is null then
    return new;
  end if;

  select first_name, last_name, phone, email, address, city, state, zip,
         utility_bill, solar_payment, utility_provider
    into l
    from public.leads
   where id = new.lead_id;

  insert into public.notification_outbox (org_id, kind, appointment_id, payload)
  values (
    new.org_id,
    k,
    new.id,
    jsonb_build_object(
      'appointmentId',  new.id,
      'ownerId',        new.owner_id,
      'assignedTo',     new.assigned_to,
      'leadId',         new.lead_id,
      'leadName',       coalesce(nullif(new.lead_name, ''), 'Homeowner'),
      -- Serialize the floating wall clock back out EXACTLY as the app stores it:
      -- read the timestamptz as UTC and drop the offset. See the PART 12 invariant.
      'scheduledAt',    case when new.scheduled_at is null then null
                             else to_char(new.scheduled_at at time zone 'UTC',
                                          'YYYY-MM-DD"T"HH24:MI:SS') end,
      'previousAt',     case when old is null or old.scheduled_at is null then null
                             else to_char(old.scheduled_at at time zone 'UTC',
                                          'YYYY-MM-DD"T"HH24:MI:SS') end,
      'scheduledLabel', coalesce(new.scheduled_label, ''),
      'durationMin',    new.duration_min,
      'timezone',       coalesce(new.timezone, ''),
      'location',       coalesce(new.location, ''),
      'notes',          coalesce(new.notes, ''),
      'source',         new.source,
      'status',         new.status,
      'cancelReason',   coalesce(new.cancel_reason, ''),
      'phone',          coalesce(l.phone, ''),
      'email',          coalesce(l.email, ''),
      'address',        coalesce(l.address, ''),
      'city',           coalesce(l.city, ''),
      'state',          coalesce(l.state, ''),
      'zip',            coalesce(l.zip, ''),
      'utilityBill',    l.utility_bill,
      'solarPayment',   l.solar_payment,
      'utilityProvider', coalesce(l.utility_provider, '')
    )
  );

  -- Mark it notified so a later reschedule/cancel knows there's something to
  -- correct, and so a second approve can't re-send the booking. The guard makes
  -- this a no-op (and fires no trigger) for the reschedule/cancel kinds.
  if k = 'appointment_set' then
    update public.appointments set notified_at = now()
     where id = new.id and notified_at is null;
  end if;

  return new;
end;
$$;

drop trigger if exists enqueue_appointment_notification on public.appointments;
create trigger enqueue_appointment_notification
  after insert or update on public.appointments
  for each row execute function public.enqueue_appointment_notification();

-- CREATE FUNCTION grants PUBLIC execute by default, which publishes both trigger
-- functions at /rest/v1/rpc/<name> for anon and authenticated. Postgres refuses to
-- run a trigger function as an ordinary call ("can only be called as a trigger"),
-- so this is not exploitable — but they are SECURITY DEFINER, they have no business
-- being in the public API surface, and the linter is right to flag them. Same
-- treatment as app_upsert_presence above.
revoke execute on function public.appointments_before_write() from public;
revoke execute on function public.appointments_before_write() from anon;
revoke execute on function public.appointments_before_write() from authenticated;
revoke execute on function public.enqueue_appointment_notification() from public;
revoke execute on function public.enqueue_appointment_notification() from anon;
revoke execute on function public.enqueue_appointment_notification() from authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- PART 13 — ASSIGNED-REP DIAL ROUTING  (idempotent; safe to re-run)
--
-- `assigned_rep_id` already existed on `leads` but nothing ever read it. It now
-- routes leads into a rep's dial queue + Leads tab NON-DESTRUCTIVELY: a rep's
-- scope became `owner_id = me OR assigned_rep_id = me` (getDialQueue / getLeads),
-- so a supervisor can hand a bulk-imported list to a rep without rewriting who
-- uploaded it. That OR-scan filters on this column on every rep load, so index it
-- (it was an unindexed text column). Partial — only assigned rows are of interest.
-- ═════════════════════════════════════════════════════════════════════════════
create index if not exists leads_assigned_rep_idx
  on public.leads (assigned_rep_id) where assigned_rep_id is not null;

-- ═════════════════════════════════════════════════════════════════════════════
-- PART 14 — LEAD GEOGRAPHY GROUPS  (idempotent; safe to re-run)
--
-- Five fixed intake groups: fresno | houston | dallas | california | manual.
-- NULL means "unsorted" — reachable ONLY via the AI auto-sort path, for a lead
-- that doesn't clearly match one of the 4 geographic buckets. The AI classifier
-- never writes 'manual' (enforced by its JSON schema's enum in
-- src/lib/ai/geo-classify.ts, not just prompt wording) — that bucket exists
-- only for a human to file a lead into on purpose.
--
-- Orthogonal to campaign_id: campaigns are named/scoped by UTILITY PROVIDER
-- (e.g. "PG&E True-Up Recovery"), a different axis from geography — a lead
-- carries both a group and a campaign at once.
-- ═════════════════════════════════════════════════════════════════════════════
alter table public.leads add column if not exists lead_group text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'leads_lead_group_check') then
    alter table public.leads
      add constraint leads_lead_group_check
      check (lead_group in ('fresno','houston','dallas','california','manual'));
  end if;
end $$;

create index if not exists leads_lead_group_idx
  on public.leads (lead_group) where lead_group is not null;

-- ═════════════════════════════════════════════════════════════════════════════
-- PART 15 — AI AGENT ATTRIBUTION  (idempotent; safe to re-run)
--
-- Which AI persona ("primary" = Agent 1, "secondary" = Agent 2) placed a call,
-- and therefore closed any appointment it books. Stamped on the conversation at
-- placement (ai-dialer → seedAIConversation) and copied onto the appointment
-- when the booking is filed (routeDisposition), so the Appointments tab can be
-- split into a tab per agent. Null on rep-booked reviews and on legacy AI rows
-- from before this column existed (those simply appear only under "All").
-- ═════════════════════════════════════════════════════════════════════════════
alter table public.ai_conversations add column if not exists agent_key text;
alter table public.appointments     add column if not exists agent_key text;
create index if not exists appointments_agent_idx
  on public.appointments (org_id, agent_key) where agent_key is not null;

-- ═════════════════════════════════════════════════════════════════════════════
-- PART 16 — LEGAL ACCEPTANCE + CAMPAIGN COMPLIANCE CERTIFICATION
--           (idempotent; safe to re-run)
--
-- Two distinct compliance controls, deliberately kept in separate tables:
--
--   legal_acceptances       — the account-level clickwrap: "I agree to the
--                             Terms of Service / Privacy Policy / Acceptable
--                             Use Policy", captured once at signup with the
--                             audit trail a real dispute would need (who, what
--                             exact text, what version, from where, when).
--                             Append-only — never updated or deleted. A new
--                             row is added if a user re-accepts a bumped
--                             version; history is never overwritten.
--
--   campaign_certifications — the PER-CAMPAIGN (or org-wide "no campaign"
--                             bucket, campaign_id null) certification that a
--                             specific list of numbers has been legally
--                             vetted. Re-required whenever CAMPAIGN_CERT_VERSION
--                             bumps. This is what makes it possible to show a
--                             customer certified responsibility for THIS
--                             specific campaign, not just the platform in
--                             general months earlier.
--
-- Service-role only (RLS on, no policies): both are written exclusively by the
-- server AFTER an application-code auth/permission check (getUser() /
-- getScope()), exactly like audit_log and dial_counters above.
-- ═════════════════════════════════════════════════════════════════════════════
create table if not exists public.legal_acceptances (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid references auth.users (id) on delete set null,
  email            text not null default '',
  -- Filled in later if/when the user creates or joins an org — nothing about
  -- a business exists yet at the moment of account creation.
  org_id           uuid references public.organizations (id) on delete set null,
  business_name    text default '',
  terms_version    text not null,
  privacy_version  text not null,
  aup_version      text not null,
  -- The EXACT checkbox label shown, verbatim — proof of what was agreed to,
  -- independent of whatever the copy says today.
  acceptance_text  text not null,
  ip_address       text default '',
  user_agent       text default '',
  created_at       timestamptz not null default now()
);
create index if not exists legal_acceptances_user_idx on public.legal_acceptances (user_id, created_at desc);
alter table public.legal_acceptances enable row level security;

-- No uniqueness constraint on (org_id, campaign_id, version) on purpose: a
-- plain `unique` column set treats two NULL campaign_ids as distinct (standard
-- SQL), so it would silently fail to dedupe the org-wide "no campaign" bucket
-- anyway. A second certification row for the same campaign isn't a bug worth
-- a partial-index workaround for — it's harmless (the gate only checks
-- whether AT LEAST ONE current-version row exists) and arguably better audit
-- history: several people certifying the same campaign over time is real
-- signal, not noise.
create table if not exists public.campaign_certifications (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations (id) on delete cascade,
  -- null = the org-wide "no campaign" bucket (ad-hoc / manual-group imports).
  campaign_id   uuid references public.campaigns (id) on delete cascade,
  certified_by  uuid references auth.users (id) on delete set null,
  version       text not null,
  cert_text     text not null,
  created_at    timestamptz not null default now()
);
create index if not exists campaign_certifications_org_idx
  on public.campaign_certifications (org_id, campaign_id, version);
alter table public.campaign_certifications enable row level security;

-- ═════════════════════════════════════════════════════════════════════════════
-- PART 17 — ORG-DEFINED LEAD GROUPS + LEAD PACKS  (idempotent; safe to re-run)
--
-- Generalizes PART 14. `lead_group` used to be five hardcoded geographic buckets
-- (fresno/houston/dallas/california/manual) enforced by a CHECK constraint and
-- shared by every tenant, with per-org settings able to RENAME them but never
-- change what they were. A workspace whose book isn't Californian or Texan had
-- to file everything into someone else's taxonomy.
--
-- Two tables now:
--
--   lead_groups — the buckets THIS org sorts into, created by its own admins.
--     `description` is the plain-English rule the AI classifier sorts against
--     ("Dallas/Fort Worth area codes and cities"), so a group means whatever the
--     org says it means. `kind` is load-bearing:
--       'sorted' — the AI may assign leads here.
--       'manual' — a human files leads here on purpose; the AI NEVER assigns it
--                  (enforced by omitting it from the classifier's enum, exactly
--                  as the old geo classifier excluded 'manual').
--
--   lead_packs — numbered slices of ONE upload ("Jan list · Pack 7"), so a
--     10,000-row file can be handed out 100 at a time. Deliberately a SEPARATE
--     axis from groups: a lead has both, so "the North Texas leads in Pack 7"
--     is answerable and packs can be dealt to reps without disturbing grouping.
--
-- leads.lead_group stays TEXT holding a group key (not a uuid FK) so the 7,614
-- already-grouped rows keep working untouched and the legacy keys stay valid;
-- validity is enforced in application code against this org's rows, the same
-- way the rest of the app scopes by org. The old CHECK is dropped because it
-- would reject every custom key.
-- ═════════════════════════════════════════════════════════════════════════════

create table if not exists public.lead_groups (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  key         text not null,
  label       text not null,
  description text not null default '',
  kind        text not null default 'sorted' check (kind in ('sorted','manual')),
  sort_order  int  not null default 0,
  created_at  timestamptz not null default now(),
  unique (org_id, key)
);
create index if not exists lead_groups_org_idx on public.lead_groups (org_id, sort_order);
alter table public.lead_groups enable row level security;

create table if not exists public.lead_packs (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  batch       text not null default '',
  seq         int  not null default 1,
  label       text not null,
  size        int  not null default 0,
  created_by  uuid,
  created_at  timestamptz not null default now()
);
create index if not exists lead_packs_org_idx on public.lead_packs (org_id, created_at desc);
alter table public.lead_packs enable row level security;

alter table public.leads
  add column if not exists lead_pack_id uuid references public.lead_packs(id) on delete set null;
create index if not exists leads_lead_pack_idx
  on public.leads (lead_pack_id) where lead_pack_id is not null;

-- The five fixed keys are no longer the only legal values.
alter table public.leads drop constraint if exists leads_lead_group_check;

-- Seed every existing org with the legacy buckets so nothing an org already
-- filed becomes an orphan key, and so a workspace that never opens the new
-- admin screen behaves exactly as it did before.
insert into public.lead_groups (org_id, key, label, description, kind, sort_order)
select o.id, g.key, g.label, g.description, g.kind, g.sort_order
from public.organizations o
cross join (values
  ('fresno',     'Fresno',        'Fresno metro: Fresno, Clovis, Sanger, Selma and nearby Central Valley cities; ZIPs 936-937.', 'sorted', 0),
  ('houston',    'Houston',       'Houston metro: Houston, Sugar Land, Pearland, Katy, Spring, The Woodlands; ZIPs 770-775.',    'sorted', 1),
  ('dallas',     'Dallas',        'Dallas/Fort Worth metro: Dallas, Plano, Irving, Garland, Richardson; ZIPs 750-753.',          'sorted', 2),
  ('california', 'California',    'Any other California lead not in the Fresno metro.',                                          'sorted', 3),
  ('manual',     'Manual Dialing','Leads a human files here on purpose to dial by hand.',                                        'manual', 4)
) as g(key, label, description, kind, sort_order)
on conflict (org_id, key) do nothing;

-- RLS. Enabling RLS with NO policies denies everything to the session client,
-- which would have made every custom group invisible (listLeadGroups would fall
-- back to the legacy five and an admin's new group would simply never appear).
-- Members read their org's groups and packs; supervisors write them. Writes also
-- go through the service-role client after an application permission check, so
-- these are the second lock, not the only one.
drop policy if exists "lead_groups read" on public.lead_groups;
create policy "lead_groups read" on public.lead_groups for select using (
  app_is_superadmin() or (app_is_active() and app_is_org_member(org_id))
);
drop policy if exists "lead_groups write" on public.lead_groups;
create policy "lead_groups write" on public.lead_groups for all
  using (app_is_superadmin() or (app_is_active() and app_is_org_supervisor(org_id)))
  with check (app_is_superadmin() or (app_is_active() and app_is_org_supervisor(org_id)));

drop policy if exists "lead_packs read" on public.lead_packs;
create policy "lead_packs read" on public.lead_packs for select using (
  app_is_superadmin() or (app_is_active() and app_is_org_member(org_id))
);
drop policy if exists "lead_packs write" on public.lead_packs;
create policy "lead_packs write" on public.lead_packs for all
  using (app_is_superadmin() or (app_is_active() and app_is_org_supervisor(org_id)))
  with check (app_is_superadmin() or (app_is_active() and app_is_org_supervisor(org_id)));

-- ═════════════════════════════════════════════════════════════════════════════
-- PART: RLS READ LOCKDOWN (P0.4)
--
-- Placed at the END so every helper function (app_is_org_member, app_active_org,
-- app_is_superadmin) already exists. The original "orgs read"/"companies read"
-- policies above used `using (auth.uid() is not null)`, which let ANY signed-in
-- user read EVERY tenant's row via the public anon key — leaking each org's
-- join_code, caller IDs, AI system prompt, notification emails and billing.
-- These tightened policies override them (drop + recreate). Kept in sync with
-- supabase/rls-lockdown.sql.
-- ═════════════════════════════════════════════════════════════════════════════

-- Onboarding directory of joinable orgs — only non-sensitive columns. SECURITY
-- DEFINER so it works under the tightened organizations policy below.
create or replace function public.app_list_joinable_orgs()
returns table (id uuid, name text, industry text, slug text, require_approval boolean)
language sql stable security definer set search_path = public as $$
  select id, name, industry, slug, coalesce(require_approval, true)
  from public.organizations
  where status = 'active' and coalesce(allow_join, true) = true
  order by name asc;
$$;
grant execute on function public.app_list_joinable_orgs() to anon, authenticated;

-- Organizations: your active org (covers the member-row-less resilience bridge),
-- orgs you're an active member of (the Hub), or superadmin.
drop policy if exists "orgs read" on public.organizations;
create policy "orgs read" on public.organizations for select using (
  public.app_is_superadmin()
  or id = public.app_active_org()
  or public.app_is_org_member(id)
);

-- Companies: members of the company's org (or your active org) only.
drop policy if exists "companies read" on public.companies;
create policy "companies read" on public.companies for select using (
  public.app_is_superadmin()
  or org_id = public.app_active_org()
  or public.app_is_org_member(org_id)
);

-- Leads read/update: scope the shared-pool branch to the caller's ACTIVE org, so
-- a dual-org member can't reach the OTHER org's leads while active in one.
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

-- ═════════════════════════════════════════════════════════════════════════════
-- PART: DO-NOT-CALL / SUPPRESSION (P1). Kept in sync with supabase/dnc.sql.
-- Phone-number-level suppression per org, written on every do_not_call
-- disposition (and inbound SMS STOP) and scrubbed at every dial path + on import.
-- ═════════════════════════════════════════════════════════════════════════════
create table if not exists public.dnc_numbers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  phone_digits text not null,
  reason text,
  source text,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (org_id, phone_digits)
);
create index if not exists dnc_numbers_org_phone_idx
  on public.dnc_numbers (org_id, phone_digits);

alter table public.dnc_numbers enable row level security;
drop policy if exists "dnc read" on public.dnc_numbers;
create policy "dnc read" on public.dnc_numbers for select using (
  public.app_is_superadmin() or (public.app_is_active() and public.app_is_org_member(org_id))
);
