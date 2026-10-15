-- Realtor access and suggested-home ownership.
--
-- A suggested home is created with the Realtor as its adder (homes.user_id),
-- and stays that way after a buyer accepts it. Two original policies still
-- granted the adder access with no membership check:
--   homes_select_own  for select using (auth.uid() = user_id)
--   homes_delete_own  for delete using (auth.uid() = user_id)
-- so a Realtor could delete a home after buyers accepted it (cascading every
-- buyer's ratings, reactions and Yes/No answers), and kept reading it, buyers'
-- later notes included, after being removed. Buyers could not delete it at
-- all. The same two policies let a departed co-buyer keep reading, and delete,
-- homes they had added to the shared search.
--
-- Also: a removed Realtor's pending suggestions stayed visible and acceptable,
-- and a connected Realtor kept reading a departed co-buyer's priorities, home
-- assessments and places.
--
-- This migration changes policies, a constraint and three function bodies,
-- and adds one trigger. It rewrites no existing row: no ownership backfill, no
-- deletes. Existing rows (Realtor-added homes, homes added by co-buyers who
-- have since left, pending suggestions of Realtors removed before today) are
-- covered because the access rules are evaluated from current membership.
--
-- Rules after this migration:
-- * Homes are read only through homes_select_member (current owner or member
--   of the home's search). The adder-only read is gone. Adder delete requires
--   being a current decision-maker (owner or co-buyer) of the home's search.
--   A home outside any search (search_id is null) is not readable or
--   deletable through the API by anyone, its original adder included.
-- * Any current decision-maker may delete a (non-staged) home whose adder is
--   no longer a decision-maker of the search: an accepted Realtor suggestion,
--   or a home added by a co-buyer who has left. Deleting a home removes every
--   member's assessment of that home (as any home delete does), its Realtor
--   notes and tour suggestions, and its accepted-suggestion record.
--   Buyers still cannot delete homes added by a current co-buyer or owner.
--   A pending (staged) suggestion is not deletable as a home: it is dismissed.
-- * When a Realtor leaves or is removed, their pending suggestions in that
--   search become status 'withdrawn' (a trigger on search_members; idempotent).
--   Withdrawn suggestions are hidden from everyone, cannot be accepted or
--   dismissed, and do not come back if the Realtor is invited again. Accepted
--   homes are untouched. Pending suggestions left by Realtors removed before
--   this migration are hidden the same way (their Realtor is no longer in the
--   search) and are marked withdrawn if that Realtor is ever invited back.
--   Suggesting a withdrawn listing again is an explicit new suggestion: the
--   suggestion is reopened as pending, credited to the suggesting Realtor.
-- * A Realtor reads priorities, home assessments and places only of the
--   search's current owner and co-buyers.
--
-- Requires: 2026-09-16-realtor-role-foundation.sql, 2026-09-16-realtor-suggestions.sql,
-- 2026-09-16-realtor-suggestions-homes-select-fix.sql and
-- 2026-09-19-account-name-capture-and-realtor-home.sql (production drift
-- repair). Run supabase/realtor-access-preflight.sql (read-only) first.
-- Re-runnable. Ends with a check that aborts the whole migration if any other
-- permissive policy on these tables would still grant the old access.
begin;

-- ----------------------------------------------------------------- homes ----

drop policy if exists "homes_select_own" on public.homes;

drop policy if exists "homes_delete_own" on public.homes;
create policy "homes_delete_own" on public.homes
  for delete using (
    auth.uid() = user_id
    and public.is_search_decision_maker(search_id, auth.uid())
  );

drop policy if exists "homes_delete_departed_adder" on public.homes;
create policy "homes_delete_departed_adder" on public.homes
  for delete using (
    not suggestion_staged
    and public.is_search_decision_maker(search_id, auth.uid())
    and not public.is_search_decision_maker(search_id, user_id)
  );

-- --------------------------------------- Realtor reads: current buyers only ----

drop policy if exists "smp_participant_or_realtor_select" on public.search_member_priorities;
create policy "smp_participant_or_realtor_select" on public.search_member_priorities
  for select using (
    auth.uid() = user_id
    or (public.is_search_realtor(search_id, auth.uid()) and public.is_search_decision_maker(search_id, user_id))
  );

drop policy if exists "hms_participant_or_realtor_select" on public.home_member_state;
create policy "hms_participant_or_realtor_select" on public.home_member_state
  for select using (
    auth.uid() = user_id
    or exists (
      select 1 from public.homes h
      where h.id = home_member_state.home_id
        and public.is_search_realtor(h.search_id, auth.uid())
        and public.is_search_decision_maker(h.search_id, home_member_state.user_id)
    )
  );

drop policy if exists "commute_destinations_participant_or_realtor_select" on public.commute_destinations;
create policy "commute_destinations_participant_or_realtor_select" on public.commute_destinations
  for select using (
    auth.uid() = user_id
    or (public.is_search_realtor(search_id, auth.uid()) and public.is_search_decision_maker(search_id, user_id))
  );

-- ---------------------------------------------- withdrawn suggestions ----

alter table public.realtor_suggestions drop constraint if exists realtor_suggestions_status_check;
alter table public.realtor_suggestions add constraint realtor_suggestions_status_check
  check (status in ('pending', 'dismissed', 'accepted', 'withdrawn'));

-- Withdraws a Realtor's pending suggestions in a search when they leave it or
-- are removed (or, defensively, stop being its Realtor). On a new Realtor
-- membership, also withdraws any pending suggestion left over from an earlier
-- membership (only possible for removals that predate this trigger), so it
-- never reappears. Only 'pending' rows change, so repeating it is a no-op.
create or replace function public.withdraw_departed_realtor_suggestions()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op in ('DELETE', 'UPDATE') and old.role = 'realtor'
     and (tg_op = 'DELETE' or new.role is distinct from 'realtor' or new.search_id is distinct from old.search_id or new.user_id is distinct from old.user_id) then
    update public.realtor_suggestions set status = 'withdrawn', updated_at = now()
      where search_id = old.search_id and suggested_by = old.user_id and status = 'pending';
  end if;
  if tg_op = 'INSERT' and new.role = 'realtor' then
    update public.realtor_suggestions set status = 'withdrawn', updated_at = now()
      where search_id = new.search_id and suggested_by = new.user_id and status = 'pending';
  end if;
  return null;
end; $$;
revoke all on function public.withdraw_departed_realtor_suggestions() from public, anon, authenticated;

drop trigger if exists search_members_withdraw_realtor_suggestions on public.search_members;
create trigger search_members_withdraw_realtor_suggestions
  after insert or update or delete on public.search_members
  for each row execute function public.withdraw_departed_realtor_suggestions();

-- Buyers see accepted and dismissed suggestions, and pending ones whose
-- Realtor is still in the search. A Realtor sees their own, except withdrawn.
drop policy if exists "suggestions_participant_select" on public.realtor_suggestions;
create policy "suggestions_participant_select" on public.realtor_suggestions
  for select using (
    status <> 'withdrawn'
    and (
      (public.is_search_decision_maker(search_id, auth.uid())
        and (status <> 'pending' or public.is_search_realtor(search_id, suggested_by)))
      or (suggested_by = auth.uid() and public.is_search_realtor(search_id, auth.uid()))
    )
  );

drop policy if exists "suggestion_dispositions_own_insert" on public.suggestion_dispositions;
create policy "suggestion_dispositions_own_insert" on public.suggestion_dispositions
  for insert with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.realtor_suggestions rs
      where rs.id = suggestion_dispositions.suggestion_id and rs.status = 'pending'
        and public.is_search_decision_maker(rs.search_id, auth.uid())
        and public.is_search_realtor(rs.search_id, rs.suggested_by)
    )
  );

