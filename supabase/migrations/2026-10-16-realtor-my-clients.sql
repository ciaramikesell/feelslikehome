-- My Clients: one private, Realtor-owned record per client.
--
-- prospective_searches already is that record for clients who have not joined
-- FLH (2026-09-16): owned by the Realtor who started it, readable and editable
-- only by them, created only through SECURITY DEFINER functions. This
-- migration extends it instead of adding a parallel table:
--
--   * Private details: contact_email, contact_phone, preferred_locations and
--     notes. They are never returned by preview_invitation or any other
--     function a buyer can call; buyers have no policy on this table at all.
--     contact_email is deliberately separate from invited_email: writing down
--     an email never invites anyone and never identifies an account.
--   * draft_priorities keeps its existing meaning: the Realtor's proposed
--     budget, beds, baths and wishlist, shown to a buyer only through an
--     invitation they open, and applied only when they confirm it.
--   * A record links to a buyer's search (search_id, status 'connected') only
--     by a deliberate act: the buyer claiming that record's own invitation
--     (claim_prospective_search, below), or the Realtor opening a record for a
--     search they are currently a Realtor on (open_connected_client_record).
--     Nothing ever links or merges records by matching email addresses.
--   * A connected record carries no buyer data: its draft criteria are cleared
--     when the buyer claims it, and a CHECK keeps them empty. Buyer-owned
--     information is always read live through the existing membership checks,
--     so removing a Realtor revokes it immediately while the Realtor's own
--     notes remain (shown as "No longer connected").
--
-- claim_prospective_search changes so that it
--   * keeps and links the record instead of deleting it;
--   * connects the search the buyer is actually using, resolved by
--     realtor_connection_target_for (2026-10-15), never "the search they own";
--   * never overwrites priorities the buyer already has in that search: the
--     caller must pass null to keep them, and a non-null document is refused
--     with 'priorities_exist'. Without existing priorities, the buyer's
--     explicitly confirmed document is required ('confirmation_required').
--
-- Additive otherwise: no other table, policy or function changes, and no
-- existing row is rewritten (every existing row is 'draft' or 'invited' with
-- no search_id, which satisfies the new checks).
begin;

-- 1. Private details and the link ------------------------------------------
alter table public.prospective_searches
  add column if not exists contact_email text,
  add column if not exists contact_phone text,
  add column if not exists preferred_locations text[] not null default '{}',
  add column if not exists notes text,
  add column if not exists search_id uuid references public.searches(id) on delete set null;

alter table public.prospective_searches drop constraint if exists prospective_searches_contact_email_check;
alter table public.prospective_searches add constraint prospective_searches_contact_email_check
  check (contact_email is null or char_length(contact_email) <= 320);
alter table public.prospective_searches drop constraint if exists prospective_searches_contact_phone_check;
alter table public.prospective_searches add constraint prospective_searches_contact_phone_check
  check (contact_phone is null or char_length(contact_phone) <= 40);
alter table public.prospective_searches drop constraint if exists prospective_searches_preferred_locations_check;
alter table public.prospective_searches add constraint prospective_searches_preferred_locations_check
  check (cardinality(preferred_locations) <= 12 and char_length(array_to_string(preferred_locations, '')) <= 1200);
alter table public.prospective_searches drop constraint if exists prospective_searches_notes_check;
alter table public.prospective_searches add constraint prospective_searches_notes_check
  check (notes is null or char_length(notes) <= 5000);

alter table public.prospective_searches drop constraint if exists prospective_searches_status_check;
alter table public.prospective_searches add constraint prospective_searches_status_check
  check (status in ('draft', 'invited', 'connected'));
