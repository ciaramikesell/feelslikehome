// The historical Pets / In-Unit Laundry / Utilities audit is read-only and
// reports aggregate counts only. It classifies homes the way a migration rule
// would have to (see docs/rental-fact-history-audit.md); it migrates nothing.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createTestDatabase, DB_TESTS_ENABLED, DB_SKIP_REASON } from './support/supabaseDb.mjs';

const sql = readFileSync(new URL('../supabase/rental-fact-history-audit.sql', import.meta.url), 'utf8');

test('the audit is read-only and returns counts, never people or homes', () => {
  assert.match(sql, /^begin read only;$/m);
  assert.match(sql, /^rollback;\s*$/m);
  assert.doesNotMatch(sql.replace(/^--.*$/gm, ''), /\b(insert|update|delete|alter|drop|truncate|grant|revoke)\b/i);
  assert.doesNotMatch(sql.replace(/^--.*$/gm, ''), /select[^;]*\b(email|address|user_id|home_id)\b\s+as\b/i);
});

const dbTest = (name, fn) => test(name, { skip: DB_TESTS_ENABLED ? false : DB_SKIP_REASON }, fn);
let db;
before(() => { if (DB_TESTS_ENABLED) db = createTestDatabase(); });
after(() => db?.drop());

dbTest('the audit separates agreeing, disagreeing and ambiguous answers and changes nothing', () => {
  const a = db.createUser({ email: 'audit.a@example.com' });
  const b = db.createUser({ email: 'audit.b@example.com' });
  const search = db.admin(`select id from public.searches where user_id = '${a}'`)[0].id;
  db.exec(`insert into public.homes(user_id, search_id, address) values ('${a}','${search}','A'), ('${a}','${search}','B'), ('${a}','${search}','C');
           update public.homes set pets_allowed = false where address = 'B';`);
  const id = (address) => db.admin(`select id from public.homes where address = '${address}'`)[0].id;
  db.exec(`insert into public.home_member_state(home_id, user_id, checks) values
    ('${id('A')}', '${a}', '{"features:Pets Allowed": true}'), ('${id('A')}', '${b}', '{"features:Pets Allowed": "no"}'),
    ('${id('B')}', '${a}', '{"features:Pets Allowed": true}'),
    ('${id('C')}', '${a}', '{"features:Pets Allowed": true, "features:In-Unit Laundry": false}')`);
  const before = db.admin('select count(*)::int as n, md5(string_agg(checks::text, \'|\' order by id)) as h from public.home_member_state')[0];
  const body = sql.replace(/^--.*$/gm, '').replace(/^begin read only;$/m, '').replace(/^rollback;\s*$/m, '').trim().replace(/;$/, '');
  const rows = db.admin(body);
  const homes = rows.filter((row) => row.section === '2 homes').map((row) => `${row.criterion} | ${row.detail} | ${row.n}`).sort();
  assert.deepEqual(homes, [
    'features:In-Unit Laundry | shared fact unknown; only legacy false/other personal values | 1',
    'features:Pets Allowed | shared fact set; a personal answer disagrees | 1',
    'features:Pets Allowed | shared fact unknown; explicit personal answers all agree | 1',
    'features:Pets Allowed | shared fact unknown; members disagree | 1',
  ]);
  // Counts only: no identifiers anywhere in the output.
  assert.doesNotMatch(JSON.stringify(rows), /[0-9a-f]{8}-[0-9a-f]{4}-/);
  assert.deepEqual(db.admin('select count(*)::int as n, md5(string_agg(checks::text, \'|\' order by id)) as h from public.home_member_state')[0], before);
});
