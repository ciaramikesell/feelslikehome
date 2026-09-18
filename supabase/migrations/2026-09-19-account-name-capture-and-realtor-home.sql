-- Account-model oversight fix + Realtor Home launchpad support.
--
-- 1) FLH never reliably captured a human name at signup, so every
--    participant-facing "who is this" fell back to an email-derived guess.
--    profiles.first_name/last_name become the canonical structured name —
--    reusing the existing profiles table rather than inventing a second,
--    unsynchronized identity record. Both are nullable so every existing
--    beta account keeps working exactly as before with no backfill and no
--    forced re-auth; only new signups are required to supply them (enforced
--    client-side in AuthForm, matching how password rules are enforced
--    there today).
-- 2) A single resolve_display_name() helper replaces the six copies of the
--    same "full_name meta -> email-derived initcap -> generic fallback"
--    expression that had accumulated across prior migrations, so every one
--    of them now also prefers the structured name the moment it exists,
--    without becoming six more places to keep in sync by hand.
-- 3) "Connect with a buyer who already uses FLH" (Realtor Home option 1)
--    reuses the existing realtor_to_buyer search_invitations machinery
--    (already used by "Invite a buyer") rather than a parallel table.
--    create_realtor_connection_request creates a plain, non-prospective
--    invitation; because prospective_search_id stays null, the existing
--    accept_invitation direct path runs, which only inserts a
--    search_members(role='realtor') row on the accepting buyer's own
--    existing search and never touches their priorities or homes. Request
--    creation never discloses whether the email belongs to an account, and
--    membership is only ever created by that buyer's own explicit accept.
begin;

alter table public.profiles
  add column if not exists first_name text,
  add column if not exists last_name text;

alter table public.profiles drop constraint if exists profiles_first_name_length;
alter table public.profiles add constraint profiles_first_name_length
  check (first_name is null or char_length(first_name) <= 100);
alter table public.profiles drop constraint if exists profiles_last_name_length;
alter table public.profiles add constraint profiles_last_name_length
  check (last_name is null or char_length(last_name) <= 100);

-- Populate first/last name from signup metadata the same way onboarding
-- state and the owned search are seeded today. Trimmed and null-if-blank so
-- an accidental empty string never displaces the "no name yet" fallback.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, onboarding_complete, first_name, last_name)
  values (
    new.id,
    false,
    nullif(trim(new.raw_user_meta_data->>'first_name'), ''),
    nullif(trim(new.raw_user_meta_data->>'last_name'), '')
  );

  insert into public.searches (user_id, priorities)
  values (
    new.id,
    '{
      "searchType": "",
      "investmentPropertyTypes": [],
      "budget": {"value": "", "tier": "important"},
      "sqftTarget": {"value": "", "tier": "nice"},
      "lotSizeTarget": {"value": "", "tier": "dontcare"},
      "bedsMin": {"value": "", "tier": "important"},
      "bathsMin": {"value": "", "tier": "nice"},
      "homeLayout": {"values": [], "tier": "dontcare"},
      "primaryBedroomLocation": {"value": "", "tier": "dontcare"},
      "secondaryBedroomLocation": {"value": "", "tier": "dontcare"},
      "location": {"customItems": [], "tiers": {}, "order": [], "hiddenCore": []},
      "homeFeel": {"customItems": [], "tiers": {}, "order": [], "hiddenCore": []},
      "exterior": {"customItems": [], "tiers": {}, "order": [], "hiddenCore": []},
      "features": {"customItems": [], "tiers": {}, "order": [], "hiddenCore": []}
    }'::jsonb
  );

  return new;
end;
$$;

-- Canonical participant display name. Structured first/last name wins when
-- present; a legacy raw_user_meta_data.full_name (a handful of RPCs already
-- read this) is next; an email-derived guess is the last resort before the
-- caller-supplied generic fallback ('Buyer', 'Realtor', ...). Never invents
-- a name from an email beyond that same pre-existing, already-shipped
-- last-resort behavior.
create or replace function public.resolve_display_name(p_user_id uuid, p_fallback text default 'there')
returns text
language sql
security definer
stable
set search_path = ''
as $$
  select coalesce(
    nullif(trim(concat_ws(' ', p.first_name, p.last_name)), ''),
    nullif(trim(u.raw_user_meta_data->>'full_name'), ''),
    nullif(initcap(replace(split_part(u.email, '@', 1), '.', ' ')), ''),
    p_fallback
  )
  from auth.users u
  left join public.profiles p on p.id = u.id
  where u.id = p_user_id;
$$;
revoke all on function public.resolve_display_name(uuid, text) from public;
grant execute on function public.resolve_display_name(uuid, text) to authenticated;
revoke execute on function public.resolve_display_name(uuid, text) from anon, service_role;

