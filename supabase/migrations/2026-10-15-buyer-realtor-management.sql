-- Buyer-side Realtor management (My Search → Your People).
--
-- Additive only: six new SECURITY DEFINER functions. No table, column,
-- constraint, policy or existing function changes, and no data is rewritten.
-- Existing grants and RLS (including 2026-10-12-realtor-access-and-home-ownership.sql)
-- are unchanged; every function checks authorization itself against current
-- membership, so a forged search id, token or membership claim grants nothing.
--
-- Who may do what (approved product behaviour):
-- * Either current buyer of a search (owner or co-buyer: is_search_decision_maker)
--   may see its people, invite a Realtor to it, see/revoke its pending Realtor
--   invitations, and remove its Realtor.
-- * A buyer approving a Realtor's connection request chooses the search it
--   applies to explicitly (the search they are actually using), and must be a
--   current owner or co-buyer of it. accept_invitation's older path, which
--   always used the caller's *owned* search (searches.user_id), is left in place
--   for compatibility but the app no longer uses it for connection requests.
-- * Realtors and outsiders can do none of this. Removing a Realtor deletes only
--   their membership; the 2026-10-12 trigger then withdraws their pending
--   suggestions permanently, and accepted homes stay with the buyers.
--
-- Requires 2026-10-12-realtor-access-and-home-ownership.sql. Re-runnable.
begin;

