-- Production repair: resolve_search_relationships(p_search_id) was reported
-- missing from PostgREST's schema cache —
--
--   PGRST202: Could not find the function
--   public.resolve_search_relationships(p_search_id) in the schema cache
--
-- — while linking an existing buyer (Ciara) to an existing co-buyer
-- (Andrew) from Account Settings. This is the exact same category of gap
-- already fixed once for profiles.first_name/last_name
-- (2026-09-21-profiles-name-schema-cache-fix.sql) and once for the Realtor
-- invitation-acceptance chain (2026-09-22-realtor-invitation-acceptance-
-- repair.sql): the function is defined in
-- 2026-09-20-account-settings-foundation.sql and unchanged since, but this
-- database's live PostgREST schema/RPC cache did not have it.
--
-- resolve_search_relationships answers a RELATIONSHIP question (owner/
-- co-buyer/Realtor membership) and is intentionally kept separate from
-- resolve_search_entitlement, which answers a FLH+ ACCESS question — the
-- fact that PostgREST's error suggested resolve_search_entitlement is only
-- its fuzzy name-matching against whatever it does have cached; that
-- function is unrelated and this repair does not touch it or use it as a
-- substitute.
begin;

-- Byte-for-byte the same definition as 2026-09-20-account-settings-
-- foundation.sql — owner-only, no RLS change, no broadened access.
create or replace function public.resolve_search_relationships(p_search_id uuid)
returns table (user_id uuid, role text, display_name text)
language plpgsql
security definer
stable
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if not coalesce(public.is_search_owner(p_search_id, auth.uid()), false) then
    raise exception 'Search access denied' using errcode = '42501';
  end if;

  return query
  select sm.user_id, sm.role, public.resolve_display_name(sm.user_id, initcap(sm.role))
  from public.search_members sm
  where sm.search_id = p_search_id;
end;
$$;

revoke all on function public.resolve_search_relationships(uuid) from public;
revoke execute on function public.resolve_search_relationships(uuid) from anon, service_role;
grant execute on function public.resolve_search_relationships(uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
