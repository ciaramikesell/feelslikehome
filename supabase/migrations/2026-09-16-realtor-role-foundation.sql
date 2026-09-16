-- PR #78: search-scoped Owner / Co-buyer / Realtor permission foundation.
-- Existing `member` rows are preserved as decision-makers by migrating them to
-- `co_buyer`; no account-wide role is introduced.
begin;

alter table public.search_members drop constraint if exists search_members_role_check;
update public.search_members set role = 'co_buyer' where role = 'member';
alter table public.search_members alter column role set default 'co_buyer';
alter table public.search_members add constraint search_members_role_check
  check (role in ('co_buyer', 'realtor'));

alter table public.search_invitations add column if not exists relationship_type text;
update public.search_invitations set relationship_type = 'co_buyer' where relationship_type is null;
alter table public.search_invitations alter column relationship_type set default 'co_buyer';
alter table public.search_invitations alter column relationship_type set not null;
alter table public.search_invitations drop constraint if exists search_invitations_relationship_type_check;
alter table public.search_invitations add constraint search_invitations_relationship_type_check
  check (relationship_type in ('co_buyer', 'realtor'));

create or replace function public.is_search_realtor(p_search_id uuid, p_user_id uuid)
returns boolean language sql security definer stable set search_path = '' as $$
  select exists (select 1 from public.search_members sm
    where sm.search_id = p_search_id and sm.user_id = p_user_id and sm.role = 'realtor');
$$;
create or replace function public.is_search_decision_maker(p_search_id uuid, p_user_id uuid)
returns boolean language sql security definer stable set search_path = '' as $$
  select public.is_search_owner(p_search_id, p_user_id) or exists (
    select 1 from public.search_members sm
    where sm.search_id = p_search_id and sm.user_id = p_user_id and sm.role = 'co_buyer');
$$;
revoke all on function public.is_search_realtor(uuid, uuid) from public;
revoke all on function public.is_search_decision_maker(uuid, uuid) from public;
grant execute on function public.is_search_realtor(uuid, uuid) to authenticated;
grant execute on function public.is_search_decision_maker(uuid, uuid) to authenticated;

-- Owners may only create memberships through the email-bound acceptance RPC.
drop policy if exists "search_members_owner_insert" on public.search_members;

-- Realtors can inspect buyer decision inputs and outcomes, but every write is
-- restricted to the owner/co-buyer decision-makers and their own row.
drop policy if exists "smp_own_select" on public.search_member_priorities;
create policy "smp_participant_or_realtor_select" on public.search_member_priorities
  for select using (auth.uid() = user_id or public.is_search_realtor(search_id, auth.uid()));
drop policy if exists "smp_own_insert" on public.search_member_priorities;
create policy "smp_decision_maker_insert" on public.search_member_priorities
  for insert with check (auth.uid() = user_id and public.is_search_decision_maker(search_id, auth.uid()));
drop policy if exists "smp_own_update" on public.search_member_priorities;
create policy "smp_decision_maker_update" on public.search_member_priorities
  for update using (auth.uid() = user_id and public.is_search_decision_maker(search_id, auth.uid()))
  with check (auth.uid() = user_id and public.is_search_decision_maker(search_id, auth.uid()));

drop policy if exists "hms_select_own" on public.home_member_state;
drop policy if exists "hms_select_members" on public.home_member_state;
create policy "hms_participant_or_realtor_select" on public.home_member_state
  for select using (auth.uid() = user_id or public.is_search_realtor((select h.search_id from public.homes h where h.id = home_id), auth.uid()));
drop policy if exists "hms_own_insert" on public.home_member_state;
create policy "hms_decision_maker_insert" on public.home_member_state
  for insert with check (auth.uid() = user_id and public.is_search_decision_maker((select h.search_id from public.homes h where h.id = home_id), auth.uid()));
drop policy if exists "hms_own_update" on public.home_member_state;
create policy "hms_decision_maker_update" on public.home_member_state
  for update using (auth.uid() = user_id and public.is_search_decision_maker((select h.search_id from public.homes h where h.id = home_id), auth.uid()))
  with check (auth.uid() = user_id and public.is_search_decision_maker((select h.search_id from public.homes h where h.id = home_id), auth.uid()));

