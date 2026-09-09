-- Pass 3C.1A: additive privacy foundation.
-- This migration deliberately does not change RLS or existing table grants.

-- Preserve the original adder's legacy state before later reads move exclusively
-- to participant-owned rows. Existing participant state always wins.
insert into public.home_member_state (
  home_id, user_id, status, reaction, toured_at, is_favorite,
  rejection_reason, ratings, checks
)
select
  h.id, h.user_id, h.status, h.reaction, h.toured_at, h.is_favorite,
  h.rejection_reason, h.ratings, h.checks
from public.homes h
on conflict (home_id, user_id) do nothing;

-- Preserve each search owner's priority document without replacing a document
-- that has already moved to participant-owned storage.
insert into public.search_member_priorities (search_id, user_id, priorities)
select s.id, s.user_id, s.priorities
from public.searches s
on conflict (search_id, user_id) do nothing;

create or replace function public.resolve_cobuyer_lifecycle_signals(
  p_search_id uuid,
  p_home_ids uuid[]
)
returns table (
  home_id uuid,
  co_buyer_wants_to_tour boolean,
  co_buyer_favorited boolean,
  co_buyer_archived boolean,
  all_participants_archived boolean
)
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_home_ids uuid[] := coalesce(p_home_ids, '{}'::uuid[]);
begin
  if v_caller is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if p_search_id is null
     or not coalesce(public.can_access_search(p_search_id, v_caller), false) then
    raise exception 'Search access denied' using errcode = '42501';
  end if;

  -- 200 comfortably covers current list pages while bounding cross-products.
  if cardinality(v_home_ids) > 200 then
    raise exception 'Home batch exceeds 200 items' using errcode = '22023';
  end if;

  -- Duplicate IDs are intentionally accepted and deduplicated. The bound above
  -- applies to raw input elements; requested_homes below reads the base table,
  -- so [A,A] returns one A row and duplicates cannot weight an aggregate.
  -- NULL and '{}' both resolve to an empty array and safely return zero rows
  -- after search authorization still runs.
  if array_position(v_home_ids, null) is not null
     or (select count(distinct requested.home_id)
         from unnest(v_home_ids) as requested(home_id))
        <> (select count(*)
            from public.homes h
            where h.search_id = p_search_id
              and h.id = any(v_home_ids)) then
    -- One response covers missing, inaccessible, and wrong-search identifiers.
    raise exception 'Invalid home batch' using errcode = '22023';
  end if;

  return query
  with participants as (
    -- search_members is the current-membership relation: invitations have their
    -- own status table, acceptance creates this row, and remove/leave deletes it.
    select s.user_id
    from public.searches s
    where s.id = p_search_id
    union
    select sm.user_id
    from public.search_members sm
    where sm.search_id = p_search_id
  ),
  requested_homes as (
    select h.id, h.user_id, h.status, h.toured_at, h.is_favorite
    from public.homes h
    where h.search_id = p_search_id
      and h.id = any(v_home_ids)
  ),
  resolved_state as (
    select
      h.id as home_id,
      p.user_id,
      case
        when hms.id is not null then hms.status
        when p.user_id = h.user_id then h.status
        else null
      end as status,
      case
        when hms.id is not null then hms.toured_at
        when p.user_id = h.user_id then h.toured_at
        else null
      end as toured_at,
      case
        when hms.id is not null then hms.is_favorite
        when p.user_id = h.user_id then h.is_favorite
        else false
      end as is_favorite
    from requested_homes h
    cross join participants p
    left join public.home_member_state hms
      on hms.home_id = h.id and hms.user_id = p.user_id
  )
  select
    rs.home_id,
    coalesce(bool_or(
      rs.status = 'Want to Tour'
      and not (rs.toured_at is not null or rs.status = 'Toured')
    ) filter (where rs.user_id <> v_caller), false),
    coalesce(bool_or(rs.is_favorite)
      filter (where rs.user_id <> v_caller), false),
    coalesce(bool_or(coalesce(rs.status = 'Archived', false))
      filter (where rs.user_id <> v_caller), false),
    coalesce(bool_and(coalesce(rs.status = 'Archived', false)), false)
  from resolved_state rs
  group by rs.home_id;
end;
$$;

revoke all on function public.resolve_cobuyer_lifecycle_signals(uuid, uuid[]) from public;
revoke execute on function public.resolve_cobuyer_lifecycle_signals(uuid, uuid[]) from anon;
revoke execute on function public.resolve_cobuyer_lifecycle_signals(uuid, uuid[]) from service_role;
grant execute on function public.resolve_cobuyer_lifecycle_signals(uuid, uuid[]) to authenticated;
