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
create index if not exists call_records_org_idx     on public.call_records (org_id, started_at desc);
create index if not exists appointments_org_idx     on public.appointments (org_id, created_at desc);
create index if not exists callbacks_org_idx        on public.callbacks (org_id);
create index if not exists ai_conversations_org_idx on public.ai_conversations (org_id, started_at desc);
create index if not exists campaigns_org_idx        on public.campaigns (org_id);

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
    owner_id = auth.uid()
    or (org_id is not null and public.app_is_org_supervisor(org_id)))));
create policy "call_records write" on public.call_records for all
  using (public.app_is_superadmin() or (public.app_is_active() and owner_id = auth.uid()))
  with check (public.app_is_superadmin() or (public.app_is_active() and owner_id = auth.uid()));

-- appointments
drop policy if exists "appointments owner" on public.appointments;
drop policy if exists "appointments read" on public.appointments;
drop policy if exists "appointments write" on public.appointments;
create policy "appointments read" on public.appointments for select using (
  public.app_is_superadmin() or (public.app_is_active() and (
    owner_id = auth.uid()
    or (org_id is not null and public.app_is_org_supervisor(org_id)))));
create policy "appointments write" on public.appointments for all
  using (public.app_is_superadmin() or (public.app_is_active() and owner_id = auth.uid()))
  with check (public.app_is_superadmin() or (public.app_is_active() and owner_id = auth.uid()));

-- callbacks
drop policy if exists "callbacks owner" on public.callbacks;
drop policy if exists "callbacks read" on public.callbacks;
drop policy if exists "callbacks write" on public.callbacks;
create policy "callbacks read" on public.callbacks for select using (
  public.app_is_superadmin() or (public.app_is_active() and (
    owner_id = auth.uid()
    or (org_id is not null and public.app_is_org_supervisor(org_id)))));
create policy "callbacks write" on public.callbacks for all
  using (public.app_is_superadmin() or (public.app_is_active() and owner_id = auth.uid()))
  with check (public.app_is_superadmin() or (public.app_is_active() and owner_id = auth.uid()));

-- ai_conversations
drop policy if exists "ai_conversations owner" on public.ai_conversations;
drop policy if exists "ai_conversations read" on public.ai_conversations;
drop policy if exists "ai_conversations write" on public.ai_conversations;
create policy "ai_conversations read" on public.ai_conversations for select using (
  public.app_is_superadmin() or (public.app_is_active() and (
    owner_id = auth.uid()
    or (org_id is not null and public.app_is_org_supervisor(org_id)))));
create policy "ai_conversations write" on public.ai_conversations for all
  using (public.app_is_superadmin() or (public.app_is_active() and owner_id = auth.uid()))
  with check (public.app_is_superadmin() or (public.app_is_active() and owner_id = auth.uid()));

-- campaigns
drop policy if exists "campaigns owner" on public.campaigns;
drop policy if exists "campaigns read" on public.campaigns;
drop policy if exists "campaigns write" on public.campaigns;
create policy "campaigns read" on public.campaigns for select using (
  public.app_is_superadmin() or (public.app_is_active() and (
    owner_id = auth.uid()
    or (org_id is not null and public.app_is_org_supervisor(org_id)))));
create policy "campaigns write" on public.campaigns for all
  using (public.app_is_superadmin() or (public.app_is_active() and owner_id = auth.uid()))
  with check (public.app_is_superadmin() or (public.app_is_active() and owner_id = auth.uid()));

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

-- Read: any active member of the lead's org (shared pool), the owner, or superadmin.
create policy "leads read" on public.leads for select using (
  public.app_is_superadmin() or (public.app_is_active() and (
    owner_id = auth.uid()
    or (org_id is not null and public.app_is_org_member(org_id)))));

-- Insert: you create leads you own (the stamp_org_id trigger fills org_id).
create policy "leads insert" on public.leads for insert with check (
  public.app_is_superadmin() or (public.app_is_active() and owner_id = auth.uid()));

-- Update: any active org member (so any rep can disposition any shared lead).
create policy "leads update" on public.leads for update
  using (public.app_is_superadmin() or (public.app_is_active() and (
    owner_id = auth.uid()
    or (org_id is not null and public.app_is_org_member(org_id)))))
  with check (public.app_is_superadmin() or (public.app_is_active() and (
    owner_id = auth.uid()
    or (org_id is not null and public.app_is_org_member(org_id)))));

-- Delete: the owner, or a supervisor (manager/admin/owner) of the lead's org.
create policy "leads delete" on public.leads for delete using (
  public.app_is_superadmin() or (public.app_is_active() and (
    owner_id = auth.uid()
    or (org_id is not null and public.app_is_org_supervisor(org_id)))));

-- ─────────────────────────────────────────────────────────────────────────────
-- PART 9 — Caller-ID rotation
--
-- A shared, atomic per-org counter so manual + AI calls cycle through the org's
-- pool of outbound numbers together (the pool + cadence live in
-- organizations.settings.dialing). app_next_dial_seq() returns the next value
-- atomically, so concurrent power-dials never collide on the same sequence.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.organizations
  add column if not exists dial_seq bigint not null default 0;

create or replace function public.app_next_dial_seq(p_org uuid)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare v bigint;
begin
  update public.organizations
     set dial_seq = coalesce(dial_seq, 0) + 1
   where id = p_org
   returning dial_seq into v;
  return coalesce(v, 0);
end;
$$;

grant execute on function public.app_next_dial_seq(uuid)
  to anon, authenticated, service_role;
