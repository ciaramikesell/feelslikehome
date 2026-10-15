-- READ-ONLY preflight for migrations/2026-10-15-buyer-realtor-management.sql.
--
-- Run in the Supabase SQL Editor of the PRODUCTION project before (and again
-- after) applying the migration. One SELECT: it writes nothing and returns
-- schema facts only (no user rows, emails, tokens or counts of people).
--
-- Before applying: every row with stage = 'required' must show ok = true.
-- Rows with stage = 'after' show null until the migration is applied, and must
-- all be true afterwards. test/your-people-db.test.js runs this file against a
-- database without the migration, with it, and with a conflicting function.
with
fn as (
  select p.oid, p.proname, pg_get_function_identity_arguments(p.oid) as args, p.prosecdef,
         coalesce(p.proconfig, '{}') as config,
         coalesce(p.proacl, acldefault('f', p.proowner)) as acl
  from pg_proc p where p.pronamespace = 'public'::regnamespace
),
col as (
  select table_name, column_name, data_type from information_schema.columns where table_schema = 'public'
),
pol as (
  select tablename, policyname, cmd from pg_policies where schemaname = 'public'
),
con as (
  select conrelid::regclass::text as tbl, conname, pg_get_constraintdef(oid) as def
  from pg_constraint where connamespace = 'public'::regnamespace
),
-- The functions this migration creates, with the exact signatures it uses.
new_fn(proname, args, callable) as (values
  ('realtor_connection_target_for', 'p_user uuid', false),
  ('get_realtor_connection_target', '', true),
  ('get_search_people', 'p_search_id uuid', true),
  ('create_search_realtor_invitation', 'p_search_id uuid, p_invited_email text', true),
  ('list_search_realtor_invitations', 'p_search_id uuid', true),
  ('revoke_search_invitation', 'p_invitation_id uuid', true),
  ('remove_search_realtor', 'p_search_id uuid, p_realtor_id uuid', true),
  ('approve_realtor_connection', 'p_token uuid, p_search_id uuid', true)
),
-- Helpers the new functions call, with the signatures they rely on.
helper(proname, args) as (values
  ('is_search_owner', 'p_search_id uuid, p_user_id uuid'),
  ('is_search_decision_maker', 'p_search_id uuid, p_user_id uuid'),
  ('is_search_realtor', 'p_search_id uuid, p_user_id uuid'),
  ('resolve_display_name', 'p_user_id uuid, p_fallback text')
),
needed_col(table_name, column_name) as (values
  ('search_invitations', 'id'), ('search_invitations', 'search_id'), ('search_invitations', 'invited_by'),
  ('search_invitations', 'invited_email'), ('search_invitations', 'token'), ('search_invitations', 'status'),
  ('search_invitations', 'expires_at'), ('search_invitations', 'responded_at'), ('search_invitations', 'created_at'),
  ('search_invitations', 'relationship_type'), ('search_invitations', 'invitation_direction'),
  ('search_invitations', 'inviter_display_name'), ('search_invitations', 'prospective_search_id'),
  ('search_members', 'search_id'), ('search_members', 'user_id'), ('search_members', 'role'), ('search_members', 'joined_at'),
  ('searches', 'id'), ('searches', 'user_id'), ('searches', 'created_at'),
  ('profiles', 'id'), ('profiles', 'active_search_id'),
  ('homes', 'search_id'), ('homes', 'suggestion_staged')
),
public_exec as (
  select f.oid from fn f, aclexplode(f.acl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE'
)
select * from (
  -- 1. Earlier migrations this one depends on -------------------------------
  select 1 as section, 'required' as stage, 'helper ' || h.proname || '(' || h.args || ') exists as SECURITY DEFINER' as item,
         exists (select 1 from fn f where f.proname = h.proname and f.args = h.args and f.prosecdef) as ok, null::text as detail
  from helper h
  union all
  select 1, 'required', '2026-10-12 applied: withdrawal trigger on search_members',
         exists (select 1 from pg_trigger t where t.tgname = 'search_members_withdraw_realtor_suggestions' and t.tgrelid = 'public.search_members'::regclass and t.tgenabled = 'O'), null
  union all
  select 1, 'required', '2026-10-12 applied: realtor_suggestions allows status withdrawn',
         exists (select 1 from con where con.conname = 'realtor_suggestions_status_check' and con.def like '%withdrawn%'), null
  union all
  select 1, 'required', '2026-10-12 applied: homes_delete_departed_adder policy',
         exists (select 1 from pol where tablename = 'homes' and policyname = 'homes_delete_departed_adder'), null
  -- 2. Columns, constraints and RLS the new functions use --------------------
  union all
  select 2, 'required', 'column ' || n.table_name || '.' || n.column_name,
         exists (select 1 from col c where c.table_name = n.table_name and c.column_name = n.column_name), null
  from needed_col n
  union all
  select 2, 'required', 'unique constraint search_members_search_id_user_id_key (used by ON CONFLICT)',
         exists (select 1 from con where con.tbl = 'search_members' and con.conname = 'search_members_search_id_user_id_key' and con.def like 'UNIQUE (search_id, user_id)'), null
  union all
  select 2, 'required', 'search_invitations.status allows pending, accepted, expired, revoked',
         exists (select 1 from con where con.conname = 'search_invitations_status_check'
                 and con.def like '%''pending''%' and con.def like '%''accepted''%' and con.def like '%''expired''%' and con.def like '%''revoked''%'), null
  union all
  select 2, 'required', 'search_invitations.invitation_direction allows buyer_to_realtor and realtor_to_buyer',
         exists (select 1 from con where con.conname = 'search_invitations_invitation_direction_check'
                 and con.def like '%buyer_to_realtor%' and con.def like '%realtor_to_buyer%'), null
  union all
  select 2, 'required', 'search_invitations.relationship_type allows realtor',
         exists (select 1 from con where con.conname = 'search_invitations_relationship_type_check' and con.def like '%''realtor''%'), null
  union all
  select 2, 'required', 'search_members.role allows co_buyer and realtor',
         exists (select 1 from con where con.tbl = 'search_members' and con.def like 'CHECK%role%' and con.def like '%co_buyer%' and con.def like '%realtor%'), null
  union all
  select 2, 'required', 'RLS enabled on search_invitations, search_members, profiles, searches',
         (select bool_and(c.relrowsecurity) from pg_class c where c.oid in ('public.search_invitations'::regclass, 'public.search_members'::regclass, 'public.profiles'::regclass, 'public.searches'::regclass)), null
  -- 3. Existing write paths stay as narrow as before ------------------------
  union all
  select 3, 'required', 'search_invitations policies are exactly owner insert + owner select (no update/delete path)',
         (select coalesce(array_agg(policyname::text || ':' || cmd order by policyname), '{}') from pol where tablename = 'search_invitations')
           = array['search_invitations_owner_insert:INSERT', 'search_invitations_owner_select:SELECT'],
         (select string_agg(policyname || ':' || cmd, ', ' order by policyname) from pol where tablename = 'search_invitations')
  union all
  select 3, 'required', 'search_members has no INSERT/UPDATE policy (memberships only via SECURITY DEFINER functions)',
         not exists (select 1 from pol where tablename = 'search_members' and cmd in ('INSERT', 'UPDATE', 'ALL')),
         (select string_agg(policyname || ':' || cmd, ', ' order by policyname) from pol where tablename = 'search_members')
  union all
  select 3, 'required', 'accept_invitation(p_token uuid) still present (co-buyer and Realtor invitations use it)',
         exists (select 1 from fn where proname = 'accept_invitation' and args = 'p_token uuid'), null
  -- 4. Name and signature conflicts -----------------------------------------
  union all
  select 4, 'required', 'no other function named ' || n.proname,
         not exists (select 1 from fn f where f.proname = n.proname and f.args <> n.args),
         coalesce((select string_agg(f.proname || '(' || f.args || ')', ', ') from fn f where f.proname = n.proname),
                  'not present: will be created')
  from new_fn n
  -- 5. After the migration: definer, pinned search_path, EXECUTE grants ------
  union all
  select 5, 'after', n.proname || ': SECURITY DEFINER with search_path pinned to ''''',
         (select f.prosecdef and 'search_path=""' = any(f.config) from fn f where f.proname = n.proname and f.args = n.args), null
  from new_fn n
  union all
  select 5, 'after', n.proname || ': EXECUTE ' || case when n.callable then 'for authenticated only' else 'for nobody (internal)' end,
         (select has_function_privilege('authenticated', f.oid, 'execute') = n.callable
                 and not has_function_privilege('anon', f.oid, 'execute')
                 and not exists (select 1 from public_exec pe where pe.oid = f.oid)
          from fn f where f.proname = n.proname and f.args = n.args), null
  from new_fn n
) report
order by section, stage, item;
