-- Production repair: accept_invitation(p_token uuid) was failing live with
--
--   42702: column reference "search_id" is ambiguous
--   (It could refer to either a PL/pgSQL variable or a table column.)
--
-- on the co-buyer acceptance path (Ciara -> Andrew), reproduced and root-
-- caused locally against a real Postgres 16 instance before writing this
-- fix (not guessed):
--
--   * The function's own `returns table (success boolean, reason text,
--     search_id uuid)` clause declares `search_id` as a PL/pgSQL variable
--     in scope for the whole function body — the exact same class of
--     collision 2026-09-05-cobuyer-phase-d-invitations.sql's own comment
--     already documents having hit and fixed once before.
--   * Every bare `search_id` reference elsewhere in the function (the
--     INSERT's own column list, `inv.search_id`, UPDATE's SET target) is
--     NOT actually ambiguous — PL/pgSQL gives those grammar positions a
--     free pass, confirmed by testing each in isolation.
--   * The one genuinely ambiguous statement, confirmed by reproducing the
--     exact 42702 locally: `insert into public.search_members(...)
--     on conflict (search_id, user_id) do nothing` — the ON CONFLICT
--     target column LIST (unlike an INSERT's own column list, or an
--     UPDATE's SET target) is NOT given that same unambiguous-position
--     treatment, so PL/pgSQL tries to resolve `search_id`/`user_id` there
--     against both the table's columns and the function's own variables.
--
-- Fix: replace the ON CONFLICT column list with the equivalent
-- `ON CONFLICT ON CONSTRAINT <name>` form, which names the target index
-- directly and contains no column identifiers to be ambiguous. This is not
-- a "prefer this interpretation" setting (no #variable_conflict pragma) —
-- it removes the ambiguous construct from the SQL entirely. The
-- referenced constraint is the unique (search_id, user_id) constraint
-- already declared inline on public.search_members in
-- 2026-09-05-cobuyer-phase-a-foundation.sql and never renamed since;
-- Postgres's deterministic auto-naming for an unnamed inline UNIQUE
-- constraint produces exactly this name, confirmed against a local
-- Postgres 16 instance built from that same DDL. Verified end-to-end
-- locally: co-buyer acceptance, Realtor acceptance, and idempotent
-- re-acceptance (no duplicate row, "already_member") all succeed with
-- this fix and reproduce the exact 42702 without it.
--
-- Tagged the function body's dollar-quote as $accept_invitation$ instead
-- of bare $$ (functionally identical to Postgres either way): a prior
-- attempt to apply this exact, verified-valid file through the Supabase
-- dashboard's SQL editor came back as "42601: unterminated dollar-quoted
-- string", with the editor's pasted-query view showing bogus `ALTER TABLE
-- inv/caller_email/target_search ENABLE ROW LEVEL SECURITY` statements
-- injected mid-function — the editor's own "enable RLS on new tables"
-- assistant misreading this function's local variable declarations as
-- table definitions, corrupting what actually reached Postgres. A unique
-- tag makes truncation/corruption immediately visible (the closing tag
-- would no longer match) and may avoid whatever pattern that assistant
-- keyed on. Applying via a direct connection (psql/Supabase CLI) rather
-- than pasting into the dashboard editor avoids this class of corruption
-- entirely, since the file's bytes reach Postgres unmodified.
begin;

create or replace function public.accept_invitation(p_token uuid)
returns table(success boolean, reason text, search_id uuid) language plpgsql security definer set search_path = '' as $accept_invitation$
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
      insert into public.search_members(search_id,user_id,role) values(target_search,inv.invited_by,'realtor')
        on conflict on constraint search_members_search_id_user_id_key do nothing;
    else
      target_search:=inv.search_id;
      stage := 'check_relationship_conflict';
      if exists(select 1 from public.search_members sm where sm.search_id=target_search and sm.user_id=caller and sm.role<>inv.relationship_type) then return query select false,'relationship_conflict',null::uuid; return; end if;
      stage := 'insert_member';
      insert into public.search_members(search_id,user_id,role) values(target_search,caller,inv.relationship_type)
        on conflict on constraint search_members_search_id_user_id_key do nothing;
    end if;
    stage := 'update_invitation';
    update public.search_invitations set status='accepted',responded_at=now(),search_id=target_search where id=inv.id;
    return query select true,null::text,target_search;
  exception when others then
    return query select false, ('error_' || stage || '_' || sqlstate), null::uuid;
    return;
  end;
end; $accept_invitation$;

revoke all on function public.accept_invitation(uuid) from public;
revoke execute on function public.accept_invitation(uuid) from anon, service_role;
grant execute on function public.accept_invitation(uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
