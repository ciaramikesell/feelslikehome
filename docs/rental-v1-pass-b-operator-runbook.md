# Rental V1 Pass B operator runbook

## Before merge
1. Review `supabase/migrations/2026-09-09-rental-v1-shared-facts.sql` as one additive transaction.
2. Run the full test/build/diff checks and compare the migration's final definitions with `supabase/schema.sql`.
3. Apply the migration to a disposable Supabase database. Confirm an invalid `property_type` fails with `23514`, valid values and `NULL` succeed, and roll the fixture transaction back.

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