drop policy if exists "commute_destinations_select_own" on public.commute_destinations;
create policy "commute_destinations_participant_or_realtor_select" on public.commute_destinations
  for select using (auth.uid() = user_id or public.is_search_realtor(search_id, auth.uid()));
drop policy if exists "commute_destinations_insert_own" on public.commute_destinations;
create policy "commute_destinations_decision_maker_insert" on public.commute_destinations
  for insert with check (auth.uid() = user_id and public.is_search_decision_maker(search_id, auth.uid()));
drop policy if exists "commute_destinations_update_own" on public.commute_destinations;
create policy "commute_destinations_decision_maker_update" on public.commute_destinations
  for update using (auth.uid() = user_id and public.is_search_decision_maker(search_id, auth.uid()))
  with check (auth.uid() = user_id and public.is_search_decision_maker(search_id, auth.uid()));
drop policy if exists "commute_destinations_delete_own" on public.commute_destinations;
create policy "commute_destinations_decision_maker_delete" on public.commute_destinations
  for delete using (auth.uid() = user_id and public.is_search_decision_maker(search_id, auth.uid()));


create or replace function public.resolve_shared_fact_priority_awareness(p_search_id uuid)
returns table (
  field text,
  criterion_key text,
  selected_by_current_user boolean,
  selected_by_co_buyer boolean,
  selected_by_both boolean,
  co_buyer_only boolean,
  eligible_for_shared_fact_capture boolean
)
language plpgsql
security definer
set search_path = ''
stable
as $$
declare
  v_caller uuid := auth.uid();
