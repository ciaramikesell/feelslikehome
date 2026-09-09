-- Pass 3C.3 post-deployment catalog verification (READ ONLY).
-- Catalog proof must be followed immediately by the two-user JWT plan in
-- docs/pass-3c3-operator-runbook.md; service_role is not participant proof.
begin transaction read only;

with checks(check_name, passed, evidence) as (
  values
  ('home_member_state SELECT is own-only',
    (select count(*)=1 and bool_and(cmd='SELECT' and qual='(auth.uid() = user_id)')
     from pg_policies where schemaname='public' and tablename='home_member_state' and cmd in ('SELECT','ALL')),
    (select string_agg(policyname||':'||cmd||':'||coalesce(qual,''), E'\n' order by policyname)
     from pg_policies where schemaname='public' and tablename='home_member_state' and cmd in ('SELECT','ALL'))),
  ('home_member_state own INSERT preserved',
    exists(select 1 from pg_policies where schemaname='public' and tablename='home_member_state' and policyname='hms_own_insert' and with_check like '%auth.uid() = user_id%' and with_check like '%can_access_home%'), 'hms_own_insert'),
  ('home_member_state own UPDATE preserved',
    exists(select 1 from pg_policies where schemaname='public' and tablename='home_member_state' and policyname='hms_own_update' and qual='(auth.uid() = user_id)' and with_check like '%can_access_home%'), 'hms_own_update'),
  ('search_member_priorities policies remain own-only',
    (select count(*)=3 and bool_and(coalesce(qual,with_check) like '%auth.uid() = user_id%') from pg_policies where schemaname='public' and tablename='search_member_priorities'), 'expected SELECT/INSERT/UPDATE; no DELETE'),
  ('commute destinations policies remain own-only',
    (select count(*)=4 and bool_and(coalesce(qual,with_check) like '%auth.uid() = user_id%' and coalesce(qual,with_check) like '%can_access_search%') from pg_policies where schemaname='public' and tablename='commute_destinations'), 'expected SELECT/INSERT/UPDATE/DELETE'),
  ('homes has no authenticated table SELECT', not has_table_privilege('authenticated','public.homes','SELECT'), 'column SELECT only'),
  ('rental shared facts have exact participant column access',
    (select count(*)=15 and bool_and(has_column_privilege('authenticated','public.homes',c.column_name,p.privilege))
     from (values ('property_type'),('available_on'),('pets_allowed'),('utilities_included'),('in_unit_laundry')) c(column_name)
     cross join (values ('SELECT'),('INSERT'),('UPDATE')) p(privilege)), 'five shared facts x SELECT/INSERT/UPDATE'),
  ('homes legacy columns unreadable',
    not has_column_privilege('authenticated','public.homes','status','SELECT')
    and not has_column_privilege('authenticated','public.homes','reaction','SELECT')
    and not has_column_privilege('authenticated','public.homes','toured_at','SELECT')
    and not has_column_privilege('authenticated','public.homes','is_favorite','SELECT')
    and not has_column_privilege('authenticated','public.homes','rejection_reason','SELECT')
    and not has_column_privilege('authenticated','public.homes','ratings','SELECT')
    and not has_column_privilege('authenticated','public.homes','checks','SELECT'), 'seven private columns'),
  ('homes legacy columns not updateable',
    not has_column_privilege('authenticated','public.homes','status','UPDATE')
    and not has_column_privilege('authenticated','public.homes','reaction','UPDATE')
    and not has_column_privilege('authenticated','public.homes','toured_at','UPDATE')
    and not has_column_privilege('authenticated','public.homes','is_favorite','UPDATE')
    and not has_column_privilege('authenticated','public.homes','rejection_reason','UPDATE')
    and not has_column_privilege('authenticated','public.homes','ratings','UPDATE')
    and not has_column_privilege('authenticated','public.homes','checks','UPDATE'), 'seven private columns'),
  ('searches priorities unreadable and immutable',
    not has_column_privilege('authenticated','public.searches','priorities','SELECT')
    and not has_column_privilege('authenticated','public.searches','priorities','UPDATE'), 'priorities SELECT/UPDATE denied'),
  ('searches has no authenticated UPDATE', not has_table_privilege('authenticated','public.searches','UPDATE'), 'no runtime UPDATE requirement'),
  ('sanitized RPC ACLs are authenticated-only',
    (select count(*)=3 and bool_and(has_function_privilege('authenticated',p.oid,'EXECUTE') and not has_function_privilege('anon',p.oid,'EXECUTE') and not has_function_privilege('service_role',p.oid,'EXECUTE') and p.prosecdef and coalesce(array_to_string(p.proconfig, ','), '') in ('search_path=', 'search_path=""'))
     from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=any(array['resolve_shared_fact_priority_awareness','resolve_cobuyer_compare_perspectives','resolve_cobuyer_lifecycle_signals'])), 'three exact participant RPCs')
)
select * from checks order by check_name;

-- Exact effective authenticated column surface. Compare directly with reviewed
-- migration allowlists; this exposes names/privileges only.
select table_name, privilege_type, array_agg(column_name order by column_name) as columns
from information_schema.columns c
cross join (values ('SELECT'),('INSERT'),('UPDATE')) p(privilege_type)
where c.table_schema='public' and c.table_name=any(array['homes','searches'])
  and has_column_privilege('authenticated',format('%I.%I',c.table_schema,c.table_name),c.column_name,p.privilege_type)
group by table_name, privilege_type order by table_name, privilege_type;

-- Identity guard and policy inventory needed to review shared edits.
select event_object_table, trigger_name, action_timing, event_manipulation, action_statement
from information_schema.triggers
where trigger_schema='public' and trigger_name='homes_enforce_shared_identity';
select policyname, cmd, qual, with_check from pg_policies
where schemaname='public' and tablename in ('homes','searches') order by tablename, policyname;

rollback;
