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
-- This migration changes policies and two function bodies only. It changes no
-- row: no ownership backfill, no deletes, no status rewrites. Rows that already
-- exist (Realtor-added homes, pending suggestions of Realtors removed before
-- today, departed co-buyers' data) are covered because every rule below is
-- evaluated from current membership at read time.
--
-- Rules after this migration:
-- * Homes in a search are read through homes_select_member (current owner or
--   member) only. The adder-only read/delete remains for homes outside any
--   search (search_id is null: legacy rows), and adder delete inside a search
--   requires being a current decision-maker (owner or co-buyer).
-- * Any current decision-maker may delete an accepted Realtor-suggested home.
--   A pending (staged) suggestion is not deletable as a home: it is dismissed.
-- * A pending suggestion whose Realtor no longer belongs to the search is
--   withdrawn: hidden from buyers, and it cannot be accepted or dismissed. It
--   is not deleted; if the same Realtor is invited back, it is theirs again
--   (consistent with how a returning member's own data reactivates).
-- * A Realtor reads priorities, home assessments and places only of the
--   search's current owner and co-buyers.
--
-- Requires: 2026-09-16-realtor-role-foundation.sql, 2026-09-16-realtor-suggestions.sql
-- and 2026-09-16-realtor-suggestions-homes-select-fix.sql (production drift
-- repair). Re-runnable. Ends with a check that aborts the whole migration if any
-- other permissive policy on these tables would still grant the old access.
begin;

-- --------------------------------------------------------------- helpers ----

-- True when the home is an accepted Realtor suggestion. SECURITY DEFINER so the
-- answer does not depend on the caller's visibility of realtor_suggestions.
create or replace function public.is_accepted_realtor_suggestion_home(p_home_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.realtor_suggestions rs
    where rs.home_id = p_home_id and rs.status = 'accepted');
$$;
revoke all on function public.is_accepted_realtor_suggestion_home(uuid) from public, anon;
grant execute on function public.is_accepted_realtor_suggestion_home(uuid) to authenticated;

-- ----------------------------------------------------------------- homes ----

drop policy if exists "homes_select_own" on public.homes;
create policy "homes_select_own" on public.homes
  for select using (auth.uid() = user_id and search_id is null);

drop policy if exists "homes_delete_own" on public.homes;
create policy "homes_delete_own" on public.homes
  for delete using (
    auth.uid() = user_id
    and (search_id is null or public.is_search_decision_maker(search_id, auth.uid()))
  );

drop policy if exists "homes_delete_accepted_suggestion" on public.homes;
create policy "homes_delete_accepted_suggestion" on public.homes
  for delete using (
    not suggestion_staged
    and public.is_search_decision_maker(search_id, auth.uid())
    and public.is_accepted_realtor_suggestion_home(id)
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

-- ------------------------------------- withdrawn (departed-Realtor) suggestions ----

drop policy if exists "suggestions_participant_select" on public.realtor_suggestions;
create policy "suggestions_participant_select" on public.realtor_suggestions
  for select using (
    (public.is_search_decision_maker(search_id, auth.uid())
      and (status <> 'pending' or public.is_search_realtor(search_id, suggested_by)))
    or (suggested_by = auth.uid() and public.is_search_realtor(search_id, auth.uid()))
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
-- a pending suggestion whose Realtor has left the search cannot be acted on.
-- Accepting an already-accepted suggestion still returns its home.
create or replace function public.promote_realtor_suggestion(p_suggestion_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare caller uuid:=auth.uid(); suggestion public.realtor_suggestions%rowtype;
begin
  select * into suggestion from public.realtor_suggestions where id=p_suggestion_id for update;
  if caller is null or suggestion.id is null or not public.is_search_decision_maker(suggestion.search_id,caller) then raise exception 'Suggestion access denied' using errcode='42501'; end if;
  if suggestion.status='accepted' then return suggestion.home_id; end if;
  if not public.is_search_realtor(suggestion.search_id,suggestion.suggested_by) then raise exception 'Suggestion is no longer available' using errcode='42501'; end if;
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
  if current_status='pending' and not public.is_search_realtor(sid,suggester) then raise exception 'Suggestion is no longer available' using errcode='42501'; end if;
  insert into public.suggestion_dispositions(suggestion_id,user_id,disposition,reasons,other_text)
  values(p_suggestion_id,caller,'dismissed',coalesce(p_reasons,'{}'),nullif(trim(p_other_text),''))
  on conflict(suggestion_id,user_id) do update set disposition='dismissed',reasons=excluded.reasons,other_text=excluded.other_text,updated_at=now();
  select 1 + count(*) into decision_count from public.search_members where search_id=sid and role='co_buyer';
  select count(*) into dismissed_count from public.suggestion_dispositions sd join public.search_members sm on sm.user_id=sd.user_id and sm.search_id=sid and sm.role='co_buyer' where sd.suggestion_id=p_suggestion_id;
  if exists(select 1 from public.suggestion_dispositions sd join public.searches s on s.user_id=sd.user_id and s.id=sid where sd.suggestion_id=p_suggestion_id) then dismissed_count:=dismissed_count+1; end if;
  if dismissed_count>=decision_count then update public.realtor_suggestions set status='dismissed',updated_at=now() where id=p_suggestion_id and status='pending'; end if;
  return case when dismissed_count>=decision_count then 'dismissed' else 'pending' end;
end; $$;

revoke all on function public.promote_realtor_suggestion(uuid) from public, anon;
revoke all on function public.dismiss_realtor_suggestion(uuid,text[],text) from public, anon;
grant execute on function public.promote_realtor_suggestion(uuid) to authenticated;
grant execute on function public.dismiss_realtor_suggestion(uuid,text[],text) to authenticated;

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
      ('homes', 'homes_select_member'), ('homes', 'homes_select_own'),
      ('homes', 'homes_delete_own'), ('homes', 'homes_delete_accepted_suggestion'),
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
