-- Search Basics are the search's definition, not weighted Match criteria.
--
-- 1. resolve_cobuyer_compare_perspectives computes the co-buyer's sanitized
--    Match in Postgres. It must agree with computeMatch (src/lib/matching.js),
--    which no longer scores budget, beds, baths, square footage, lot size, home
--    type, layout, condition, or bedroom locations. This also repairs criteria
--    drift: 'exterior:Garage' was restored to purchase Match and
--    'features:Guest / In-Law Suite' is a discontinued offering that still
--    counts in computeMatch, but this function had kept skipping both as
--    retired, so a co-buyer's Garage priority never reached their Match.
--
-- 2. resolve_shared_fact_priority_awareness decides which shared property facts
--    Add/Edit Home asks for. A Basic is now "selected" when the participant has
--    actually filled it in, not by an importance tier that no longer has any
--    meaning (layout/condition defaulted to 'dontcare', so a layout chosen in
--    onboarding never surfaced the Home layout input on Add Home).
--
-- Stored priorities JSON is not modified; old Basics tiers remain but are unused.
-- Signatures, security definer, search_path, and grants are unchanged.

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
        when 'budget' then nullif(regexp_replace(coalesce(rp.priorities #>> '{budget,value}', ''), '[^0-9]', '', 'g'), '') is not null
        when 'bedsMin' then nullif(regexp_replace(coalesce(rp.priorities #>> '{bedsMin,value}', ''), '[^0-9]', '', 'g'), '') is not null
        when 'bathsMin' then nullif(regexp_replace(coalesce(rp.priorities #>> '{bathsMin,value}', ''), '[^0-9]', '', 'g'), '') is not null
        when 'sqftTarget' then nullif(regexp_replace(coalesce(rp.priorities #>> '{sqftTarget,value}', ''), '[^0-9]', '', 'g'), '') is not null
        when 'lotSizeTarget' then nullif(regexp_replace(coalesce(rp.priorities #>> '{lotSizeTarget,value}', ''), '[^0-9]', '', 'g'), '') is not null
        when 'homeLayout' then exists (select 1 from jsonb_array_elements_text(case when jsonb_typeof(rp.priorities #> '{homeLayout,values}') = 'array' then rp.priorities #> '{homeLayout,values}' else '[]'::jsonb end) v where v <> 'No Preference')
        when 'homeCondition' then exists (select 1 from jsonb_array_elements_text(case when jsonb_typeof(rp.priorities #> '{homeCondition,values}') = 'array' then rp.priorities #> '{homeCondition,values}' else '[]'::jsonb end) v where v <> 'No Preference')
        when 'primaryBedroomLocation' then coalesce(rp.priorities #>> '{primaryBedroomLocation,value}', '') not in ('', 'No Preference')
        when 'secondaryBedroomLocation' then coalesce(rp.priorities #>> '{secondaryBedroomLocation,value}', '') not in ('', 'No Preference')
        when 'exterior:Garage' then coalesce(rp.priorities #>> '{exterior,tiers,Garage}', 'dontcare') <> 'dontcare'
        when 'features:Basement' then coalesce(rp.priorities #>> '{features,tiers,Basement}', 'dontcare') <> 'dontcare'
        when 'preferredPropertyTypes' then
          exists (select 1 from jsonb_array_elements_text(case when jsonb_typeof(rp.priorities -> 'preferredPropertyTypes') = 'array' then rp.priorities -> 'preferredPropertyTypes' when jsonb_typeof(rp.priorities #> '{preferredPropertyTypes,values}') = 'array' then rp.priorities #> '{preferredPropertyTypes,values}' else '[]'::jsonb end) v where v <> 'No Preference')
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
revoke execute on function public.resolve_shared_fact_priority_awareness(uuid) from anon, service_role;

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

    -- Search Basics (budget, beds, baths, square footage, lot size, home type,
    -- layout, condition, bedroom locations) are not weighted Match criteria;
    -- they match computeMatch in src/lib/matching.js, which no longer scores them.

    -- Item-list priorities. Their selected tiers are the canonical stored list;
    -- state shape determines rating vs explicit Yes/No without disclosing either.
    foreach v_category in array array['location','features','exterior','homeFeel'] loop
      for v_label, v_tier in select key, value #>> '{}' from jsonb_each(coalesce(v_priorities #> array[v_category, 'tiers'], '{}'::jsonb)) loop
        if v_tier = 'dontcare' or (v_category = 'location' and v_label = 'Schools' and v_priorities #>> '{location,schoolsRelevance}' = 'no') then continue; end if;
        v_key := v_category || ':' || v_label;
        -- Retired purchase built-ins remain in participant JSON for history but
        -- cannot create artificial Unknowns or affect the sanitized co-buyer Match.
        if coalesce(v_priorities ->> 'searchType', '') in ('purchase', 'buy') and v_key = any(array[
          'location:Neighborhood','location:Walkability','location:Immediate Street / Surroundings','location:Dog Parks Nearby','location:Restaurants / Coffee / Shopping Nearby',
          'homeFeel:Overall Condition','homeFeel:Layout / Flow','homeFeel:Natural Light','homeFeel:Character / Charm','homeFeel:Room Sizes','homeFeel:Openness / Ceiling Height','homeFeel:Privacy','homeFeel:Social Community','homeFeel:On-Site Management',
          'exterior:Yard','exterior:Privacy','exterior:Sidewalks','exterior:Exterior Condition','exterior:Curb Appeal','exterior:Outdoor Space','exterior:Noise Level','exterior:Driveway / Off-Street Parking','exterior:Fitness Center','exterior:Secure Entry','exterior:Elevator',
          'features:Basement','features:Mudroom','features:Pantry','features:Storage','features:Updated Kitchen','features:Updated Bathrooms','features:Walk-In Closet','features:Additional Living Space','features:Hardwood Floors','features:Dishwasher','features:In-Unit Laundry','features:Updated Interior','features:Pets Allowed','features:Utilities Included','features:Basement Bedroom'
        ]) then continue; end if;
        v_selected := v_selected + 1;
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
        elsif v_raw = '"positive"'::jsonb then
          v_score := 1; v_evaluated := v_evaluated + 1;
        elsif v_raw = '"negative"'::jsonb then
          v_score := 0; v_evaluated := v_evaluated + 1;
        elsif v_raw = '"neutral"'::jsonb then
          -- Evaluated, but deliberately excluded from the V1 score denominator.
          v_evaluated := v_evaluated + 1; continue;
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
