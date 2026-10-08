-- Invitation acceptance: unambiguous conflict targets.
--
-- accept_invitation and claim_prospective_search both `returns table(...,
-- search_id uuid)`, which makes `search_id` a PL/pgSQL OUT variable inside the
-- function body. Their `on conflict(search_id,user_id)` clauses are therefore
-- ambiguous (variable vs. column). With PostgreSQL's default
-- plpgsql.variable_conflict = error, every call that reaches one of those
-- inserts fails with 42702 ("column reference \"search_id\" is ambiguous")
-- before any membership is written: every co-buyer acceptance, every Realtor
-- acceptance, every Realtor connection request, and every Realtor-started
-- client claim since 2026-09-16-realtor-notes-tours-buyer-invitations.sql.
--
-- Found by the real-Postgres regression in
-- test/cobuyer-onboarding-shared-search.test.js. The fix names the existing
-- unique constraints instead of listing columns. Both bodies are otherwise the
-- current definitions from 2026-09-16-realtor-started-searches.sql verbatim:
-- same signatures, SECURITY DEFINER with an empty search_path, same checks,
-- same grants. No policy or grant is widened.
begin;

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
    on conflict on constraint search_member_priorities_search_id_user_id_key do update set priorities=excluded.priorities,updated_at=now();
  insert into public.search_members(search_id,user_id,role) values(target_search,inv.invited_by,'realtor') on conflict on constraint search_members_search_id_user_id_key do nothing;
  update public.search_invitations set status='accepted',responded_at=now(),search_id=target_search,prospective_search_id=null where id=inv.id;
  update public.profiles set onboarding_complete=true where id=caller;
  delete from public.prospective_searches where id=draft.id;
  return query select true,null::text,target_search;
end; $$;

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
    insert into public.search_members(search_id,user_id,role) values(target_search,inv.invited_by,'realtor') on conflict on constraint search_members_search_id_user_id_key do nothing;
  else
    target_search:=inv.search_id;
    if exists(select 1 from public.search_members sm where sm.search_id=target_search and sm.user_id=caller and sm.role<>inv.relationship_type) then return query select false,'relationship_conflict',null::uuid; return; end if;
    insert into public.search_members(search_id,user_id,role) values(target_search,caller,inv.relationship_type) on conflict on constraint search_members_search_id_user_id_key do nothing;
  end if;
  update public.search_invitations set status='accepted',responded_at=now(),search_id=target_search where id=inv.id;
  return query select true,null::text,target_search;
end; $$;

revoke all on function public.claim_prospective_search(uuid,jsonb), public.accept_invitation(uuid) from public;
grant execute on function public.claim_prospective_search(uuid,jsonb), public.accept_invitation(uuid) to authenticated;
revoke execute on function public.claim_prospective_search(uuid,jsonb), public.accept_invitation(uuid) from anon, service_role;

notify pgrst, 'reload schema';
commit;
