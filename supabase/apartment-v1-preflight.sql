-- Run immediately before the Apartment V1 migration. This reads catalog metadata only.
begin transaction read only;

select
  count(*) = 0 as new_columns_are_not_already_present,
  not has_table_privilege('authenticated', 'public.homes', 'SELECT')
    and not has_table_privilege('authenticated', 'public.homes', 'INSERT')
    and not has_table_privilege('authenticated', 'public.homes', 'UPDATE') as homes_has_no_broad_authenticated_dml,
  (select relrowsecurity from pg_class where oid = 'public.homes'::regclass) as homes_rls_enabled
from information_schema.columns
where table_schema = 'public' and table_name = 'homes'
  and column_name = any(array[
    'property_name', 'selected_floor_plan_name', 'selected_unit_label', 'floor_plan_image_url'
  ]);

rollback;
