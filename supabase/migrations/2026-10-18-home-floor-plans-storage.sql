-- Floor Plans foundation, part 2 of 2: the private `home-floor-plans` bucket
-- and its storage.objects policies.
--
-- Requires 2026-10-18-home-floor-plans.sql (the table and its helpers).
-- Does not touch the `home-photos` bucket, its policies or any cover photo.
--
-- Bucket: private (no public URLs; the app reads through short-lived signed
-- URLs), 10 MB per object, JPEG / PNG / WebP only. No SVG (scriptable), no
-- HEIC (iOS file pickers already hand over JPEG), no PDF (deferred).
--
-- Object names are '{home_id}/{uuid}.{jpg|png|webp}' — keyed by the home, not
-- the uploader, so any decision-maker can replace or remove a plan another
-- one uploaded. Anything else is rejected (home_floor_plan_object_home_id).
--
-- Policies (authenticated only; nothing for anon):
-- * INSERT: the caller can edit the home's floor plans (owner / co-buyer, not a
--   pending suggestion) and the home's folder holds fewer than 8 objects
--   (4 plans plus room for in-flight replacements), so an upload that never
--   gets a row cannot be repeated without bound.
-- * SELECT (also what createSignedUrl(s) and remove() need):
--     - decision-makers: every object in their homes' folders, so they can
--       finish or clean up a replacement and delete an object whose row is
--       already gone;
--     - everyone else who can read the home (connected Realtors): only
--       objects a home_floor_plans row currently references. An upload with
--       no row, or a removed / replaced plan, is never visible to them.
-- * DELETE: decision-makers, in their homes' folders.
-- * No UPDATE policy: objects are immutable (uploads use upsert: false).
-- Membership is evaluated live: leaving or being removed revokes everything
-- at once. Signed URLs already issued stay valid until they expire.
--
-- If the SQL Editor refuses the policy statements ("must be owner of table
-- objects"), create the same four policies in Dashboard -> Storage ->
-- Policies with the expressions below, then run the verification script.
-- Re-runnable. Ends with a check that aborts if any other storage.objects
-- policy could grant access to this bucket.
begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('home-floor-plans', 'home-floor-plans', false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.can_read_home_floor_plan_object(p_name text)
returns boolean language sql security definer stable set search_path = '' as $$
  select coalesce(
    public.can_edit_home_floor_plans(public.home_floor_plan_object_home_id(p_name))
    or (
      exists (select 1 from public.home_floor_plans f where f.storage_path = p_name)
      and public.can_view_home_floor_plans(public.home_floor_plan_object_home_id(p_name))
    ),
    false);
$$;

create or replace function public.can_upload_home_floor_plan_object(p_name text)
returns boolean language sql security definer stable set search_path = '' as $$
  select coalesce(
    public.can_edit_home_floor_plans(public.home_floor_plan_object_home_id(p_name))
    and (
      select count(*) from storage.objects o
      where o.bucket_id = 'home-floor-plans'
        and o.name like public.home_floor_plan_object_home_id(p_name)::text || '/%'
    ) < 8,
    false);
$$;

revoke all on function public.can_read_home_floor_plan_object(text) from public, anon;
revoke all on function public.can_upload_home_floor_plan_object(text) from public, anon;
grant execute on function public.can_read_home_floor_plan_object(text) to authenticated;
grant execute on function public.can_upload_home_floor_plan_object(text) to authenticated;

drop policy if exists "home_floor_plans_objects_select" on storage.objects;
create policy "home_floor_plans_objects_select" on storage.objects
  for select to authenticated
  using (bucket_id = 'home-floor-plans' and public.can_read_home_floor_plan_object(name));
drop policy if exists "home_floor_plans_objects_insert" on storage.objects;
create policy "home_floor_plans_objects_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'home-floor-plans' and public.can_upload_home_floor_plan_object(name));
drop policy if exists "home_floor_plans_objects_delete" on storage.objects;
create policy "home_floor_plans_objects_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'home-floor-plans' and public.can_edit_home_floor_plans(public.home_floor_plan_object_home_id(name)));

-- Abort if another permissive policy could apply to this bucket: one that
-- names it but is not ours, or one that does not restrict bucket_id at all.
do $$
declare extra text;
begin
  select string_agg(policyname || ' [' || cmd || ']', ', ') into extra from pg_policies p
  where p.schemaname = 'storage' and p.tablename = 'objects' and p.permissive = 'PERMISSIVE'
    and p.policyname not in ('home_floor_plans_objects_select', 'home_floor_plans_objects_insert', 'home_floor_plans_objects_delete')
    and (
      (coalesce(p.qual, '') || ' ' || coalesce(p.with_check, '')) ilike '%home-floor-plans%'
      or (coalesce(p.qual, '') || ' ' || coalesce(p.with_check, '')) not ilike '%bucket_id%'
    );
  if extra is not null then
    raise exception 'storage.objects policies that could grant access to home-floor-plans: %', extra;
  end if;
end $$;

commit;
