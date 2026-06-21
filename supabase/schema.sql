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