begin
  if v_caller is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if not coalesce(public.can_access_search(p_search_id, v_caller), false) then
    raise exception 'Search access denied' using errcode = '42501';
  end if;

  return query
  with search_row as (
    select s.user_id as owner_id, s.priorities as owner_priorities
    from public.searches s
    where s.id = p_search_id
  ),
  participants as (
    select sr.owner_id as user_id from search_row sr
    union
    select sm.user_id
    from public.search_members sm
    where sm.search_id = p_search_id and sm.role = 'co_buyer'
  ),
  resolved_priorities as (
    select
      p.user_id,
      coalesce(smp.priorities,
        case when p.user_id = sr.owner_id then sr.owner_priorities else '{}'::jsonb end,
        '{}'::jsonb) as priorities
    from participants p
    cross join search_row sr
    left join public.search_member_priorities smp
      on smp.search_id = p_search_id and smp.user_id = p.user_id
  ),
  selections as (
    select rp.user_id, f.field, f.criterion_key,
      case f.criterion_key
        when 'budget' then coalesce(rp.priorities #>> '{budget,tier}', 'important') <> 'dontcare'
        when 'bedsMin' then coalesce(rp.priorities #>> '{bedsMin,tier}', 'important') <> 'dontcare'
        when 'bathsMin' then coalesce(rp.priorities #>> '{bathsMin,tier}', 'nice') <> 'dontcare'
        when 'sqftTarget' then coalesce(rp.priorities #>> '{sqftTarget,tier}', 'nice') <> 'dontcare'
        when 'lotSizeTarget' then coalesce(rp.priorities #>> '{lotSizeTarget,tier}', 'dontcare') <> 'dontcare'
        when 'homeLayout' then coalesce(rp.priorities #>> '{homeLayout,tier}', 'dontcare') <> 'dontcare'
        when 'homeCondition' then coalesce(rp.priorities #>> '{homeCondition,tier}', 'dontcare') <> 'dontcare'
        when 'primaryBedroomLocation' then coalesce(rp.priorities #>> '{primaryBedroomLocation,tier}', 'dontcare') <> 'dontcare'
        when 'secondaryBedroomLocation' then coalesce(rp.priorities #>> '{secondaryBedroomLocation,tier}', 'dontcare') <> 'dontcare'
        when 'exterior:Garage' then coalesce(rp.priorities #>> '{exterior,tiers,Garage}', 'dontcare') <> 'dontcare'
        when 'features:Basement' then coalesce(rp.priorities #>> '{features,tiers,Basement}', 'dontcare') <> 'dontcare'
        when 'preferredPropertyTypes' then
          coalesce(rp.priorities #>> '{preferredPropertyTypes,tier}', 'important') <> 'dontcare'
          and jsonb_array_length(case when jsonb_typeof(rp.priorities -> 'preferredPropertyTypes') = 'array' then rp.priorities -> 'preferredPropertyTypes' else coalesce(rp.priorities #> '{preferredPropertyTypes,values}', '[]'::jsonb) end) > 0
        when 'features:Pets Allowed' then coalesce(rp.priorities #>> '{features,tiers,Pets Allowed}', 'dontcare') <> 'dontcare'
        when 'features:Utilities Included' then coalesce(rp.priorities #>> '{features,tiers,Utilities Included}', 'dontcare') <> 'dontcare'
        when 'features:In-Unit Laundry' then coalesce(rp.priorities #>> '{features,tiers,In-Unit Laundry}', 'dontcare') <> 'dontcare'
        when 'location:Schools' then
          coalesce(rp.priorities #>> '{location,schoolsRelevance}', '') <> 'no'
          and coalesce(rp.priorities #>> '{location,tiers,Schools}', 'dontcare') <> 'dontcare'
        else false
      end as selected
    from resolved_priorities rp
    cross join (values
      ('price', 'budget'),
      ('beds', 'bedsMin'),
      ('baths', 'bathsMin'),
      ('sqft', 'sqftTarget'),
      ('lotSize', 'lotSizeTarget'),
      ('homeLayout', 'homeLayout'),
      ('homeCondition', 'homeCondition'),
      ('primaryBedroomLocation', 'primaryBedroomLocation'),
      ('secondaryBedroomLocation', 'secondaryBedroomLocation'),
      ('garageSpaces', 'exterior:Garage'),
      ('basementNotes', 'features:Basement'),
      ('schoolsNotes', 'location:Schools'),
      ('propertyType', 'preferredPropertyTypes'),
      ('petsAllowed', 'features:Pets Allowed'),
      ('utilitiesIncluded', 'features:Utilities Included'),
      ('inUnitLaundry', 'features:In-Unit Laundry')
    ) as f(field, criterion_key)
  ),
  projected as (
    select s.field, s.criterion_key,
      bool_or(s.selected) filter (where s.user_id = v_caller) as current_selected,
      coalesce(bool_or(s.selected) filter (where s.user_id <> v_caller), false) as cobuyer_selected
    from selections s
    group by s.field, s.criterion_key
  )
  select p.field, p.criterion_key,
    coalesce(p.current_selected, false),
    p.cobuyer_selected,
    coalesce(p.current_selected, false) and p.cobuyer_selected,
    not coalesce(p.current_selected, false) and p.cobuyer_selected,
    coalesce(p.current_selected, false) or p.cobuyer_selected
  from projected p;
end;
$$;

revoke all on function public.resolve_shared_fact_priority_awareness(uuid) from public;
grant execute on function public.resolve_shared_fact_priority_awareness(uuid) to authenticated;


create or replace function public.resolve_cobuyer_compare_perspectives(
  p_search_id uuid,
  p_home_ids uuid[]
)
returns table (
  home_id uuid,
  pct integer,
  evaluated_count integer,
  selected_count integer,
  overall_feeling integer,
  different_takes jsonb
)
language plpgsql
security definer
set search_path = ''
stable
as $$
declare
  v_caller uuid := auth.uid();
  v_participant uuid;
  v_priorities jsonb;
  v_home public.homes%rowtype;
  v_state public.home_member_state%rowtype;
  v_caller_state public.home_member_state%rowtype;
  v_tier text;
  v_target numeric;
  v_actual numeric;
  v_actual_text text;
  v_score numeric;
  v_weight numeric;
  v_total_weight numeric;
  v_weighted_sum numeric;
  v_selected integer;
  v_evaluated integer;
  v_category text;
  v_label text;
  v_key text;
  v_raw jsonb;
  v_caller_raw jsonb;
  v_differences jsonb;
  v_legacy_ratings jsonb;
  v_legacy_checks jsonb;
begin
  if v_caller is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if not coalesce(public.can_access_search(p_search_id, v_caller), false) then
    raise exception 'Search access denied' using errcode = '42501';
  end if;

  -- V1 collaboration permits one co-buyer. Selecting only an accepted
  -- participant prevents a caller from choosing an arbitrary user id.
  select p.user_id into v_participant
  from (
    select s.user_id from public.searches s where s.id = p_search_id
    union
    select sm.user_id from public.search_members sm where sm.search_id = p_search_id and sm.role = 'co_buyer'
  ) p
  where p.user_id <> v_caller
  limit 1;
  if v_participant is null then return; end if;

  select coalesce(smp.priorities,
    case when s.user_id = v_participant then s.priorities else '{}'::jsonb end,
    '{}'::jsonb)
  into v_priorities
  from public.searches s
  left join public.search_member_priorities smp
    on smp.search_id = s.id and smp.user_id = v_participant
  where s.id = p_search_id;

  for v_home in
    select h.* from public.homes h
    where h.search_id = p_search_id and h.id = any(coalesce(p_home_ids, '{}'::uuid[]))
  loop
    select * into v_state from public.home_member_state hms
      where hms.home_id = v_home.id and hms.user_id = v_participant;
    select * into v_caller_state from public.home_member_state hms
      where hms.home_id = v_home.id and hms.user_id = v_caller;

    v_legacy_ratings := case when v_home.user_id = v_participant then v_home.ratings else '{}'::jsonb end;
    v_legacy_checks := case when v_home.user_id = v_participant then v_home.checks else '{}'::jsonb end;
    v_selected := 0; v_evaluated := 0; v_total_weight := 0; v_weighted_sum := 0;

    -- Numeric threshold priorities share computeMatch's partial-credit rules.
    for v_key, v_actual in select * from (values
      ('budget', nullif(regexp_replace(v_home.price, '[^0-9.]', '', 'g'), '')::numeric),
      ('sqftTarget', nullif(regexp_replace(v_home.sqft, '[^0-9.]', '', 'g'), '')::numeric),
      ('lotSizeTarget', nullif(regexp_replace(v_home.lot_size, '[^0-9.]', '', 'g'), '')::numeric),
      ('bedsMin', nullif(regexp_replace(v_home.beds, '[^0-9.]', '', 'g'), '')::numeric),
      ('bathsMin', nullif(regexp_replace(v_home.baths, '[^0-9.]', '', 'g'), '')::numeric)
    ) n(key, actual)
    loop
      v_tier := coalesce(v_priorities #>> array[v_key, 'tier'], 'dontcare');
      v_target := nullif(regexp_replace(v_priorities #>> array[v_key, 'value'], '[^0-9.]', '', 'g'), '')::numeric;
      if v_tier <> 'dontcare' and v_target is not null and v_target > 0 then
        v_selected := v_selected + 1;
        if v_actual is not null then
          v_evaluated := v_evaluated + 1;
          v_weight := case v_tier when 'must' then 4 when 'important' then 2 else 1 end;
          v_score := case when v_key = 'budget'
            then greatest(0, 1 - greatest(0, v_actual - v_target) / v_target)
            else least(1, v_actual / v_target) end;
          v_total_weight := v_total_weight + v_weight;
          v_weighted_sum := v_weighted_sum + v_score * v_weight;
        end if;
      end if;
    end loop;

    -- Shared categorical facts.
    for v_key in select unnest(array['homeLayout','homeCondition']) loop
      v_tier := coalesce(v_priorities #>> array[v_key, 'tier'], 'dontcare');
      if v_tier <> 'dontcare' and jsonb_array_length(coalesce(v_priorities #> array[v_key, 'values'], '[]'::jsonb)) > 0 then
        v_selected := v_selected + 1;
        if (case v_key when 'homeLayout' then cardinality(v_home.home_layout) else cardinality(v_home.home_condition) end) > 0 then
          v_evaluated := v_evaluated + 1;
          v_weight := case v_tier when 'must' then 4 when 'important' then 2 else 1 end;
          v_score := case when v_key = 'homeLayout' then exists (
            select 1 from unnest(v_home.home_layout) x where v_priorities #> array[v_key, 'values'] ? x
          ) else exists (
            select 1 from unnest(v_home.home_condition) x where v_priorities #> array[v_key, 'values'] ? x
          ) end::integer;
          v_total_weight := v_total_weight + v_weight; v_weighted_sum := v_weighted_sum + v_score * v_weight;
        end if;
      end if;
    end loop;

    for v_key, v_actual_text in select * from (values
      ('primaryBedroomLocation', v_home.primary_bedroom_location),
      ('secondaryBedroomLocation', v_home.secondary_bedroom_location)
    ) s(key, actual)
    loop
      v_tier := coalesce(v_priorities #>> array[v_key, 'tier'], 'dontcare');
      if v_tier <> 'dontcare' and coalesce(v_priorities #>> array[v_key, 'value'], '') <> '' then
        v_selected := v_selected + 1;
        if coalesce(v_actual_text, '') <> '' then
          v_evaluated := v_evaluated + 1;
          v_weight := case v_tier when 'must' then 4 when 'important' then 2 else 1 end;
          v_score := (v_actual_text = v_priorities #>> array[v_key, 'value'])::integer;
          v_total_weight := v_total_weight + v_weight; v_weighted_sum := v_weighted_sum + v_score * v_weight;
        end if;
      end if;
    end loop;

    -- Future first-class property type preference. Values remain private;
    -- only their contribution to the sanitized score leaves this function.
    v_raw := case when jsonb_typeof(v_priorities -> 'preferredPropertyTypes') = 'array'
      then v_priorities -> 'preferredPropertyTypes'
      else coalesce(v_priorities #> '{preferredPropertyTypes,values}', '[]'::jsonb) end;
    v_tier := coalesce(v_priorities #>> '{preferredPropertyTypes,tier}', 'important');
    if v_tier <> 'dontcare' and jsonb_array_length(v_raw) > 0 then
      v_selected := v_selected + 1;
      if v_home.property_type is not null then
        v_evaluated := v_evaluated + 1;
        v_weight := case v_tier when 'must' then 4 when 'important' then 2 else 1 end;
        v_score := (v_raw ? v_home.property_type)::integer;
        v_total_weight := v_total_weight + v_weight;
        v_weighted_sum := v_weighted_sum + v_score * v_weight;
      end if;
    end if;

    -- Item-list priorities. Their selected tiers are the canonical stored list;
    -- state shape determines rating vs explicit Yes/No without disclosing either.
    foreach v_category in array array['location','features','exterior','homeFeel'] loop
      for v_label, v_tier in select key, value #>> '{}' from jsonb_each(coalesce(v_priorities #> array[v_category, 'tiers'], '{}'::jsonb)) loop
        if v_tier = 'dontcare' or (v_category = 'location' and v_label = 'Schools' and v_priorities #>> '{location,schoolsRelevance}' = 'no') then continue; end if;
        v_selected := v_selected + 1; v_key := v_category || ':' || v_label;
        -- These shared facts are authoritative. NULL is unevaluated and never
        -- falls back to participant-private historical checks.
        if v_key = any(array['features:Pets Allowed','features:Utilities Included','features:In-Unit Laundry']) then
          v_score := case v_key
            when 'features:Pets Allowed' then v_home.pets_allowed::integer
            when 'features:Utilities Included' then v_home.utilities_included::integer
            when 'features:In-Unit Laundry' then v_home.in_unit_laundry::integer end;
          if v_score is null then continue; end if;
          v_evaluated := v_evaluated + 1;
          v_weight := case v_tier when 'must' then 4 when 'important' then 2 else 1 end;
          v_total_weight := v_total_weight + v_weight;
          v_weighted_sum := v_weighted_sum + v_score * v_weight;
          continue;
        end if;
        v_raw := coalesce(v_state.ratings, v_legacy_ratings) -> v_key;
        if v_raw is not null and jsonb_typeof(v_raw) = 'number' and (v_raw #>> '{}')::numeric > 0 then
          v_score := (v_raw #>> '{}')::numeric / 5; v_evaluated := v_evaluated + 1;
        elsif v_category = 'exterior' and v_label = 'Garage' and coalesce(v_home.garage_spaces, '') <> '' then
          v_score := (nullif(regexp_replace(v_home.garage_spaces, '[^0-9.]', '', 'g'), '')::numeric > 0)::integer; v_evaluated := v_evaluated + 1;
        else
          v_raw := coalesce(v_state.checks, v_legacy_checks) -> v_key;
          if v_raw = 'true'::jsonb then v_score := 1; v_evaluated := v_evaluated + 1;
          elsif v_raw = '"no"'::jsonb then v_score := 0; v_evaluated := v_evaluated + 1;
          else continue;
          end if;
        end if;
        v_weight := case v_tier when 'must' then 4 when 'important' then 2 else 1 end;
        v_total_weight := v_total_weight + v_weight; v_weighted_sum := v_weighted_sum + v_score * v_weight;
      end loop;
    end loop;

    -- Only opposing, actually-evaluated experiential reactions are projected.
    select coalesce(jsonb_agg(jsonb_build_object(
      'key', r.key, 'label', split_part(r.key, ':', 2),
      'youLiked', (c.value #>> '{}')::numeric >= 3,
      'coBuyerLiked', (r.value #>> '{}')::numeric >= 3
    ) order by r.key), '[]'::jsonb)
    into v_differences
    from jsonb_each(coalesce(v_state.ratings, v_legacy_ratings)) r
    join jsonb_each(coalesce(v_caller_state.ratings,
      case when v_home.user_id = v_caller then v_home.ratings else '{}'::jsonb end)) c on c.key = r.key
    where r.key = any(array[
      'homeFeel:Overall Condition','homeFeel:Layout / Flow','homeFeel:Natural Light','homeFeel:Character / Charm','homeFeel:Room Sizes','homeFeel:Openness / Ceiling Height','homeFeel:Privacy',
      'location:Neighborhood','location:Immediate Street / Surroundings','exterior:Yard','exterior:Privacy','exterior:Exterior Condition','exterior:Landscaping','exterior:Outdoor Space','exterior:Noise Level'
    ]) and jsonb_typeof(r.value) = 'number' and jsonb_typeof(c.value) = 'number'
      and (r.value #>> '{}')::numeric > 0 and (c.value #>> '{}')::numeric > 0
      and ((r.value #>> '{}')::numeric >= 3) <> ((c.value #>> '{}')::numeric >= 3);

    home_id := v_home.id;
    selected_count := v_selected;
    evaluated_count := v_evaluated;
    pct := case when v_evaluated > 0 and v_total_weight > 0 then round(v_weighted_sum / v_total_weight * 100)::integer else null end;
    overall_feeling := nullif(coalesce(v_state.ratings, v_legacy_ratings) ->> 'tour:overall', '')::integer;
    different_takes := v_differences;
    return next;
  end loop;
end;
$$;

revoke all on function public.resolve_cobuyer_compare_perspectives(uuid, uuid[]) from public;
revoke execute on function public.resolve_cobuyer_compare_perspectives(uuid, uuid[]) from anon;
revoke execute on function public.resolve_cobuyer_compare_perspectives(uuid, uuid[]) from service_role;
grant execute on function public.resolve_cobuyer_compare_perspectives(uuid, uuid[]) to authenticated;


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
    where sm.search_id = p_search_id and sm.role = 'co_buyer'
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


create or replace function public.resolve_collaborator_search_context(p_search_id uuid)
returns table (priorities jsonb, commute_destinations jsonb, home_states jsonb)
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
      where h.search_id = p_search_id and hms.user_id = v_collaborator), '[]'::jsonb);
end;
$$;

revoke all on function public.resolve_collaborator_search_context(uuid) from public;
revoke execute on function public.resolve_collaborator_search_context(uuid) from anon;
revoke execute on function public.resolve_collaborator_search_context(uuid) from service_role;
grant execute on function public.resolve_collaborator_search_context(uuid) to authenticated;

-- Shared homes remain readable to every accepted relationship, including
-- archived contenders. Only decision-makers may add or edit shared truth.
drop policy if exists "homes_insert_member" on public.homes;
drop policy if exists "homes_insert_accessible_own_adder" on public.homes;
drop policy if exists "homes_insert_own" on public.homes;
create policy "homes_insert_decision_maker" on public.homes
  for insert with check (auth.uid() = user_id and public.is_search_decision_maker(search_id, auth.uid()));
drop policy if exists "homes_update_member" on public.homes;
drop policy if exists "homes_update_decision_maker" on public.homes;
drop policy if exists "homes_update_own" on public.homes;
create policy "homes_update_decision_maker" on public.homes
  for update using (public.is_search_decision_maker(search_id, auth.uid()))
  with check (public.is_search_decision_maker(search_id, auth.uid()));

-- The invite preview discloses only validity and intended relationship.
drop function if exists public.preview_invitation(uuid);
create function public.preview_invitation(p_token uuid)
returns table (valid boolean, reason text, relationship_type text)
language plpgsql security definer stable set search_path = '' as $$
declare inv public.search_invitations%rowtype;
begin
  if auth.uid() is null then return query select false, 'not_authenticated', null::text; return; end if;
  select * into inv from public.search_invitations si where si.token = p_token;
  if inv is null then return query select false, 'not_found', null::text; return; end if;
  if inv.status = 'accepted' then return query select false, 'already_accepted', inv.relationship_type; return; end if;
  if inv.status = 'revoked' then return query select false, 'revoked', inv.relationship_type; return; end if;
  if inv.status = 'expired' or inv.expires_at < now() then return query select false, 'expired', inv.relationship_type; return; end if;
  return query select true, null::text, inv.relationship_type;
end; $$;
revoke all on function public.preview_invitation(uuid) from public;
grant execute on function public.preview_invitation(uuid) to authenticated;

create or replace function public.accept_invitation(p_token uuid)
returns table (success boolean, reason text, search_id uuid)
language plpgsql security definer set search_path = '' as $$
declare inv public.search_invitations%rowtype; caller uuid := auth.uid(); caller_email text;
begin
  if caller is null then return query select false, 'not_authenticated', null::uuid; return; end if;
  select * into inv from public.search_invitations si where si.token = p_token for update;
  if inv is null then return query select false, 'not_found', null::uuid; return; end if;
  if inv.status = 'accepted' then
    if exists (select 1 from public.search_members sm where sm.search_id=inv.search_id and sm.user_id=caller and sm.role=inv.relationship_type)
      then return query select true, 'already_member', inv.search_id; return; end if;
    return query select false, 'already_accepted', null::uuid; return;
  end if;
  if inv.status = 'revoked' then return query select false, 'revoked', null::uuid; return; end if;
  if inv.status = 'expired' or inv.expires_at < now() then return query select false, 'expired', null::uuid; return; end if;
  if inv.invited_by = caller then return query select false, 'self_invite', null::uuid; return; end if;
  select u.email into caller_email from auth.users u where u.id = caller;
  if caller_email is null or lower(caller_email) is distinct from lower(inv.invited_email)
    then return query select false, 'wrong_account', null::uuid; return; end if;
  if exists (select 1 from public.search_members sm where sm.search_id=inv.search_id and sm.user_id=caller) then
    return query select false, 'relationship_conflict', null::uuid; return;
  end if;
  insert into public.search_members(search_id,user_id,role) values(inv.search_id,caller,inv.relationship_type);
  update public.search_invitations si set status='accepted',responded_at=now() where si.id=inv.id;
  return query select true, null::text, inv.search_id;
exception when unique_violation then
  return query select false, 'relationship_conflict', null::uuid;
end; $$;
revoke all on function public.accept_invitation(uuid) from public;
grant execute on function public.accept_invitation(uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
