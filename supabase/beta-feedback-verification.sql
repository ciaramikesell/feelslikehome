-- Production-safe catalog verification for pre-beta feedback.
-- A single all-true row is PASS. This script reads metadata only.
begin transaction read only;

with expected_columns(name, data_type, nullable) as (values
  ('id','uuid','NO'), ('user_id','uuid','NO'), ('search_id','uuid','YES'),
  ('home_id','uuid','YES'), ('route','text','NO'), ('search_intent','text','YES'),
  ('feedback_type','text','YES'), ('message','text','NO'), ('is_blocking','boolean','NO'),
  ('viewport_width','integer','YES'), ('viewport_height','integer','YES'),
  ('device_class','text','YES'), ('user_agent','text','YES'), ('app_version','text','YES'),
  ('screenshot_path','text','YES'), ('created_at','timestamp with time zone','NO')
), actual_columns as (
  select column_name, data_type, is_nullable
  from information_schema.columns
  where table_schema = 'public' and table_name = 'beta_feedback'
), checks as (
  select
    to_regclass('public.beta_feedback') is not null as table_exists,
    (select count(*) = 16 from actual_columns) and not exists (
      select 1 from expected_columns e full join actual_columns a on a.column_name = e.name
      where e.name is null or a.column_name is null or a.data_type <> e.data_type or a.is_nullable <> e.nullable
    ) as exact_columns,
    coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.beta_feedback')), false) as rls_enabled,
    not has_table_privilege('authenticated', 'public.beta_feedback', 'select') as no_authenticated_select,
    not has_table_privilege('authenticated', 'public.beta_feedback', 'update') as no_authenticated_update,
    not has_table_privilege('authenticated', 'public.beta_feedback', 'delete') as no_authenticated_delete,
    has_column_privilege('authenticated', 'public.beta_feedback', 'message', 'insert') as authenticated_can_insert,
    (select count(*) = 1 and bool_and(cmd = 'INSERT' and roles = '{authenticated}' and with_check like '%auth.uid()%user_id%')
      from pg_policies where schemaname = 'public' and tablename = 'beta_feedback') as caller_bound_insert_only,
    (select count(*) >= 9 from pg_constraint where conrelid = to_regclass('public.beta_feedback') and contype = 'c') as constraints_present,
    has_column_privilege('authenticated', 'public.homes', 'address', 'select')
      and not has_column_privilege('authenticated', 'public.homes', 'ratings', 'select')
      and has_column_privilege('authenticated', 'public.searches', 'id', 'select')
      and not has_column_privilege('authenticated', 'public.searches', 'priorities', 'select') as pass_3c_grants_unchanged
)
select *,
  table_exists and exact_columns and rls_enabled and no_authenticated_select
  and no_authenticated_update and no_authenticated_delete and authenticated_can_insert
  and caller_bound_insert_only and constraints_present and pass_3c_grants_unchanged as all_checks_pass
from checks;

rollback;
