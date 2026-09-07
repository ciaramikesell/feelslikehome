-- Co-Buyer V1 — Phase D: invitation preview/acceptance RPCs.
--
-- Invite CREATION needs no RPC — the search owner already has direct INSERT
-- rights on search_invitations via the existing Phase A policy
-- (search_invitations_owner_insert). This file only adds the two operations
-- an invitee (who has zero RLS access to search_invitations before accepting)
-- needs: a minimal, safe preview, and an atomic accept.
--
-- Both require an authenticated session (auth.uid() is not null) — this app
-- already gates every page behind sign-in first, so the invitee must sign in
-- or sign up before ever reaching either of these, consistent with existing
-- architecture rather than inventing a new unauthenticated access pattern.

-- preview_invitation: tells the caller ONLY whether a token is currently
-- usable, and why not if it isn't. Never returns the search's contents,
-- other invitations, member data, or home data.
create or replace function public.preview_invitation(p_token uuid)
returns table (valid boolean, reason text)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  inv record;
begin
  select * into inv from public.search_invitations where token = p_token;

  if inv is null then
    return query select false, 'not_found';
    return;
  end if;
  if inv.status = 'accepted' then
    return query select false, 'already_accepted';
    return;
  end if;
  if inv.status = 'revoked' then
    return query select false, 'revoked';
    return;
  end if;
  if inv.expires_at < now() then
    return query select false, 'expired';
    return;
  end if;

  return query select true, null::text;
end;
$$;

revoke all on function public.preview_invitation(uuid) from public;
-- Explicit, not redundant: Supabase's platform-level default privileges grant
-- EXECUTE on newly created public-schema functions to anon/authenticated/
-- service_role directly — a separate, role-specific ACL entry that REVOKE ALL
-- FROM PUBLIC does not touch. Discovered via live grant verification after
-- this migration was first applied; corrected here so a fresh environment
-- gets the intended "authenticated only" surface on the first run.
revoke execute on function public.preview_invitation(uuid) from anon;
revoke execute on function public.preview_invitation(uuid) from service_role;
grant execute on function public.preview_invitation(uuid) to authenticated;

-- accept_invitation: validates everything, then atomically creates
-- membership and marks the invitation accepted. `select ... for update` locks
-- the invitation row for the transaction's duration, so a double-click (two
-- concurrent accept calls) cannot both succeed — the second call blocks
-- until the first commits, then sees status = 'accepted' and returns the
-- idempotent "already_accepted" outcome rather than creating a duplicate
-- membership row. The unique(search_id, user_id) constraint on
-- search_members is a second, database-level backstop against duplicates
-- even if this function's own logic ever had a bug.
create or replace function public.accept_invitation(p_token uuid)
returns table (success boolean, reason text, search_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  inv record;
  caller uuid := auth.uid();
  caller_email text;
begin
  if caller is null then
    return query select false, 'not_authenticated', null::uuid;
    return;
  end if;

  select * into inv from public.search_invitations where token = p_token for update;

  if inv is null then
    return query select false, 'not_found', null::uuid;
    return;
  end if;
  if inv.status = 'accepted' then
    -- Idempotent: if this exact caller is already the member this
    -- invitation created, treat a repeat accept as a harmless success
    -- rather than an error (e.g. a double-click, or returning to the link).
    if exists (select 1 from public.search_members where search_id = inv.search_id and user_id = caller) then
      return query select true, 'already_member', inv.search_id;
      return;
    end if;
    return query select false, 'already_accepted', null::uuid;
    return;
  end if;
  if inv.status = 'revoked' then
    return query select false, 'revoked', null::uuid;
    return;
  end if;
  if inv.expires_at < now() then
    return query select false, 'expired', null::uuid;
    return;
  end if;
  if inv.invited_by = caller then
    return query select false, 'self_invite', null::uuid;
    return;
  end if;

  -- Email-binding: only the invited address may accept. Reads ONLY the
  -- caller's own email (auth.uid() = caller), never any other user's row.
  select email into caller_email from auth.users where id = caller;
  if caller_email is null or lower(caller_email) is distinct from lower(inv.invited_email) then
    return query select false, 'wrong_account', null::uuid;
    return;
  end if;

  if exists (select 1 from public.search_members where search_id = inv.search_id and user_id = caller) then
    update public.search_invitations set status = 'accepted', responded_at = now() where id = inv.id;
    return query select true, 'already_member', inv.search_id;
    return;
  end if;

  insert into public.search_members (search_id, user_id, role) values (inv.search_id, caller, 'member');
  update public.search_invitations set status = 'accepted', responded_at = now() where id = inv.id;

  return query select true, null::text, inv.search_id;
end;
$$;

revoke all on function public.accept_invitation(uuid) from public;
-- Same correction as preview_invitation above, for the same reason.
revoke execute on function public.accept_invitation(uuid) from anon;
revoke execute on function public.accept_invitation(uuid) from service_role;
grant execute on function public.accept_invitation(uuid) to authenticated;
