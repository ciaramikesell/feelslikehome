-- Account Settings foundation.
--
-- This adds exactly one new RPC: a narrow, owner-only projection of a
-- search's relationships (co-buyer/Realtor identity) for the new /account
-- page's Connections section. It reuses resolve_display_name (added by the
-- account-name-capture migration) rather than re-deriving names again.
--
-- Deliberately NOT included: any FLH+/entitlement/purchase schema. The
-- Account Settings UI in this pass derives its Free/FLH+ presentation from
-- data that already exists (whether the search already has a co-buyer or
-- Realtor member) rather than a persisted "this search purchased FLH+"
-- flag, because no payment/entitlement architecture exists yet and this
-- pass must not invent one. See src/app/(app)/account/page.js for that
-- reasoning and the explicit seam left for a future payment pass.
begin;

-- Owner-only: only the person who owns a search should see who is
-- connected to it from their own Account Settings. This mirrors
-- get_realtor_client_roster's shape (search-scoped, no contact details
-- beyond a resolved display name) but for the opposite viewpoint — the
-- buyer looking at their own search's co-buyer/Realtor, not a Realtor
-- looking at their client roster.
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
