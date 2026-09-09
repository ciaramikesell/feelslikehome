const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const migration = fs.readFileSync('supabase/migrations/2026-09-09-pass-3c3-lock-legacy-privacy.sql', 'utf8');
const schema = fs.readFileSync('supabase/schema.sql', 'utf8');
const preflight = fs.readFileSync('supabase/3c3-production-preflight.sql', 'utf8');
const verification = fs.readFileSync('supabase/3c3-production-verification.sql', 'utf8');
const runbook = fs.readFileSync('docs/pass-3c3-operator-runbook.md', 'utf8');
const preflightVerdict = fs.readFileSync('supabase/3c3-production-preflight-verdict.sql', 'utf8');

const homeRead = [
  'id','user_id','search_id','address','crossroads','listing_url','photo_url','price','est_monthly','sqft','beds','baths','lot_size','garage_spaces','year_built','days_on_market','home_layout','home_condition','primary_bedroom_location','secondary_bedroom_location','notes','pros','cons','latitude','longitude','coordinate_address_fingerprint','coordinate_status','coordinate_source','hoa_fee_monthly','property_tax_annual','property_tax_year','basement_notes','schools_notes','condition_notes','created_at','updated_at',
];
const homePrivate = ['status','reaction','toured_at','is_favorite','rejection_reason','ratings','checks'];

function grantColumns(sql, privilege, table) {
  const match = sql.match(new RegExp(`grant ${privilege} \\(([^)]*)\\)\\s+on public\\.${table} to authenticated;`, 'i'));
  assert.ok(match, `missing ${privilege} column grant on ${table}`);
  return match[1].split(',').map((x) => x.trim()).filter(Boolean);
}

test('home_member_state becomes own-select while participant-owned writes remain', () => {
  assert.match(migration, /create policy "hms_select_own"[\s\S]*?for select using \(auth\.uid\(\) = user_id\)/);
  assert.match(schema, /create policy "hms_select_own"[\s\S]*?for select using \(auth\.uid\(\) = user_id\)/);
  const selectPolicy = migration.match(/create policy "hms_select_own"[\s\S]*?;/)[0];
  assert.doesNotMatch(selectPolicy, /can_access_home/);
  assert.match(schema, /create policy "hms_own_insert"[\s\S]*?auth\.uid\(\) = user_id[\s\S]*?can_access_home/);
  assert.match(schema, /create policy "hms_own_update"[\s\S]*?using \(auth\.uid\(\) = user_id\)[\s\S]*?can_access_home/);
  assert.doesNotMatch(migration, /create policy[^;]+home_member_state[\s\S]*?for delete/i);
});

test('homes exact read allowlist excludes every legacy private column', () => {
  assert.deepEqual(grantColumns(migration, 'select', 'homes'), homeRead);
  for (const column of homePrivate) assert.ok(!grantColumns(migration, 'select', 'homes').includes(column));
  assert.match(migration, /revoke select, insert, update on table public\.homes from authenticated/);
  assert.doesNotMatch(migration, /grant select on (table )?public\.homes/i);
});

test('homes write surface supports shared facts but not legacy state', () => {
  const insert = grantColumns(migration, 'insert', 'homes');
  const update = grantColumns(migration, 'update', 'homes');
  for (const column of ['address','notes','pros','cons','latitude','coordinate_status']) {
    assert.ok(insert.includes(column)); assert.ok(update.includes(column));
  }
  for (const column of homePrivate) {
    assert.ok(!insert.includes(column)); assert.ok(!update.includes(column));
  }
  assert.ok(!update.includes('created_at'));
  assert.match(migration, /new\.id is distinct from old\.id[\s\S]*?new\.user_id is distinct from old\.user_id[\s\S]*?new\.search_id is distinct from old\.search_id/);
  assert.match(migration, /auth\.uid\(\) = user_id[\s\S]*?can_access_search\(search_id, auth\.uid\(\)\)/);
});

test('searches exposes only shared metadata and has no authenticated update', () => {
  assert.deepEqual(grantColumns(migration, 'select', 'searches'), ['id','user_id','created_at','updated_at']);
  assert.match(migration, /revoke select, update on table public\.searches from authenticated/);
  assert.doesNotMatch(migration, /grant update[^;]*public\.searches/i);
  assert.ok(!grantColumns(migration, 'select', 'searches').includes('priorities'));
});

test('existing own-only priority and commute policies remain canonical', () => {
  assert.match(schema, /create policy "smp_own_select"[\s\S]*?for select using \(auth\.uid\(\) = user_id\)/);
  assert.match(schema, /create policy "smp_own_insert"[\s\S]*?auth\.uid\(\) = user_id[\s\S]*?can_access_search\(search_id, auth\.uid\(\)\)/);
  assert.match(schema, /create policy "smp_own_update"[\s\S]*?using \(auth\.uid\(\) = user_id\)[\s\S]*?can_access_search\(search_id, auth\.uid\(\)\)/);
  for (const command of ['select','insert','update','delete']) {
    assert.match(schema, new RegExp(`commute_destinations_${command}_own[\\s\\S]*?auth\\.uid\\(\\) = user_id[\\s\\S]*?can_access_search\\(search_id, auth\\.uid\\(\\)\\)`));
  }
});

