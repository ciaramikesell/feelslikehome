-- Bridge: resolve_collaborator_search_context gains its display_name column.
--
-- 2026-09-16-map-collaborator-places.sql and
-- 2026-09-16-my-search-collaborator-display-name.sql both redefine this
-- function with a 4th output column (display_name) using CREATE OR REPLACE.
-- Postgres cannot change a function's return type in place (42P13 "cannot
-- change return type of existing function"), so on any database that still
-- has the 3-column 2026-09-10 / 2026-09-16 version (production, per the
-- 2026-10-08 inventory) both migrations fail and roll back, and
-- 2026-09-19-account-name-capture-and-realtor-home.sql (which redefines the
-- 4-column version) fails the same way.
--
-- Only when the installed function still returns 3 columns, this drops it
-- and creates the 2026-09-16-my-search-collaborator-display-name.sql
-- definition verbatim, in ONE transaction, so callers never see the function
-- missing. On a database that already has a 4-column version (including the
-- newer 2026-09-19 one) it changes NOTHING, so replaying migrations in
-- filename order can never downgrade the function.
--
-- Nothing depends on the function (no view, policy, or other function
-- references it). The definition is that reviewed migration's, unchanged:
-- SECURITY DEFINER, empty search_path, can_access_search check, same
-- projection plus the collaborator's display name. Execute is revoked from
-- public/anon/service_role and granted to authenticated only, exactly as
-- before (re-asserting those grants is a no-op on a 4-column version). No
-- data is read or written.
--
-- Production order: apply BEFORE
-- 2026-09-19-account-name-capture-and-realtor-home.sql, which then replaces
-- it with the name-aware version. Never apply map-collaborator-places.sql or
-- my-search-collaborator-display-name.sql: both are superseded.
begin;

do $do$
begin
  if exists (
    select 1 from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname = 'resolve_collaborator_search_context'
      and pg_get_function_result(p.oid) not like '%display_name%'
  ) then
    drop function public.resolve_collaborator_search_context(uuid);
    execute $bridge$
create function public.resolve_collaborator_search_context(p_search_id uuid)
returns table (priorities jsonb, commute_destinations jsonb, home_states jsonb, display_name text)
language plpgsql
security definer
set search_path = ''
stable
as $$
declare
  v_caller uuid := auth.uid();
  v_collaborator uuid;
begin
  if v_caller is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if not coalesce(public.can_access_search(p_search_id, v_caller), false) then
    raise exception 'Search access denied' using errcode = '42501';
  end if;

  select participant.user_id into v_collaborator
  from (
    select s.user_id from public.searches s where s.id = p_search_id
    union
    select sm.user_id from public.search_members sm where sm.search_id = p_search_id and sm.role = 'co_buyer'
  ) participant
  where participant.user_id <> v_caller
  limit 1;

  if v_collaborator is null then return; end if;

  return query
  select
    coalesce((select smp.priorities from public.search_member_priorities smp
      where smp.search_id = p_search_id and smp.user_id = v_collaborator), '{}'::jsonb),
    coalesce((select jsonb_agg(jsonb_build_object(
      'label', d.label, 'address', d.address, 'maxDriveMinutes', d.max_drive_minutes
    ) order by d.created_at)
      from public.commute_destinations d
      where d.search_id = p_search_id and d.user_id = v_collaborator), '[]'::jsonb),
    coalesce((select jsonb_agg(jsonb_build_object(
      'homeId', hms.home_id, 'status', hms.status, 'touredAt', hms.toured_at,
      'isFavorite', hms.is_favorite, 'reaction', hms.reaction
    )) from public.home_member_state hms
      join public.homes h on h.id = hms.home_id
      where h.search_id = p_search_id and hms.user_id = v_collaborator), '[]'::jsonb),
    (select coalesce(nullif(initcap(replace(split_part(u.email, '@', 1), '.', ' ')), ''), 'Your collaborator')
      from auth.users u where u.id = v_collaborator);
end;
$$;
$bridge$;
  end if;
end
$do$;

revoke all on function public.resolve_collaborator_search_context(uuid) from public;
revoke execute on function public.resolve_collaborator_search_context(uuid) from anon;
revoke execute on function public.resolve_collaborator_search_context(uuid) from service_role;
grant execute on function public.resolve_collaborator_search_context(uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