-- The six existing call sites, updated in place (same signatures) to prefer
-- the structured name via resolve_display_name. Every other behavior is
-- unchanged from each function's most recent prior definition.
create or replace function public.get_realtor_client_roster(p_search_ids uuid[])
returns table (search_id uuid, user_id uuid, display_name text, relationship text)
language sql security definer stable set search_path = '' as $$
  select participants.search_id, participants.user_id,
    public.resolve_display_name(participants.user_id, 'Buyer'),
    participants.relationship
  from (
    select s.id as search_id, s.user_id, 'Owner'::text as relationship
      from public.searches s
    union all
    select sm.search_id, sm.user_id, 'Co-buyer'::text as relationship
      from public.search_members sm where sm.role = 'co_buyer'
  ) participants
  where participants.search_id = any(p_search_ids)
    and public.is_search_realtor(participants.search_id, auth.uid());
$$;
revoke all on function public.get_realtor_client_roster(uuid[]) from public;
revoke execute on function public.get_realtor_client_roster(uuid[]) from anon, service_role;
grant execute on function public.get_realtor_client_roster(uuid[]) to authenticated;

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
  realtor_name := public.resolve_display_name(caller, 'Realtor');
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

create or replace function public.save_realtor_note(p_search_id uuid, p_home_id uuid, p_content text)
returns public.realtor_notes language plpgsql security definer set search_path = '' as $$
declare caller uuid:=auth.uid(); result public.realtor_notes; display_name text;
begin
  if caller is null or not public.is_search_realtor(p_search_id,caller) then raise exception 'Search access denied' using errcode='42501'; end if;
  if nullif(trim(p_content),'') is null or char_length(trim(p_content)) > 2000 then raise exception 'Note must be between 1 and 2000 characters'; end if;
  if not exists(select 1 from public.homes h where h.id=p_home_id and h.search_id=p_search_id and not h.suggestion_staged) then raise exception 'Home is not an eligible contender' using errcode='42501'; end if;
  display_name := public.resolve_display_name(caller, 'Realtor');
  insert into public.realtor_notes(search_id,home_id,author_id,author_display_name,content)
  values(p_search_id,p_home_id,caller,display_name,trim(p_content))
  on conflict(search_id,home_id,author_id) do update set content=excluded.content,updated_at=now()
  returning * into result;
  return result;
end; $$;

create or replace function public.suggest_home_tour(p_search_id uuid, p_home_id uuid)
returns public.tour_suggestions language plpgsql security definer set search_path = '' as $$
declare caller uuid:=auth.uid(); result public.tour_suggestions; display_name text;
begin
  if caller is null or not public.is_search_realtor(p_search_id,caller) then raise exception 'Search access denied' using errcode='42501'; end if;
  if not exists(select 1 from public.homes h where h.id=p_home_id and h.search_id=p_search_id and not h.suggestion_staged
    and exists(select 1 from public.home_member_state s where s.home_id=h.id and s.status <> 'Archived'))
    then raise exception 'Home is not an active contender' using errcode='42501'; end if;
  display_name := public.resolve_display_name(caller, 'Realtor');
  insert into public.tour_suggestions(search_id,home_id,suggested_by,suggested_by_display_name)
  values(p_search_id,p_home_id,caller,display_name)
  on conflict(search_id,home_id,suggested_by) do update set suggested_by_display_name=excluded.suggested_by_display_name
  returning * into result;
  return result;
end; $$;

create or replace function public.invite_prospective_client(p_prospective_search_id uuid, p_invited_email text)
returns table(token uuid, expires_at timestamptz) language plpgsql security definer set search_path = '' as $$
declare caller uuid:=auth.uid(); draft public.prospective_searches%rowtype; existing public.search_invitations%rowtype; caller_name text; normalized text:=lower(trim(p_invited_email));
begin
  if caller is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select * into draft from public.prospective_searches p where p.id=p_prospective_search_id and p.started_by=caller for update;
  if draft.id is null then raise exception 'Draft access denied' using errcode='42501'; end if;
  if normalized is null or position('@' in normalized)=0 then raise exception 'A valid email is required'; end if;
  select * into existing from public.search_invitations i where i.prospective_search_id=draft.id and i.status='pending' and i.expires_at>now() limit 1;
  if existing.id is not null then
    if existing.invited_email <> normalized then raise exception 'This draft already has an active invitation'; end if;
    return query select existing.token,existing.expires_at; return;
  end if;
  caller_name := public.resolve_display_name(caller, 'Your Realtor');
  update public.prospective_searches set invited_email=normalized,status='invited' where prospective_searches.id=draft.id;
  return query insert into public.search_invitations(search_id,invited_by,invited_email,relationship_type,invitation_direction,inviter_display_name,prospective_search_id)
    values(null,caller,normalized,'realtor','realtor_to_buyer',caller_name,draft.id)
    returning search_invitations.token,search_invitations.expires_at;
