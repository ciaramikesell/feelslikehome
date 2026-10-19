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
--     - Fail-closed: it counts storage.objects as the helper's owner, which
--       is only meaningful if that role sees every row (superuser, BYPASSRLS,
--       or the table's owner without FORCE RLS). If it does not, every upload
--       is refused rather than the cap silently counting nothing, and this
--       migration aborts before installing anything.
--     - Best-effort under simultaneous uploads (accepted for v1): Supabase
--       Storage evaluates this policy in a pre-check transaction it rolls
--       back, writes the file, then inserts the row as its own admin role,
--       which RLS does not apply to. Uploads whose pre-checks all run before
--       any of them finishes can together exceed 8. Sequential uploads are
--       capped exactly. The 4-plans-per-home row limit (part 1) is strict.
--       Extra objects never get a row, so Realtors cannot read them and the
--       operator sweep finds them (docs/floor-plans-foundation.md).
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
-- objects"), the whole file rolls back. Do not recreate it by hand without
-- review: the helper functions and the upload-cap check must exist first.
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

-- Whether p_role reads every storage.objects row regardless of RLS, i.e.
-- whether a count taken as that role is a real count. Catalog-only.
create or replace function public.home_floor_plan_role_sees_all_objects(p_role oid)
returns boolean language sql stable set search_path = '' as $$
  select coalesce((
    select (r.rolsuper or r.rolbypassrls or (c.relowner = r.oid and not c.relforcerowsecurity))
       and pg_catalog.has_table_privilege(r.oid, c.oid, 'select')
    from pg_catalog.pg_roles r, pg_catalog.pg_class c
    where r.oid = p_role and c.oid = 'storage.objects'::regclass
  ), false);
$$;

-- Runs as its owner (security definer), so current_user is that owner.
-- Storage calls it from its pre-check only; see the header for why the count
-- is best-effort under simultaneous uploads.
create or replace function public.can_upload_home_floor_plan_object(p_name text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  home uuid := public.home_floor_plan_object_home_id(p_name);
begin
  if home is null or not public.can_edit_home_floor_plans(home) then
    return false;
  end if;
  -- Fail closed: a count this role cannot fully see would always read low.
  if not public.home_floor_plan_role_sees_all_objects((select r.oid from pg_catalog.pg_roles r where r.rolname = current_user)) then
    return false;
  end if;
  return (
    select count(*) from storage.objects o
    where o.bucket_id = 'home-floor-plans' and o.name like home::text || '/%'
  ) < 8;
end;
$$;

revoke all on function public.can_read_home_floor_plan_object(text) from public, anon;
revoke all on function public.can_upload_home_floor_plan_object(text) from public, anon;
revoke all on function public.home_floor_plan_role_sees_all_objects(oid) from public, anon, authenticated;
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

-- Abort unless the upload cap can actually count: the owner of
-- can_upload_home_floor_plan_object (the role running this migration) must see
-- every storage.objects row. Otherwise nothing is installed.
do $$
declare owner_role oid := (select p.proowner from pg_catalog.pg_proc p
                           where p.oid = 'public.can_upload_home_floor_plan_object(text)'::regprocedure);
begin
  if not public.home_floor_plan_role_sees_all_objects(owner_role) then
    raise exception 'Floor-plan upload cap cannot be enforced: role % does not see every storage.objects row (needs BYPASSRLS, superuser, or table ownership without FORCE RLS, plus SELECT)', owner_role::regrole
      using hint = 'Nothing was applied. See docs/floor-plans-foundation.md, "Upload cap".';
  end if;
end $$;

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
