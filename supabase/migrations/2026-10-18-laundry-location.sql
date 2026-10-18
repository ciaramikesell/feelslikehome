-- Laundry Location: one shared, structured property fact shown under Heating
-- and Cooling on the home overlay (docs/home-overlay-phase-2.md).
--
-- Purely additive. One nullable text column with no default, so every
-- existing home reads as Unknown (null); no row is updated, backfilled, or
-- deleted.
--
-- Deliberately separate from homes.in_unit_laundry (a rental yes/no fact and
-- the shared answer to the In-Unit Laundry criterion) and from every personal
-- laundry-related Match answer in home_member_state.checks. Where the laundry
-- is, and whether a unit has its own, are different facts.
--
-- Not a Match input: no scoring function (JS or SQL, including
-- resolve_cobuyer_compare_perspectives) reads this column.
--
-- Run supabase/laundry-location-preflight.sql first (read-only), then this,
-- then supabase/laundry-location-verification.sql. Re-runnable.
begin;

alter table public.homes add column if not exists laundry_location text;

-- Only the canonical tokens (or null = Unknown). A listing that names several
-- locations is left Unknown by the importer, never forced into one of these.
do $$ begin
  alter table public.homes add constraint homes_laundry_location_check
    check (laundry_location is null or laundry_location in ('basement', 'first_floor', 'second_floor'));
exception when duplicate_object then null; end $$;

-- Keep the Pass 3C.3 column boundary: authenticated gets exactly this new
-- column. Homes RLS still decides which rows (decision-makers of the search
-- only; Realtors and anon get nothing new).
grant select (laundry_location) on public.homes to authenticated;
grant insert (laundry_location) on public.homes to authenticated;
grant update (laundry_location) on public.homes to authenticated;

notify pgrst, 'reload schema';
commit;