-- Drafts are never linked; connected records never hold draft criteria (the
-- buyer's confirmed preferences are the only ones that count once they join).
alter table public.prospective_searches drop constraint if exists prospective_searches_link_check;
alter table public.prospective_searches add constraint prospective_searches_link_check
  check (case when status = 'connected' then draft_priorities = '{}'::jsonb else search_id is null end);

create index if not exists prospective_searches_started_by_idx on public.prospective_searches (started_by);
create index if not exists prospective_searches_search_id_idx on public.prospective_searches (search_id) where search_id is not null;

-- 2. Owner-only access --------------------------------------------------------
-- Select stays owner-only (2026-09-18). Update is owner-only for any status;
-- the CHECKs above, not the policy, keep connected records free of drafts.
-- search_id, status, invited_email and started_by are never client-writable.
drop policy if exists "prospective_searches_owner_update" on public.prospective_searches;
create policy "prospective_searches_owner_update" on public.prospective_searches
  for update to authenticated using (started_by = auth.uid()) with check (started_by = auth.uid());
drop policy if exists "prospective_searches_owner_delete" on public.prospective_searches;
create policy "prospective_searches_owner_delete" on public.prospective_searches
  for delete to authenticated using (started_by = auth.uid());

revoke all on table public.prospective_searches from public, anon, authenticated;
grant select (id, client_name, invited_email, status, draft_priorities, created_at, updated_at,
              contact_email, contact_phone, preferred_locations, notes, search_id)
  on table public.prospective_searches to authenticated;
grant update (client_name, draft_priorities, updated_at, contact_email, contact_phone, preferred_locations, notes)
  on table public.prospective_searches to authenticated;
grant delete on table public.prospective_searches to authenticated;

-- Deleting a record withdraws its unanswered invitation first. Otherwise the
-- invitation's prospective_search_id would be set null and it would read as a
-- plain connection request that skips the buyer's review.
create or replace function public.revoke_client_record_invitations()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.search_invitations set status = 'revoked', responded_at = now()
    where prospective_search_id = old.id and status = 'pending';
  return old;
end; $$;
revoke all on function public.revoke_client_record_invitations() from public, anon, authenticated;
drop trigger if exists prospective_searches_revoke_invitations on public.prospective_searches;
create trigger prospective_searches_revoke_invitations before delete on public.prospective_searches
  for each row execute function public.revoke_client_record_invitations();

-- 3. Creating records ---------------------------------------------------------
-- A private prospective client. Only a name is required.
create or replace function public.create_client_record(
  p_client_name text, p_draft_priorities jsonb default '{}'::jsonb, p_contact_email text default null,
  p_contact_phone text default null, p_preferred_locations text[] default '{}', p_notes text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare caller uuid := auth.uid(); created uuid;
begin
  if caller is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if nullif(trim(p_client_name), '') is null then raise exception 'A client name is required' using errcode = '22023'; end if;
  if jsonb_typeof(coalesce(p_draft_priorities, '{}'::jsonb)) <> 'object' then raise exception 'Invalid draft criteria' using errcode = '22023'; end if;
  insert into public.prospective_searches (started_by, client_name, draft_priorities, contact_email, contact_phone, preferred_locations, notes)
    values (caller, trim(p_client_name), coalesce(p_draft_priorities, '{}'::jsonb), nullif(trim(p_contact_email), ''),
            nullif(trim(p_contact_phone), ''), coalesce(p_preferred_locations, '{}'), nullif(trim(p_notes), ''))
    returning id into created;
  return created;
end; $$;

-- The Realtor's private record for a client they are connected to right now:
-- the existing one (oldest, if a claim linked more than one) or a new, empty
-- one. Never copies anything from the buyer's search.
create or replace function public.open_connected_client_record(p_search_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare caller uuid := auth.uid(); found uuid;
begin
  if caller is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_search_id is null or not public.is_search_realtor(p_search_id, caller) then
    raise exception 'Not connected to this search' using errcode = '42501';
  end if;
  -- One record per (Realtor, search) even when two tabs ask at once.
  perform pg_advisory_xact_lock(hashtextextended(caller::text || ':' || p_search_id::text, 0));
  select p.id into found from public.prospective_searches p
    where p.started_by = caller and p.search_id = p_search_id order by p.created_at limit 1;
  if found is not null then return found; end if;
  insert into public.prospective_searches (started_by, status, search_id, draft_priorities)
    values (caller, 'connected', p_search_id, '{}'::jsonb) returning id into found;
  return found;
end; $$;

-- 4. Inviting only ever applies to records that have not connected ----------
-- 2026-09-19's body, plus the status check: a connected record has no draft
-- to offer and must never become 'invited' again.
create or replace function public.invite_prospective_client(p_prospective_search_id uuid, p_invited_email text)
returns table(token uuid, expires_at timestamptz) language plpgsql security definer set search_path = '' as $$
declare caller uuid:=auth.uid(); draft public.prospective_searches%rowtype; existing public.search_invitations%rowtype; caller_name text; normalized text:=lower(trim(p_invited_email));
begin
  if caller is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select * into draft from public.prospective_searches p where p.id=p_prospective_search_id and p.started_by=caller for update;
  if draft.id is null then raise exception 'Draft access denied' using errcode='42501'; end if;
  if draft.status not in ('draft','invited') then raise exception 'This client is already connected' using errcode='22023'; end if;
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

-- 5. Claiming: link, resolve the search in use, never overwrite --------------
drop function if exists public.claim_prospective_search(uuid, jsonb);
create or replace function public.claim_prospective_search(p_token uuid, p_confirmed_priorities jsonb, p_search_id uuid default null)
returns table(success boolean, reason text, search_id uuid) language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare inv public.search_invitations%rowtype; draft public.prospective_searches%rowtype; caller uuid:=auth.uid(); caller_email text; target uuid; why text; has_priorities boolean;
begin
  if caller is null then return query select false,'not_authenticated',null::uuid; return; end if;
  if p_confirmed_priorities is not null and (jsonb_typeof(p_confirmed_priorities) <> 'object' or pg_column_size(p_confirmed_priorities) > 65536) then
    return query select false,'invalid_criteria',null::uuid; return;
  end if;
  select * into inv from public.search_invitations i where i.token=p_token for update;
  if inv.id is null then return query select false,'not_found',null::uuid; return; end if;
  select lower(u.email) into caller_email from auth.users u where u.id=caller;
  if caller_email is distinct from lower(inv.invited_email) then return query select false,'wrong_account',null::uuid; return; end if;
  if inv.status='accepted' and inv.search_id is not null and public.is_search_decision_maker(inv.search_id, caller)
     and public.is_search_realtor(inv.search_id, inv.invited_by) then
    return query select true,'already_claimed',inv.search_id; return;
  end if;
  if inv.status<>'pending' then return query select false,inv.status,null::uuid; return; end if;
  if inv.expires_at<now() then return query select false,'expired',null::uuid; return; end if;
  if inv.invitation_direction<>'realtor_to_buyer' or inv.prospective_search_id is null then return query select false,'not_prospective',null::uuid; return; end if;
  if inv.invited_by=caller then return query select false,'self_invite',null::uuid; return; end if;
  select * into draft from public.prospective_searches p where p.id=inv.prospective_search_id and p.started_by=inv.invited_by and p.status in ('draft','invited') for update;
  if draft.id is null then return query select false,'draft_unavailable',null::uuid; return; end if;

  -- The search the buyer is using, as the database resolves it; when the
  -- screen named one, it must still be that one.
  select t.search_id, t.reason into target, why from public.realtor_connection_target_for(caller) t;
  if target is null then return query select false,coalesce(why,'search_not_ready'),null::uuid; return; end if;
  if p_search_id is not null and p_search_id is distinct from target then return query select false,'search_changed',null::uuid; return; end if;
  if public.is_search_decision_maker(target, inv.invited_by) then return query select false,'relationship_conflict',null::uuid; return; end if;

  -- Existing priorities are the buyer's own and are never replaced here.
  select exists(select 1 from public.search_member_priorities smp where smp.search_id=target and smp.user_id=caller) into has_priorities;
  if has_priorities and p_confirmed_priorities is not null then return query select false,'priorities_exist',null::uuid; return; end if;
  if not has_priorities and p_confirmed_priorities is null then return query select false,'confirmation_required',null::uuid; return; end if;
  if not has_priorities then
    insert into public.search_member_priorities(search_id,user_id,priorities) values(target,caller,p_confirmed_priorities)
      on conflict on constraint search_member_priorities_search_id_user_id_key do nothing;
  end if;

  insert into public.search_members(search_id,user_id,role) values(target,inv.invited_by,'realtor')
    on conflict on constraint search_members_search_id_user_id_key do nothing;
  update public.search_invitations set status='accepted',responded_at=now(),search_id=target,prospective_search_id=null where id=inv.id;
  update public.profiles set onboarding_complete=true where id=caller;
  -- Keep the Realtor's record and link it; its proposed criteria are superseded.
  update public.prospective_searches set status='connected',search_id=target,draft_priorities='{}'::jsonb where id=draft.id;
  return query select true,null::text,target;
end; $$;

revoke all on function public.create_client_record(text, jsonb, text, text, text[], text) from public, anon;
revoke all on function public.open_connected_client_record(uuid) from public, anon;
revoke all on function public.invite_prospective_client(uuid, text) from public, anon;
revoke all on function public.claim_prospective_search(uuid, jsonb, uuid) from public, anon;
grant execute on function public.create_client_record(text, jsonb, text, text, text[], text) to authenticated;
grant execute on function public.open_connected_client_record(uuid) to authenticated;
grant execute on function public.invite_prospective_client(uuid, text) to authenticated;
grant execute on function public.claim_prospective_search(uuid, jsonb, uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
