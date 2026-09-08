-- Commute V1: participant-owned destinations and trustworthy home coordinates.
-- Apply immediately before deploying the application version that reads this table.

create or replace function public.address_fingerprint(value text)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select encode(public.digest(lower(regexp_replace(trim(value), '\s+', ' ', 'g')), 'sha256'), 'hex');
$$;

alter table public.homes
  add column if not exists coordinate_address_fingerprint text,
  add column if not exists geocode_status text not null default 'pending',
  add column if not exists geocode_provider text,
  add column if not exists normalized_address text,
  add column if not exists geocoded_at timestamptz;

alter table public.homes
  drop constraint if exists homes_geocode_status_check;
alter table public.homes
  add constraint homes_geocode_status_check
  check (geocode_status in ('pending', 'resolved', 'invalid', 'ambiguous', 'unavailable'));

-- Pre-V1 coordinates have no address provenance. Clearing them is deliberately
-- conservative: the application will resolve them again before routing, which is
-- safer than ever routing from coordinates that may belong to an edited address.
update public.homes
set latitude = null,
    longitude = null,
    coordinate_address_fingerprint = null,
    geocode_status = 'pending',
    geocode_provider = null,
    normalized_address = null,
    geocoded_at = null
where latitude is not null
   or longitude is not null
   or coordinate_address_fingerprint is not null;

create or replace function public.protect_home_coordinate_provenance()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.address is distinct from old.address then
    new.latitude := null;
    new.longitude := null;
    new.coordinate_address_fingerprint := null;
    new.geocode_status := 'pending';
    new.geocode_provider := null;
    new.normalized_address := null;
    new.geocoded_at := null;
    return new;
  end if;

  if new.latitude is not null and new.longitude is not null then
    new.coordinate_address_fingerprint := public.address_fingerprint(new.address);
    new.geocode_status := 'resolved';
  else
    -- Never retain half a coordinate pair or provenance for no coordinates.
    new.latitude := null;
    new.longitude := null;
    if new.geocode_status = 'resolved' then new.geocode_status := 'pending'; end if;
  end if;
  return new;
end;
$$;

drop trigger if exists homes_protect_coordinate_provenance on public.homes;
create trigger homes_protect_coordinate_provenance
  before insert or update of address, latitude, longitude on public.homes
  for each row execute function public.protect_home_coordinate_provenance();

create table if not exists public.commute_destinations (
  -- Text preserves the non-UUID IDs created by the legacy browser implementation.
  id text not null,
  search_id uuid not null references public.searches(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  label text not null check (char_length(trim(label)) between 1 and 80),
  address text not null check (char_length(trim(address)) between 1 and 200),
  maximum_minutes integer check (maximum_minutes between 1 and 600),
  latitude numeric,
  longitude numeric,
  normalized_address text,
  geocode_status text not null default 'pending'
    check (geocode_status in ('pending', 'resolved', 'invalid', 'ambiguous', 'unavailable')),
  geocode_provider text,
  address_fingerprint text not null,
  geocoded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (search_id, user_id, id),
  check ((latitude is null and longitude is null) or (latitude is not null and longitude is not null)),
  check (geocode_status <> 'resolved' or (latitude is not null and longitude is not null))
);

alter table public.commute_destinations enable row level security;

drop policy if exists "commute_destinations_own_select" on public.commute_destinations;
create policy "commute_destinations_own_select" on public.commute_destinations
  for select using (
    auth.uid() = user_id and public.can_access_search(search_id, auth.uid())
  );

drop policy if exists "commute_destinations_own_insert" on public.commute_destinations;
create policy "commute_destinations_own_insert" on public.commute_destinations
  for insert with check (
    auth.uid() = user_id and public.can_access_search(search_id, auth.uid())
  );

drop policy if exists "commute_destinations_own_update" on public.commute_destinations;
create policy "commute_destinations_own_update" on public.commute_destinations
  for update using (
    auth.uid() = user_id and public.can_access_search(search_id, auth.uid())
  ) with check (
    auth.uid() = user_id and public.can_access_search(search_id, auth.uid())
  );

drop policy if exists "commute_destinations_own_delete" on public.commute_destinations;
create policy "commute_destinations_own_delete" on public.commute_destinations
  for delete using (
    auth.uid() = user_id and public.can_access_search(search_id, auth.uid())
  );

drop trigger if exists commute_destinations_set_updated_at on public.commute_destinations;
create trigger commute_destinations_set_updated_at
  before update on public.commute_destinations
  for each row execute function public.set_updated_at();

create index if not exists commute_destinations_search_user_idx
  on public.commute_destinations(search_id, user_id, created_at);

-- Copy legacy owner destinations. Their historical per-destination tier is
-- intentionally ignored; the single existing location.tiers.Commute value remains
-- untouched in the priority document. Invalid shapes are skipped, never guessed.
insert into public.commute_destinations (
  id, search_id, user_id, label, address, address_fingerprint, geocode_status
)
select
  coalesce(nullif(item->>'id', ''), 'legacy-' || encode(digest(s.id::text || ':' || item::text, 'sha256'), 'hex')),
  s.id,
  s.user_id,
  left(trim(item->>'name'), 80),
  left(trim(item->>'address'), 200),
  public.address_fingerprint(left(trim(item->>'address'), 200)),
  'pending'
from public.searches s
cross join lateral jsonb_array_elements(
  case when jsonb_typeof(s.priorities #> '{location,commuteDestinations}') = 'array'
    then s.priorities #> '{location,commuteDestinations}' else '[]'::jsonb end
) item
where nullif(trim(item->>'name'), '') is not null
  and nullif(trim(item->>'address'), '') is not null
  and not exists (
    select 1 from public.search_member_priorities p
    where p.search_id = s.id and p.user_id = s.user_id
  )
on conflict (search_id, user_id, id) do nothing;

-- Copy the canonical participant document when one exists. If an owner's legacy
-- row was already copied above, the stable ID prevents duplication.
insert into public.commute_destinations (
  id, search_id, user_id, label, address, address_fingerprint, geocode_status
)
select
  coalesce(nullif(item->>'id', ''), 'legacy-' || encode(digest(p.search_id::text || ':' || p.user_id::text || ':' || item::text, 'sha256'), 'hex')),
  p.search_id,
  p.user_id,
  left(trim(item->>'name'), 80),
  left(trim(item->>'address'), 200),
  public.address_fingerprint(left(trim(item->>'address'), 200)),
  'pending'
from public.search_member_priorities p
cross join lateral jsonb_array_elements(
  case when jsonb_typeof(p.priorities #> '{location,commuteDestinations}') = 'array'
    then p.priorities #> '{location,commuteDestinations}' else '[]'::jsonb end
) item
where nullif(trim(item->>'name'), '') is not null
  and nullif(trim(item->>'address'), '') is not null
on conflict (search_id, user_id, id) do nothing;
