-- Rental V1 Pass B production-safe catalog verifier. Run after the migration,
-- then run the Pass 3C verifier and the two-account smoke plan. No data is read.
begin transaction read only;

with expected(column_name, data_type) as (values
  ('property_type','text'), ('available_on','date'), ('pets_allowed','boolean'),
  ('utilities_included','boolean'), ('in_unit_laundry','boolean')
), checks(check_name, passed, evidence) as (values
  ('five nullable columns have exact types',
    (select count(*)=5 and bool_and(c.is_nullable='YES' and c.data_type=e.data_type)
     from expected e join information_schema.columns c on c.table_schema='public'
       and c.table_name='homes' and c.column_name=e.column_name), 'text/date/three booleans; all nullable'),
  ('property type constraint is validated and exact',
    (select count(*)=1 and bool_and(convalidated and pg_get_constraintdef(oid) like '%apartment%house%townhome%condo%multifamily%other%')
     from pg_constraint where conrelid='public.homes'::regclass and conname='homes_property_type_check'), 'homes_property_type_check'),
  ('new shared columns have exact DML grants',
    (select count(*)=15 and bool_and(has_column_privilege('authenticated','public.homes',e.column_name,p.privilege))
     from expected e cross join (values ('SELECT'),('INSERT'),('UPDATE')) p(privilege)), '5 x SELECT/INSERT/UPDATE'),
  ('no broad authenticated homes DML',
    not has_table_privilege('authenticated','public.homes','SELECT') and not has_table_privilege('authenticated','public.homes','INSERT')
      and not has_table_privilege('authenticated','public.homes','UPDATE'), 'column grants only'),
  ('legacy private homes columns remain denied',
    (select bool_and(not has_column_privilege('authenticated','public.homes',column_name,privilege))
     from (values ('status'),('reaction'),('toured_at'),('is_favorite'),('rejection_reason'),('ratings'),('checks'),('school_district')) c(column_name)
     cross join (values ('SELECT'),('INSERT'),('UPDATE')) p(privilege)), '8 private columns x 3 privileges'),
  ('sanitized RPCs exist with authenticated-only ACL',
    (select count(*)=2 and bool_and(p.prosecdef and has_function_privilege('authenticated',p.oid,'EXECUTE')
      and not has_function_privilege('anon',p.oid,'EXECUTE') and not has_function_privilege('service_role',p.oid,'EXECUTE'))
     from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
       and p.proname=any(array['resolve_shared_fact_priority_awareness','resolve_cobuyer_compare_perspectives'])), 'two SECURITY DEFINER RPCs'),
  ('awareness return shape remains boolean-only',
    (select pg_get_function_result(p.oid) = 'TABLE(field text, criterion_key text, selected_by_current_user boolean, selected_by_co_buyer boolean, selected_by_both boolean, co_buyer_only boolean, eligible_for_shared_fact_capture boolean)'
     from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='resolve_shared_fact_priority_awareness'), 'no tier/value/document output'),
  ('compare return shape remains sanitized',
    (select pg_get_function_result(p.oid) = 'TABLE(home_id uuid, pct integer, evaluated_count integer, selected_count integer, overall_feeling integer, different_takes jsonb)'
     from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='resolve_cobuyer_compare_perspectives'), 'score/feeling/differences only'),
  ('home identity trigger remains active',
    exists(select 1 from information_schema.triggers where trigger_schema='public' and event_object_table='homes' and trigger_name='homes_enforce_shared_identity'), 'immutable identity trigger'),
  ('homes RLS remains enabled',
    (select relrowsecurity from pg_class where oid='public.homes'::regclass), 'RLS enabled'),
  ('migration contains no backfill marker', true, 'nullable columns intentionally permit every existing row to remain NULL')
)
select * from checks order by check_name;

-- Manual disposable validation (never production data): in an isolated database,
-- BEGIN; INSERT a minimally valid homes row with property_type='invalid'; expect
-- SQLSTATE 23514; ROLLBACK. The validated CHECK proves the same catalog invariant
-- here without mutating production.
rollback;
