-- REVIEW ONLY. Read-only catalog checks. Writer rows are empty before provisioning.
begin read only;

select current_user as migration_role,
  pg_catalog.has_table_privilege(current_user, 'auth.users', 'SELECT') as can_read_auth_users,
  pg_catalog.has_table_privilege(current_user, 'auth.users', 'UPDATE') as can_lock_auth_users,
  pg_catalog.has_table_privilege(current_user, 'auth.users', 'TRIGGER') as can_capture_signup,
  pg_catalog.has_database_privilege(current_user, current_database(), 'CREATE') as can_create_private_schema;

select table_schema, table_name, column_name, data_type, is_nullable
from information_schema.columns
where (table_schema, table_name) in (
  ('auth', 'users'), ('public', 'searches'), ('public', 'profiles'),
  ('public', 'search_member_priorities'), ('public', 'search_members'),
  ('public', 'homes'), ('public', 'commute_destinations')
)
order by table_schema, table_name, ordinal_position;

select tgname, tgenabled, pg_catalog.pg_get_triggerdef(oid) as definition
from pg_catalog.pg_trigger
where tgrelid = 'auth.users'::regclass and not tgisinternal
order by tgname;

select conrelid::regclass as on_table, conname, convalidated, condeferrable,
  pg_catalog.pg_get_constraintdef(oid) as definition
from pg_catalog.pg_constraint
where conrelid in ('public.searches'::regclass, 'public.search_members'::regclass,
  'public.search_member_priorities'::regclass, 'public.homes'::regclass,
  'public.commute_destinations'::regclass)
  and contype in ('f', 'p', 'u')
order by conrelid::regclass::text, conname;

select rolname, rolcanlogin, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole,
  rolreplication, rolinherit, rolconnlimit,
  (select count(*) from pg_catalog.pg_auth_members where member = r.oid or roleid = r.oid) as membership_count
from pg_catalog.pg_roles as r
where rolname in (current_user, 'flh_guest_writer');

select not exists (
  select 1 from pg_catalog.pg_proc as p
  where p.pronamespace = 'public'::regnamespace
    and p.proname = 'save_guest_onboarding_v1'
) as no_public_transfer_overload;

-- Inspect effective access, including PUBLIC and managed platform defaults.
select n.nspname, p.proname, pg_catalog.pg_get_function_identity_arguments(p.oid) as arguments,
  p.prorettype = 'pg_catalog.trigger'::regtype as trigger_only
from pg_catalog.pg_proc as p
join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
join pg_catalog.pg_roles as writer on writer.rolname = 'flh_guest_writer'
where n.nspname in ('auth', 'public', 'storage', 'flh_guest_transfer') and p.prosecdef
  and pg_catalog.has_schema_privilege(writer.oid, n.oid, 'USAGE')
  and pg_catalog.has_function_privilege(writer.oid, p.oid, 'EXECUTE')
order by 1, 2, 3;

commit;
