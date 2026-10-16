-- READ-ONLY preflight for migrations/2026-10-16-realtor-my-clients.sql.
--
-- Run in the Supabase SQL Editor of the PRODUCTION project before (and again
-- after) applying the migration. One SELECT: it writes nothing and returns
-- schema facts and yes/no answers only (no rows, names, emails, notes or
-- counts of people).
--
-- Before applying: every row with stage = 'required' must show ok = true.
-- Rows with stage = 'after' show false or null until the migration is applied,
-- and must all be true afterwards. test/my-clients-db-preflight.test.js runs
-- this file against a database without the migration, with it, and with
-- conflicting states.
with
fn as (
  select p.oid, p.proname, pg_get_function_identity_arguments(p.oid) as args, p.prosecdef,
         coalesce(p.proconfig, '{}') as config,
         coalesce(p.proacl, acldefault('f', p.proowner)) as acl
  from pg_proc p where p.pronamespace = 'public'::regnamespace
),
col as (
  select column_name, data_type, udt_name from information_schema.columns
  where table_schema = 'public' and table_name = 'prospective_searches'
),
pol as (
  select policyname, cmd from pg_policies where schemaname = 'public' and tablename = 'prospective_searches'
),
con as (
  select conrelid::regclass::text as tbl, conname, pg_get_constraintdef(oid) as def
  from pg_constraint where connamespace = 'public'::regnamespace
),
-- Functions the migration creates or replaces, with the signatures it leaves.
new_fn(proname, args, callable) as (values
  ('create_client_record', 'p_client_name text, p_draft_priorities jsonb, p_contact_email text, p_contact_phone text, p_preferred_locations text[], p_notes text', true),
  ('open_connected_client_record', 'p_search_id uuid', true),
  ('invite_prospective_client', 'p_prospective_search_id uuid, p_invited_email text', true),
  ('claim_prospective_search', 'p_token uuid, p_confirmed_priorities jsonb, p_search_id uuid', true),
  ('revoke_client_record_invitations', '', false)
),
helper(proname, args) as (values
  ('realtor_connection_target_for', 'p_user uuid'),
  ('is_search_realtor', 'p_search_id uuid, p_user_id uuid'),
  ('is_search_decision_maker', 'p_search_id uuid, p_user_id uuid'),
  ('resolve_display_name', 'p_user_id uuid, p_fallback text'),
  ('set_updated_at', '')
),
existing_col(column_name) as (values
  ('id'), ('started_by'), ('client_name'), ('invited_email'), ('draft_priorities'), ('status'), ('created_at'), ('updated_at')
),
new_col(column_name, udt_name) as (values
  ('contact_email', 'text'), ('contact_phone', 'text'), ('preferred_locations', '_text'), ('notes', 'text'), ('search_id', 'uuid')
),
-- Column privileges the app relies on afterwards, and the ones it must not have.
priv(column_name, privilege, expected) as (values
  ('contact_email', 'SELECT', true), ('contact_phone', 'SELECT', true), ('preferred_locations', 'SELECT', true),
  ('notes', 'SELECT', true), ('search_id', 'SELECT', true),
  ('contact_email', 'UPDATE', true), ('contact_phone', 'UPDATE', true), ('preferred_locations', 'UPDATE', true),
  ('notes', 'UPDATE', true), ('client_name', 'UPDATE', true), ('draft_priorities', 'UPDATE', true),
  ('search_id', 'UPDATE', false), ('status', 'UPDATE', false), ('started_by', 'UPDATE', false), ('invited_email', 'UPDATE', false),
  ('started_by', 'INSERT', false), ('client_name', 'INSERT', false)
),
public_exec as (
  select f.oid from fn f, aclexplode(f.acl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE'
)
select * from (
  -- 1. Earlier migrations this one depends on -------------------------------
  select 1 as section, 'required' as stage, 'helper ' || h.proname || '(' || h.args || ') exists' as item,
         exists (select 1 from fn f where f.proname = h.proname and f.args = h.args) as ok, null::text as detail
  from helper h
  union all
  select 1, 'required', '2026-10-15 buyer-realtor-management applied (approve_realtor_connection present)',
         exists (select 1 from fn where proname = 'approve_realtor_connection' and args = 'p_token uuid, p_search_id uuid'), null
  union all
  select 1, 'required', '2026-10-12 applied: withdrawal trigger on search_members',
         exists (select 1 from pg_trigger t where t.tgname = 'search_members_withdraw_realtor_suggestions' and t.tgrelid = 'public.search_members'::regclass), null
  -- 2. The table as the migration expects to find it -------------------------
  union all
  select 2, 'required', 'column prospective_searches.' || e.column_name,
         exists (select 1 from col c where c.column_name = e.column_name), null
  from existing_col e
  union all
  select 2, 'required', 'column search_invitations.prospective_search_id',
         exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'search_invitations' and column_name = 'prospective_search_id'), null
  union all
  select 2, 'required', 'new column ' || n.column_name || ' absent, or already ' || n.udt_name,
         coalesce((select c.udt_name = n.udt_name from col c where c.column_name = n.column_name), true),
         (select c.udt_name from col c where c.column_name = n.column_name)
  from new_col n
  union all
  select 2, 'required', 'every existing record has a status the new check allows',
         not exists (select 1 from public.prospective_searches p where p.status not in ('draft', 'invited', 'connected')), null
  union all
  select 2, 'required', 'unique keys used by ON CONFLICT exist',
         exists (select 1 from con where conname = 'search_member_priorities_search_id_user_id_key')
         and exists (select 1 from con where conname = 'search_members_search_id_user_id_key'), null
  union all
  select 2, 'required', 'RLS enabled on prospective_searches and search_member_priorities',
         (select bool_and(c.relrowsecurity) from pg_class c where c.oid in ('public.prospective_searches'::regclass, 'public.search_member_priorities'::regclass)), null
  -- 3. Nobody but the owner can reach a record, before or after ---------------
  union all
  select 3, 'required', 'prospective_searches policies are owner-only (select/update, plus delete once applied)',
         not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'prospective_searches'
                       and (qual is distinct from '(started_by = auth.uid())' or cmd = 'ALL' or cmd = 'INSERT')),
         (select string_agg(policyname || ':' || cmd, ', ' order by policyname) from pol)
  union all
  select 3, 'required', 'anon has no privilege on prospective_searches',
         not has_table_privilege('anon', 'public.prospective_searches', 'SELECT, INSERT, UPDATE, DELETE'), null
  union all
  select 3, 'required', 'no buyer-facing function returns private record columns (preview_invitation unchanged shape)',
         exists (select 1 from fn where proname = 'preview_invitation' and args = 'p_token uuid')
         and not exists (select 1 from fn where proname = 'preview_invitation'
                           and pg_get_function_result(oid) ~ '(notes|contact_|preferred_locations)'), null
  -- 4. Name and signature conflicts -----------------------------------------
  union all
  select 4, 'required', 'no other function named ' || n.proname,
         not exists (select 1 from fn f where f.proname = n.proname and f.args <> n.args
                       and not (n.proname = 'claim_prospective_search' and f.args = 'p_token uuid, p_confirmed_priorities jsonb')),
         coalesce((select string_agg(f.proname || '(' || f.args || ')', ', ') from fn f where f.proname = n.proname), 'not present: will be created')
  from new_fn n
  -- 5. After the migration -----------------------------------------------------
  union all
  select 5, 'after', 'column ' || n.column_name || ' is ' || n.udt_name,
         exists (select 1 from col c where c.column_name = n.column_name and c.udt_name = n.udt_name), null
  from new_col n
  union all
  select 5, 'after', 'status allows connected; link and field-length checks present',
         exists (select 1 from con where conname = 'prospective_searches_status_check' and def like '%connected%')
         and exists (select 1 from con where conname = 'prospective_searches_link_check')
         and exists (select 1 from con where conname = 'prospective_searches_notes_check')
         and exists (select 1 from con where conname = 'prospective_searches_preferred_locations_check'), null
  union all
  select 5, 'after', 'policies are exactly owner select, update and delete',
         (select coalesce(array_agg(policyname::text || ':' || cmd order by policyname), '{}') from pol)
           = array['prospective_searches_owner_delete:DELETE', 'prospective_searches_owner_select:SELECT', 'prospective_searches_owner_update:UPDATE'],
         (select string_agg(policyname || ':' || cmd, ', ' order by policyname) from pol)
  union all
  select 5, 'after', 'authenticated ' || p.privilege || ' on ' || p.column_name || ' is ' || case when p.expected then 'granted' else 'not granted' end,
         (select has_column_privilege('authenticated', 'public.prospective_searches', p.column_name, p.privilege) = p.expected
          where exists (select 1 from col c where c.column_name = p.column_name)), null
  from priv p
  union all
  select 5, 'after', 'deleting a record withdraws its pending invitation (trigger present)',
         exists (select 1 from pg_trigger t where t.tgname = 'prospective_searches_revoke_invitations' and t.tgrelid = 'public.prospective_searches'::regclass), null
  union all
  select 5, 'after', 'the two-argument claim_prospective_search is gone',
         not exists (select 1 from fn where proname = 'claim_prospective_search' and args = 'p_token uuid, p_confirmed_priorities jsonb'), null
  union all
  select 5, 'after', n.proname || ': SECURITY DEFINER with search_path pinned to ''''',
         (select f.prosecdef and 'search_path=""' = any(f.config) from fn f where f.proname = n.proname and f.args = n.args), null
  from new_fn n
  union all
  select 5, 'after', n.proname || ': EXECUTE ' || case when n.callable then 'for authenticated only' else 'for nobody (trigger only)' end,
         (select has_function_privilege('authenticated', f.oid, 'execute') = n.callable
                 and not has_function_privilege('anon', f.oid, 'execute')
                 and not exists (select 1 from public_exec pe where pe.oid = f.oid)
          from fn f where f.proname = n.proname and f.args = n.args), null
  from new_fn n
) report
order by section, stage, item;
