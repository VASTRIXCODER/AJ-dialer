-- ═════════════════════════════════════════════════════════════════════════════
-- DO-NOT-CALL / SUPPRESSION (P1) — run once in the Supabase SQL editor.
--
-- Before this, "do not call" existed only as a per-LEAD-ROW status, so the same
-- homeowner on a second row (a re-import, another campaign, another rep's list)
-- was fully dialable, and deleting the lead destroyed the only record of the
-- request. This is a phone-number-level suppression list, scoped per org: it is
-- written on every do_not_call disposition (and, later, on an inbound SMS STOP)
-- and scrubbed at every dial path + on import.
--
-- Idempotent; folded into schema.sql.
-- ═════════════════════════════════════════════════════════════════════════════

create table if not exists public.dnc_numbers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  -- Last 10 digits (NANP), so formatting differences never split one number.
  phone_digits text not null,
  reason text,
  -- Where it came from: 'rep_disposition' | 'ai_disposition' | 'sms_stop' |
  -- 'import' | 'manual'.
  source text,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (org_id, phone_digits)
);
create index if not exists dnc_numbers_org_phone_idx
  on public.dnc_numbers (org_id, phone_digits);

-- Members of the org may READ their suppression list (the Admin screen). All
-- WRITES go through the service-role client after an application-code check
-- (exactly like leads assignment / org settings).
alter table public.dnc_numbers enable row level security;
drop policy if exists "dnc read" on public.dnc_numbers;
create policy "dnc read" on public.dnc_numbers for select using (
  public.app_is_superadmin() or (public.app_is_active() and public.app_is_org_member(org_id))
);
