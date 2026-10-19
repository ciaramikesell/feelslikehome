-- READ-ONLY Storage usage report for the private home-floor-plans bucket.
-- Run weekly after the UI ships, then monthly (docs/floor-plans-foundation.md,
-- "Storage usage monitoring"). One SELECT: counts and bytes only — no object
-- names, paths, home ids or any other user data. Changes nothing.
--
--  1  floor-plan rows / homes with plans
--  2  images in the bucket / their bytes
--  3  homes whose folder holds more than 8 images — above 0 means the
--     best-effort upload cap was exceeded (simultaneous uploads or abuse)
--  4  images with no floor-plan row: all / older than 24 h (what the sweep's
--     dry run would report), with bytes
--  5  largest home folder: images / bytes
--  6  homes with more than 4 floor-plan rows — must be 0 (strict limit)
select * from (
  with objects as (
    select o.name, o.created_at, coalesce((o.metadata ->> 'size')::bigint, 0) as bytes,
           split_part(o.name, '/', 1) as folder,
           exists (select 1 from public.home_floor_plans f where f.storage_path = o.name) as referenced
    from storage.objects o where o.bucket_id = 'home-floor-plans'
  ),
  folders as (select folder, count(*) as images, sum(bytes) as bytes from objects group by folder)
  select 1 as section, 'floor-plan rows / homes with plans' as item,
         (select count(*) from public.home_floor_plans)::text || ' / ' || (select count(distinct home_id) from public.home_floor_plans)::text as value
  union all
  select 2, 'images in the bucket / bytes',
         (select count(*) from objects)::text || ' / ' || (select coalesce(sum(bytes), 0) from objects)::text
  union all
  select 3, 'homes whose folder holds more than 8 images (best-effort cap exceeded)',
         (select count(*) from folders where images > 8)::text
  union all
  select 4, 'images with no row: all / older than 24 h (bytes)',
         (select count(*) from objects where not referenced)::text || ' (' || (select coalesce(sum(bytes), 0) from objects where not referenced)::text || ') / '
           || (select count(*) from objects where not referenced and created_at < now() - interval '24 hours')::text || ' ('
           || (select coalesce(sum(bytes), 0) from objects where not referenced and created_at < now() - interval '24 hours')::text || ')'
  union all
  select 5, 'largest home folder: images / bytes',
         coalesce((select images::text || ' / ' || bytes::text from folders order by images desc, bytes desc limit 1), '0 / 0')
  union all
  select 6, 'homes with more than 4 floor-plan rows (must be 0)',
         (select count(*) from (select home_id from public.home_floor_plans group by home_id having count(*) > 4) h)::text
) report
order by section;
