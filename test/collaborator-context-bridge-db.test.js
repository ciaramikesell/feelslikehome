// 2026-10-08-collaborator-context-return-type.sql must only ever upgrade the
// 3-column collaborator context, and never overwrite a 4-column one (the
// display-name version, the newer 2026-09-19 version, or a hand edit), even if
// replayed later. Real Postgres; skips unless FLH_TEST_PGHOST is set.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createTestDatabase, DB_TESTS_ENABLED, DB_SKIP_REASON } from './support/supabaseDb.mjs';

const dbTest = (name, fn) => test(name, { skip: DB_TESTS_ENABLED ? false : DB_SKIP_REASON }, fn);
const M = 'supabase/migrations/';
const BRIDGE = `${M}2026-10-08-collaborator-context-return-type.sql`;
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const definitionIn = (file) => {
  const sql = read(file);
  const start = sql.indexOf('create or replace function public.resolve_collaborator_search_context(');
  return sql.slice(start, sql.indexOf('$$;', start) + 3);
};
const GRANTS = `revoke all on function public.resolve_collaborator_search_context(uuid) from public;
  revoke execute on function public.resolve_collaborator_search_context(uuid) from anon, service_role;
  grant execute on function public.resolve_collaborator_search_context(uuid) to authenticated;`;

let db;
before(() => { if (DB_TESTS_ENABLED) db = createTestDatabase(); });
after(() => db?.drop());

const installed = () => db.admin(`select md5(p.prosrc) as body, pg_get_function_result(p.oid) as result, p.proacl::text as acl,
  p.prosecdef as definer, p.proconfig::text as config from pg_proc p where p.proname = 'resolve_collaborator_search_context'`)[0];
const bodyMd5 = (file) => db.admin(`select md5(${`$q$${definitionIn(file).match(/\$\$([\s\S]*)\$\$;$/)[1]}$q$`}) as m`)[0].m;

dbTest('a 4-column version is never touched: newer 09-19, display-name, or a hand edit', () => {
  for (const [label, setup] of [
    ['2026-09-19 version (repository build)', null],
    ['display-name version', `drop function public.resolve_collaborator_search_context(uuid); ${definitionIn(`${M}2026-09-16-my-search-collaborator-display-name.sql`)} ${GRANTS}`],
    ['hand-edited 4-column version', `create or replace function public.resolve_collaborator_search_context(p_search_id uuid)
      returns table (priorities jsonb, commute_destinations jsonb, home_states jsonb, display_name text)
      language sql security definer set search_path = '' as $$ select null::jsonb, null::jsonb, null::jsonb, 'HAND EDIT'::text $$; ${GRANTS}`],
  ]) {
    if (setup) db.exec(setup);
    const before = installed();
    assert.equal(db.applyFile(BRIDGE).ok, true, label);
    assert.deepEqual(installed(), before, `${label}: body, return type, ACL, definer, and settings unchanged`);
  }
});

dbTest('the 3-column version is upgraded to the reviewed display-name definition, authenticated-only', () => {
  db.exec(`drop function public.resolve_collaborator_search_context(uuid); ${definitionIn(`${M}2026-09-10-shared-search-collaboration-contract.sql`)} ${GRANTS}`);
  assert.doesNotMatch(installed().result, /display_name/);
  assert.equal(db.applyFile(BRIDGE).ok, true);
  const after = installed();
  assert.match(after.result, /display_name text/);
  assert.equal(after.body, bodyMd5(`${M}2026-09-16-my-search-collaborator-display-name.sql`));
  assert.equal(after.definer, true);
  assert.equal(after.config, '{"search_path=\\"\\""}');
  assert.equal(after.acl, '{postgres=X/postgres,authenticated=X/postgres}');
  // And once upgraded, replaying it again is a no-op.
  assert.equal(db.applyFile(BRIDGE).ok, true);
  assert.deepEqual(installed(), after);
});
