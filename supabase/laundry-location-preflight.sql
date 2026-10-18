-- READ-ONLY preflight for migrations/2026-10-18-laundry-location.sql.
--
-- Run in the Supabase SQL Editor of the PRODUCTION project before applying the
-- migration. It is one SELECT: it writes nothing, and returns schema facts and
-- row COUNTS only (no ids, emails, addresses or other user data).
--
-- Proceed only if every row with "check" = 'required' shows ok = true.
-- test/home-overlay-db.test.js runs this file before and after the migration
-- and asserts it changes no rows.
with
existing as (
  select c.data_type, c.is_nullable, c.column_default
  from information_schema.columns c
  where c.table_schema = 'public' and c.table_name = 'homes' and c.column_name = 'laundry_location'
),
homes_ready as (select to_regclass('public.homes') is not null as ok)
select 1 as section, 'required' as "check", 'public.homes exists' as item,
       (select ok from homes_ready) as ok, null::text as detail
union all
select 2, 'required', 'homes.laundry_location is absent, or already nullable text with no default',
       not exists (select 1 from existing where data_type <> 'text' or is_nullable <> 'YES' or column_default is not null),
       coalesce((select data_type from existing), 'not present yet')
union all
select 3, 'required', 'no other table already uses the constraint name homes_laundry_location_check',
       not exists (
         select 1 from pg_constraint k
         where k.conname = 'homes_laundry_location_check'
           and k.conrelid <> coalesce(to_regclass('public.homes'), 0::regclass)
       ), null
union all
select 4, 'required', 'Home Facts details migration (2026-10-17) is applied: homes.garage_type exists',
       exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'homes' and column_name = 'garage_type'), null
union all
select 5, 'required', 'Pass 3C.3 boundary intact: authenticated cannot update legacy homes.school_district',
       not coalesce(has_column_privilege('authenticated', 'public.homes', 'school_district', 'UPDATE'), false), null
union all
select 6, 'required', 'authenticated can already update shared homes.address (column grants model present)',
       coalesce(has_column_privilege('authenticated', 'public.homes', 'address', 'UPDATE'), false), null
union all
select 7, 'required', 'row level security is enabled on public.homes',
       coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.homes')), false), null
union all
select 8, 'info', 'homes (all stay Unknown for laundry location; none are updated)',
       true, case when (select ok from homes_ready) then (select count(*)::text from public.homes) end
union all
select 9, 'info', 'homes with in_unit_laundry set (a different fact; left exactly as it is)',
       true, case when (select ok from homes_ready) then (select count(*)::text from public.homes where in_unit_laundry is not null) end
order by section;
