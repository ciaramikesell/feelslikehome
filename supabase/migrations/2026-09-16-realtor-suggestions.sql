-- PR #80: Realtor suggestions remain staged outside the contender collection
-- until one current decision-maker promotes them transactionally.
begin;

alter table public.homes add column if not exists suggestion_staged boolean not null default false;

create table if not exists public.realtor_suggestions (
  id uuid primary key default gen_random_uuid(),
  search_id uuid not null references public.searches(id) on delete cascade,
  home_id uuid not null unique references public.homes(id) on delete cascade,
  suggested_by uuid not null references auth.users(id) on delete restrict,
  suggested_by_display_name text not null,
  listing_identity text not null,
  status text not null default 'pending' check (status in ('pending','dismissed','accepted')),
  promoted_by uuid references auth.users(id) on delete set null,
  promoted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (search_id, listing_identity)
);

create table if not exists public.suggestion_dispositions (
  suggestion_id uuid not null references public.realtor_suggestions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  disposition text not null check (disposition = 'dismissed'),
  reasons text[] not null default '{}',
  other_text text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (suggestion_id, user_id),
  constraint suggestion_reasons_allowed check (reasons <@ array['Price','Location','Layout','Condition','Missing a must-have','Just don''t like it','Other']::text[]),
  constraint suggestion_other_text_length check (char_length(coalesce(other_text,'')) <= 280)
);

alter table public.realtor_suggestions enable row level security;
alter table public.suggestion_dispositions enable row level security;

-- Existing Home policies were intentionally broad for decision-makers. Staged
-- rows are readable as suggestion property truth, but cannot be edited or gain
-- personal contender state before the promotion RPC clears this flag.
drop policy if exists "homes_update_decision_maker" on public.homes;
create policy "homes_update_decision_maker" on public.homes for update
  using (not suggestion_staged and public.is_search_decision_maker(search_id,auth.uid()))
  with check (not suggestion_staged and public.is_search_decision_maker(search_id,auth.uid()));
drop policy if exists "homes_insert_decision_maker" on public.homes;
create policy "homes_insert_decision_maker" on public.homes for insert with check (
  auth.uid()=user_id and not suggestion_staged and public.is_search_decision_maker(search_id,auth.uid())
);
drop policy if exists "hms_decision_maker_insert" on public.home_member_state;
create policy "hms_decision_maker_insert" on public.home_member_state for insert with check (
  auth.uid()=user_id and public.is_search_decision_maker((select h.search_id from public.homes h where h.id=home_id and not h.suggestion_staged),auth.uid())
);

create policy "suggestions_participant_select" on public.realtor_suggestions for select using (
  public.is_search_decision_maker(search_id, auth.uid())
  or (suggested_by = auth.uid() and public.is_search_realtor(search_id, auth.uid()))
);
create policy "suggestion_dispositions_participant_select" on public.suggestion_dispositions for select using (
  exists (select 1 from public.realtor_suggestions rs where rs.id = suggestion_id and (
    public.is_search_decision_maker(rs.search_id, auth.uid())
    or (rs.suggested_by = auth.uid() and public.is_search_realtor(rs.search_id, auth.uid()))
  ))
);
create policy "suggestion_dispositions_own_insert" on public.suggestion_dispositions for insert with check (
  user_id = auth.uid() and exists (select 1 from public.realtor_suggestions rs
    where rs.id = suggestion_id and rs.status = 'pending'
      and public.is_search_decision_maker(rs.search_id, auth.uid()))
);
create policy "suggestion_dispositions_own_update" on public.suggestion_dispositions for update
  using (user_id = auth.uid()) with check (
    user_id = auth.uid() and exists (select 1 from public.realtor_suggestions rs
      where rs.id = suggestion_id and rs.status in ('pending','dismissed')
        and public.is_search_decision_maker(rs.search_id, auth.uid()))
  );

create or replace function public.suggestion_listing_identity(p_url text, p_address text)
returns text language sql immutable set search_path = '' as $$
  select case when nullif(trim(p_url),'') is not null
    then lower(regexp_replace(regexp_replace(trim(p_url), '[?#].*$', ''), '/+$', ''))
    else 'address:' || lower(regexp_replace(trim(coalesce(p_address,'')), '[^a-zA-Z0-9]+', '', 'g')) end;
$$;
revoke all on function public.suggestion_listing_identity(text,text) from public;

create or replace function public.create_realtor_suggestion(p_search_id uuid, p_home jsonb)
returns table (suggestion_id uuid, result text, home_id uuid)
language plpgsql security definer set search_path = '' as $$
declare
  caller uuid := auth.uid(); ident text; existing public.realtor_suggestions%rowtype;
  existing_home uuid; staged_home uuid; realtor_name text;
