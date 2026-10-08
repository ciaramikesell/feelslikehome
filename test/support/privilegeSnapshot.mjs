// Snapshot of every access-control fact in the public schema: table ACLs and
// RLS flags, column grants to API roles, RLS policies, and function ACLs /
// SECURITY DEFINER / settings. Used to prove a migration sequence changes
// permissions only where intended.
export const PRIVILEGE_SNAPSHOT = `
  select 'table' as kind, c.relname as object, coalesce(c.relacl::text, '') || ' rls=' || c.relrowsecurity as detail
  from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
  union all
  select 'column', cp.table_name || '.' || cp.column_name, string_agg(cp.grantee || ':' || cp.privilege_type, ',' order by cp.grantee, cp.privilege_type)
  from information_schema.column_privileges cp
  where cp.table_schema = 'public' and cp.grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC')
  group by cp.table_name, cp.column_name
  union all
  select 'policy', p.tablename || '.' || p.policyname, p.cmd || ' roles=' || p.roles::text || ' using=' || coalesce(p.qual, '') || ' check=' || coalesce(p.with_check, '')
  from pg_policies p where p.schemaname = 'public'
  union all
  select 'function', p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', coalesce(p.proacl::text, '') || ' definer=' || p.prosecdef || ' config=' || coalesce(p.proconfig::text, '')
  from pg_proc p where p.pronamespace = 'public'::regnamespace`;

export function diffSnapshots(before, after) {
  const key = (row) => `${row.kind} ${row.object}`;
  const a = new Map(before.map((row) => [key(row), row.detail]));
  const b = new Map(after.map((row) => [key(row), row.detail]));
  const added = [...b.keys()].filter((k) => !a.has(k)).sort();
  const removed = [...a.keys()].filter((k) => !b.has(k)).sort();
  const changed = [...a.keys()].filter((k) => b.has(k) && a.get(k) !== b.get(k)).sort().map((k) => ({ object: k, before: a.get(k), after: b.get(k) }));
  return { added, removed, changed };
}