-- Who is in this search, for its buyers: owner, co-buyers and Realtors, with
-- display names. Never returns priorities, ratings or reactions.
create or replace function public.get_search_people(p_search_id uuid)
returns table(user_id uuid, role text, display_name text, is_you boolean, joined_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare caller uuid := auth.uid();
begin
  if caller is null or p_search_id is null or not public.is_search_decision_maker(p_search_id, caller) then
    raise exception 'Search access denied' using errcode = '42501';
  end if;
  return query
  select p.uid, p.r,
         public.resolve_display_name(p.uid, case p.r when 'realtor' then 'Your Realtor' when 'owner' then 'Search owner' else 'Co-buyer' end),
         p.uid = caller, p.j
  from (
    select s.user_id as uid, 'owner'::text as r, s.created_at as j from public.searches s where s.id = p_search_id
    union all
    select sm.user_id, sm.role, sm.joined_at from public.search_members sm
      where sm.search_id = p_search_id and sm.role in ('co_buyer', 'realtor')
  ) p
  order by case p.r when 'owner' then 0 when 'co_buyer' then 1 else 2 end, p.j;
end; $$;

-- A copy-link Realtor invitation for this search, created by either buyer.
-- Re-inviting the same email while an invitation is still pending returns that
-- invitation instead of creating another.
create or replace function public.create_search_realtor_invitation(p_search_id uuid, p_invited_email text)
returns table(invitation_id uuid, token uuid, expires_at timestamptz, reused boolean)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  caller uuid := auth.uid();
  normalized text := lower(trim(p_invited_email));
  invitee uuid;
  existing public.search_invitations%rowtype;
begin
  if caller is null or p_search_id is null or not public.is_search_decision_maker(p_search_id, caller) then
    raise exception 'Search access denied' using errcode = '42501';
  end if;
  if normalized is null or normalized !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'invalid_email' using errcode = '22023';
  end if;
  if exists (select 1 from auth.users u where u.id = caller and lower(u.email) = normalized) then
    raise exception 'self_invite' using errcode = '22023';
  end if;
  select u.id into invitee from auth.users u where lower(u.email) = normalized;
  if invitee is not null and public.is_search_realtor(p_search_id, invitee) then
    raise exception 'already_connected' using errcode = '22023';
  end if;
  if invitee is not null and public.is_search_decision_maker(p_search_id, invitee) then
    raise exception 'already_a_buyer' using errcode = '22023';
  end if;
  select * into existing from public.search_invitations i
    where i.search_id = p_search_id and i.invited_email = normalized and i.relationship_type = 'realtor'
      and i.invitation_direction = 'buyer_to_realtor' and i.status = 'pending' and i.expires_at > now()
    order by i.created_at desc limit 1;
  if existing.id is not null then
    return query select existing.id, existing.token, existing.expires_at, true;
    return;
  end if;
  return query
  insert into public.search_invitations as i (search_id, invited_by, invited_email, relationship_type, invitation_direction, inviter_display_name)
  values (p_search_id, caller, normalized, 'realtor', 'buyer_to_realtor', public.resolve_display_name(caller, 'Your buyer'))
  returning i.id, i.token, i.expires_at, false;
end; $$;

-- Realtor invitations this search's buyers can act on: invitations sent for
-- this search (pending, plus expired/revoked ones from the last 30 days so a
-- replacement can be sent), and pending connection requests addressed to the
-- caller. A link token is returned only while it can still be used.
create or replace function public.list_search_realtor_invitations(p_search_id uuid)
returns table(invitation_id uuid, direction text, invited_email text, inviter_name text, status text, created_at timestamptz, expires_at timestamptz, token uuid)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare caller uuid := auth.uid(); caller_email text;
begin
  if caller is null or p_search_id is null or not public.is_search_decision_maker(p_search_id, caller) then
    raise exception 'Search access denied' using errcode = '42501';
  end if;
  select lower(u.email) into caller_email from auth.users u where u.id = caller;
  return query
  select x.id, x.invitation_direction, x.invited_email, x.inviter_display_name, x.effective, x.created_at, x.expires_at,
         case when x.effective = 'pending' then x.token end
  from (
    select i.*, case when i.status = 'pending' and i.expires_at < now() then 'expired' else i.status end as effective
    from public.search_invitations i
    where (
        i.search_id = p_search_id and i.relationship_type = 'realtor' and i.invitation_direction = 'buyer_to_realtor'
        and i.status <> 'accepted' and (i.status = 'pending' or coalesce(i.responded_at, i.expires_at) > now() - interval '30 days')
      ) or (
        i.invitation_direction = 'realtor_to_buyer' and i.prospective_search_id is null and i.status = 'pending'
        and lower(i.invited_email) = caller_email
      )
  ) x
  order by (x.effective = 'pending') desc, x.created_at desc;
end; $$;

-- Revokes a pending Realtor invitation (a buyer of its search, or the person
-- who sent it), or declines a connection request addressed to the caller.
-- A revoked token can never be accepted (accept/approve require 'pending').
create or replace function public.revoke_search_invitation(p_invitation_id uuid)
returns text
language plpgsql security definer set search_path = '' as $$
declare caller uuid := auth.uid(); caller_email text; inv public.search_invitations%rowtype;
begin
  if caller is null then raise exception 'Invitation access denied' using errcode = '42501'; end if;
  select * into inv from public.search_invitations i where i.id = p_invitation_id for update;
  select lower(u.email) into caller_email from auth.users u where u.id = caller;
  if inv.id is null or not (
    (inv.relationship_type = 'realtor' and inv.invitation_direction = 'buyer_to_realtor' and inv.search_id is not null
      and public.is_search_decision_maker(inv.search_id, caller))
    or (inv.invitation_direction = 'realtor_to_buyer' and inv.prospective_search_id is null and lower(inv.invited_email) = caller_email)
    or inv.invited_by = caller
  ) then
    raise exception 'Invitation access denied' using errcode = '42501';
  end if;
  if inv.status = 'revoked' then return 'already_revoked'; end if;
  if inv.status = 'accepted' then return 'already_accepted'; end if;
  update public.search_invitations set status = 'revoked', responded_at = now() where id = inv.id;
  return 'revoked';
end; $$;

-- Removes this search's Realtor. Either buyer may. Only a Realtor membership
-- can be removed here; buyers are never removed by this function.
create or replace function public.remove_search_realtor(p_search_id uuid, p_realtor_id uuid)
returns text
language plpgsql security definer set search_path = '' as $$
declare caller uuid := auth.uid(); target_role text;
begin
  if caller is null or p_search_id is null or not public.is_search_decision_maker(p_search_id, caller) then
    raise exception 'Search access denied' using errcode = '42501';
  end if;
  if public.is_search_owner(p_search_id, p_realtor_id) then raise exception 'not_a_realtor' using errcode = '22023'; end if;
  select sm.role into target_role from public.search_members sm where sm.search_id = p_search_id and sm.user_id = p_realtor_id;
  if target_role is null then return 'not_connected'; end if;
  if target_role <> 'realtor' then raise exception 'not_a_realtor' using errcode = '22023'; end if;
  -- search_members_withdraw_realtor_suggestions (2026-10-12) withdraws their
  -- pending suggestions; accepted homes are untouched.
  delete from public.search_members sm where sm.search_id = p_search_id and sm.user_id = p_realtor_id and sm.role = 'realtor';
  return 'removed';
end; $$;

-- A buyer approves a Realtor's connection request for a specific search they
-- buy in (owner or co-buyer), instead of whichever search they happen to own.
create or replace function public.approve_realtor_connection(p_token uuid, p_search_id uuid)
returns table(success boolean, reason text, search_id uuid)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare caller uuid := auth.uid(); caller_email text; inv public.search_invitations%rowtype;
begin
  if caller is null then return query select false, 'not_authenticated', null::uuid; return; end if;
  select * into inv from public.search_invitations i where i.token = p_token for update;
  if inv.id is null then return query select false, 'not_found', null::uuid; return; end if;
  select lower(u.email) into caller_email from auth.users u where u.id = caller;
  if caller_email is distinct from lower(inv.invited_email) then return query select false, 'wrong_account', null::uuid; return; end if;
  if inv.invitation_direction <> 'realtor_to_buyer' then return query select false, 'not_a_connection_request', null::uuid; return; end if;
  if inv.prospective_search_id is not null then return query select false, 'confirmation_required', null::uuid; return; end if;
  if p_search_id is null or not public.is_search_decision_maker(p_search_id, caller) then
    return query select false, 'search_not_authorized', null::uuid; return;
  end if;
  if inv.status = 'accepted' then
    if public.is_search_realtor(p_search_id, inv.invited_by) then return query select true, 'already_member', p_search_id; return; end if;
    return query select false, 'accepted', null::uuid; return;
  end if;
  if inv.status <> 'pending' then return query select false, inv.status, null::uuid; return; end if;
  if inv.expires_at < now() then return query select false, 'expired', null::uuid; return; end if;
  if inv.invited_by = caller then return query select false, 'self_invite', null::uuid; return; end if;
  if public.is_search_decision_maker(p_search_id, inv.invited_by) then
    return query select false, 'relationship_conflict', null::uuid; return;
  end if;
  insert into public.search_members (search_id, user_id, role) values (p_search_id, inv.invited_by, 'realtor')
    on conflict on constraint search_members_search_id_user_id_key do nothing;
  update public.search_invitations set status = 'accepted', responded_at = now(), search_id = p_search_id where id = inv.id;
  return query select true, null::text, p_search_id;
end; $$;

revoke all on function public.get_search_people(uuid) from public, anon;
revoke all on function public.create_search_realtor_invitation(uuid, text) from public, anon;
revoke all on function public.list_search_realtor_invitations(uuid) from public, anon;
revoke all on function public.revoke_search_invitation(uuid) from public, anon;
revoke all on function public.remove_search_realtor(uuid, uuid) from public, anon;
revoke all on function public.approve_realtor_connection(uuid, uuid) from public, anon;
grant execute on function public.get_search_people(uuid) to authenticated;
grant execute on function public.create_search_realtor_invitation(uuid, text) to authenticated;
grant execute on function public.list_search_realtor_invitations(uuid) to authenticated;
grant execute on function public.revoke_search_invitation(uuid) to authenticated;
grant execute on function public.remove_search_realtor(uuid, uuid) to authenticated;
grant execute on function public.approve_realtor_connection(uuid, uuid) to authenticated;

commit;
