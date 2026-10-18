-- READ-ONLY verification after applying both Floor Plans migrations:
--   supabase/migrations/2026-10-18-home-floor-plans.sql
--   supabase/migrations/2026-10-18-home-floor-plans-storage.sql
-- One SELECT: catalog facts and COUNTS only — no rows, object names or paths.
-- Every `ok` must be true. Rows marked info never block.
select * from (
  with tbl as (select to_regclass('public.home_floor_plans') as oid),
  table_policies as (
    select p.policyname, p.cmd, p.roles::text as roles from pg_policies p
    where p.schemaname = 'public' and p.tablename = 'home_floor_plans'
  ),
  object_policies as (
    select p.policyname, p.cmd, p.permissive, p.roles::text as roles,
           coalesce(p.qual, '') || ' ' || coalesce(p.with_check, '') as rule
    from pg_policies p where p.schemaname = 'storage' and p.tablename = 'objects'
  ),
  ours as (select unnest(array['home_floor_plans_objects_select', 'home_floor_plans_objects_insert', 'home_floor_plans_objects_delete']) as policyname),
  helpers as (
    select p.proname, p.prosecdef, p.proconfig, p.oid
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in (
      'home_floor_plan_object_home_id', 'can_view_home_floor_plans', 'can_edit_home_floor_plans',
      'enforce_home_floor_plan_limit', 'can_read_home_floor_plan_object', 'can_upload_home_floor_plan_object')
  ),
  bucket as (select b.public, b.file_size_limit, b.allowed_mime_types from storage.buckets b where b.id = 'home-floor-plans')
  select 1 as section, 'home_floor_plans exists with row level security on' as item,
         coalesce((select c.relrowsecurity from pg_class c where c.oid = (select oid from tbl)), false) as ok,
         null::text as detail
  union all
  select 2, 'exactly the four table policies, for authenticated',
         (select count(*) from table_policies) = 4
           and exists (select 1 from table_policies where policyname = 'home_floor_plans_select' and cmd = 'SELECT' and roles = '{authenticated}')
           and exists (select 1 from table_policies where policyname = 'home_floor_plans_insert' and cmd = 'INSERT' and roles = '{authenticated}')
           and exists (select 1 from table_policies where policyname = 'home_floor_plans_update' and cmd = 'UPDATE' and roles = '{authenticated}')
           and exists (select 1 from table_policies where policyname = 'home_floor_plans_delete' and cmd = 'DELETE' and roles = '{authenticated}'),
         (select string_agg(policyname || ' [' || cmd || ' ' || roles || ']', ', ' order by policyname) from table_policies)
  union all
  select 3, 'anon has no privilege on home_floor_plans',
         (select oid from tbl) is not null
           and not has_table_privilege('anon', 'public.home_floor_plans', 'select,insert,update,delete,truncate,references,trigger')
           and not has_any_column_privilege('anon', 'public.home_floor_plans', 'select,insert,update,references'),
         null
  union all
  select 4, 'authenticated: select, delete; insert only home_id/storage_path; update only storage_path',
         (select oid from tbl) is not null
           and has_table_privilege('authenticated', 'public.home_floor_plans', 'select')
           and has_table_privilege('authenticated', 'public.home_floor_plans', 'delete')
           and not has_table_privilege('authenticated', 'public.home_floor_plans', 'insert')
           and not has_table_privilege('authenticated', 'public.home_floor_plans', 'update')
           and has_column_privilege('authenticated', 'public.home_floor_plans', 'home_id', 'insert')
           and has_column_privilege('authenticated', 'public.home_floor_plans', 'storage_path', 'insert')
           and not has_column_privilege('authenticated', 'public.home_floor_plans', 'created_by', 'insert')
           and not has_column_privilege('authenticated', 'public.home_floor_plans', 'id', 'insert')
           and has_column_privilege('authenticated', 'public.home_floor_plans', 'storage_path', 'update')
           and not has_column_privilege('authenticated', 'public.home_floor_plans', 'home_id', 'update')
           and not has_column_privilege('authenticated', 'public.home_floor_plans', 'created_by', 'update'),
         null
  union all
  select 5, 'constraints: unique storage_path, path in own home folder, home FK on delete cascade',
         exists (select 1 from pg_constraint where conrelid = (select oid from tbl) and conname = 'home_floor_plans_storage_path_key' and contype = 'u')
           and exists (select 1 from pg_constraint where conrelid = (select oid from tbl) and conname = 'home_floor_plans_path_in_home_folder' and contype = 'c')
           and exists (select 1 from pg_constraint where conrelid = (select oid from tbl) and contype = 'f' and confrelid = 'public.homes'::regclass and confdeltype = 'c'),
         null
  union all
  select 6, 'triggers: four-per-home limit (before insert) and updated_at',
         exists (select 1 from pg_trigger where tgrelid = (select oid from tbl) and tgname = 'home_floor_plans_limit' and not tgisinternal and tgenabled = 'O')
           and exists (select 1 from pg_trigger where tgrelid = (select oid from tbl) and tgname = 'home_floor_plans_set_updated_at' and not tgisinternal and tgenabled = 'O'),
         null
  union all
  select 7, 'all six helpers exist with a pinned search_path; access helpers are security definer',
         (select count(*) from helpers) = 6
           and not exists (select 1 from helpers where not coalesce(proconfig @> array['search_path=""'], false))
           and not exists (select 1 from helpers where proname <> 'home_floor_plan_object_home_id' and not prosecdef),
         (select string_agg(proname || case when prosecdef then ' (definer)' else '' end, ', ' order by proname) from helpers)
  union all
  select 8, 'helpers are not executable by anon',
         not exists (select 1 from helpers where has_function_privilege('anon', oid, 'execute')),
         (select string_agg(proname, ', ') from helpers where has_function_privilege('anon', oid, 'execute'))
  union all
  select 9, 'bucket home-floor-plans is private, 10 MB, exactly jpeg/png/webp',
         coalesce((select not public and file_size_limit = 10485760
                     and allowed_mime_types @> array['image/jpeg', 'image/png', 'image/webp']
                     and allowed_mime_types <@ array['image/jpeg', 'image/png', 'image/webp'] from bucket), false),
         coalesce((select 'public=' || public || ', limit=' || coalesce(file_size_limit::text, 'unset') || ', types=' || coalesce(array_to_string(allowed_mime_types, ' '), 'unset') from bucket), 'bucket not found')
  union all
  select 10, 'storage.objects: select / insert / delete policies for authenticated, no update policy',
         exists (select 1 from object_policies where policyname = 'home_floor_plans_objects_select' and cmd = 'SELECT' and roles = '{authenticated}' and rule ilike '%can_read_home_floor_plan_object%')
           and exists (select 1 from object_policies where policyname = 'home_floor_plans_objects_insert' and cmd = 'INSERT' and roles = '{authenticated}' and rule ilike '%can_upload_home_floor_plan_object%')
           and exists (select 1 from object_policies where policyname = 'home_floor_plans_objects_delete' and cmd = 'DELETE' and roles = '{authenticated}' and rule ilike '%can_edit_home_floor_plans%')
           and not exists (select 1 from object_policies where rule ilike '%home-floor-plans%' and cmd in ('UPDATE', 'ALL')),
         (select string_agg(policyname || ' [' || cmd || ' ' || roles || ']', ', ' order by policyname) from object_policies where policyname in (select policyname from ours))
  union all
  select 11, 'no other storage.objects policy can reach home-floor-plans',
         not exists (select 1 from object_policies where permissive = 'PERMISSIVE' and policyname not in (select policyname from ours)
                       and (rule ilike '%home-floor-plans%' or rule not ilike '%bucket_id%')),
         (select string_agg(policyname || ' [' || cmd || ']', ', ') from object_policies where permissive = 'PERMISSIVE' and policyname not in (select policyname from ours)
            and (rule ilike '%home-floor-plans%' or rule not ilike '%bucket_id%'))
  union all
  select 12, 'no home has more than four floor plans',
         (select oid from tbl) is not null and not exists (select 1 from public.home_floor_plans group by home_id having count(*) > 4),
         null
  union all
  select 13, 'info: floor plan rows / homes with plans / bucket objects', true,
         (select count(*)::text from public.home_floor_plans) || ' / '
           || (select count(distinct home_id)::text from public.home_floor_plans) || ' / '
           || (select count(*)::text from storage.objects o where o.bucket_id = 'home-floor-plans')
  union all
  select 14, 'info: bucket objects with no floor plan row (cleanup: scripts/ops/floor-plan-orphans.mjs)', true,
         (select count(*)::text from storage.objects o where o.bucket_id = 'home-floor-plans'
            and not exists (select 1 from public.home_floor_plans f where f.storage_path = o.name))
  union all
  select 15, 'info: floor plan rows whose object is missing (shown as "not available")', true,
         (select count(*)::text from public.home_floor_plans f
            where not exists (select 1 from storage.objects o where o.bucket_id = 'home-floor-plans' and o.name = f.storage_path))
  union all
  select 16, 'info: 8-objects-per-home upload cap is effective (helper owner bypasses RLS on storage.objects)', true,
         coalesce((select r.rolname || case when r.rolsuper or r.rolbypassrls then ': yes' else ': NO - cap counts nothing; rows are still limited to 4' end
                   from pg_proc p join pg_roles r on r.oid = p.proowner
                   where p.oid = to_regprocedure('public.can_upload_home_floor_plan_object(text)')), 'helper missing')
  union all
  select 17, 'info: legacy homes.floor_plan_image_url (not touched)', true,
         case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'homes' and column_name = 'floor_plan_image_url') then 'present' else 'absent' end
) checks
order by section;
