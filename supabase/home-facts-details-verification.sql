-- READ-ONLY verification for migrations/2026-10-17-home-facts-details.sql.
--
-- Run after the migration. One SELECT; schema facts and counts only. Every row
-- must show ok = true.
with
new_columns(column_name) as (values
  ('listing_id'), ('heating'), ('cooling'), ('exterior'), ('roof'), ('garage_type'),
  ('basement_style'), ('basement_condition'), ('school_district_name'),
  ('elementary_school'), ('middle_school'), ('high_school')
),
present as (
  select c.column_name from information_schema.columns c
  where c.table_schema = 'public' and c.table_name = 'homes'
    and c.column_name in (select column_name from new_columns)
    and c.data_type = 'text' and c.is_nullable = 'YES' and c.column_default is null
)
select 1 as section, 'all 12 columns exist as nullable text without a default' as item,
       (select count(*) from present) = 12 as ok,
       (select string_agg(column_name, ', ' order by column_name) from new_columns where column_name not in (select column_name from present)) as detail
union all
select 2, 'choice constraints exist on public.homes',
       (select count(*) from pg_constraint where conrelid = 'public.homes'::regclass
          and conname in ('homes_garage_type_check', 'homes_basement_style_check', 'homes_basement_condition_check')) = 3, null
union all
select 3, 'authenticated can select, insert and update every new column',
       not exists (
         select 1 from new_columns n
         where not (has_column_privilege('authenticated', 'public.homes', n.column_name, 'SELECT')
                and has_column_privilege('authenticated', 'public.homes', n.column_name, 'INSERT')
                and has_column_privilege('authenticated', 'public.homes', n.column_name, 'UPDATE'))
       ), null
union all
-- Supabase keeps anon's default table-level grants; homes RLS gives anon no
-- rows. The new columns must not widen anon beyond an existing shared column.
select 4, 'anon gets nothing on the new columns beyond what it already has on homes.address',
       not exists (
         select 1 from new_columns n, (values ('SELECT'), ('INSERT'), ('UPDATE')) p(privilege)
         where has_column_privilege('anon', 'public.homes', n.column_name, p.privilege)
           and not has_column_privilege('anon', 'public.homes', 'address', p.privilege)
       ), null
union all
select 5, 'legacy homes.school_district is still not updatable by authenticated',
       not has_column_privilege('authenticated', 'public.homes', 'school_district', 'UPDATE'), null
union all
select 6, 'row level security is still enabled on public.homes',
       (select relrowsecurity from pg_class where oid = 'public.homes'::regclass), null
union all
-- Informational: 0 right after applying (no row is backfilled); it grows only
-- as buyers edit Home Facts or import new listings.
select 7, 'homes with any new value set (expect 0 immediately after applying)', true,
       (select count(*)::text from public.homes where coalesce(listing_id, heating, cooling, exterior, roof, garage_type,
          basement_style, basement_condition, school_district_name, elementary_school, middle_school, high_school) is not null)
order by section;
