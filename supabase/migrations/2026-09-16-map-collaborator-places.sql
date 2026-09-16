-- PR #87 (Neighborhood Map visual refresh): the Map needs to trust-render a
-- collaborator's Places That Matter as markers, which requires their
-- coordinate provenance (latitude/longitude/coordinate_status/fingerprint) --
-- the same fields currentDestinationCoordinates() already requires to trust
-- the CURRENT user's own destinations (see src/lib/commute.js). This adds
-- those columns to resolve_collaborator_search_context's existing
-- commute_destinations projection. Same access guard, same v_collaborator
-- resolution, same participant already authorized by this function; no new
-- endpoint, no RLS change, no broader grant.
begin;

create or replace function public.resolve_collaborator_search_context(p_search_id uuid)
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
      'id', d.id, 'label', d.label, 'address', d.address, 'maxDriveMinutes', d.max_drive_minutes,
      'latitude', d.latitude, 'longitude', d.longitude,
      'coordinateAddressFingerprint', d.coordinate_address_fingerprint, 'coordinateStatus', d.coordinate_status
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

revoke all on function public.resolve_collaborator_search_context(uuid) from public;
revoke execute on function public.resolve_collaborator_search_context(uuid) from anon;
revoke execute on function public.resolve_collaborator_search_context(uuid) from service_role;
grant execute on function public.resolve_collaborator_search_context(uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
