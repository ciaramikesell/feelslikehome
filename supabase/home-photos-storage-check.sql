-- READ-ONLY check of the production `home-photos` Storage bucket the home
-- overlay uploads to (src/lib/homePhoto.js). The bucket and its policies live
-- in the Supabase dashboard, not in this repository, so this shows what is
-- actually configured. One SELECT: settings, policy text and COUNTS only — no
-- object names, paths, owners or any other user data.
--
-- Expected for the overlay's upload / display / replace to work:
--   1  the bucket exists and is public (photos render from getPublicUrl)
--   2  its size limit is at least 5 MB, or unset (the app allows up to 5 MB)
--   3  its MIME allow-list is unset, or includes image/jpeg, image/png, image/webp
--   4  an INSERT policy on storage.objects lets a signed-in user write into
--      their own folder: (storage.foldername(name))[1] = auth.uid()::text
--   5  a DELETE policy lets the uploader remove their own objects (replaced
--      photos are deleted best-effort; without it they are simply left behind)
-- Rows 6–7 are informational.
with bucket as (
  select b.public, b.file_size_limit, b.allowed_mime_types
  from storage.buckets b where b.id = 'home-photos'
),
policies as (
  select p.policyname, p.cmd, p.roles::text as roles, coalesce(p.qual, '') || ' ' || coalesce(p.with_check, '') as rule
  from pg_policies p
  where p.schemaname = 'storage' and p.tablename = 'objects'
    and (coalesce(p.qual, '') || coalesce(p.with_check, '')) ilike '%home-photos%'
)
select 1 as section, 'bucket home-photos exists and is public' as item,
       coalesce((select public from bucket), false) as ok,
       case when exists (select 1 from bucket) then null else 'bucket not found' end as detail
union all
select 2, 'size limit is unset or at least 5 MB (5242880 bytes)',
       coalesce((select file_size_limit is null or file_size_limit >= 5242880 from bucket), false),
       (select coalesce(file_size_limit::text, 'unset') from bucket)
union all
select 3, 'MIME allow-list is unset or allows jpeg, png and webp',
       coalesce((select allowed_mime_types is null or allowed_mime_types @> array['image/jpeg', 'image/png', 'image/webp'] from bucket), false),
       (select coalesce(array_to_string(allowed_mime_types, ', '), 'unset') from bucket)
union all
select 4, 'an INSERT policy for home-photos exists (review: own folder = auth.uid())',
       exists (select 1 from policies where cmd in ('INSERT', 'ALL')),
       (select string_agg(policyname || ' [' || cmd || ' ' || roles || ']: ' || rule, ' | ') from policies where cmd in ('INSERT', 'ALL'))
union all
select 5, 'a DELETE policy for home-photos exists (review: own objects only)',
       exists (select 1 from policies where cmd in ('DELETE', 'ALL')),
       (select string_agg(policyname || ' [' || cmd || ' ' || roles || ']: ' || rule, ' | ') from policies where cmd in ('DELETE', 'ALL'))
union all
select 6, 'info: all home-photos policies on storage.objects', true,
       (select string_agg(policyname || ' [' || cmd || ']', ', ') from policies)
union all
select 7, 'info: objects currently in home-photos', true,
       (select count(*)::text from storage.objects o where o.bucket_id = 'home-photos')
order by section;
