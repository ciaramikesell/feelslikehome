-- Forward hotfix for Compare perspective type-safe fact evaluation.
--
-- Replaces the function because the original migration may already be applied.
-- Numeric thresholds populate the numeric variable, while bedroom locations
-- populate the text variable. The function contract and access controls remain
-- unchanged.

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
    select sm.user_id from public.search_members sm where sm.search_id = p_search_id
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

    -- Item-list priorities. Their selected tiers are the canonical stored list;
    -- state shape determines rating vs explicit Yes/No without disclosing either.
    foreach v_category in array array['location','features','exterior','homeFeel'] loop
      for v_label, v_tier in select key, value #>> '{}' from jsonb_each(coalesce(v_priorities #> array[v_category, 'tiers'], '{}'::jsonb)) loop
        if v_tier = 'dontcare' or (v_category = 'location' and v_label = 'Schools' and v_priorities #>> '{location,schoolsRelevance}' = 'no') then continue; end if;
        v_selected := v_selected + 1; v_key := v_category || ':' || v_label;
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