test('sanitized RPC contracts and explicit ACLs remain locked', () => {
  for (const [name, args] of [
    ['resolve_shared_fact_priority_awareness', 'uuid'],
    ['resolve_cobuyer_compare_perspectives', 'uuid, uuid\\[\\]'],
    ['resolve_cobuyer_lifecycle_signals', 'uuid, uuid\\[\\]'],
  ]) {
    assert.match(schema, new RegExp(`function public\\.${name}\\([\\s\\S]*?security definer[\\s\\S]*?set search_path = ''`, 'i'));
    assert.match(migration, new RegExp(`revoke execute on function public\\.${name}\\(${args}\\) from anon, service_role;`));
  }
  assert.match(schema, /returns table \(\s*home_id uuid,\s*co_buyer_wants_to_tour boolean,\s*co_buyer_favorited boolean,\s*co_buyer_archived boolean,\s*all_participants_archived boolean\s*\)/);
});

test('operator tooling is read-only and covers real JWT proof and rollback', () => {
  assert.match(preflight, /begin transaction read only/); assert.match(preflight, /rollback;/);
  assert.match(verification, /begin transaction read only/); assert.match(verification, /rollback;/);
  assert.doesNotMatch(preflight, /select\s+\*\s+from\s+public\./i);
  assert.match(runbook, /two ordinary, non-admin accounts A and B/);
  assert.match(runbook, /Never restore cross-participant/);
  assert.match(runbook, /Exact manual production order/);
});

test('migration never destroys or clears legacy data and never restores broad grants', () => {
  assert.doesNotMatch(migration, /\bdrop\s+(table|column)\b/i);
  assert.doesNotMatch(migration, /\b(truncate|delete\s+from)\b/i);
  assert.doesNotMatch(migration, /update\s+public\.(homes|searches)\s+set/i);
  assert.doesNotMatch(migration, /grant\s+(all|select|update)\s+on\s+(table\s+)?public\.(homes|searches)/i);
});

test('standalone preflight verdict is one read-only catalog result with fail-closed blockers', () => {
  assert.match(preflightVerdict, /^-- Pass 3C\.3 standalone production GO\/NO-GO verdict/);
  assert.doesNotMatch(preflightVerdict, /^\s*(insert\s+into|update\s+|delete\s+from|truncate\s+|alter\s+|create\s+|drop\s+|grant\s+|revoke\s+)/im);
  assert.doesNotMatch(preflightVerdict, /\bfrom\s+public\./i);
  assert.equal((preflightVerdict.match(/\nselect\n  bool_and\(passed\)/g) || []).length, 1);
  assert.match(preflightVerdict, /coalesce\(bool_and\(passed\),false\) as safe_to_apply_3c3/);
  assert.match(preflightVerdict, /array_agg\(check_name order by check_name\) filter\(where not coalesce\(passed,false\)\)/);
});

test('safe_to_apply_3c3 and blockers consume every named safety prerequisite', () => {
  const requiredChecks = [
    'all_six_tables_have_rls',
    'exact_expected_policy_inventory',
    'no_unexpected_privacy_policy',
    'hms_known_pre_3c3_select_policy',
    'priorities_policies_caller_own_only',
    'commute_policies_caller_own_two_arg',
    'homes_expected_authenticated_table_privileges',
    'searches_expected_authenticated_table_privileges',
    'no_authenticated_column_acl_drift',
    'all_homes_migration_columns_exist',
    'all_searches_migration_columns_exist',
    'all_protected_legacy_home_columns_exist',
    'searches_priorities_exists',
    'one_two_arg_can_access_search',
    'one_lifecycle_overload',
    'security_definer_metadata_matches',
    'function_acls_compatible',
  ];
  const checksCte = preflightVerdict.match(/checks\(check_name,passed\) as \(([\s\S]*?)\n\)\nselect/)[1];
  const namedChecks = [...checksCte.matchAll(/\('([a-z0-9_]+)',b\.[a-z0-9_]+\)/g)].map((m) => m[1]);
  assert.deepEqual(namedChecks, requiredChecks);
  for (const check of requiredChecks) {
    assert.match(preflightVerdict, new RegExp(`filter\\(where check_name='${check}'\\) as ${check}`));
  }
  // The verdict and blockers aggregate the same complete checks relation;
  // there is no hand-maintained permissive AND-list that could omit a check.
  assert.match(preflightVerdict, /coalesce\(bool_and\(passed\),false\) as safe_to_apply_3c3/);
  assert.match(preflightVerdict, /from checks;\s*$/);
});
