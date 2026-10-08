// Production schema drift (found 2026-10-08) and its repair, proven end to end.
//
// Production's Section 0 check showed prospective_searches and
// search_invitations.prospective_search_id missing while invitation_direction
// exists. That is exactly the state left by the pre-fix schema.sql, whose
// final block (2026-09-16 Realtor-started searches) opened a transaction and
// never committed. In that state the 2026-09-18 people-workspace and
// 2026-09-19 account-name migrations cannot apply (they reference the missing
// table), and co-buyer acceptance fails with 42702.
//
// This rebuilds that state, seeds existing data, applies the documented repair
// order exactly as an operator would in the SQL Editor, and proves existing
// data is untouched and every invitation path plus the co-buyer journey works.
// See docs/production-schema-drift-repair.md. Skips unless FLH_TEST_PGHOST is set.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { createTestDatabase, DB_TESTS_ENABLED, DB_SKIP_REASON } from './support/supabaseDb.mjs';
import { normalizePriorities } from '../src/lib/constants.js';

register('./support/aliasHooks.mjs', import.meta.url);
const {
  acceptInvitation, claimProspectiveSearch, createProspectiveSearch, inviteProspectiveClient, needsSharedSearchSetup,
  previewInvitation, resolveActiveSearch, resolveOnboardingSearch,
} = await import('../src/lib/supabase/collaboration.js');
const { updateProfileName } = await import('../src/lib/supabase/data.js');

const dbTest = (name, fn) => test(name, { skip: DB_TESTS_ENABLED ? false : DB_SKIP_REASON }, fn);
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

// The repair, in order. Each file is the repository migration, unmodified.
const REPAIR_ORDER = [
  'supabase/migrations/2026-09-16-realtor-started-searches.sql',
  'supabase/migrations/2026-09-18-people-workspace-draft-select-privileges.sql',
  'supabase/migrations/2026-09-19-account-name-capture-and-realtor-home.sql',
  'supabase/migrations/2026-10-07-invitation-acceptance-conflict-targets.sql',
  'supabase/migrations/2026-10-07-cobuyer-compare-garage-parity.sql',
  'supabase/migrations/2026-10-07-onboarding-state.sql',
];

// Production's baseline: schema.sql as it was before the Phase 0 fixes — the
// Realtor-started block never committed, and the original ambiguous conflict
// targets — followed by the migrations production does have.
function driftedProductionBaseline() {
  const schema = read('supabase/schema.sql');
  const cut = schema.indexOf('-- 2026-09-16 Realtor-started client searches');
  assert.ok(cut > 0);
  return schema.slice(0, cut)
    .replaceAll('on conflict on constraint search_members_search_id_user_id_key', 'on conflict(search_id,user_id)')
    .replaceAll('on conflict on constraint search_member_priorities_search_id_user_id_key', 'on conflict(search_id,user_id)');
}
const DRIFTED_STEPS = [
  { sql: 'drop function public.resolve_collaborator_search_context(uuid);' },
  { file: 'supabase/migrations/2026-09-16-my-search-collaborator-display-name.sql' },
  { file: 'supabase/migrations/2026-09-16-realtor-suggestions-homes-select-fix.sql' },
  { file: 'supabase/migrations/2026-09-17-listing-import-z-privileges-hotfix.sql' },
  { file: 'supabase/migrations/2026-09-18-tour-evaluations.sql' },
];

const inventoryQuery = read('supabase/production-migration-inventory.sql').replace(/^--.*$/gm, '').trim().replace(/;$/, '');
const section0Query = read('supabase/cobuyer-journey-production-check.sql')
  .match(/-- 0\. Prerequisites[\s\S]*?\n(select[\s\S]*?);/)[1];

const FINGERPRINT = `
  select 'profiles' as t, md5(string_agg(row(id,onboarding_complete,active_search_id,created_at)::text, '|' order by id)) as h from public.profiles
  union all select 'searches', md5(string_agg(row(id,user_id,priorities,created_at,updated_at)::text,'|' order by id)) from public.searches
  union all select 'search_members', md5(string_agg(row(id,search_id,user_id,role,joined_at)::text,'|' order by id)) from public.search_members
  union all select 'search_member_priorities', md5(string_agg(row(id,search_id,user_id,priorities,updated_at)::text,'|' order by id)) from public.search_member_priorities
  union all select 'homes', md5(string_agg(row(id,user_id,search_id,address,price,beds,garage_spaces,updated_at)::text,'|' order by id)) from public.homes
  union all select 'home_member_state', md5(string_agg(row(id,home_id,user_id,status,checks,ratings,updated_at)::text,'|' order by id)) from public.home_member_state
  union all select 'search_invitations', md5(string_agg(row(id,search_id,invited_by,invited_email,token,status,relationship_type,invitation_direction,expires_at,responded_at)::text,'|' order by id)) from public.search_invitations
  union all select 'realtor_notes', md5(string_agg(row(id,content,updated_at)::text,'|' order by id)) from public.realtor_notes
  union all select 'commute_destinations', md5(string_agg(row(id,label,address)::text,'|' order by id)) from public.commute_destinations
  union all select 'auth.users', md5(string_agg(row(id,email,raw_user_meta_data)::text,'|' order by id)) from auth.users`;

