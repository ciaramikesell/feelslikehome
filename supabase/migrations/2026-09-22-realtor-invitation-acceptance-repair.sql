-- Production repair: buyer-invites-Realtor acceptance ("Join as Realtor")
-- was failing with a generic "We couldn't complete that", and a Realtor's
-- own /people workspace was failing to load entirely, even on a first-run
-- account with a legitimately empty roster.
--
-- This mirrors the exact issue already fixed once for this same table in
-- 2026-09-18-people-workspace-draft-select-privileges.sql ("Production had
-- no usable authenticated SELECT privilege on the relation, so PostgREST
-- returned 42501 before RLS could return the caller's (possibly empty)
-- owner-scoped result") and the PostgREST schema-cache gap already fixed
-- for profiles.first_name/last_name in
-- 2026-09-21-profiles-name-schema-cache-fix.sql: this database's live
-- schema/grants/RPC cache can lag behind what these migration files
-- describe. Rather than guess which specific prior migration never fully
-- reached production, this idempotently re-asserts the exact canonical
-- state the invitation-acceptance and Realtor-roster read paths depend on
-- — every statement is a no-op if that state already exists — and reloads
-- PostgREST's schema/RPC cache. No RLS is weakened; every policy/grant
-- re-asserted here is byte-for-byte the same authorization rule already
-- documented in the migrations that first introduced it.
begin;

/* ---------------------------- search_members ---------------------------- */

alter table public.search_members drop constraint if exists search_members_role_check;
alter table public.search_members alter column role set default 'co_buyer';
alter table public.search_members add constraint search_members_role_check
  check (role in ('co_buyer', 'realtor'));

/* -------------------------- search_invitations --------------------------- */

alter table public.search_invitations alter column search_id drop not null;

alter table public.search_invitations add column if not exists relationship_type text;
update public.search_invitations set relationship_type = 'co_buyer' where relationship_type is null;
alter table public.search_invitations alter column relationship_type set default 'co_buyer';
alter table public.search_invitations alter column relationship_type set not null;
alter table public.search_invitations drop constraint if exists search_invitations_relationship_type_check;
alter table public.search_invitations add constraint search_invitations_relationship_type_check
  check (relationship_type in ('co_buyer', 'realtor'));

alter table public.search_invitations add column if not exists invitation_direction text;
update public.search_invitations set invitation_direction = 'buyer_to_realtor' where invitation_direction is null;
alter table public.search_invitations alter column invitation_direction set default 'buyer_to_realtor';
alter table public.search_invitations alter column invitation_direction set not null;
alter table public.search_invitations drop constraint if exists search_invitations_invitation_direction_check;
alter table public.search_invitations add constraint search_invitations_invitation_direction_check
  check (invitation_direction in ('buyer_to_realtor', 'realtor_to_buyer'));

alter table public.search_invitations add column if not exists inviter_display_name text;
alter table public.search_invitations add column if not exists prospective_search_id uuid;

/* --------------------------- prospective_searches -------------------------- */

create table if not exists public.prospective_searches (
  id uuid primary key default gen_random_uuid(),
  started_by uuid not null references auth.users(id) on delete cascade,
  client_name text check (client_name is null or char_length(client_name) <= 120),
  invited_email text check (invited_email is null or char_length(invited_email) <= 320),
  draft_priorities jsonb not null default '{}'::jsonb check (jsonb_typeof(draft_priorities) = 'object' and pg_column_size(draft_priorities) <= 65536),
  status text not null default 'draft' check (status in ('draft','invited')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.prospective_searches enable row level security;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'search_invitations_prospective_search_id_key') then
    alter table public.search_invitations
      add constraint search_invitations_prospective_search_id_key unique (prospective_search_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'search_invitations_prospective_search_id_fkey') then
    alter table public.search_invitations
      add constraint search_invitations_prospective_search_id_fkey
      foreign key (prospective_search_id) references public.prospective_searches(id) on delete set null;
  end if;
end $$;

drop policy if exists "prospective_searches_owner_select" on public.prospective_searches;
create policy "prospective_searches_owner_select" on public.prospective_searches
  for select to authenticated using (started_by = auth.uid());
drop policy if exists "prospective_searches_owner_update" on public.prospective_searches;
create policy "prospective_searches_owner_update" on public.prospective_searches
  for update to authenticated using (started_by = auth.uid()) with check (started_by = auth.uid() and status in ('draft','invited'));

-- The exact narrow ACL from 2026-09-18: a projected SELECT, not a blanket
-- grant — RLS still restricts rows to the caller's own drafts.
revoke all on public.prospective_searches from public, anon;
revoke select on table public.prospective_searches from authenticated;
grant select (
  id, client_name, invited_email, status, draft_priorities, created_at, updated_at
) on table public.prospective_searches to authenticated;
grant update (client_name, draft_priorities, updated_at) on public.prospective_searches to authenticated;

drop trigger if exists prospective_searches_set_updated_at on public.prospective_searches;
create trigger prospective_searches_set_updated_at before update on public.prospective_searches
  for each row execute function public.set_updated_at();

/* -------------------------------- functions -------------------------------- */

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

create or replace function public.create_prospective_search(p_draft_priorities jsonb default '{}'::jsonb, p_client_name text default null)
returns table(id uuid, status text) language plpgsql security definer set search_path = '' as $$
declare caller uuid := auth.uid(); created public.prospective_searches%rowtype;
begin
  if caller is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if jsonb_typeof(coalesce(p_draft_priorities,'{}'::jsonb)) <> 'object' or pg_column_size(coalesce(p_draft_priorities,'{}'::jsonb)) > 65536 then raise exception 'Invalid draft criteria'; end if;
  insert into public.prospective_searches(started_by,client_name,draft_priorities)
    values(caller,nullif(trim(p_client_name),''),coalesce(p_draft_priorities,'{}'::jsonb)) returning * into created;
  return query select created.id,created.status;
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

create or replace function public.create_buyer_invitation(p_invited_email text)
returns table(token uuid, expires_at timestamptz) language plpgsql security definer set search_path = '' as $$
declare caller uuid:=auth.uid(); draft_id uuid;
begin
  if caller is null then raise exception 'Authentication required' using errcode='42501'; end if;
  insert into public.prospective_searches(started_by,draft_priorities) values(caller,'{}'::jsonb) returning id into draft_id;
  return query select * from public.invite_prospective_client(draft_id,p_invited_email);
end; $$;

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

drop function if exists public.preview_invitation(uuid);
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

create or replace function public.claim_prospective_search(p_token uuid, p_confirmed_priorities jsonb)
returns table(success boolean, reason text, search_id uuid) language plpgsql security definer set search_path = '' as $$
declare inv public.search_invitations%rowtype; draft public.prospective_searches%rowtype; caller uuid:=auth.uid(); caller_email text; target_search uuid;
begin
  if caller is null then return query select false,'not_authenticated',null::uuid; return; end if;
  if jsonb_typeof(coalesce(p_confirmed_priorities,'{}'::jsonb)) <> 'object' or pg_column_size(coalesce(p_confirmed_priorities,'{}'::jsonb)) > 65536 then return query select false,'invalid_criteria',null::uuid; return; end if;
  select * into inv from public.search_invitations i where i.token=p_token for update;
  if inv.id is null then return query select false,'not_found',null::uuid; return; end if;
  select s.id into target_search from public.searches s where s.user_id=caller;
  if inv.status='accepted' and target_search is not null and exists(select 1 from public.search_members sm where sm.search_id=target_search and sm.user_id=inv.invited_by and sm.role='realtor') then return query select true,'already_claimed',target_search; return; end if;
  if inv.status<>'pending' then return query select false,inv.status,null::uuid; return; end if;
  if inv.expires_at<now() then return query select false,'expired',null::uuid; return; end if;
  if inv.invitation_direction<>'realtor_to_buyer' or inv.prospective_search_id is null then return query select false,'not_prospective',null::uuid; return; end if;
  select lower(u.email) into caller_email from auth.users u where u.id=caller;
  if caller_email is distinct from lower(inv.invited_email) then return query select false,'wrong_account',null::uuid; return; end if;
  if inv.invited_by=caller then return query select false,'self_invite',null::uuid; return; end if;
  select * into draft from public.prospective_searches p where p.id=inv.prospective_search_id and p.started_by=inv.invited_by for update;
  if draft.id is null then return query select false,'draft_unavailable',null::uuid; return; end if;
  if target_search is null then return query select false,'search_not_ready',null::uuid; return; end if;
  insert into public.search_member_priorities(search_id,user_id,priorities) values(target_search,caller,p_confirmed_priorities)
    on conflict(search_id,user_id) do update set priorities=excluded.priorities,updated_at=now();
  insert into public.search_members(search_id,user_id,role) values(target_search,inv.invited_by,'realtor') on conflict(search_id,user_id) do nothing;
  update public.search_invitations set status='accepted',responded_at=now(),search_id=target_search,prospective_search_id=null where id=inv.id;
  update public.profiles set onboarding_complete=true where id=caller;
  delete from public.prospective_searches where id=draft.id;
  return query select true,null::text,target_search;
end; $$;

-- Same acceptance logic as 2026-09-16-realtor-started-searches.sql, with one
-- addition: every risky step is now wrapped so an unexpected database error
-- (e.g. a constraint this environment's live schema doesn't yet match)
-- returns a sanitized `error_<stage>_<sqlstate>` reason instead of an opaque
-- failure — the same diagnostic pattern the original 2026-09-05 version of
-- this function used. Never includes the token, email, user id, or search id.
create or replace function public.accept_invitation(p_token uuid)
returns table(success boolean, reason text, search_id uuid) language plpgsql security definer set search_path = '' as $$
declare inv public.search_invitations%rowtype; caller uuid:=auth.uid(); caller_email text; target_search uuid; stage text := 'start';
begin
  if caller is null then return query select false,'not_authenticated',null::uuid; return; end if;
  begin
    stage := 'lookup_invitation';
    select * into inv from public.search_invitations i where i.token=p_token for update;
    if inv.id is null then return query select false,'not_found',null::uuid; return; end if;
    if inv.prospective_search_id is not null then return query select false,'confirmation_required',null::uuid; return; end if;
    stage := 'check_already_accepted';
    if inv.status='accepted' and inv.invitation_direction='realtor_to_buyer' and exists(select 1 from public.searches s join public.search_members sm on sm.search_id=s.id where s.user_id=caller and sm.user_id=inv.invited_by and sm.role='realtor') then return query select true,'already_member',(select s.id from public.searches s where s.user_id=caller); return; end if;
    if inv.status<>'pending' then return query select false,inv.status,null::uuid; return; end if;
    if inv.expires_at<now() then return query select false,'expired',null::uuid; return; end if;
    if inv.invited_by=caller then return query select false,'self_invite',null::uuid; return; end if;
    stage := 'lookup_email';
    select u.email into caller_email from auth.users u where u.id=caller;
    if lower(caller_email) is distinct from lower(inv.invited_email) then return query select false,'wrong_account',null::uuid; return; end if;
    stage := 'resolve_target_search';
    if inv.invitation_direction='realtor_to_buyer' then
      select s.id into target_search from public.searches s where s.user_id=caller;
      if target_search is null then return query select false,'search_not_ready',null::uuid; return; end if;
      stage := 'insert_member';
      insert into public.search_members(search_id,user_id,role) values(target_search,inv.invited_by,'realtor') on conflict(search_id,user_id) do nothing;
    else
      target_search:=inv.search_id;
      stage := 'check_relationship_conflict';
      if exists(select 1 from public.search_members sm where sm.search_id=target_search and sm.user_id=caller and sm.role<>inv.relationship_type) then return query select false,'relationship_conflict',null::uuid; return; end if;
      stage := 'insert_member';
      insert into public.search_members(search_id,user_id,role) values(target_search,caller,inv.relationship_type) on conflict(search_id,user_id) do nothing;
    end if;
    stage := 'update_invitation';
    update public.search_invitations set status='accepted',responded_at=now(),search_id=target_search where id=inv.id;
    return query select true,null::text,target_search;
  exception when others then
    return query select false, ('error_' || stage || '_' || sqlstate), null::uuid;
    return;
  end;
end; $$;

revoke all on function public.create_prospective_search(jsonb,text), public.invite_prospective_client(uuid,text), public.claim_prospective_search(uuid,jsonb), public.preview_invitation(uuid), public.create_buyer_invitation(text), public.create_realtor_connection_request(text), public.get_realtor_client_roster(uuid[]), public.accept_invitation(uuid) from public;
grant execute on function public.create_prospective_search(jsonb,text), public.invite_prospective_client(uuid,text), public.claim_prospective_search(uuid,jsonb), public.preview_invitation(uuid), public.create_buyer_invitation(text), public.create_realtor_connection_request(text), public.get_realtor_client_roster(uuid[]), public.accept_invitation(uuid) to authenticated;
revoke execute on function public.create_prospective_search(jsonb,text), public.invite_prospective_client(uuid,text), public.claim_prospective_search(uuid,jsonb), public.preview_invitation(uuid), public.create_buyer_invitation(text), public.create_realtor_connection_request(text), public.get_realtor_client_roster(uuid[]), public.accept_invitation(uuid) from anon, service_role;

notify pgrst, 'reload schema';
commit;