end; $$;

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
    public.resolve_display_name(v_collaborator, 'Your collaborator');
end;
$$;

revoke all on function public.resolve_collaborator_search_context(uuid) from public;
revoke execute on function public.resolve_collaborator_search_context(uuid) from anon;
revoke execute on function public.resolve_collaborator_search_context(uuid) from service_role;
grant execute on function public.resolve_collaborator_search_context(uuid) to authenticated;

-- Realtor Home option 1: "Connect with a buyer who already uses FLH". A
-- plain realtor_to_buyer invitation, deliberately not routed through
-- prospective_searches — there is no draft to confirm because the buyer
-- already has their own search and priorities. Because prospective_search_id
-- stays null here, accept_invitation's existing direct realtor_to_buyer path
-- runs: it only inserts a search_members(role='realtor') row on the
-- accepting buyer's own existing search and never reads or writes their
-- priorities, homes, or any other state. Creating a request never discloses
-- whether the email belongs to an existing account — the same email is
-- accepted whether or not one exists, exactly like create_buyer_invitation.
create or replace function public.create_realtor_connection_request(p_invited_email text)
returns table(token uuid, expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  caller uuid := auth.uid();
  caller_name text;
  existing public.search_invitations%rowtype;
  normalized text := lower(trim(p_invited_email));
begin
  if caller is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if normalized is null or position('@' in normalized) = 0 then raise exception 'A valid email is required'; end if;
  select * into existing from public.search_invitations i
    where i.invited_by = caller and i.invited_email = normalized and i.invitation_direction = 'realtor_to_buyer'
      and i.prospective_search_id is null and i.status = 'pending' and i.expires_at > now()
    order by i.created_at desc limit 1;
  if existing.id is not null then return query select existing.token, existing.expires_at; return; end if;
  caller_name := public.resolve_display_name(caller, 'Your Realtor');
  return query insert into public.search_invitations(search_id, invited_by, invited_email, relationship_type, invitation_direction, inviter_display_name)
    values (null, caller, normalized, 'realtor', 'realtor_to_buyer', caller_name)
    returning search_invitations.token, search_invitations.expires_at;
end; $$;
revoke all on function public.create_realtor_connection_request(text) from public;
grant execute on function public.create_realtor_connection_request(text) to authenticated;
revoke execute on function public.create_realtor_connection_request(text) from anon, service_role;

-- The invite preview now also tells the client whether this realtor_to_buyer
-- invitation is a prospective (Realtor-authored draft, needs confirmation)
-- request or a direct connection request (existing buyer, no draft to
-- review) so the acceptance UI can skip the confirm/claim step for the
-- latter instead of forcing a priorities review the buyer doesn't need.
drop function public.preview_invitation(uuid);
create function public.preview_invitation(p_token uuid)
returns table(valid boolean, reason text, relationship_type text, invitation_direction text, inviter_display_name text, draft_priorities jsonb, client_name text, requires_confirmation boolean)
language plpgsql security definer stable set search_path = '' as $$
declare inv public.search_invitations%rowtype; draft public.prospective_searches%rowtype; caller uuid:=auth.uid(); caller_email text;
begin
  if caller is null then return query select false,'not_authenticated',null::text,null::text,null::text,null::jsonb,null::text,null::boolean; return; end if;
  select * into inv from public.search_invitations i where i.token=p_token;
  if inv.id is null then return query select false,'not_found',null::text,null::text,null::text,null::jsonb,null::text,null::boolean; return; end if;
  select lower(u.email) into caller_email from auth.users u where u.id=caller;
  if caller_email is distinct from lower(inv.invited_email) then return query select false,'wrong_account',null::text,null::text,null::text,null::jsonb,null::text,null::boolean; return; end if;
  if inv.status<>'pending' then return query select false,inv.status,inv.relationship_type,inv.invitation_direction,inv.inviter_display_name,null::jsonb,null::text,(inv.prospective_search_id is not null); return; end if;
  if inv.expires_at<now() then return query select false,'expired',inv.relationship_type,inv.invitation_direction,inv.inviter_display_name,null::jsonb,null::text,(inv.prospective_search_id is not null); return; end if;
  if inv.prospective_search_id is not null then select * into draft from public.prospective_searches p where p.id=inv.prospective_search_id; end if;
  return query select true,null::text,inv.relationship_type,inv.invitation_direction,inv.inviter_display_name,coalesce(draft.draft_priorities,'{}'::jsonb),draft.client_name,(inv.prospective_search_id is not null);
end; $$;
revoke all on function public.preview_invitation(uuid) from public;
grant execute on function public.preview_invitation(uuid) to authenticated;
revoke execute on function public.preview_invitation(uuid) from anon, service_role;

notify pgrst, 'reload schema';
commit;
