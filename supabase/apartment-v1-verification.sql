-- Run after the Apartment V1 migration. Catalog/ACL verification; reads no home data.
begin transaction read only;

with expected(column_name) as (values
  ('property_name'), ('selected_floor_plan_name'),
  ('selected_unit_label'), ('floor_plan_image_url')
), checks(check_name, passed, evidence) as (values
  ('four nullable text columns exist',
    (select count(*) = 4 and bool_and(c.data_type = 'text' and c.is_nullable = 'YES')
     from expected e join information_schema.columns c
       on c.table_schema = 'public' and c.table_name = 'homes' and c.column_name = e.column_name),
    'property_name, selected_floor_plan_name, selected_unit_label, floor_plan_image_url'),
  ('new columns have shared DML grants',
    (select count(*) = 12 and bool_and(has_column_privilege('authenticated', 'public.homes', e.column_name, p.privilege))
     from expected e cross join (values ('SELECT'), ('INSERT'), ('UPDATE')) p(privilege)),
    '4 columns x SELECT/INSERT/UPDATE'),
  ('authenticated still has no broad homes DML',
    not has_table_privilege('authenticated', 'public.homes', 'SELECT')
      and not has_table_privilege('authenticated', 'public.homes', 'INSERT')
      and not has_table_privilege('authenticated', 'public.homes', 'UPDATE'),
    'column grants only'),
  ('homes RLS remains enabled',
    (select relrowsecurity from pg_class where oid = 'public.homes'::regclass),
    'existing RLS boundary')
)
select * from checks order by check_name;

rollback;
