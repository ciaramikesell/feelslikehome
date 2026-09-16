-- PR #82: search-scoped professional context, tour recommendations, and the
-- reverse (Realtor -> buyer) entry point into the existing invitation system.
begin;

create table public.realtor_notes (
  id uuid primary key default gen_random_uuid(),
  search_id uuid not null references public.searches(id) on delete cascade,
  home_id uuid not null references public.homes(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete restrict,
  author_display_name text not null,
  content text not null check (char_length(trim(content)) between 1 and 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (search_id, home_id, author_id)
);

create table public.tour_suggestions (
  id uuid primary key default gen_random_uuid(),
  search_id uuid not null references public.searches(id) on delete cascade,
  home_id uuid not null references public.homes(id) on delete cascade,
  suggested_by uuid not null references auth.users(id) on delete restrict,
  suggested_by_display_name text not null,
  created_at timestamptz not null default now(),
  unique (search_id, home_id, suggested_by)
);

alter table public.realtor_notes enable row level security;
alter table public.tour_suggestions enable row level security;

-- Decision-makers retain useful history. A Realtor only sees contributions
-- while their current membership still authorizes the search.
create policy "realtor_notes_relationship_select" on public.realtor_notes for select using (
  public.is_search_decision_maker(search_id, auth.uid()) or public.is_search_realtor(search_id, auth.uid())
);
create policy "tour_suggestions_relationship_select" on public.tour_suggestions for select using (
  public.is_search_decision_maker(search_id, auth.uid()) or public.is_search_realtor(search_id, auth.uid())
);
grant select on public.realtor_notes, public.tour_suggestions to authenticated;

create or replace function public.save_realtor_note(p_search_id uuid, p_home_id uuid, p_content text)
returns public.realtor_notes language plpgsql security definer set search_path = '' as $$
declare caller uuid:=auth.uid(); result public.realtor_notes; display_name text;
begin
  if caller is null or not public.is_search_realtor(p_search_id,caller) then raise exception 'Search access denied' using errcode='42501'; end if;
  if nullif(trim(p_content),'') is null or char_length(trim(p_content)) > 2000 then raise exception 'Note must be between 1 and 2000 characters'; end if;
  if not exists(select 1 from public.homes h where h.id=p_home_id and h.search_id=p_search_id and not h.suggestion_staged) then raise exception 'Home is not an eligible contender' using errcode='42501'; end if;
  select coalesce(nullif(trim(u.raw_user_meta_data->>'full_name'),''),nullif(initcap(replace(split_part(u.email,'@',1),'.',' ')),''),'Realtor') into display_name
    from auth.users u where u.id=caller;
  insert into public.realtor_notes(search_id,home_id,author_id,author_display_name,content)
  values(p_search_id,p_home_id,caller,display_name,trim(p_content))
  on conflict(search_id,home_id,author_id) do update set content=excluded.content,updated_at=now()
  returning * into result;
  return result;
end; $$;

create or replace function public.delete_realtor_note(p_note_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare caller uuid:=auth.uid(); affected int;
begin
  if caller is null then raise exception 'Authentication required' using errcode='42501'; end if;
  delete from public.realtor_notes n where n.id=p_note_id and n.author_id=caller and public.is_search_realtor(n.search_id,caller);
  get diagnostics affected=row_count; return affected=1;
end; $$;

create or replace function public.suggest_home_tour(p_search_id uuid, p_home_id uuid)
returns public.tour_suggestions language plpgsql security definer set search_path = '' as $$
declare caller uuid:=auth.uid(); result public.tour_suggestions; display_name text;
begin
  if caller is null or not public.is_search_realtor(p_search_id,caller) then raise exception 'Search access denied' using errcode='42501'; end if;
  if not exists(select 1 from public.homes h where h.id=p_home_id and h.search_id=p_search_id and not h.suggestion_staged
    and exists(select 1 from public.home_member_state s where s.home_id=h.id and s.status <> 'Archived'))
    then raise exception 'Home is not an active contender' using errcode='42501'; end if;
  select coalesce(nullif(trim(u.raw_user_meta_data->>'full_name'),''),nullif(initcap(replace(split_part(u.email,'@',1),'.',' ')),''),'Realtor') into display_name
    from auth.users u where u.id=caller;
  insert into public.tour_suggestions(search_id,home_id,suggested_by,suggested_by_display_name)
  values(p_search_id,p_home_id,caller,display_name)
  on conflict(search_id,home_id,suggested_by) do update set suggested_by_display_name=excluded.suggested_by_display_name
  returning * into result;
  return result;
end; $$;

-- A reverse invitation is still the same secure, email-bound invitation row.
-- It has no search until the buyer explicitly accepts and chooses their own
-- one-and-only owned search; invitation never grants pre-acceptance access.
alter table public.search_invitations alter column search_id drop not null;
alter table public.search_invitations add column invitation_direction text not null default 'buyer_to_realtor'
  check (invitation_direction in ('buyer_to_realtor','realtor_to_buyer'));
alter table public.search_invitations add column inviter_display_name text;

create or replace function public.create_buyer_invitation(p_invited_email text)
returns table(token uuid, expires_at timestamptz) language plpgsql security definer set search_path = '' as $$
declare caller uuid:=auth.uid(); caller_name text; existing public.search_invitations%rowtype;
begin
  if caller is null or not exists(select 1 from public.search_members sm where sm.user_id=caller and sm.role='realtor') then raise exception 'Realtor access required' using errcode='42501'; end if;
  if nullif(trim(p_invited_email),'') is null or position('@' in p_invited_email)=0 then raise exception 'A valid email is required'; end if;
  select * into existing from public.search_invitations i where i.invited_by=caller and i.invited_email=lower(trim(p_invited_email)) and i.invitation_direction='realtor_to_buyer' and i.status='pending' and i.expires_at>now() order by i.created_at desc limit 1;
  if existing.id is not null then return query select existing.token,existing.expires_at; return; end if;
  select coalesce(nullif(trim(u.raw_user_meta_data->>'full_name'),''),nullif(initcap(replace(split_part(u.email,'@',1),'.',' ')),''),'Your Realtor') into caller_name from auth.users u where u.id=caller;
  return query insert into public.search_invitations(search_id,invited_by,invited_email,relationship_type,invitation_direction,inviter_display_name)
    values(null,caller,lower(trim(p_invited_email)),'realtor','realtor_to_buyer',caller_name) returning search_invitations.token,search_invitations.expires_at;
end; $$;

-- Replace the #78 functions so preview supplies safe invitation copy and
-- acceptance converges both directions on search_members.
drop function public.preview_invitation(uuid);
create function public.preview_invitation(p_token uuid)
returns table(valid boolean, reason text, relationship_type text, invitation_direction text, inviter_display_name text)
language plpgsql security definer stable set search_path = '' as $$
declare inv public.search_invitations%rowtype;
begin
  if auth.uid() is null then return query select false,'not_authenticated',null::text,null::text,null::text; return; end if;
  select * into inv from public.search_invitations i where i.token=p_token;
  if inv is null then return query select false,'not_found',null::text,null::text,null::text; return; end if;
  if inv.status<>'pending' then return query select false,inv.status,inv.relationship_type,inv.invitation_direction,inv.inviter_display_name; return; end if;
  if inv.expires_at<now() then return query select false,'expired',inv.relationship_type,inv.invitation_direction,inv.inviter_display_name; return; end if;
  return query select true,null::text,inv.relationship_type,inv.invitation_direction,inv.inviter_display_name;
end; $$;

create or replace function public.accept_invitation(p_token uuid)
returns table(success boolean, reason text, search_id uuid) language plpgsql security definer set search_path = '' as $$
declare inv public.search_invitations%rowtype; caller uuid:=auth.uid(); caller_email text; target_search uuid;
begin
  if caller is null then return query select false,'not_authenticated',null::uuid; return; end if;
  select * into inv from public.search_invitations i where i.token=p_token for update;
  if inv is null then return query select false,'not_found',null::uuid; return; end if;
  if inv.invitation_direction='realtor_to_buyer' and inv.status='accepted' and exists(select 1 from public.searches s join public.search_members sm on sm.search_id=s.id where s.user_id=caller and sm.user_id=inv.invited_by and sm.role='realtor') then return query select true,'already_member',(select s.id from public.searches s where s.user_id=caller); return; end if;
  if inv.status<>'pending' then return query select false,inv.status,null::uuid; return; end if;
  if inv.expires_at<now() then return query select false,'expired',null::uuid; return; end if;
  if inv.invited_by=caller then return query select false,'self_invite',null::uuid; return; end if;
  select u.email into caller_email from auth.users u where u.id=caller;
  if lower(caller_email) is distinct from lower(inv.invited_email) then return query select false,'wrong_account',null::uuid; return; end if;
  if inv.invitation_direction='realtor_to_buyer' then
    select s.id into target_search from public.searches s where s.user_id=caller;
    if target_search is null then return query select false,'search_not_ready',null::uuid; return; end if;
    if exists(select 1 from public.search_members sm where sm.search_id=target_search and sm.user_id=inv.invited_by and sm.role<>'realtor') then return query select false,'relationship_conflict',null::uuid; return; end if;
    insert into public.search_members(search_id,user_id,role) values(target_search,inv.invited_by,'realtor') on conflict(search_id,user_id) do nothing;
  else
    target_search:=inv.search_id;
    if exists(select 1 from public.search_members sm where sm.search_id=target_search and sm.user_id=caller and sm.role<>inv.relationship_type) then return query select false,'relationship_conflict',null::uuid; return; end if;
    insert into public.search_members(search_id,user_id,role) values(target_search,caller,inv.relationship_type) on conflict(search_id,user_id) do nothing;
  end if;
  update public.search_invitations set status='accepted',responded_at=now(),search_id=target_search where id=inv.id;
  return query select true,null::text,target_search;
end; $$;

revoke all on function public.save_realtor_note(uuid,uuid,text), public.delete_realtor_note(uuid), public.suggest_home_tour(uuid,uuid), public.create_buyer_invitation(text), public.preview_invitation(uuid), public.accept_invitation(uuid) from public;
grant execute on function public.save_realtor_note(uuid,uuid,text), public.delete_realtor_note(uuid), public.suggest_home_tour(uuid,uuid), public.create_buyer_invitation(text), public.preview_invitation(uuid), public.accept_invitation(uuid) to authenticated;
revoke execute on function public.save_realtor_note(uuid,uuid,text), public.delete_realtor_note(uuid), public.suggest_home_tour(uuid,uuid), public.create_buyer_invitation(text), public.preview_invitation(uuid), public.accept_invitation(uuid) from anon, service_role;

notify pgrst, 'reload schema';
commit;
