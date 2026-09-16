-- Realtor-started client searches. Draft understanding is deliberately kept
-- outside participant-owned priorities until the invited buyer confirms it.
begin;

create table public.prospective_searches (
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
create policy "prospective_searches_owner_select" on public.prospective_searches for select to authenticated using (started_by = auth.uid());
create policy "prospective_searches_owner_update" on public.prospective_searches for update to authenticated using (started_by = auth.uid()) with check (started_by = auth.uid() and status in ('draft','invited'));
revoke all on public.prospective_searches from public, anon;
grant select, update (client_name, draft_priorities, updated_at) on public.prospective_searches to authenticated;
create trigger prospective_searches_set_updated_at before update on public.prospective_searches for each row execute function public.set_updated_at();

alter table public.search_invitations add column prospective_search_id uuid unique references public.prospective_searches(id) on delete set null;

create function public.create_prospective_search(p_draft_priorities jsonb default '{}'::jsonb, p_client_name text default null)
returns table(id uuid, status text) language plpgsql security definer set search_path = '' as $$
declare caller uuid := auth.uid(); created public.prospective_searches%rowtype;
begin
  if caller is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if jsonb_typeof(coalesce(p_draft_priorities,'{}'::jsonb)) <> 'object' or pg_column_size(coalesce(p_draft_priorities,'{}'::jsonb)) > 65536 then raise exception 'Invalid draft criteria'; end if;
  insert into public.prospective_searches(started_by,client_name,draft_priorities)
    values(caller,nullif(trim(p_client_name),''),coalesce(p_draft_priorities,'{}'::jsonb)) returning * into created;
  return query select created.id,created.status;
end; $$;

create function public.invite_prospective_client(p_prospective_search_id uuid, p_invited_email text)
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
  select coalesce(nullif(trim(u.raw_user_meta_data->>'full_name'),''),nullif(initcap(replace(split_part(u.email,'@',1),'.',' ')),''),'Your Realtor') into caller_name from auth.users u where u.id=caller;
  update public.prospective_searches set invited_email=normalized,status='invited' where prospective_searches.id=draft.id;
  return query insert into public.search_invitations(search_id,invited_by,invited_email,relationship_type,invitation_direction,inviter_display_name,prospective_search_id)
    values(null,caller,normalized,'realtor','realtor_to_buyer',caller_name,draft.id)
    returning search_invitations.token,search_invitations.expires_at;
end; $$;

-- The no-preconfiguration action uses the exact same draft architecture, with
-- an empty document. Creating one's own isolated draft is not authorization to
-- any client data and therefore does not depend on spoofable entry metadata.
create or replace function public.create_buyer_invitation(p_invited_email text)
returns table(token uuid, expires_at timestamptz) language plpgsql security definer set search_path = '' as $$
declare caller uuid:=auth.uid(); draft_id uuid;
begin
  if caller is null then raise exception 'Authentication required' using errcode='42501'; end if;
  insert into public.prospective_searches(started_by,draft_priorities) values(caller,'{}'::jsonb) returning id into draft_id;
  return query select * from public.invite_prospective_client(draft_id,p_invited_email);
end; $$;

drop function public.preview_invitation(uuid);
create function public.preview_invitation(p_token uuid)
returns table(valid boolean, reason text, relationship_type text, invitation_direction text, inviter_display_name text, draft_priorities jsonb, client_name text)
language plpgsql security definer stable set search_path = '' as $$
declare inv public.search_invitations%rowtype; draft public.prospective_searches%rowtype; caller uuid:=auth.uid(); caller_email text;
begin
  if caller is null then return query select false,'not_authenticated',null::text,null::text,null::text,null::jsonb,null::text; return; end if;
  select * into inv from public.search_invitations i where i.token=p_token;
  if inv.id is null then return query select false,'not_found',null::text,null::text,null::text,null::jsonb,null::text; return; end if;
  select lower(u.email) into caller_email from auth.users u where u.id=caller;
  if caller_email is distinct from lower(inv.invited_email) then return query select false,'wrong_account',null::text,null::text,null::text,null::jsonb,null::text; return; end if;
  if inv.status<>'pending' then return query select false,inv.status,inv.relationship_type,inv.invitation_direction,inv.inviter_display_name,null::jsonb,null::text; return; end if;
  if inv.expires_at<now() then return query select false,'expired',inv.relationship_type,inv.invitation_direction,inv.inviter_display_name,null::jsonb,null::text; return; end if;
  if inv.prospective_search_id is not null then select * into draft from public.prospective_searches p where p.id=inv.prospective_search_id; end if;
  return query select true,null::text,inv.relationship_type,inv.invitation_direction,inv.inviter_display_name,coalesce(draft.draft_priorities,'{}'::jsonb),draft.client_name;
end; $$;

create function public.claim_prospective_search(p_token uuid, p_confirmed_priorities jsonb)
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

-- Generic acceptance must never bypass buyer confirmation for a started
-- search. Other invitation directions retain the established atomic path.
create or replace function public.accept_invitation(p_token uuid)
returns table(success boolean, reason text, search_id uuid) language plpgsql security definer set search_path = '' as $$
declare inv public.search_invitations%rowtype; caller uuid:=auth.uid(); caller_email text; target_search uuid;
begin
  if caller is null then return query select false,'not_authenticated',null::uuid; return; end if;
  select * into inv from public.search_invitations i where i.token=p_token for update;
  if inv.id is null then return query select false,'not_found',null::uuid; return; end if;
  if inv.prospective_search_id is not null then return query select false,'confirmation_required',null::uuid; return; end if;
  if inv.status='accepted' and inv.invitation_direction='realtor_to_buyer' and exists(select 1 from public.searches s join public.search_members sm on sm.search_id=s.id where s.user_id=caller and sm.user_id=inv.invited_by and sm.role='realtor') then return query select true,'already_member',(select s.id from public.searches s where s.user_id=caller); return; end if;
  if inv.status<>'pending' then return query select false,inv.status,null::uuid; return; end if;
  if inv.expires_at<now() then return query select false,'expired',null::uuid; return; end if;
  if inv.invited_by=caller then return query select false,'self_invite',null::uuid; return; end if;
  select u.email into caller_email from auth.users u where u.id=caller;
  if lower(caller_email) is distinct from lower(inv.invited_email) then return query select false,'wrong_account',null::uuid; return; end if;
  if inv.invitation_direction='realtor_to_buyer' then
    select s.id into target_search from public.searches s where s.user_id=caller;
    if target_search is null then return query select false,'search_not_ready',null::uuid; return; end if;
    insert into public.search_members(search_id,user_id,role) values(target_search,inv.invited_by,'realtor') on conflict(search_id,user_id) do nothing;
  else
    target_search:=inv.search_id;
    if exists(select 1 from public.search_members sm where sm.search_id=target_search and sm.user_id=caller and sm.role<>inv.relationship_type) then return query select false,'relationship_conflict',null::uuid; return; end if;
    insert into public.search_members(search_id,user_id,role) values(target_search,caller,inv.relationship_type) on conflict(search_id,user_id) do nothing;
  end if;
  update public.search_invitations set status='accepted',responded_at=now(),search_id=target_search where id=inv.id;
  return query select true,null::text,target_search;
end; $$;

revoke all on function public.create_prospective_search(jsonb,text), public.invite_prospective_client(uuid,text), public.claim_prospective_search(uuid,jsonb), public.preview_invitation(uuid), public.create_buyer_invitation(text), public.accept_invitation(uuid) from public;
grant execute on function public.create_prospective_search(jsonb,text), public.invite_prospective_client(uuid,text), public.claim_prospective_search(uuid,jsonb), public.preview_invitation(uuid), public.create_buyer_invitation(text), public.accept_invitation(uuid) to authenticated;
grant execute on function public.create_prospective_search(jsonb,text) to authenticated;
grant execute on function public.invite_prospective_client(uuid,text) to authenticated;
grant execute on function public.claim_prospective_search(uuid,jsonb) to authenticated;
grant execute on function public.preview_invitation(uuid) to authenticated;
revoke execute on function public.create_prospective_search(jsonb,text), public.invite_prospective_client(uuid,text), public.claim_prospective_search(uuid,jsonb), public.preview_invitation(uuid), public.create_buyer_invitation(text), public.accept_invitation(uuid) from anon, service_role;

notify pgrst, 'reload schema';
commit;
