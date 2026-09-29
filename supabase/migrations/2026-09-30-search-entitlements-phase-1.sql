-- Monetization Phase 1: search-scoped entitlement + free-home allowance.
--
-- Product model
--   * Every buyer search may admit its first three unique homes for free.
--   * Admitting a fourth unique home requires the search to be unlocked
--     (one-time purchase, not a subscription). Co-buyers share the search's
--     entitlement because it is keyed by search, not by user.
--   * The allowance counts homes *admitted*, not homes currently present:
--     deleting or archiving a home never returns its slot, and re-adding a
--     previously admitted property never consumes a new one.
--   * Realtor suggestions are staged homes (homes.suggestion_staged = true)
--     and are never counted. Promotion (staged -> not staged) is an admission.
--
-- Enforcement lives entirely in the database: a trigger on public.homes
-- admits every non-staged home insert and every staged -> unstaged promotion
-- through one function (public.admit_search_home). Clients cannot write the
-- entitlement or admission tables at all, so no client-side state, direct
-- PostgREST call, or less-common path can grant or reset an allowance.
--
-- This migration does NOT implement purchasing. Nothing here marks a search
-- unlocked except public.record_search_entitlement_unlock, which only the
-- service_role may execute (Phase 2 server-side receipt verification).
--
-- Existing data is never hidden, deleted, archived, or locked. Existing
-- non-staged homes are backfilled as grandfathered admissions.
begin;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.search_entitlements (
  search_id uuid primary key references public.searches(id) on delete cascade,
  status text not null default 'free' check (status in ('free', 'unlocked')),
  free_home_limit integer not null default 3 check (free_home_limit >= 0),
  unlocked_at timestamptz,
  source text check (source in ('apple', 'web', 'admin', 'promo')),
  product_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint search_entitlements_unlock_shape check (
    (status = 'free' and unlocked_at is null and source is null)
    or (status = 'unlocked' and unlocked_at is not null and source is not null)
  )
);

-- Provider transaction detail for verification/restoration. Never exposed to
-- ordinary clients (no grants, RLS with no policies). search_id is kept on
-- search deletion as null so the purchase audit trail survives.
create table if not exists public.search_entitlement_transactions (
  id uuid primary key default gen_random_uuid(),
  search_id uuid references public.searches(id) on delete set null,
  source text not null check (source in ('apple', 'web', 'admin', 'promo')),
  product_id text,
  provider_transaction_id text,
  provider_original_transaction_id text,
  environment text check (environment in ('production', 'sandbox')),
  purchased_by uuid,
  purchased_at timestamptz,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  constraint search_entitlement_transactions_apple_id check (source <> 'apple' or provider_transaction_id is not null)
);
create unique index if not exists search_entitlement_transactions_provider_idx
  on public.search_entitlement_transactions (source, provider_transaction_id)
  where provider_transaction_id is not null;

-- One row per unique property ever admitted to a search. Rows outlive the
-- home (first_home_id is nulled on delete) so deletion never restores a slot.
create table if not exists public.search_home_admissions (
  id uuid primary key default gen_random_uuid(),
  search_id uuid not null references public.searches(id) on delete cascade,
  listing_identity text not null,
  address_key text,
  first_home_id uuid references public.homes(id) on delete set null,
  admitted_by uuid,
  admission_source text not null check (admission_source in ('buyer_add', 'suggestion_promotion', 'grandfathered')),
  counted_against_free boolean not null,
  admitted_at timestamptz not null default now(),
  unique (search_id, listing_identity)
);
create index if not exists search_home_admissions_address_idx
  on public.search_home_admissions (search_id, address_key) where address_key is not null;

alter table public.search_entitlements enable row level security;
alter table public.search_entitlement_transactions enable row level security;
alter table public.search_home_admissions enable row level security;
-- Deliberately no policies: all reads go through the RPCs below and all
-- writes go through the admission trigger or the service-role unlock function.
revoke all on table public.search_entitlements from public, anon, authenticated;
revoke all on table public.search_entitlement_transactions from public, anon, authenticated;
revoke all on table public.search_home_admissions from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Identity helpers
-- ---------------------------------------------------------------------------

-- Address-only key, matching the address branch of
-- public.suggestion_listing_identity. Null when the address is empty.
create or replace function public.home_address_key(p_address text)
returns text language sql immutable set search_path = '' as $$
  select case when regexp_replace(trim(coalesce(p_address, '')), '[^a-zA-Z0-9]+', '', 'g') = '' then null
    else 'address:' || lower(regexp_replace(trim(coalesce(p_address, '')), '[^a-zA-Z0-9]+', '', 'g')) end;
$$;
revoke all on function public.home_address_key(text) from public;

-- ---------------------------------------------------------------------------
-- The single admission gate
-- ---------------------------------------------------------------------------