begin
  if caller is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if not public.is_search_realtor(p_search_id, caller) then raise exception 'Search access denied' using errcode='42501'; end if;
  if nullif(trim(p_home->>'address'),'') is null then raise exception 'A verified property address is required'; end if;
  ident := public.suggestion_listing_identity(p_home->>'listingUrl', p_home->>'address');
  if ident = 'address:' then raise exception 'Property identity is required'; end if;

  select h.id into existing_home from public.homes h where h.search_id=p_search_id and not h.suggestion_staged
    and public.suggestion_listing_identity(h.listing_url,h.address)=ident limit 1;
  if existing_home is not null then return query select null::uuid,'already_in_homes',existing_home; return; end if;
  select * into existing from public.realtor_suggestions rs where rs.search_id=p_search_id and rs.listing_identity=ident;
  if existing.id is not null then
    return query select existing.id, case existing.status when 'dismissed' then 'previously_dismissed' when 'accepted' then 'already_in_homes' else 'already_suggested' end, existing.home_id; return;
  end if;
  select coalesce(nullif(initcap(replace(split_part(u.email,'@',1),'.',' ')),''),'Realtor') into realtor_name from auth.users u where u.id=caller;
  insert into public.homes(user_id,search_id,address,crossroads,listing_url,photo_url,price,est_monthly,sqft,beds,baths,lot_size,garage_spaces,year_built,days_on_market,home_layout,home_condition,primary_bedroom_location,secondary_bedroom_location,notes,pros,cons,property_type,property_name,selected_floor_plan_name,selected_unit_label,floor_plan_image_url,suggestion_staged)
  values(caller,p_search_id,p_home->>'address',coalesce(p_home->>'crossroads',''),coalesce(p_home->>'listingUrl',''),coalesce(p_home->>'photoUrl',''),coalesce(p_home->>'price',''),coalesce(p_home->>'estMonthly',''),coalesce(p_home->>'sqft',''),coalesce(p_home->>'beds',''),coalesce(p_home->>'baths',''),coalesce(p_home->>'lotSize',''),coalesce(p_home->>'garageSpaces',''),coalesce(p_home->>'yearBuilt',''),coalesce(p_home->>'daysOnMarket',''),array(select jsonb_array_elements_text(coalesce(p_home->'homeLayout','[]'::jsonb))),array(select jsonb_array_elements_text(coalesce(p_home->'homeCondition','[]'::jsonb))),coalesce(p_home->>'primaryBedroomLocation',''),coalesce(p_home->>'secondaryBedroomLocation',''),coalesce(p_home->>'notes',''),'', '',nullif(p_home->>'propertyType',''),nullif(p_home->>'propertyName',''),nullif(p_home->>'selectedFloorPlanName',''),nullif(p_home->>'selectedUnitLabel',''),nullif(p_home->>'floorPlanImageUrl',''),true)
  returning id into staged_home;
  insert into public.realtor_suggestions(search_id,home_id,suggested_by,suggested_by_display_name,listing_identity)
  values(p_search_id,staged_home,caller,realtor_name,ident) returning id into suggestion_id;
  result := 'created'; home_id := staged_home; return next;
exception when unique_violation then
  select * into existing from public.realtor_suggestions rs where rs.search_id=p_search_id and rs.listing_identity=ident;
  return query select existing.id,'already_suggested',existing.home_id;
end; $$;

create or replace function public.dismiss_realtor_suggestion(p_suggestion_id uuid, p_reasons text[] default '{}', p_other_text text default null)
returns text language plpgsql security definer set search_path = '' as $$
declare caller uuid:=auth.uid(); sid uuid; decision_count int; dismissed_count int;
begin
  select search_id into sid from public.realtor_suggestions where id=p_suggestion_id for update;
  if caller is null or sid is null or not public.is_search_decision_maker(sid,caller) then raise exception 'Suggestion access denied' using errcode='42501'; end if;
  insert into public.suggestion_dispositions(suggestion_id,user_id,disposition,reasons,other_text)
  values(p_suggestion_id,caller,'dismissed',coalesce(p_reasons,'{}'),nullif(trim(p_other_text),''))
  on conflict(suggestion_id,user_id) do update set disposition='dismissed',reasons=excluded.reasons,other_text=excluded.other_text,updated_at=now();
  select 1 + count(*) into decision_count from public.search_members where search_id=sid and role='co_buyer';
  select count(*) into dismissed_count from public.suggestion_dispositions sd join public.search_members sm on sm.user_id=sd.user_id and sm.search_id=sid and sm.role='co_buyer' where sd.suggestion_id=p_suggestion_id;
  if exists(select 1 from public.suggestion_dispositions sd join public.searches s on s.user_id=sd.user_id and s.id=sid where sd.suggestion_id=p_suggestion_id) then dismissed_count:=dismissed_count+1; end if;
  if dismissed_count>=decision_count then update public.realtor_suggestions set status='dismissed',updated_at=now() where id=p_suggestion_id and status='pending'; end if;
  return case when dismissed_count>=decision_count then 'dismissed' else 'pending' end;
end; $$;

create or replace function public.promote_realtor_suggestion(p_suggestion_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare caller uuid:=auth.uid(); suggestion public.realtor_suggestions%rowtype;
begin
  select * into suggestion from public.realtor_suggestions where id=p_suggestion_id for update;
  if caller is null or suggestion.id is null or not public.is_search_decision_maker(suggestion.search_id,caller) then raise exception 'Suggestion access denied' using errcode='42501'; end if;
  if suggestion.status='accepted' then return suggestion.home_id; end if;
  update public.homes set suggestion_staged=false where id=suggestion.home_id;
  insert into public.home_member_state(home_id,user_id,status) values(suggestion.home_id,caller,'Saved') on conflict(home_id,user_id) do nothing;
  update public.realtor_suggestions set status='accepted',promoted_by=caller,promoted_at=now(),updated_at=now() where id=p_suggestion_id;
  return suggestion.home_id;
end; $$;

revoke all on function public.create_realtor_suggestion(uuid,jsonb) from public;
revoke all on function public.dismiss_realtor_suggestion(uuid,text[],text) from public;
revoke all on function public.promote_realtor_suggestion(uuid) from public;
grant execute on function public.create_realtor_suggestion(uuid,jsonb) to authenticated;
grant execute on function public.dismiss_realtor_suggestion(uuid,text[],text) to authenticated;
grant execute on function public.promote_realtor_suggestion(uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
