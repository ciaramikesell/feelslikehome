-- READ-ONLY verification for migrations/2026-10-18-laundry-location.sql.
--
-- Run after the migration. One SELECT; schema facts and counts only. Every row
-- must show ok = true.
select 1 as section, 'homes.laundry_location exists as nullable text without a default' as item,
       exists (
         select 1 from information_schema.columns c
         where c.table_schema = 'public' and c.table_name = 'homes' and c.column_name = 'laundry_location'
           and c.data_type = 'text' and c.is_nullable = 'YES' and c.column_default is null
       ) as ok, null::text as detail
union all
select 2, 'homes_laundry_location_check exists on public.homes',
       exists (select 1 from pg_constraint where conrelid = 'public.homes'::regclass and conname = 'homes_laundry_location_check'), null
union all
select 3, 'authenticated can select, insert and update homes.laundry_location',
       has_column_privilege('authenticated', 'public.homes', 'laundry_location', 'SELECT')
         and has_column_privilege('authenticated', 'public.homes', 'laundry_location', 'INSERT')
         and has_column_privilege('authenticated', 'public.homes', 'laundry_location', 'UPDATE'), null
union all
-- Supabase keeps anon's default table-level grants; homes RLS gives anon no
-- rows. The new column must not widen anon beyond an existing shared column.
select 4, 'anon gets nothing on laundry_location beyond what it already has on homes.address',
       not exists (
         select 1 from (values ('SELECT'), ('INSERT'), ('UPDATE')) p(privilege)
         where has_column_privilege('anon', 'public.homes', 'laundry_location', p.privilege)
           and not has_column_privilege('anon', 'public.homes', 'address', p.privilege)
       ), null
union all
select 5, 'legacy homes.school_district is still not updatable by authenticated',
       not has_column_privilege('authenticated', 'public.homes', 'school_district', 'UPDATE'), null
union all
select 6, 'row level security is still enabled on public.homes',
       (select relrowsecurity from pg_class where oid = 'public.homes'::regclass), null
union all
-- Informational: 0 right after applying (no row is backfilled).
select 7, 'homes with a laundry location set (expect 0 immediately after applying)', true,
       (select count(*)::text from public.homes where laundry_location is not null)
order by section;
