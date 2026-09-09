-- Pass 3C.3 production preflight (READ ONLY).
-- Run in production SQL Editor before reviewing/applying the migration.
-- Returns metadata only: no application rows or private values are selected.
begin transaction read only;

-- 1: RLS status.
select n.nspname as schema_name, c.relname as table_name,
       c.relrowsecurity as rls_enabled, c.relforcerowsecurity as rls_forced
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = any(array[
  'homes','home_member_state','searches','search_member_priorities',
  'commute_destinations','search_members'
]) order by c.relname;

-- 2: exact policy inventory (catalog expressions only).
select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public' and tablename = any(array[
  'homes','home_member_state','searches','search_member_priorities',
  'commute_destinations','search_members'
]) order by tablename, policyname;

-- 3: table grants for API roles.
select table_name, grantee, privilege_type, is_grantable
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name = any(array['homes','home_member_state','searches',
    'search_member_priorities','commute_destinations','search_members'])
  and grantee = any(array['PUBLIC','anon','authenticated','service_role'])
order by table_name, grantee, privilege_type;

-- 4: explicit/effective homes and searches column grants.
select table_name, column_name, grantee, privilege_type
from information_schema.role_column_grants
where table_schema = 'public' and table_name = any(array['homes','searches'])
  and grantee = any(array['PUBLIC','anon','authenticated','service_role'])
order by table_name, column_name, grantee, privilege_type;

-- 5: function overload, definer, search_path, and ACL inventory. identity_args
-- makes a weaker overload visible without exposing application data.
select p.proname, pg_get_function_identity_arguments(p.oid) as identity_args,
       p.prosecdef as security_definer, p.provolatile as volatility,
       coalesce(array_to_string(p.proconfig, ','), '<unset>') as function_config,
       coalesce(array_to_string(p.proacl, ','), '<default>') as acl
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = any(array[
  'is_search_owner','is_search_member','can_access_search','can_access_home',
  'resolve_shared_fact_priority_awareness','resolve_cobuyer_compare_perspectives',
  'resolve_cobuyer_lifecycle_signals','preview_invitation','accept_invitation'
]) order by p.proname, identity_args;

-- 6: required-column drift. No values are read.
with required(table_name, column_name) as (values
  ('homes','id'),('homes','user_id'),('homes','search_id'),('homes','address'),
  ('homes','crossroads'),('homes','listing_url'),('homes','photo_url'),
  ('homes','price'),('homes','est_monthly'),('homes','sqft'),('homes','beds'),
  ('homes','baths'),('homes','lot_size'),('homes','garage_spaces'),
  ('homes','year_built'),('homes','days_on_market'),('homes','home_layout'),
  ('homes','home_condition'),('homes','primary_bedroom_location'),
  ('homes','secondary_bedroom_location'),('homes','notes'),('homes','pros'),
  ('homes','cons'),('homes','latitude'),('homes','longitude'),
  ('homes','coordinate_address_fingerprint'),('homes','coordinate_status'),
  ('homes','coordinate_source'),('homes','hoa_fee_monthly'),
  ('homes','property_tax_annual'),('homes','property_tax_year'),
  ('homes','basement_notes'),('homes','schools_notes'),('homes','condition_notes'),
  ('homes','created_at'),('homes','updated_at'),('homes','status'),
  ('homes','reaction'),('homes','toured_at'),('homes','is_favorite'),
  ('homes','rejection_reason'),('homes','ratings'),('homes','checks'),
  ('searches','id'),('searches','user_id'),('searches','priorities'),
  ('searches','created_at'),('searches','updated_at')
), missing as (
  select r.* from required r left join information_schema.columns c
    on c.table_schema='public' and c.table_name=r.table_name and c.column_name=r.column_name
  where c.column_name is null
)
select table_name, column_name as missing_column from missing
order by table_name, column_name;

-- 7: compact go/no-go summary. false requires STOP/review; policy text above
-- remains the source of truth when production differs from the repository.
select
  (select count(*) = 6 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname=any(array['homes','home_member_state','searches','search_member_priorities','commute_destinations','search_members']) and c.relrowsecurity) as all_relevant_rls_enabled,
  has_table_privilege('authenticated','public.homes','SELECT') as authenticated_homes_table_select,
  has_table_privilege('authenticated','public.homes','UPDATE') as authenticated_homes_table_update,
  has_table_privilege('authenticated','public.searches','SELECT') as authenticated_searches_table_select,
  has_table_privilege('authenticated','public.searches','UPDATE') as authenticated_searches_table_update,
  (select count(*)=1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='can_access_search' and pg_get_function_identity_arguments(p.oid)='p_search_id uuid, p_user_id uuid') as one_two_arg_access_helper,
  (select count(*)=1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='resolve_cobuyer_lifecycle_signals' and pg_get_function_identity_arguments(p.oid)='p_search_id uuid, p_home_ids uuid[]') as one_lifecycle_overload;

rollback;