let db;
const ids = {};
before(() => {
  if (!DB_TESTS_ENABLED) return;
  db = createTestDatabase({ schemaSql: driftedProductionBaseline(), steps: DRIFTED_STEPS });
  for (const [key, email] of Object.entries({ ciara: 'ciara@example.com', andrew: 'andrew@example.com', rita: 'rita@example.com', pat: 'pat@example.com', newbie: 'newbie@example.com', client: 'client@example.com' })) {
    ids[key] = db.createUser({ email });
  }
  ids.searchOf = Object.fromEntries(db.admin('select user_id, id from public.searches').map((row) => [row.user_id, row.id]));
  const shared = ids.searchOf[ids.ciara];
  // Existing production data, written before the repair.
  db.exec(`
    update public.profiles set onboarding_complete = true where id in ('${ids.ciara}','${ids.andrew}','${ids.rita}','${ids.pat}');
    -- Andrew: joined Ciara's search; his onboarding preferences landed on his own search (stranded).
    insert into public.search_members(search_id,user_id,role) values ('${shared}','${ids.andrew}','co_buyer'), ('${shared}','${ids.rita}','realtor');
    update public.profiles set active_search_id = '${shared}' where id = '${ids.andrew}';
    insert into public.search_member_priorities(search_id,user_id,priorities) values
      ('${shared}','${ids.ciara}','{"searchType":"purchase","bedsMin":{"value":"3","tier":"must"}}'),
      ('${ids.searchOf[ids.andrew]}','${ids.andrew}','{"searchType":"purchase","bedsMin":{"value":"4","tier":"must"}}');
    insert into public.homes(user_id,search_id,address,price,beds,garage_spaces) values ('${ids.ciara}','${shared}','1 Lake Shore Rd, Grosse Pointe, MI','450000','4','2');
    insert into public.home_member_state(home_id,user_id,status) select id,'${ids.ciara}','Saved' from public.homes;
    insert into public.realtor_notes(search_id,home_id,author_id,author_display_name,content) select search_id,id,'${ids.rita}','Rita','Roof replaced 2021.' from public.homes;
    -- Pending invitations created while production was drifted.
    insert into public.search_invitations(token,search_id,invited_by,invited_email,relationship_type)
      values ('c0000000-0000-4000-8000-000000000001','${shared}','${ids.ciara}','pat@example.com','co_buyer');
    insert into public.search_invitations(token,search_id,invited_by,invited_email,relationship_type,invitation_direction,inviter_display_name)
      values ('c0000000-0000-4000-8000-000000000002',null,'${ids.rita}','newbie@example.com','realtor','realtor_to_buyer','Rita');
  `);
});
after(() => db?.drop());

const fingerprint = () => db.admin(FINGERPRINT);
const inventory = () => Object.fromEntries(db.admin(inventoryQuery).map((row) => [row.migration, row.applied ?? row.evidence]));

dbTest('the reconstructed baseline matches production\'s Section 0 result and reproduces the failure', async () => {
  const [section0] = db.admin(section0Query);
  assert.deepEqual(
    { prospective: section0.has_prospective_searches, link: section0.has_invitation_prospective_link, direction: section0.has_invitation_direction },
    { prospective: false, link: false, direction: true },
  );
  const inv = inventory();
  assert.equal(inv['2026-09-16-realtor-started-searches.sql'], false);
  assert.equal(inv['2026-09-19-account-name-capture-and-realtor-home.sql'], false);
  assert.equal(inv['2026-09-18-tour-evaluations.sql'], true);
  assert.match(inv['FACT: accept_invitation conflict clause'], /ambiguous/);
  assert.equal(inv['FACT: Realtor-started functions present'], 'none');

  // Co-buyer acceptance fails before any membership is written.
  await assert.rejects(acceptInvitation(db.clientFor(ids.pat), 'c0000000-0000-4000-8000-000000000001'), (error) => /ambiguous/.test(error.message));
  assert.deepEqual(db.admin(`select 1 from public.search_members where user_id = '${ids.pat}'`), []);
});

