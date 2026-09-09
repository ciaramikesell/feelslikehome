-- Pass 3C.3: enforce participant privacy at the database boundary.
-- Apply manually only after 3C.2 is live and 3c3-production-preflight.sql passes.
-- This migration changes ACLs/policies only; it never rewrites legacy values.

begin;

-- Fail closed on schema drift rather than installing a partial allowlist.
do $$
declare
  v_missing text[];
begin
  select array_agg(required.column_name order by required.column_name)
    into v_missing
  from (values
    ('id'), ('user_id'), ('search_id'), ('address'), ('crossroads'),
    ('listing_url'), ('photo_url'), ('price'), ('est_monthly'), ('sqft'),
    ('beds'), ('baths'), ('lot_size'), ('garage_spaces'), ('year_built'),
    ('days_on_market'), ('home_layout'), ('home_condition'),
    ('primary_bedroom_location'), ('secondary_bedroom_location'), ('notes'),
    ('pros'), ('cons'), ('latitude'), ('longitude'),
    ('coordinate_address_fingerprint'), ('coordinate_status'),
    ('coordinate_source'), ('hoa_fee_monthly'), ('property_tax_annual'),
    ('property_tax_year'), ('basement_notes'), ('schools_notes'),
    ('condition_notes'), ('created_at'), ('updated_at'),
    ('status'), ('reaction'), ('toured_at'), ('is_favorite'),
    ('rejection_reason'), ('ratings'), ('checks')
  ) required(column_name)
  left join information_schema.columns actual
    on actual.table_schema = 'public' and actual.table_name = 'homes'
   and actual.column_name = required.column_name
  where actual.column_name is null;

  if v_missing is not null then
    raise exception 'Pass 3C.3 aborted: public.homes is missing columns: %', v_missing;
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'searches'
      and column_name = 'priorities'
  ) then
    raise exception 'Pass 3C.3 aborted: public.searches.priorities is missing';
  end if;
end
$$;

-- Direct home state is caller-owned. There is intentionally still no DELETE
-- policy, preserving V1 behavior. Sanitized cross-participant signals use RPCs.
drop policy if exists "hms_select_members" on public.home_member_state;
drop policy if exists "hms_select_own" on public.home_member_state;
create policy "hms_select_own" on public.home_member_state
  for select using (auth.uid() = user_id);

-- Column ACLs are the smallest PostgREST-compatible boundary: explicit selects
-- continue to address public.homes, RLS still controls rows, and SELECT * fails
-- because authenticated has no privilege on the private/legacy columns.
revoke select, insert, update on table public.homes from authenticated;
revoke select (status, reaction, toured_at, is_favorite, rejection_reason,
  ratings, checks, school_district) on public.homes from authenticated;
revoke insert (status, reaction, toured_at, is_favorite, rejection_reason,
  ratings, checks, school_district, created_at) on public.homes from authenticated;
revoke update (status, reaction, toured_at, is_favorite, rejection_reason,
  ratings, checks, school_district, created_at) on public.homes from authenticated;
grant select (
  id, user_id, search_id, address, crossroads, listing_url, photo_url, price,
  est_monthly, sqft, beds, baths, lot_size, garage_spaces, year_built,
  days_on_market, home_layout, home_condition, primary_bedroom_location,
  secondary_bedroom_location, notes, pros, cons, latitude, longitude,
  coordinate_address_fingerprint, coordinate_status, coordinate_source,
  hoa_fee_monthly, property_tax_annual, property_tax_year, basement_notes,
  schools_notes, condition_notes, created_at, updated_at
) on public.homes to authenticated;

-- INSERT permits creating a shared record but not supplying legacy private
-- values. updated_at remains a compatibility target but is overwritten by the
-- trigger; RLS below binds the adder identity to the caller.
grant insert (
  id, user_id, search_id, address, crossroads, listing_url, photo_url, price,
  est_monthly, sqft, beds, baths, lot_size, garage_spaces, year_built,
  days_on_market, home_layout, home_condition, primary_bedroom_location,
  secondary_bedroom_location, notes, pros, cons, latitude, longitude,
  coordinate_address_fingerprint, coordinate_status, coordinate_source,
  hoa_fee_monthly, property_tax_annual, property_tax_year, basement_notes,
  schools_notes, condition_notes, updated_at
) on public.homes to authenticated;

-- Existing 3C.2 upserts include identity columns and updated_at in their SET
-- list. Granting those targets avoids an app cutover; the trigger below makes
-- identity changes impossible and owns updated_at. Legacy private columns are
-- deliberately absent. All objective/shared fields used by Edit Home and
-- coordinate enrichment are present.
grant update (
  id, user_id, search_id, address, crossroads, listing_url, photo_url, price,
  est_monthly, sqft, beds, baths, lot_size, garage_spaces, year_built,
  days_on_market, home_layout, home_condition, primary_bedroom_location,
  secondary_bedroom_location, notes, pros, cons, latitude, longitude,
  coordinate_address_fingerprint, coordinate_status, coordinate_source,
  hoa_fee_monthly, property_tax_annual, property_tax_year, basement_notes,
  schools_notes, condition_notes, updated_at
) on public.homes to authenticated;

create or replace function public.enforce_home_shared_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.updated_at := now();
    return new;
  end if;

  if new.id is distinct from old.id
     or new.user_id is distinct from old.user_id
     or new.search_id is distinct from old.search_id
     or new.created_at is distinct from old.created_at then
    raise exception 'Home identity fields are immutable' using errcode = '42501';
  end if;
  -- Never accept a client-selected system timestamp.
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists homes_enforce_shared_identity on public.homes;
create trigger homes_enforce_shared_identity
  before insert or update on public.homes
  for each row execute function public.enforce_home_shared_identity();

drop policy if exists "homes_insert_own" on public.homes;
drop policy if exists "homes_insert_member" on public.homes;
create policy "homes_insert_accessible_own_adder" on public.homes
  for insert with check (
    auth.uid() = user_id
    and public.can_access_search(search_id, auth.uid())
  );

-- Searches have no legitimate authenticated UPDATE path after 3C.2. Keep the
-- shared metadata readable by column, while priorities and all direct UPDATEs
-- are denied. INSERT/DELETE and their existing owner RLS behavior are untouched.
revoke select, update on table public.searches from authenticated;
revoke select (id, user_id, priorities, created_at, updated_at)
  on public.searches from authenticated;
revoke update (id, user_id, priorities, created_at, updated_at)
  on public.searches from authenticated;
grant select (id, user_id, created_at, updated_at)
  on public.searches to authenticated;

-- Close platform-role ACL entries explicitly. Function bodies/contracts are
-- unchanged; these statements are idempotent ACL hygiene.
revoke execute on function public.is_search_owner(uuid, uuid) from anon, service_role;
revoke execute on function public.is_search_member(uuid, uuid) from anon, service_role;
revoke execute on function public.can_access_search(uuid, uuid) from anon, service_role;
revoke execute on function public.can_access_home(uuid, uuid) from anon, service_role;
revoke execute on function public.resolve_shared_fact_priority_awareness(uuid) from anon, service_role;
revoke execute on function public.resolve_cobuyer_compare_perspectives(uuid, uuid[]) from anon, service_role;
revoke execute on function public.resolve_cobuyer_lifecycle_signals(uuid, uuid[]) from anon, service_role;

notify pgrst, 'reload schema';
commit;
