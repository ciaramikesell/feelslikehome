-- Rental V1 Pass B disposable-only mutation probe.
-- Prerequisite: apply schema.sql (or the representative pre-Pass-B Pass 3C
-- schema) and then 2026-09-09-rental-v1-shared-facts.sql. Never run this
-- against production. The entire probe is rolled back.
\set ON_ERROR_STOP on

begin;

-- LIKE copies the production constraint itself. Relaxing unrelated required
-- columns on this temporary clone avoids requiring an auth.users fixture.
create temporary table pass_b_property_type_probe
  (like public.homes including defaults including constraints);
alter table pass_b_property_type_probe alter column user_id drop not null;

insert into pass_b_property_type_probe (property_type) values
  ('apartment'), ('house'), ('townhome'), ('condo'), ('multifamily'), ('other'), (null);

do $$
declare
  v_sqlstate text;
begin
  begin
    insert into pass_b_property_type_probe (property_type) values ('invalid');
    raise exception 'invalid property_type was unexpectedly accepted';
  exception
    when check_violation then
      get stacked diagnostics v_sqlstate = returned_sqlstate;
      if v_sqlstate <> '23514' then
        raise exception 'expected SQLSTATE 23514, received %', v_sqlstate;
      end if;
  end;

  if (select count(*) from pass_b_property_type_probe) <> 7 then
    raise exception 'property-type probe left unexpected rows';
  end if;
end
$$;

-- Catalog assertions not dependent on application data.
do $$
begin
  if has_table_privilege('authenticated', 'public.homes', 'SELECT')
     or has_table_privilege('authenticated', 'public.homes', 'INSERT')
     or has_table_privilege('authenticated', 'public.homes', 'UPDATE') then
    raise exception 'authenticated regained broad homes privileges';
  end if;

  if not (select relrowsecurity from pg_class where oid = 'public.homes'::regclass) then
    raise exception 'homes RLS is disabled';
  end if;

  if not exists (
    select 1 from information_schema.triggers
    where trigger_schema = 'public' and event_object_table = 'homes'
      and trigger_name = 'homes_enforce_shared_identity'
  ) then
    raise exception 'immutable home identity trigger is absent';
  end if;
end
$$;

rollback;
