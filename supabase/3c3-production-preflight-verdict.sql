-- Pass 3C.3 standalone production GO/NO-GO verdict.
-- READ ONLY: this statement inspects catalogs only and returns exactly one row.
-- Run it before applying 2026-09-09-pass-3c3-lock-legacy-privacy.sql.
with
expected_policies(table_name, policy_name, command, permissive, roles, using_expression, check_expression) as (
  values
    ('homes','homes_delete_own','DELETE','PERMISSIVE','{public}','(auth.uid()=user_id)',null),
    ('homes','homes_insert_member','INSERT','PERMISSIVE','{public}',null,'can_access_search(search_id,auth.uid())'),
    ('homes','homes_insert_own','INSERT','PERMISSIVE','{public}',null,'(auth.uid()=user_id)'),
    ('homes','homes_select_member','SELECT','PERMISSIVE','{public}','can_access_search(search_id,auth.uid())',null),
    ('homes','homes_select_own','SELECT','PERMISSIVE','{public}','(auth.uid()=user_id)',null),
    ('homes','homes_update_member','UPDATE','PERMISSIVE','{public}','can_access_search(search_id,auth.uid())','can_access_search(search_id,auth.uid())'),
    ('homes','homes_update_own','UPDATE','PERMISSIVE','{public}','(auth.uid()=user_id)','(auth.uid()=user_id)'),
    ('home_member_state','hms_own_insert','INSERT','PERMISSIVE','{public}',null,'((auth.uid()=user_id)ANDcan_access_home(home_id,auth.uid()))'),
    ('home_member_state','hms_own_update','UPDATE','PERMISSIVE','{public}','(auth.uid()=user_id)','((auth.uid()=user_id)ANDcan_access_home(home_id,auth.uid()))'),
    ('home_member_state','hms_select_members','SELECT','PERMISSIVE','{public}','((auth.uid()=user_id)ORcan_access_home(home_id,auth.uid()))',null),
    ('searches','searches_delete_own','DELETE','PERMISSIVE','{public}','(auth.uid()=user_id)',null),
    ('searches','searches_insert_own','INSERT','PERMISSIVE','{public}',null,'(auth.uid()=user_id)'),
    ('searches','searches_select_member','SELECT','PERMISSIVE','{public}','is_search_member(id,auth.uid())',null),
    ('searches','searches_select_own','SELECT','PERMISSIVE','{public}','(auth.uid()=user_id)',null),
    ('searches','searches_update_own','UPDATE','PERMISSIVE','{public}','(auth.uid()=user_id)','(auth.uid()=user_id)'),
    ('search_member_priorities','smp_own_insert','INSERT','PERMISSIVE','{public}',null,'((auth.uid()=user_id)ANDcan_access_search(search_id,auth.uid()))'),
    ('search_member_priorities','smp_own_select','SELECT','PERMISSIVE','{public}','(auth.uid()=user_id)',null),
    ('search_member_priorities','smp_own_update','UPDATE','PERMISSIVE','{public}','(auth.uid()=user_id)','((auth.uid()=user_id)ANDcan_access_search(search_id,auth.uid()))'),
    ('commute_destinations','commute_destinations_delete_own','DELETE','PERMISSIVE','{public}','((auth.uid()=user_id)ANDcan_access_search(search_id,auth.uid()))',null),
    ('commute_destinations','commute_destinations_insert_own','INSERT','PERMISSIVE','{public}',null,'((auth.uid()=user_id)ANDcan_access_search(search_id,auth.uid()))'),
    ('commute_destinations','commute_destinations_select_own','SELECT','PERMISSIVE','{public}','((auth.uid()=user_id)ANDcan_access_search(search_id,auth.uid()))',null),
    ('commute_destinations','commute_destinations_update_own','UPDATE','PERMISSIVE','{public}','((auth.uid()=user_id)ANDcan_access_search(search_id,auth.uid()))','((auth.uid()=user_id)ANDcan_access_search(search_id,auth.uid()))'),
    ('search_members','search_members_owner_delete','DELETE','PERMISSIVE','{public}','(is_search_owner(search_id,auth.uid())OR(auth.uid()=user_id))',null),
    ('search_members','search_members_owner_insert','INSERT','PERMISSIVE','{public}',null,'is_search_owner(search_id,auth.uid())'),
    ('search_members','search_members_select','SELECT','PERMISSIVE','{public}','((auth.uid()=user_id)ORis_search_owner(search_id,auth.uid()))',null)
),
actual_policies as (
  select tablename::text as table_name, policyname::text as policy_name,
    cmd::text as command, permissive::text, roles::text,
    regexp_replace(coalesce(qual,''),'[[:space:]]','','g') as using_expression,
    regexp_replace(coalesce(with_check,''),'[[:space:]]','','g') as check_expression
  from pg_policies
  where schemaname='public' and tablename=any(array[
    'homes','home_member_state','searches','search_member_priorities',
    'commute_destinations','search_members'
  ])
),
policy_diff as (
  (select table_name,policy_name,command,permissive,roles,
      coalesce(using_expression,''),coalesce(check_expression,'') from expected_policies
   except
   select table_name,policy_name,command,permissive,roles,
      using_expression,check_expression from actual_policies)
  union all
  (select table_name,policy_name,command,permissive,roles,
      using_expression,check_expression from actual_policies
   except
   select table_name,policy_name,command,permissive,roles,
      coalesce(using_expression,''),coalesce(check_expression,'') from expected_policies)
),
required_columns(table_name,column_name) as (
  values
    ('homes','id'),('homes','user_id'),('homes','search_id'),('homes','address'),
    ('homes','crossroads'),('homes','listing_url'),('homes','photo_url'),('homes','price'),
    ('homes','est_monthly'),('homes','sqft'),('homes','beds'),('homes','baths'),
    ('homes','lot_size'),('homes','garage_spaces'),('homes','year_built'),
    ('homes','days_on_market'),('homes','home_layout'),('homes','home_condition'),
    ('homes','primary_bedroom_location'),('homes','secondary_bedroom_location'),
    ('homes','notes'),('homes','pros'),('homes','cons'),('homes','latitude'),
    ('homes','longitude'),('homes','coordinate_address_fingerprint'),
    ('homes','coordinate_status'),('homes','coordinate_source'),('homes','hoa_fee_monthly'),
    ('homes','property_tax_annual'),('homes','property_tax_year'),('homes','basement_notes'),
    ('homes','schools_notes'),('homes','condition_notes'),('homes','created_at'),
    ('homes','updated_at'),('homes','status'),('homes','reaction'),('homes','toured_at'),
    ('homes','is_favorite'),('homes','rejection_reason'),('homes','ratings'),
    ('homes','checks'),('homes','school_district'),
    ('searches','id'),('searches','user_id'),('searches','priorities'),
    ('searches','created_at'),('searches','updated_at')
),
expected_functions(function_name,identity_arguments,required_path,requires_caller_access_check) as (
  values
    ('is_search_owner','p_search_id uuid, p_user_id uuid','search_path=public',false),
    ('is_search_member','p_search_id uuid, p_user_id uuid','search_path=public',false),
    ('can_access_search','p_search_id uuid, p_user_id uuid','search_path=public',false),
    ('can_access_home','p_home_id uuid, p_user_id uuid','search_path=public',false),
    ('resolve_shared_fact_priority_awareness','p_search_id uuid','search_path=""',true),
    ('resolve_cobuyer_compare_perspectives','p_search_id uuid, p_home_ids uuid[]','search_path=""',true),
    ('resolve_cobuyer_lifecycle_signals','p_search_id uuid, p_home_ids uuid[]','search_path=""',true)
),
actual_functions as (
  select p.oid, p.proname::text as function_name,
    pg_get_function_identity_arguments(p.oid) as identity_arguments,
    p.prosecdef, coalesce(array_to_string(p.proconfig,','),'') as function_config,
    pg_get_functiondef(p.oid) as definition, p.proacl, p.proowner
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname in (select function_name from expected_functions)
),
function_checks as (
  select
    (select count(*)=1 from actual_functions where function_name='can_access_search'
      and identity_arguments='p_search_id uuid, p_user_id uuid') as one_two_arg_can_access_search,
    (select count(*)=1 from actual_functions where function_name='resolve_cobuyer_lifecycle_signals'
      and identity_arguments='p_search_id uuid, p_home_ids uuid[]') as one_lifecycle_overload,
    not exists (
      select 1 from expected_functions e left join actual_functions a
        on a.function_name=e.function_name and a.identity_arguments=e.identity_arguments
      where a.oid is null or not a.prosecdef or a.function_config<>e.required_path
        or (e.requires_caller_access_check and
          (a.definition not like '%auth.uid()%' or a.definition not like '%can_access_search%'))
    ) and (select count(*) from actual_functions)=(select count(*) from expected_functions)
      as security_definer_metadata_matches,
    not exists (
      select 1 from expected_functions e left join actual_functions a
        on a.function_name=e.function_name and a.identity_arguments=e.identity_arguments
      where a.oid is null
        or not has_function_privilege('authenticated',a.oid,'EXECUTE')
        or exists (select 1 from aclexplode(coalesce(a.proacl,acldefault('f',a.proowner))) x
                   where x.grantee=0 and x.privilege_type='EXECUTE')
    ) as function_acls_compatible
),
base_checks as (
  select
    (select count(*)=6 and bool_and(c.relrowsecurity)
     from pg_class c join pg_namespace n on n.oid=c.relnamespace
     where n.nspname='public' and c.relkind in ('r','p') and c.relname=any(array[
       'homes','home_member_state','searches','search_member_priorities',
       'commute_destinations','search_members'])) as all_six_tables_have_rls,
    not exists(select 1 from policy_diff) as exact_expected_policy_inventory,
    not exists(select 1 from actual_policies where permissive<>'PERMISSIVE')
      and not exists(select 1 from policy_diff) as no_unexpected_privacy_policy,
    exists(select 1 from actual_policies where table_name='home_member_state'
      and policy_name='hms_select_members' and command='SELECT'
      and using_expression='((auth.uid()=user_id)ORcan_access_home(home_id,auth.uid()))')
      as hms_known_pre_3c3_select_policy,
    not exists(select 1 from policy_diff where table_name='search_member_priorities')
      as priorities_policies_caller_own_only,
    not exists(select 1 from policy_diff where table_name='commute_destinations')
      as commute_policies_caller_own_two_arg,
    has_table_privilege('authenticated','public.homes','SELECT')
      and has_table_privilege('authenticated','public.homes','UPDATE')
      and has_table_privilege('authenticated','public.homes','INSERT')
      and has_table_privilege('authenticated','public.homes','DELETE')
      as homes_expected_authenticated_table_privileges,
    has_table_privilege('authenticated','public.searches','SELECT')
      and has_table_privilege('authenticated','public.searches','UPDATE')
      and has_table_privilege('authenticated','public.searches','INSERT')
      and has_table_privilege('authenticated','public.searches','DELETE')
      as searches_expected_authenticated_table_privileges,
    not exists (
      select 1 from pg_attribute a join pg_class c on c.oid=a.attrelid
      join pg_namespace n on n.oid=c.relnamespace
      cross join lateral aclexplode(a.attacl) x
      join pg_roles r on r.oid=x.grantee
      where n.nspname='public' and c.relname in ('homes','searches')
        and a.attnum>0 and not a.attisdropped and r.rolname='authenticated'
    ) as no_authenticated_column_acl_drift,
    not exists (
      select 1 from required_columns r left join information_schema.columns c
        on c.table_schema='public' and c.table_name=r.table_name and c.column_name=r.column_name
      where r.table_name='homes' and c.column_name is null
    ) as all_homes_migration_columns_exist,
    not exists (
      select 1 from required_columns r left join information_schema.columns c
        on c.table_schema='public' and c.table_name=r.table_name and c.column_name=r.column_name
      where r.table_name='searches' and c.column_name is null
    ) as all_searches_migration_columns_exist,
    (select count(*)=7 from required_columns r join information_schema.columns c
      on c.table_schema='public' and c.table_name=r.table_name and c.column_name=r.column_name
      where r.table_name='homes' and r.column_name in
        ('status','reaction','toured_at','is_favorite','rejection_reason','ratings','checks'))
      as all_protected_legacy_home_columns_exist,
    exists(select 1 from information_schema.columns
      where table_schema='public' and table_name='searches' and column_name='priorities')
      as searches_priorities_exists,
    f.*
  from function_checks f
),
checks(check_name,passed) as (
  select v.check_name,v.passed
  from base_checks b
  cross join lateral (values
    ('all_six_tables_have_rls',b.all_six_tables_have_rls),
    ('exact_expected_policy_inventory',b.exact_expected_policy_inventory),
    ('no_unexpected_privacy_policy',b.no_unexpected_privacy_policy),
    ('hms_known_pre_3c3_select_policy',b.hms_known_pre_3c3_select_policy),
    ('priorities_policies_caller_own_only',b.priorities_policies_caller_own_only),
    ('commute_policies_caller_own_two_arg',b.commute_policies_caller_own_two_arg),
    ('homes_expected_authenticated_table_privileges',b.homes_expected_authenticated_table_privileges),
    ('searches_expected_authenticated_table_privileges',b.searches_expected_authenticated_table_privileges),
    ('no_authenticated_column_acl_drift',b.no_authenticated_column_acl_drift),
    ('all_homes_migration_columns_exist',b.all_homes_migration_columns_exist),
    ('all_searches_migration_columns_exist',b.all_searches_migration_columns_exist),
    ('all_protected_legacy_home_columns_exist',b.all_protected_legacy_home_columns_exist),
    ('searches_priorities_exists',b.searches_priorities_exists),
    ('one_two_arg_can_access_search',b.one_two_arg_can_access_search),
    ('one_lifecycle_overload',b.one_lifecycle_overload),
    ('security_definer_metadata_matches',b.security_definer_metadata_matches),
    ('function_acls_compatible',b.function_acls_compatible)
  ) v(check_name,passed)
)
select
  bool_and(passed) filter(where check_name='all_six_tables_have_rls') as all_six_tables_have_rls,
  bool_and(passed) filter(where check_name='exact_expected_policy_inventory') as exact_expected_policy_inventory,
  bool_and(passed) filter(where check_name='no_unexpected_privacy_policy') as no_unexpected_privacy_policy,
  bool_and(passed) filter(where check_name='hms_known_pre_3c3_select_policy') as hms_known_pre_3c3_select_policy,
  bool_and(passed) filter(where check_name='priorities_policies_caller_own_only') as priorities_policies_caller_own_only,
  bool_and(passed) filter(where check_name='commute_policies_caller_own_two_arg') as commute_policies_caller_own_two_arg,
  bool_and(passed) filter(where check_name='homes_expected_authenticated_table_privileges') as homes_expected_authenticated_table_privileges,
  bool_and(passed) filter(where check_name='searches_expected_authenticated_table_privileges') as searches_expected_authenticated_table_privileges,
  bool_and(passed) filter(where check_name='no_authenticated_column_acl_drift') as no_authenticated_column_acl_drift,
  bool_and(passed) filter(where check_name='all_homes_migration_columns_exist') as all_homes_migration_columns_exist,
  bool_and(passed) filter(where check_name='all_searches_migration_columns_exist') as all_searches_migration_columns_exist,
  bool_and(passed) filter(where check_name='all_protected_legacy_home_columns_exist') as all_protected_legacy_home_columns_exist,
  bool_and(passed) filter(where check_name='searches_priorities_exists') as searches_priorities_exists,
  bool_and(passed) filter(where check_name='one_two_arg_can_access_search') as one_two_arg_can_access_search,
  bool_and(passed) filter(where check_name='one_lifecycle_overload') as one_lifecycle_overload,
  bool_and(passed) filter(where check_name='security_definer_metadata_matches') as security_definer_metadata_matches,
  bool_and(passed) filter(where check_name='function_acls_compatible') as function_acls_compatible,
  coalesce(bool_and(passed),false) as safe_to_apply_3c3,
  coalesce(array_agg(check_name order by check_name) filter(where not coalesce(passed,false)),'{}'::text[]) as blockers
from checks;
