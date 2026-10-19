-- Floor Plans foundation, part 1 of 2: the home_floor_plans table.
--
-- Up to four floor-plan images per home, shared by everyone on the home's
-- search. One row per image; the image itself lives in the private
-- `home-floor-plans` Storage bucket (part 2,
-- 2026-10-18-home-floor-plans-storage.sql) at '{home_id}/{uuid}.{jpg|png|webp}'.
-- Floor plans are not the home's cover photo (homes.photo_url, bucket
-- home-photos) and never feed Match. The legacy apartment column
-- homes.floor_plan_image_url is not read, written or altered here.
--
-- Rules:
-- * Read: anyone who can read the home — its search's owner, co-buyers and
--   connected Realtors (can_access_home, the same membership check as
--   homes_select_member). Leaving or being removed revokes it immediately.
-- * Add / replace / remove: the search's current decision-makers (owner or
--   co-buyer, is_search_decision_maker), on homes that are not a pending
--   Realtor suggestion (suggestion_staged) — the same rule as editing the home.
--   Any decision-maker may replace or remove a plan another one added.
--   Realtors never write.
-- * At most four rows per home, enforced under a per-home advisory lock so
--   concurrent adds cannot overshoot. Replacing updates storage_path in place
--   and never counts as an add.
-- * storage_path must sit in its own home's folder (CHECK), so a row can
--   never point at another home's object, and home_id cannot change.
-- * Deleting a home cascades its rows. The Storage objects are not deleted
--   by the database (Supabase does not allow it from SQL); once their row is
--   gone they are unreadable to Realtors, and the operator script
--   scripts/ops/floor-plan-orphans.mjs removes them.
--
-- Adds one table, five functions, policies, grants and two triggers. Changes
-- no existing table, policy, function or row. Run
-- supabase/home-floor-plans-preflight.sql (read-only) first and
-- supabase/home-floor-plans-verification.sql after. Re-runnable. Ends with a
-- check that aborts if any other policy on the table would grant access.
begin;

-- '{home_id}/{uuid}.{ext}' -> home_id; null for any other shape (nested
-- folders, upper case, other extensions, a bare file name). Every Storage
-- policy and the table CHECK use this one parser.
create or replace function public.home_floor_plan_object_home_id(p_name text)
returns uuid language sql immutable set search_path = '' as $$
  select case
    when p_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$'
    then split_part(p_name, '/', 1)::uuid
  end;
$$;

create table if not exists public.home_floor_plans (
  id uuid primary key default gen_random_uuid(),
  home_id uuid not null references public.homes(id) on delete cascade,
  storage_path text not null,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint home_floor_plans_storage_path_key unique (storage_path),
  constraint home_floor_plans_path_in_home_folder check (public.home_floor_plan_object_home_id(storage_path) = home_id)
);
create index if not exists home_floor_plans_home_id_idx on public.home_floor_plans(home_id, created_at);

-- Who may read / write a home's floor plans, for the caller (auth.uid()).
create or replace function public.can_view_home_floor_plans(p_home_id uuid)
returns boolean language sql security definer stable set search_path = '' as $$
  select auth.uid() is not null and public.can_access_home(p_home_id, auth.uid());
$$;

create or replace function public.can_edit_home_floor_plans(p_home_id uuid)
returns boolean language sql security definer stable set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from public.homes h
    where h.id = p_home_id
      and not h.suggestion_staged
      and public.is_search_decision_maker(h.search_id, auth.uid())
  );
$$;

-- Supabase's default privileges grant every new public function to anon too.
revoke all on function public.home_floor_plan_object_home_id(text) from public, anon;
revoke all on function public.can_view_home_floor_plans(uuid) from public, anon;
revoke all on function public.can_edit_home_floor_plans(uuid) from public, anon;
grant execute on function public.home_floor_plan_object_home_id(text) to authenticated;
grant execute on function public.can_view_home_floor_plans(uuid) to authenticated;
grant execute on function public.can_edit_home_floor_plans(uuid) to authenticated;

-- At most four per home. The advisory lock serializes concurrent adds to the
-- same home (without locking the homes row the autosave writes), so two
-- co-buyers adding the fourth and fifth plan at once cannot both succeed.
create or replace function public.enforce_home_floor_plan_limit()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('home_floor_plans:' || new.home_id::text, 0));
  if (select count(*) from public.home_floor_plans f where f.home_id = new.home_id) >= 4 then
    raise exception 'A home can have at most 4 floor plans' using errcode = 'P0001', hint = 'floor_plan_limit';
  end if;
  return new;
end;
$$;
revoke all on function public.enforce_home_floor_plan_limit() from public, anon, authenticated;

drop trigger if exists home_floor_plans_limit on public.home_floor_plans;
create trigger home_floor_plans_limit before insert on public.home_floor_plans
  for each row execute function public.enforce_home_floor_plan_limit();
drop trigger if exists home_floor_plans_set_updated_at on public.home_floor_plans;
create trigger home_floor_plans_set_updated_at before update on public.home_floor_plans
  for each row execute function public.set_updated_at();

alter table public.home_floor_plans enable row level security;

drop policy if exists "home_floor_plans_select" on public.home_floor_plans;
create policy "home_floor_plans_select" on public.home_floor_plans
  for select to authenticated using (public.can_view_home_floor_plans(home_id));
drop policy if exists "home_floor_plans_insert" on public.home_floor_plans;
create policy "home_floor_plans_insert" on public.home_floor_plans
  for insert to authenticated with check (created_by = auth.uid() and public.can_edit_home_floor_plans(home_id));
drop policy if exists "home_floor_plans_update" on public.home_floor_plans;
create policy "home_floor_plans_update" on public.home_floor_plans
  for update to authenticated
  using (public.can_edit_home_floor_plans(home_id))
  with check (public.can_edit_home_floor_plans(home_id));
drop policy if exists "home_floor_plans_delete" on public.home_floor_plans;
create policy "home_floor_plans_delete" on public.home_floor_plans
  for delete to authenticated using (public.can_edit_home_floor_plans(home_id));

-- created_by is never client-supplied (defaults to auth.uid()); home_id is
-- fixed after insert; only storage_path is replaceable.
revoke all on public.home_floor_plans from public, anon, authenticated;
grant select, delete on public.home_floor_plans to authenticated;
grant insert (home_id, storage_path) on public.home_floor_plans to authenticated;
grant update (storage_path) on public.home_floor_plans to authenticated;

-- Abort if anything else grants access to the table.
do $$
declare extra text;
begin
  select string_agg(policyname, ', ') into extra from pg_policies
  where schemaname = 'public' and tablename = 'home_floor_plans'
    and policyname not in ('home_floor_plans_select', 'home_floor_plans_insert', 'home_floor_plans_update', 'home_floor_plans_delete');
  if extra is not null then
    raise exception 'Unexpected policies on public.home_floor_plans: %', extra;
  end if;
  if has_table_privilege('anon', 'public.home_floor_plans', 'select') then
    raise exception 'anon must not read public.home_floor_plans';
  end if;
end $$;

commit;