-- Admits one property to a search or raises paywall_required (SQLSTATE FL402).
-- Serialized per search by locking the entitlement row, so two concurrent
-- requests can never both take the final free slot. Internal only: not
-- executable by any client role; reached through the homes trigger.
create or replace function public.admit_search_home(
  p_search_id uuid, p_home_id uuid, p_listing_url text, p_address text, p_source text, p_actor uuid
) returns text
language plpgsql security definer set search_path = '' as $$
declare
  ent public.search_entitlements%rowtype;
  ident text := public.suggestion_listing_identity(p_listing_url, p_address);
  addr text := public.home_address_key(p_address);
  existing_id uuid;
  used integer;
begin
  if ident = 'address:' then ident := 'home:' || p_home_id::text; end if;

  insert into public.search_entitlements (search_id) values (p_search_id) on conflict (search_id) do nothing;
  select * into ent from public.search_entitlements where search_id = p_search_id for update;

  select a.id into existing_id from public.search_home_admissions a
   where a.search_id = p_search_id
     and (a.listing_identity = ident or (addr is not null and a.address_key = addr))
   order by a.admitted_at limit 1;
  if existing_id is not null then
    update public.search_home_admissions set first_home_id = p_home_id
     where id = existing_id and first_home_id is null;
    return 'existing';
  end if;

  if ent.status = 'unlocked' then
    insert into public.search_home_admissions (search_id, listing_identity, address_key, first_home_id, admitted_by, admission_source, counted_against_free)
    values (p_search_id, ident, addr, p_home_id, p_actor, p_source, false);
    return 'unlocked';
  end if;

  select count(*) into used from public.search_home_admissions
   where search_id = p_search_id and counted_against_free;
  if used < ent.free_home_limit then
    insert into public.search_home_admissions (search_id, listing_identity, address_key, first_home_id, admitted_by, admission_source, counted_against_free)
    values (p_search_id, ident, addr, p_home_id, p_actor, p_source, true);
    return 'free';
  end if;

  raise exception 'paywall_required'
    using errcode = 'FL402', detail = 'free_home_limit_reached', hint = 'Unlock this search to add more homes.';
end;
$$;
revoke all on function public.admit_search_home(uuid, uuid, text, text, text, uuid) from public, anon, authenticated, service_role;

create or replace function public.enforce_home_admission()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.search_id is null or new.suggestion_staged then return new; end if;
  if tg_op = 'INSERT' then
    perform public.admit_search_home(new.search_id, new.id, new.listing_url, new.address, 'buyer_add', auth.uid());
  elsif old.suggestion_staged and not new.suggestion_staged then
    perform public.admit_search_home(new.search_id, new.id, new.listing_url, new.address, 'suggestion_promotion', auth.uid());
  end if;
  return new;
end;
$$;
revoke all on function public.enforce_home_admission() from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Non-destructive grandfathering backfill (runs before the trigger exists)
-- ---------------------------------------------------------------------------

insert into public.search_entitlements (search_id)
select s.id from public.searches s on conflict (search_id) do nothing;

do $$
declare
  h record; ident text; addr text;
begin
  for h in select id, search_id, user_id, listing_url, address, created_at from public.homes
            where search_id is not null and not suggestion_staged
            order by search_id, created_at, id loop
    ident := public.suggestion_listing_identity(h.listing_url, h.address);
    if ident = 'address:' then ident := 'home:' || h.id::text; end if;
    addr := public.home_address_key(h.address);
    if not exists (select 1 from public.search_home_admissions a where a.search_id = h.search_id
                    and (a.listing_identity = ident or (addr is not null and a.address_key = addr))) then
      insert into public.search_home_admissions (search_id, listing_identity, address_key, first_home_id, admitted_by, admission_source, counted_against_free, admitted_at)
      values (h.search_id, ident, addr, h.id, h.user_id, 'grandfathered', true, coalesce(h.created_at, now()));
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------
-- AFTER row triggers: the home row exists (so first_home_id can reference it),
-- an upsert that resolves to an UPDATE of an existing home never fires the
-- insert trigger, and raising paywall_required rolls the whole statement back.

drop trigger if exists enforce_home_admission_insert on public.homes;
create trigger enforce_home_admission_insert
  after insert on public.homes
  for each row when (not new.suggestion_staged)
  execute function public.enforce_home_admission();

drop trigger if exists enforce_home_admission_promotion on public.homes;
create trigger enforce_home_admission_promotion
  after update of suggestion_staged on public.homes
  for each row when (old.suggestion_staged and not new.suggestion_staged)
  execute function public.enforce_home_admission();

-- ---------------------------------------------------------------------------
-- Client read RPCs (decision-makers of the search only)
-- ---------------------------------------------------------------------------

