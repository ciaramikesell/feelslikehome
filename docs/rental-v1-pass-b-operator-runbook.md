# Rental V1 Pass B operator runbook

## Before merge
1. Review `supabase/migrations/2026-09-09-rental-v1-shared-facts.sql` as one additive transaction.
2. Run the full test/build/diff checks and compare the migration's final definitions with `supabase/schema.sql`.
3. Apply the migration to a disposable Supabase database. Confirm an invalid `property_type` fails with `23514`, valid values and `NULL` succeed, and roll the fixture transaction back.

### Copy/paste disposable execution package

Use a newly created temporary Supabase project or other Supabase-compatible PostgreSQL database. Never substitute production credentials.

1. Install the current pre-Pass-B schema. For a clean database, run `supabase/schema.sql` from the parent commit (`e16035f^`); for higher fidelity, restore a schema-only dump of the reviewed Pass 3C production shape with all data excluded.
2. Execute `supabase/migrations/2026-09-09-rental-v1-shared-facts.sql` in full and require a successful `COMMIT`.
3. Execute `supabase/rental-v1-shared-facts-verification.sql`; every `passed` value must be `true`.
4. Execute `supabase/3c3-production-preflight.sql`, inspect its inventories, then execute `supabase/3c3-production-preflight-verdict.sql` and require `safe_to_apply_3c3 = true` where the chosen baseline supports the preflight. Execute `supabase/3c3-production-verification.sql` and require every `passed` value to be `true`.
5. With `psql`, execute `supabase/rental-v1-disposable-execution.sql`. It copies the real constraint onto a temporary table, accepts all six values plus `NULL`, catches and validates invalid input as SQLSTATE `23514`, checks broad privileges/RLS/identity protection, and rolls back all probe rows.
6. Inspect effective grants and RPC ACLs with the copy/paste queries below. Confirm the five shared columns have all three privileges, broad table privileges are false, every legacy-private result is false, and RPC execution is authenticated-only.
7. Delete the temporary project/database after recording the commands, UTC time, PostgreSQL version, and outputs in the PR.

```sql
select c.column_name, p.privilege,
       has_column_privilege('authenticated','public.homes',c.column_name,p.privilege) as granted
from (values ('property_type'),('available_on'),('pets_allowed'),
             ('utilities_included'),('in_unit_laundry')) c(column_name)
cross join (values ('SELECT'),('INSERT'),('UPDATE')) p(privilege)
order by c.column_name, p.privilege;

select has_table_privilege('authenticated','public.homes','SELECT') as broad_select,
       has_table_privilege('authenticated','public.homes','INSERT') as broad_insert,
       has_table_privilege('authenticated','public.homes','UPDATE') as broad_update;

select c.column_name, p.privilege,
       has_column_privilege('authenticated','public.homes',c.column_name,p.privilege) as wrongly_granted
from (values ('status'),('reaction'),('toured_at'),('is_favorite'),
             ('rejection_reason'),('ratings'),('checks'),('school_district')) c(column_name)
cross join (values ('SELECT'),('INSERT'),('UPDATE')) p(privilege)
order by c.column_name, p.privilege;

select p.proname, p.prosecdef,
       has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute,
       has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,
       has_function_privilege('service_role',p.oid,'EXECUTE') as service_role_execute,
       p.proconfig
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in
  ('resolve_shared_fact_priority_awareness','resolve_cobuyer_compare_perspectives');

select relrowsecurity from pg_class where oid='public.homes'::regclass;
select trigger_name from information_schema.triggers
where trigger_schema='public' and event_object_table='homes'
  and trigger_name='homes_enforce_shared_identity';
```

## After repository PR merge
Confirm the production application remains healthy **before** database application. The runtime recognizes a missing Pass B column and retries the pre-Pass-B explicit projection/write, so this merge is compatible with the old schema. Do not merge Pass C, D, or E.

## Manual Supabase application
1. In production SQL Editor, execute `supabase/migrations/2026-09-09-rental-v1-shared-facts.sql` in full. Its order is: begin; add five columns; add and validate the property-type check; extend exact column ACLs; replace awareness RPC; replace Compare RPC; restore RPC ACLs; reload PostgREST; commit.
2. Record migration filename/version, UTC start/end time, operator, and result.

## Immediate verification
Run, in order:
1. `supabase/rental-v1-shared-facts-verification.sql`.
2. `supabase/3c3-production-preflight.sql`, review output, then `supabase/3c3-production-preflight-verdict.sql` and `supabase/3c3-production-verification.sql`.
3. The two-account privacy smoke plan in `docs/pass-3c3-operator-runbook.md`.
4. As each accepted account, explicitly select and update only `property_type,available_on,pets_allowed,utilities_included,in_unit_laundry`; verify owner and collaborator succeed and a stranger sees no row.
5. Verify broad `homes` selection and every legacy private column remain denied, identity mutation fails, awareness is boolean/tier-free, and Compare exposes only its reviewed sanitized shape.

Only after every result is green and the migration record is complete may Pass C/D/E merge.

## Failure and corrective strategy
If the migration transaction fails, it rolls back; investigate in isolation and keep later passes blocked. After commit, **do not drop columns** and do not rewrite data. Dormant nullable columns may safely remain. Restore the prior reviewed RPC definition and/or exact ACL set with a new corrective transaction, rerun all verification, and keep later passes blocked until green. Dropping columns is not an approved rollback.
