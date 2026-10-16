-- READ-ONLY preflight for migrations/2026-10-17-home-facts-details.sql.
--
-- Run in the Supabase SQL Editor of the PRODUCTION project before applying the
-- migration. It is one SELECT: it writes nothing, and returns schema facts and
-- row COUNTS only (no ids, emails, addresses or other user data).
--
-- Proceed only if every row with "check" = 'required' shows ok = true. Rows
-- with "check" = 'info' describe the data the migration will leave untouched.
-- test/home-facts-details-db.test.js runs this file before and after the
-- migration and asserts it changes no rows.
with
new_columns(column_name) as (values
  ('listing_id'), ('heating'), ('cooling'), ('exterior'), ('roof'), ('garage_type'),
  ('basement_style'), ('basement_condition'), ('school_district_name'),
  ('elementary_school'), ('middle_school'), ('high_school')
),
existing as (
  select c.column_name, c.data_type, c.is_nullable, c.column_default
  from information_schema.columns c
  where c.table_schema = 'public' and c.table_name = 'homes'
    and c.column_name in (select column_name from new_columns)
),
new_constraints(conname) as (values
  ('homes_garage_type_check'), ('homes_basement_style_check'), ('homes_basement_condition_check')
),
homes_ready as (select to_regclass('public.homes') is not null as ok)
select 1 as section, 'required' as "check", 'public.homes exists' as item,
       (select ok from homes_ready) as ok, null::text as detail
union all
select 2, 'required', 'any already-present new column is nullable text with no default',
       not exists (select 1 from existing where data_type <> 'text' or is_nullable <> 'YES' or column_default is not null),
       coalesce((select string_agg(column_name || ' ' || data_type, ', ' order by column_name) from existing), 'none present yet')
union all
select 3, 'required', 'no foreign constraint already uses a new constraint name',
       not exists (
         select 1 from pg_constraint k
         where k.conname in (select conname from new_constraints)
           and k.conrelid <> coalesce(to_regclass('public.homes'), 0::regclass)
       ), null
union all
select 4, 'required', 'Pass 3C.3 boundary intact: authenticated cannot update legacy homes.school_district',
       not coalesce(has_column_privilege('authenticated', 'public.homes', 'school_district', 'UPDATE'), false), null
union all
select 5, 'required', 'authenticated can already update shared homes.address (column grants model present)',
       coalesce(has_column_privilege('authenticated', 'public.homes', 'address', 'UPDATE'), false), null
union all
select 6, 'required', 'row level security is enabled on public.homes',
       coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.homes')), false), null
union all
select 7, 'info', 'new columns already present (0 = fresh apply)',
       true, (select count(*)::text from existing)
union all
select 8, 'info', 'homes (all rows stay Unknown for every new column; none are updated)',
       true, case when (select ok from homes_ready) then (select count(*)::text from public.homes) end
union all
select 9, 'info', 'homes whose listing snapshot reported heating/cooling/exterior/roof/garage/Listing ID (shown as "Listing says", never copied)',
       true, case when (select ok from homes_ready) then (
         select count(*)::text from public.homes h
         where jsonb_typeof(h.listing_import -> 'listingFacts') = 'array'
           and exists (
             select 1 from jsonb_array_elements(h.listing_import -> 'listingFacts') f
             where f ->> 'key' in ('heating', 'cooling', 'exterior', 'roof', 'garageType', 'mls')
           )
       ) end
order by section;
