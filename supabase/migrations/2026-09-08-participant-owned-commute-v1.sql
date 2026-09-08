-- Commute V1: private participant destinations and address-bound coordinates.
-- Route results are intentionally not stored.

alter table public.homes
  add column if not exists coordinate_address_fingerprint text,
  add column if not exists coordinate_status text not null default 'unresolved',
  add column if not exists coordinate_source text;

create table if not exists public.commute_destinations (
  id uuid primary key default gen_random_uuid(),
  search_id uuid not null references public.searches(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  label text not null check (char_length(btrim(label)) between 1 and 80),
  address text not null check (char_length(btrim(address)) between 1 and 500),
  max_drive_minutes integer check (max_drive_minutes between 1 and 1440),
  latitude numeric,
  longitude numeric,
  coordinate_address_fingerprint text,
  coordinate_status text not null default 'unresolved'
    check (coordinate_status in ('unresolved', 'resolved', 'invalid', 'ambiguous', 'unavailable')),
  coordinate_source text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists commute_destinations_user_search_idx
  on public.commute_destinations(user_id, search_id);
create unique index if not exists commute_destinations_legacy_dedupe_idx
  on public.commute_destinations(user_id, search_id, lower(btrim(label)), lower(btrim(address)));

alter table public.commute_destinations enable row level security;

drop policy if exists "commute_destinations_select_own" on public.commute_destinations;
create policy "commute_destinations_select_own" on public.commute_destinations
  for select using (auth.uid() = user_id and public.can_access_search(search_id, auth.uid()));
drop policy if exists "commute_destinations_insert_own" on public.commute_destinations;
create policy "commute_destinations_insert_own" on public.commute_destinations
  for insert with check (auth.uid() = user_id and public.can_access_search(search_id, auth.uid()));
drop policy if exists "commute_destinations_update_own" on public.commute_destinations;
create policy "commute_destinations_update_own" on public.commute_destinations
  for update using (auth.uid() = user_id and public.can_access_search(search_id, auth.uid()))
  with check (auth.uid() = user_id and public.can_access_search(search_id, auth.uid()));
drop policy if exists "commute_destinations_delete_own" on public.commute_destinations;
create policy "commute_destinations_delete_own" on public.commute_destinations
  for delete using (auth.uid() = user_id and public.can_access_search(search_id, auth.uid()));

create or replace function public.invalidate_coordinates_on_address_change()
returns trigger language plpgsql set search_path = public as $$
begin
  if old.address is distinct from new.address then
    new.latitude = null;
    new.longitude = null;
    new.coordinate_address_fingerprint = null;
    new.coordinate_status = 'unresolved';
    new.coordinate_source = null;
  end if;
  return new;
end;
$$;

drop trigger if exists homes_invalidate_coordinates on public.homes;
create trigger homes_invalidate_coordinates before update of address on public.homes
  for each row execute function public.invalidate_coordinates_on_address_change();
drop trigger if exists commute_destinations_invalidate_coordinates on public.commute_destinations;
create trigger commute_destinations_invalidate_coordinates before update of address on public.commute_destinations
  for each row execute function public.invalidate_coordinates_on_address_change();
drop trigger if exists commute_destinations_set_updated_at on public.commute_destinations;
create trigger commute_destinations_set_updated_at before update on public.commute_destinations
  for each row execute function public.set_updated_at();

-- Additive, idempotent copy of legacy personal JSON. It is deliberately retained
-- in priorities for rollback/history and is no longer read by the application.
insert into public.commute_destinations (search_id, user_id, label, address, max_drive_minutes)
select s.id, s.user_id, left(btrim(d.item->>'name'), 80), left(btrim(d.item->>'address'), 500),
       case when (d.item->>'maxDriveMinutes') ~ '^[0-9]+$'
            then least(1440, greatest(1, (d.item->>'maxDriveMinutes')::integer)) end
from public.searches s
cross join lateral jsonb_array_elements(coalesce(s.priorities#>'{location,commuteDestinations}', '[]'::jsonb)) d(item)
where btrim(coalesce(d.item->>'name','')) <> '' and btrim(coalesce(d.item->>'address','')) <> ''
on conflict do nothing;

insert into public.commute_destinations (search_id, user_id, label, address, max_drive_minutes)
select p.search_id, p.user_id, left(btrim(d.item->>'name'), 80), left(btrim(d.item->>'address'), 500),
       case when (d.item->>'maxDriveMinutes') ~ '^[0-9]+$'
            then least(1440, greatest(1, (d.item->>'maxDriveMinutes')::integer)) end
from public.search_member_priorities p
cross join lateral jsonb_array_elements(coalesce(p.priorities#>'{location,commuteDestinations}', '[]'::jsonb)) d(item)
where btrim(coalesce(d.item->>'name','')) <> '' and btrim(coalesce(d.item->>'address','')) <> ''
on conflict do nothing;
