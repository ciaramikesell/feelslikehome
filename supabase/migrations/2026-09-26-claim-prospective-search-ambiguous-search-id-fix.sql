-- Proactive sibling repair: claim_prospective_search(p_token uuid, ...) has
-- the exact same defective shape already proven live in accept_invitation
-- (see 2026-09-25-accept-invitation-ambiguous-search-id-fix.sql) — a
-- `returns table (..., search_id uuid)` clause declaring `search_id` as a
-- PL/pgSQL variable, combined with an unqualified `ON CONFLICT (search_id,
-- ...)` target column list. Reproduced locally against a real Postgres 16
-- instance before writing this fix: claiming a prospective search (a
-- Realtor's client confirming their draft priorities) fails with the
-- identical 42702 the very first time it tries to save those priorities —
--
--   ERROR: column reference "search_id" is ambiguous
--   DETAIL: It could refer to either a PL/pgSQL variable or a table column.
--   QUERY: insert into public.search_member_priorities(search_id,user_id,
--     priorities) values(target_search,caller,p_confirmed_priorities)
--     on conflict(search_id,user_id) do update set ...
--
-- Same fix as accept_invitation: ON CONFLICT ON CONSTRAINT <name> in place
-- of the ambiguous column list, for BOTH conflict targets this function
-- has — search_member_priorities(search_id, user_id) and search_members
-- (search_id, user_id), each its own unnamed inline `unique(...)` from
-- 2026-09-05-cobuyer-phase-a-foundation.sql, never renamed since; Postgres's
-- deterministic auto-naming for those produces
-- search_member_priorities_search_id_user_id_key and
-- search_members_search_id_user_id_key respectively, both confirmed against
-- a local database built from that same DDL.
--
-- Also adds the same stage-tracked exception handler accept_invitation
-- already has, so an unexpected DB error here returns a sanitized
-- error_<stage>_<sqlstate> reason instead of an uncaught raw exception —
-- this function currently has no such handling at all, unlike
-- accept_invitation. No other behavior changes: every validation check,
-- its order, and the atomic claim/backfill/cleanup sequence are unchanged.
--
-- Audited every other PL/pgSQL function in this repository for the same
-- combination (a search_id-named RETURNS TABLE column or declared
-- variable, plus an unqualified ON CONFLICT (search_id, ...) target) — no
-- other instance exists. save_realtor_note/suggest_home_tour use
-- p_search_id as their parameter name (not search_id) and RETURN a
-- composite row type, not RETURNS TABLE, so they never declare a
-- colliding variable. The remaining ON CONFLICT (search_id, ...)
-- occurrences found (2026-09-09-pass-3c1a-privacy-foundation.sql,
-- 2026-09-23-search-entitlement-foundation.sql) are plain top-level
-- INSERT/SELECT backfill statements outside any function body, so no
-- PL/pgSQL variable scope applies to them at all.
begin;

create or replace function public.claim_prospective_search(p_token uuid, p_confirmed_priorities jsonb)
returns table(success boolean, reason text, search_id uuid) language plpgsql security definer set search_path = '' as $claim_prospective_search$
declare inv public.search_invitations%rowtype; draft public.prospective_searches%rowtype; caller uuid:=auth.uid(); caller_email text; target_search uuid; stage text := 'start';
begin
  if caller is null then return query select false,'not_authenticated',null::uuid; return; end if;
  if jsonb_typeof(coalesce(p_confirmed_priorities,'{}'::jsonb)) <> 'object' or pg_column_size(coalesce(p_confirmed_priorities,'{}'::jsonb)) > 65536 then return query select false,'invalid_criteria',null::uuid; return; end if;
  begin
    stage := 'lookup_invitation';
    select * into inv from public.search_invitations i where i.token=p_token for update;
    if inv.id is null then return query select false,'not_found',null::uuid; return; end if;
    stage := 'lookup_owned_search';
    select s.id into target_search from public.searches s where s.user_id=caller;
    stage := 'check_already_claimed';
    if inv.status='accepted' and target_search is not null and exists(select 1 from public.search_members sm where sm.search_id=target_search and sm.user_id=inv.invited_by and sm.role='realtor') then return query select true,'already_claimed',target_search; return; end if;
    if inv.status<>'pending' then return query select false,inv.status,null::uuid; return; end if;
    if inv.expires_at<now() then return query select false,'expired',null::uuid; return; end if;
    if inv.invitation_direction<>'realtor_to_buyer' or inv.prospective_search_id is null then return query select false,'not_prospective',null::uuid; return; end if;
    stage := 'lookup_email';
    select lower(u.email) into caller_email from auth.users u where u.id=caller;
    if caller_email is distinct from lower(inv.invited_email) then return query select false,'wrong_account',null::uuid; return; end if;
    if inv.invited_by=caller then return query select false,'self_invite',null::uuid; return; end if;
    stage := 'lookup_draft';
    select * into draft from public.prospective_searches p where p.id=inv.prospective_search_id and p.started_by=inv.invited_by for update;
    if draft.id is null then return query select false,'draft_unavailable',null::uuid; return; end if;
    if target_search is null then return query select false,'search_not_ready',null::uuid; return; end if;
    stage := 'save_priorities';
    insert into public.search_member_priorities(search_id,user_id,priorities) values(target_search,caller,p_confirmed_priorities)
      on conflict on constraint search_member_priorities_search_id_user_id_key do update set priorities=excluded.priorities,updated_at=now();
    stage := 'insert_member';
    insert into public.search_members(search_id,user_id,role) values(target_search,inv.invited_by,'realtor')
      on conflict on constraint search_members_search_id_user_id_key do nothing;
    stage := 'update_invitation';
    update public.search_invitations set status='accepted',responded_at=now(),search_id=target_search,prospective_search_id=null where id=inv.id;
    stage := 'complete_onboarding';
    update public.profiles set onboarding_complete=true where id=caller;
    stage := 'cleanup_draft';
    delete from public.prospective_searches where id=draft.id;
    return query select true,null::text,target_search;
  exception when others then
    return query select false, ('error_' || stage || '_' || sqlstate), null::uuid;
    return;
  end;
end; $claim_prospective_search$;

revoke all on function public.claim_prospective_search(uuid, jsonb) from public;
revoke execute on function public.claim_prospective_search(uuid, jsonb) from anon, service_role;
grant execute on function public.claim_prospective_search(uuid, jsonb) to authenticated;

notify pgrst, 'reload schema';
commit;