create or replace function public.get_search_entitlement(p_search_id uuid)
returns table (
  search_id uuid, status text, unlocked_at timestamptz, source text,
  free_home_limit integer, free_homes_used integer, free_homes_remaining integer
)
language plpgsql security definer stable set search_path = '' as $$
declare caller uuid := auth.uid(); ent public.search_entitlements%rowtype; used integer;
begin
  if caller is null or not public.is_search_decision_maker(p_search_id, caller) then
    raise exception 'Search access denied' using errcode = '42501';
  end if;
  select * into ent from public.search_entitlements e where e.search_id = p_search_id;
  select count(*) into used from public.search_home_admissions a where a.search_id = p_search_id and a.counted_against_free;
  return query select p_search_id, coalesce(ent.status, 'free'), ent.unlocked_at, ent.source,
    coalesce(ent.free_home_limit, 3), used, greatest(coalesce(ent.free_home_limit, 3) - used, 0);
end;
$$;
revoke all on function public.get_search_entitlement(uuid) from public, anon, service_role;
grant execute on function public.get_search_entitlement(uuid) to authenticated;

-- Read-only preflight: would this property be admitted right now? Returns
-- 'existing' | 'unlocked' | 'free' | 'paywall_required'. Advisory only; the
-- trigger remains authoritative at write time.
create or replace function public.check_home_admission(p_search_id uuid, p_listing_url text, p_address text)
returns text
language plpgsql security definer stable set search_path = '' as $$
declare
  caller uuid := auth.uid(); ent public.search_entitlements%rowtype;
  ident text := public.suggestion_listing_identity(p_listing_url, p_address);
  addr text := public.home_address_key(p_address);
  used integer;
begin
  if caller is null or not public.is_search_decision_maker(p_search_id, caller) then
    raise exception 'Search access denied' using errcode = '42501';
  end if;
  if ident <> 'address:' and exists (select 1 from public.search_home_admissions a where a.search_id = p_search_id
      and (a.listing_identity = ident or (addr is not null and a.address_key = addr))) then
    return 'existing';
  end if;
  select * into ent from public.search_entitlements e where e.search_id = p_search_id;
  if ent.status = 'unlocked' then return 'unlocked'; end if;
  select count(*) into used from public.search_home_admissions a where a.search_id = p_search_id and a.counted_against_free;
  if used < coalesce(ent.free_home_limit, 3) then return 'free'; end if;
  return 'paywall_required';
end;
$$;
revoke all on function public.check_home_admission(uuid, text, text) from public, anon, service_role;
grant execute on function public.check_home_admission(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Server-only unlock (Phase 2 connection point; unused by the app in Phase 1)
-- ---------------------------------------------------------------------------

-- The only way a search becomes unlocked. Executable by service_role only, so
-- it can be called solely from trusted server code after verifying a purchase
-- (e.g. an App Store signed transaction) or by an operator for admin/promo.
-- Idempotent per (source, provider_transaction_id).
create or replace function public.record_search_entitlement_unlock(
  p_search_id uuid, p_source text, p_product_id text,
  p_provider_transaction_id text default null, p_provider_original_transaction_id text default null,
  p_environment text default null, p_purchased_by uuid default null, p_purchased_at timestamptz default null
) returns text
language plpgsql security definer set search_path = '' as $$
begin
  if p_source not in ('apple', 'web', 'admin', 'promo') then raise exception 'Unknown entitlement source'; end if;
  if p_source in ('apple', 'web') and nullif(trim(coalesce(p_provider_transaction_id, '')), '') is null then
    raise exception 'A verified provider transaction is required';
  end if;
  if not exists (select 1 from public.searches s where s.id = p_search_id) then raise exception 'Search not found'; end if;

  insert into public.search_entitlement_transactions (search_id, source, product_id, provider_transaction_id,
    provider_original_transaction_id, environment, purchased_by, purchased_at, verified_at)
  values (p_search_id, p_source, p_product_id, p_provider_transaction_id, p_provider_original_transaction_id,
    p_environment, p_purchased_by, p_purchased_at, now())
  on conflict (source, provider_transaction_id) where provider_transaction_id is not null do nothing;

  insert into public.search_entitlements (search_id) values (p_search_id) on conflict (search_id) do nothing;
  update public.search_entitlements
     set status = 'unlocked', unlocked_at = coalesce(unlocked_at, now()),
         source = coalesce(source, p_source), product_id = coalesce(product_id, p_product_id), updated_at = now()
   where search_id = p_search_id;
  return 'unlocked';
end;
$$;
revoke all on function public.record_search_entitlement_unlock(uuid, text, text, text, text, text, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.record_search_entitlement_unlock(uuid, text, text, text, text, text, uuid, timestamptz) to service_role;

commit;
