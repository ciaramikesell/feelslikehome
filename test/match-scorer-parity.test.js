// FLH has two Match scorers that must agree for the same participant:
// computeMatch (src/lib/matching.js, the caller's own Match) and the sanitized
// SQL projection resolve_cobuyer_compare_perspectives (the other participant's
// Match, as shown in Compare). This pins the pieces of the SQL scorer that are
// copied from JS catalog metadata, against the newest SQL definition.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { RETIRED_PURCHASE_BUILT_IN_KEYS } from '../src/lib/constants.js';

const migrationsDir = new URL('../supabase/migrations/', import.meta.url);
const latestDefinition = readdirSync(migrationsDir).sort().reverse()
  .map((file) => ({ file, sql: readFileSync(new URL(file, migrationsDir), 'utf8') }))
  .find(({ sql }) => /create or replace function public\.resolve_cobuyer_compare_perspectives\(/.test(sql));

function sqlRetiredKeys(sql) {
  const block = sql.match(/in \('purchase', 'buy'\) and v_key = any\(array\[([\s\S]*?)\]\)/);
  assert.ok(block, 'retired purchase built-in array present in the SQL scorer');
  return [...block[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
}

test('the newest co-buyer Compare scorer skips exactly the JS retired purchase built-ins', () => {
  assert.equal(latestDefinition.file, '2026-10-07-cobuyer-compare-garage-parity.sql');
  assert.deepEqual([...sqlRetiredKeys(latestDefinition.sql)].sort(), [...RETIRED_PURCHASE_BUILT_IN_KEYS].sort());
});

test('Garage stays a scored criterion on both sides, from the shared garage_spaces fact', () => {
  assert.ok(!RETIRED_PURCHASE_BUILT_IN_KEYS.includes('exterior:Garage'));
  assert.match(latestDefinition.sql, /v_category = 'exterior' and v_label = 'Garage' and coalesce\(v_home\.garage_spaces, ''\) <> ''/);
});
