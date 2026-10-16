-- Home Facts details: structured, shared property facts the redesigned Home
-- Facts page edits (docs/home-facts-flow-redesign.md).
--
-- Purely additive. Every column is nullable with no default, so every existing
-- home reads as Unknown (null) for all of them; no row is updated, backfilled,
-- or deleted. "None" is a real, stored answer ('none'), distinct from Unknown.
--
-- Not a Match input: no scoring function (JS or SQL, including
-- resolve_cobuyer_compare_perspectives) reads any of these columns.
--
-- Deliberately NOT reused: the legacy homes.school_district column. Pass 3C.3
-- (2026-09-09-pass-3c3-lock-legacy-privacy.sql) locked it as a legacy private
-- column; its contents predate the shared-fact model, so the shared district
-- lives in school_district_name instead and the legacy column stays locked.
--
-- Run supabase/home-facts-details-preflight.sql first (read-only), then this,
-- then supabase/home-facts-details-verification.sql.
begin;

alter table public.homes
  add column if not exists listing_id text,
  add column if not exists heating text,
  add column if not exists cooling text,
  add column if not exists exterior text,
  add column if not exists roof text,
  add column if not exists garage_type text,
  add column if not exists basement_style text,
  add column if not exists basement_condition text,
  add column if not exists school_district_name text,
  add column if not exists elementary_school text,
  add column if not exists middle_school text,
  add column if not exists high_school text;

-- Choice facts accept only their canonical tokens (or null = Unknown).
do $$ begin
  alter table public.homes add constraint homes_garage_type_check
    check (garage_type is null or garage_type in ('none', 'attached', 'detached'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.homes add constraint homes_basement_style_check
    check (basement_style is null or basement_style in ('none', 'traditional', 'gardenview', 'walkout'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.homes add constraint homes_basement_condition_check
    check (basement_condition is null or basement_condition in ('none', 'unfinished', 'partially_finished', 'finished'));
exception when duplicate_object then null; end $$;

-- Keep the Pass 3C.3 column boundary: authenticated gets exactly these new
-- columns. Homes RLS still decides which rows (decision-makers of the search
-- only; Realtors and anon get nothing new).
grant select (listing_id, heating, cooling, exterior, roof, garage_type, basement_style, basement_condition,
  school_district_name, elementary_school, middle_school, high_school) on public.homes to authenticated;
grant insert (listing_id, heating, cooling, exterior, roof, garage_type, basement_style, basement_condition,
  school_district_name, elementary_school, middle_school, high_school) on public.homes to authenticated;
grant update (listing_id, heating, cooling, exterior, roof, garage_type, basement_style, basement_condition,
  school_district_name, elementary_school, middle_school, high_school) on public.homes to authenticated;

notify pgrst, 'reload schema';
commit;