drop policy if exists "suggestion_dispositions_own_update" on public.suggestion_dispositions;
create policy "suggestion_dispositions_own_update" on public.suggestion_dispositions
  for update using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.realtor_suggestions rs
      where rs.id = suggestion_dispositions.suggestion_id and rs.status in ('pending', 'dismissed')
        and public.is_search_decision_maker(rs.search_id, auth.uid())
        and (rs.status <> 'pending' or public.is_search_realtor(rs.search_id, rs.suggested_by))
    )
  );

-- Current definitions (2026-09-16-realtor-suggestions.sql) plus one check each:
-- a withdrawn suggestion, or a pending one whose Realtor has left, cannot be
-- acted on. Accepting an already-accepted suggestion still returns its home.
create or replace function public.promote_realtor_suggestion(p_suggestion_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare caller uuid:=auth.uid(); suggestion public.realtor_suggestions%rowtype;
begin
  select * into suggestion from public.realtor_suggestions where id=p_suggestion_id for update;
  if caller is null or suggestion.id is null or not public.is_search_decision_maker(suggestion.search_id,caller) then raise exception 'Suggestion access denied' using errcode='42501'; end if;
  if suggestion.status='accepted' then return suggestion.home_id; end if;
  if suggestion.status='withdrawn' or not public.is_search_realtor(suggestion.search_id,suggestion.suggested_by) then raise exception 'Suggestion is no longer available' using errcode='42501'; end if;
  update public.homes set suggestion_staged=false where id=suggestion.home_id;
  insert into public.home_member_state(home_id,user_id,status) values(suggestion.home_id,caller,'Saved') on conflict(home_id,user_id) do nothing;
  update public.realtor_suggestions set status='accepted',promoted_by=caller,promoted_at=now(),updated_at=now() where id=p_suggestion_id;
  return suggestion.home_id;
end; $$;

create or replace function public.dismiss_realtor_suggestion(p_suggestion_id uuid, p_reasons text[] default '{}', p_other_text text default null)
returns text language plpgsql security definer set search_path = '' as $$
declare caller uuid:=auth.uid(); sid uuid; current_status text; suggester uuid; decision_count int; dismissed_count int;
begin
  select search_id, status, suggested_by into sid, current_status, suggester from public.realtor_suggestions where id=p_suggestion_id for update;
  if caller is null or sid is null or not public.is_search_decision_maker(sid,caller) then raise exception 'Suggestion access denied' using errcode='42501'; end if;
  if current_status='withdrawn' or (current_status='pending' and not public.is_search_realtor(sid,suggester)) then raise exception 'Suggestion is no longer available' using errcode='42501'; end if;
  insert into public.suggestion_dispositions(suggestion_id,user_id,disposition,reasons,other_text)
  values(p_suggestion_id,caller,'dismissed',coalesce(p_reasons,'{}'),nullif(trim(p_other_text),''))
  on conflict(suggestion_id,user_id) do update set disposition='dismissed',reasons=excluded.reasons,other_text=excluded.other_text,updated_at=now();
  select 1 + count(*) into decision_count from public.search_members where search_id=sid and role='co_buyer';
  select count(*) into dismissed_count from public.suggestion_dispositions sd join public.search_members sm on sm.user_id=sd.user_id and sm.search_id=sid and sm.role='co_buyer' where sd.suggestion_id=p_suggestion_id;
  if exists(select 1 from public.suggestion_dispositions sd join public.searches s on s.user_id=sd.user_id and s.id=sid where sd.suggestion_id=p_suggestion_id) then dismissed_count:=dismissed_count+1; end if;
  if dismissed_count>=decision_count then update public.realtor_suggestions set status='dismissed',updated_at=now() where id=p_suggestion_id and status='pending'; end if;
  return case when dismissed_count>=decision_count then 'dismissed' else 'pending' end;
end; $$;

-- Current definition (2026-09-19-account-name-capture-and-realtor-home.sql)
-- plus one branch: a withdrawn listing suggested again (by any current Realtor
-- of the search) is reopened as pending and credited to that Realtor, instead
-- of answering "already suggested" for a suggestion nobody can see.
create or replace function public.create_realtor_suggestion(p_search_id uuid, p_home jsonb)
returns table(suggestion_id uuid, result text, home_id uuid) language plpgsql security definer set search_path = '' as $$
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
  select * into existing from public.realtor_suggestions rs where rs.search_id=p_search_id and rs.listing_identity=ident for update;
  if existing.id is not null and existing.status='withdrawn' then
    update public.realtor_suggestions rs set status='pending', suggested_by=caller,
      suggested_by_display_name=public.resolve_display_name(caller, 'Realtor'), updated_at=now()
      where rs.id=existing.id;
    return query select existing.id,'created',existing.home_id; return;
  end if;
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

revoke all on function public.promote_realtor_suggestion(uuid) from public, anon;
revoke all on function public.dismiss_realtor_suggestion(uuid,text[],text) from public, anon;
revoke all on function public.create_realtor_suggestion(uuid,jsonb) from public, anon;
grant execute on function public.promote_realtor_suggestion(uuid) to authenticated;
grant execute on function public.dismiss_realtor_suggestion(uuid,text[],text) to authenticated;
grant execute on function public.create_realtor_suggestion(uuid,jsonb) to authenticated;

-- ------------------------------------------------------------ drift check ----
-- Permissive policies are OR'ed: any other SELECT/DELETE policy left over on
-- these tables (for example a pre-collaboration "hms_select_members") would
-- silently keep the old access. Abort instead.
do $$
declare unexpected text;
begin
  select string_agg(format('%s.%s (%s)', tablename, policyname, cmd), ', ' order by tablename, policyname) into unexpected
  from pg_policies
  where schemaname = 'public' and permissive = 'PERMISSIVE' and cmd in ('SELECT', 'DELETE', 'ALL')
    and (tablename, policyname) not in (
      ('homes', 'homes_select_member'),
      ('homes', 'homes_delete_own'), ('homes', 'homes_delete_departed_adder'),
      ('home_member_state', 'hms_participant_or_realtor_select'),
      ('search_member_priorities', 'smp_participant_or_realtor_select'),
      ('commute_destinations', 'commute_destinations_participant_or_realtor_select'),
      ('commute_destinations', 'commute_destinations_decision_maker_delete'),
      ('realtor_suggestions', 'suggestions_participant_select')
    )
    and tablename in ('homes', 'home_member_state', 'search_member_priorities', 'commute_destinations', 'realtor_suggestions');
  if unexpected is not null then
    raise exception 'Unexpected policies would keep the old access: %. Reconcile them (docs/production-schema-drift-repair.md) before applying this migration.', unexpected;
  end if;
end $$;

commit;