dbTest('applying the October 7 / September 19 SQL out of order fails cleanly and leaves nothing half-applied', () => {
  const before = fingerprint();
  for (const file of ['supabase/migrations/2026-09-19-account-name-capture-and-realtor-home.sql', 'supabase/migrations/2026-10-07-invitation-acceptance-conflict-targets.sql']) {
    const result = db.applyFile(file);
    assert.equal(result.ok, false, `${file} must not apply before its prerequisites`);
    assert.match(result.error, /prospective_searches/);
  }
  assert.deepEqual(fingerprint(), before);
  assert.equal(inventory()['2026-09-19-account-name-capture-and-realtor-home.sql'], false, 'transaction rolled back entirely');
});

dbTest('the repair order applies cleanly and every existing row is unchanged', () => {
  const before = fingerprint();
  for (const file of REPAIR_ORDER) {
    const result = db.applyFile(file);
    assert.equal(result.ok, true, `${file}: ${result.error}`);
  }
  assert.deepEqual(fingerprint(), before);
  const inv = inventory();
  for (const [migration, applied] of Object.entries(inv)) {
    if (!migration.startsWith('FACT')) assert.equal(applied, true, migration);
  }
  assert.equal(inv['FACT: accept_invitation conflict clause'], 'named constraint (fixed)');
  assert.deepEqual(db.admin('select count(*)::int as n from public.search_invitations where prospective_search_id is not null'), [{ n: 0 }]);
});

dbTest('after repair: invitations created during the drift still work, with no data copied', async () => {
  // Ciara's pending co-buyer invitation to Pat.
  const pat = await acceptInvitation(db.clientFor(ids.pat), 'c0000000-0000-4000-8000-000000000001');
  assert.equal(pat.success, true);
  assert.equal(pat.search_id, ids.searchOf[ids.ciara]);
  // Rita's legacy (non-draft) Realtor invitation to a buyer: direct connection path.
  const preview = await previewInvitation(db.clientFor(ids.newbie), 'c0000000-0000-4000-8000-000000000002');
  assert.equal(preview.requires_confirmation, false);
  const newbie = await acceptInvitation(db.clientFor(ids.newbie), 'c0000000-0000-4000-8000-000000000002');
  assert.equal(newbie.success, true);
  assert.deepEqual(db.admin(`select role from public.search_members where search_id = '${ids.searchOf[ids.newbie]}'`), [{ role: 'realtor' }]);
});

dbTest('after repair: the Realtor-started client flow works end to end', async () => {
  const rita = db.clientFor(ids.rita);
  const draft = await createProspectiveSearch(rita, normalizePriorities({ searchType: 'purchase' }), 'New Client');
  const invite = await inviteProspectiveClient(rita, draft.id, 'client@example.com');
  assert.equal((await previewInvitation(db.clientFor(ids.client), invite.token)).requires_confirmation, true);
  const claimed = await claimProspectiveSearch(db.clientFor(ids.client), invite.token, normalizePriorities({ searchType: 'purchase', bedsMin: { value: '2', tier: 'must' } }));
  assert.equal(claimed.success, true);
  assert.equal(claimed.search_id, ids.searchOf[ids.client]);
});

dbTest('after repair: Andrew is routed to set up his own preferences on the shared search; his own search is untouched', async () => {
  const andrew = db.clientFor(ids.andrew);
  const { search, isOwner } = await resolveActiveSearch(andrew, ids.andrew);
  assert.equal(search.id, ids.searchOf[ids.ciara]);
  assert.equal(await needsSharedSearchSetup(andrew, ids.andrew, search, isOwner), true);
  assert.equal((await resolveOnboardingSearch(andrew, ids.andrew)).search.id, ids.searchOf[ids.ciara]);
  assert.deepEqual(
    db.admin(`select search_id, priorities->'bedsMin'->>'value' as beds from public.search_member_priorities where user_id = '${ids.andrew}'`),
    [{ search_id: ids.searchOf[ids.andrew], beds: '4' }],
  );
});

dbTest('after repair: account names (2026-09-19) work again', async () => {
  await updateProfileName(db.clientFor(ids.ciara), ids.ciara, 'Ciara', 'M');
  assert.deepEqual(db.admin(`select first_name, last_name from public.profiles where id = '${ids.ciara}'`), [{ first_name: 'Ciara', last_name: 'M' }]);
});
