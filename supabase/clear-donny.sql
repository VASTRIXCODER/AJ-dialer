-- Run this in the Supabase SQL editor to wipe all data for the Donny organisation.
-- It deletes records scoped to Donny's org_id but leaves the org row itself intact.
do $$
declare
  donny_id uuid;
begin
  select id into donny_id from public.organizations where slug = 'donny';
  if donny_id is null then
    raise exception 'Donny organisation not found';
  end if;

  delete from public.call_records     where org_id = donny_id;
  delete from public.ai_conversations where org_id = donny_id;
  delete from public.appointments     where org_id = donny_id;
  delete from public.callbacks        where org_id = donny_id;
  delete from public.leads            where org_id = donny_id;
end $$;
