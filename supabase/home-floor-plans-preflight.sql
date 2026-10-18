-- READ-ONLY preflight for the Floor Plans foundation:
--   supabase/migrations/2026-10-18-home-floor-plans.sql
--   supabase/migrations/2026-10-18-home-floor-plans-storage.sql
-- One SELECT: settings, catalog facts and policy names only — no rows, object
-- names, paths or any other user data. Every `ok` must be true before applying.
-- Rows marked info are for the record and never block.
--
--  1-5  prerequisites the migrations call: homes.suggestion_staged,
--       can_access_home, is_search_decision_maker, set_updated_at, auth.uid
--  6    Supabase Storage tables are present
--  7    home_floor_plans is absent (fresh) or already in the expected shape (re-run)
--  8    the home-floor-plans bucket is absent (fresh) or already private with
--       the expected limits (re-run)
--  9    no permissive storage.objects policy is missing a bucket_id restriction
--       (it would also grant access to the new private bucket; the storage
--       migration aborts on it — review and scope it to its bucket first)
--  10   no policy other than the migration's own mentions home-floor-plans
--  11   info: legacy homes.floor_plan_image_url (left untouched either way)
--  12   info: home-photos bucket visibility (left untouched)
select * from (
  with object_policies as (
    select p.policyname, p.cmd, p.permissive, coalesce(p.qual, '') || ' ' || coalesce(p.with_check, '') as rule
    from pg_policies p where p.schemaname = 'storage' and p.tablename = 'objects'
  ),
  ours as (select unnest(array['home_floor_plans_objects_select', 'home_floor_plans_objects_insert', 'home_floor_plans_objects_delete']) as policyname),
  bucket as (select b.public, b.file_size_limit, b.allowed_mime_types from storage.buckets b where b.id = 'home-floor-plans')
  select 1 as section, 'homes.suggestion_staged exists' as item,
         exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'homes' and column_name = 'suggestion_staged') as ok,
         null::text as detail
  union all
  select 2, 'public.can_access_home(uuid, uuid) exists', to_regprocedure('public.can_access_home(uuid,uuid)') is not null, null
  union all
  select 3, 'public.is_search_decision_maker(uuid, uuid) exists', to_regprocedure('public.is_search_decision_maker(uuid,uuid)') is not null, null
  union all
  select 4, 'public.set_updated_at() exists', to_regprocedure('public.set_updated_at()') is not null, null
  union all
  select 5, 'auth.uid() exists', to_regprocedure('auth.uid()') is not null, null
  union all
  select 6, 'storage.buckets and storage.objects exist',
         to_regclass('storage.buckets') is not null and to_regclass('storage.objects') is not null, null
  union all
  select 7, 'home_floor_plans is absent, or present with RLS on (re-run)',
         to_regclass('public.home_floor_plans') is null
           or coalesce((select c.relrowsecurity from pg_class c where c.oid = to_regclass('public.home_floor_plans')), false),
         case when to_regclass('public.home_floor_plans') is null then 'absent (fresh install)' else 'present (re-run)' end
  union all
  select 8, 'bucket home-floor-plans is absent, or private with 10 MB and jpeg/png/webp (re-run)',
         not exists (select 1 from bucket)
           or coalesce((select not public and file_size_limit = 10485760
                         and allowed_mime_types @> array['image/jpeg', 'image/png', 'image/webp']
                         and allowed_mime_types <@ array['image/jpeg', 'image/png', 'image/webp'] from bucket), false),
         coalesce((select 'public=' || public || ', limit=' || coalesce(file_size_limit::text, 'unset') || ', types=' || coalesce(array_to_string(allowed_mime_types, ' '), 'unset') from bucket), 'absent (fresh install)')
  union all
  select 9, 'no permissive storage.objects policy without a bucket_id restriction',
         not exists (select 1 from object_policies where permissive = 'PERMISSIVE' and rule not ilike '%bucket_id%'),
         (select string_agg(policyname || ' [' || cmd || ']', ', ') from object_policies where permissive = 'PERMISSIVE' and rule not ilike '%bucket_id%')
  union all
  select 10, 'no other policy mentions home-floor-plans',
         not exists (select 1 from object_policies where rule ilike '%home-floor-plans%' and policyname not in (select policyname from ours)),
         (select string_agg(policyname || ' [' || cmd || ']', ', ') from object_policies where rule ilike '%home-floor-plans%' and policyname not in (select policyname from ours))
  union all
  select 11, 'info: legacy homes.floor_plan_image_url (not touched)', true,
         case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'homes' and column_name = 'floor_plan_image_url') then 'present' else 'absent' end
  union all
  select 12, 'info: home-photos bucket (not touched)', true,
         coalesce((select 'public=' || b.public from storage.buckets b where b.id = 'home-photos'), 'absent')
) checks
order by section;
