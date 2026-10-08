// Production schema drift (inventoried 2026-10-08) and its repair, proven end to end.
//
// Production's inventory (supabase/production-migration-inventory.sql):
//   applied:  realtor-role-foundation, realtor-suggestions (+ homes select fix),
//             realtor-notes-tours-buyer-invitations, listing-import (+ hotfix)
//   missing:  collaborator display-name, realtor-started-searches,
//             people-workspace, tour-evaluations, account-name (09-19),
//             all three 2026-10-07 migrations
//   facts:    ambiguous accept_invitation; no Realtor-started functions; no
//             variable_conflict override; 5-column preview_invitation
// The first inventory reported garage-parity as applied. That was a false
// positive: production's compare projection predates 2026-09-18 and never had
// a retired list, so "Garage not retired" was trivially true. Which pre-09-18
// version it runs is not knowable from the inventory, so every candidate is
// tested here; production-function-fingerprints.sql tells the operator which.
//
// This rebuilds each variant, seeds existing data, proves the old plan's
// hazards, applies the revised order exactly as the SQL Editor does, and
// proves existing data is untouched, every function ends at its newest
// repository version, and every invitation path plus the co-buyer journey and
// Match parity work. See docs/production-schema-drift-repair.md.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { createTestDatabase, DB_TESTS_ENABLED, DB_SKIP_REASON } from './support/supabaseDb.mjs';
import { fingerprintSql } from './support/functionCatalog.mjs';
import { PRIVILEGE_SNAPSHOT, diffSnapshots } from './support/privilegeSnapshot.mjs';
import { normalizePriorities } from '../src/lib/constants.js';
import { computeMatch } from '../src/lib/matching.js';

register('./support/aliasHooks.mjs', import.meta.url);
const {
  acceptInvitation, claimProspectiveSearch, createProspectiveSearch, getHomesForUser, inviteProspectiveClient,
  needsSharedSearchSetup, previewInvitation, resolveActiveSearch, resolveCoBuyerComparePerspectives,
  resolveCollaboratorSearchContext, resolveOnboardingSearch, savePriorities,
} = await import('../src/lib/supabase/collaboration.js');
const { updateProfileName } = await import('../src/lib/supabase/data.js');

const dbTest = (name, fn) => test(name, { skip: DB_TESTS_ENABLED ? false : DB_SKIP_REASON }, fn);
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const M = 'supabase/migrations/';

// The revised repair order. Every file is a repository migration, unmodified.
const REPAIR_ORDER = [
  `${M}2026-09-16-realtor-started-searches.sql`,
  `${M}2026-09-18-people-workspace-draft-select-privileges.sql`,
  `${M}2026-10-08-collaborator-context-return-type.sql`,
  `${M}2026-09-19-account-name-capture-and-realtor-home.sql`,
  `${M}2026-10-07-invitation-acceptance-conflict-targets.sql`,
  `${M}2026-10-07-cobuyer-compare-garage-parity.sql`,
  `${M}2026-10-07-onboarding-state.sql`,
];
// Never applied to production: superseded, and harmful out of order.
const SUPERSEDED = [
  `${M}2026-09-16-map-collaborator-places.sql`,
  `${M}2026-09-16-my-search-collaborator-display-name.sql`,
  `${M}2026-09-18-tour-evaluations.sql`,
];

// The pre-2026-09-18 compare projections production could be running.
const COMPARE_CANDIDATES = [
  `${M}2026-09-08-secure-compare-perspectives.sql`,
  `${M}2026-09-09-rental-v1-shared-facts.sql`,
  `${M}2026-09-16-realtor-role-foundation.sql`,
];

function functionDefinition(file, name) {
  const sql = read(file);
  const start = sql.indexOf(`create or replace function public.${name}(`);
  assert.ok(start >= 0, `${name} in ${file}`);
  const end = sql.indexOf('$$;', start) + 3;
  return sql.slice(start, end);
}

// Production's baseline: schema.sql before the Phase 0 fixes (Realtor-started
// block never committed, original ambiguous conflict targets) with the
// compare projection set to one candidate pre-2026-09-18 version.
function productionBaseline(compareFile) {
  const schema = read('supabase/schema.sql');
  const cut = schema.indexOf('-- 2026-09-16 Realtor-started client searches');
  return `${schema.slice(0, cut)
    .replaceAll('on conflict on constraint search_members_search_id_user_id_key', 'on conflict(search_id,user_id)')
    .replaceAll('on conflict on constraint search_member_priorities_search_id_user_id_key', 'on conflict(search_id,user_id)')}
${functionDefinition(compareFile, 'resolve_cobuyer_compare_perspectives')}
`;
}

const stripComments = (sql) => sql.replace(/^\s*--.*$/gm, '').trim().replace(/;\s*$/, '');
const INVENTORY = stripComments(read('supabase/production-migration-inventory.sql'));
const FINGERPRINTS = stripComments(read('supabase/production-function-fingerprints.sql'));
const PREFLIGHT = stripComments(read('supabase/production-repair-preflight.sql'));
const SECTION_0 = read('supabase/cobuyer-journey-production-check.sql').match(/-- 0\. Prerequisites[\s\S]*?\n(select[\s\S]*?);/)[1];

const FINGERPRINT_DATA = `
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

// Exactly what production reported, with the corrected garage-parity check.
const PRODUCTION_INVENTORY = {
  '2026-09-16-realtor-role-foundation.sql': true,
  '2026-09-16-realtor-suggestions.sql': true,
  '2026-09-16-realtor-suggestions-homes-select-fix.sql': true,
  '2026-09-16-realtor-notes-tours-buyer-invitations.sql': true,
  '2026-09-16-map-collaborator-places.sql / my-search-collaborator-display-name.sql': false,
  '2026-09-16-realtor-started-searches.sql': false,
  '2026-09-17-listing-import-provenance.sql': true,
  '2026-09-17-listing-import-z-privileges-hotfix.sql': true,
  '2026-09-18-people-workspace-draft-select-privileges.sql': false,
  '2026-09-18-tour-evaluations.sql': false,
  '2026-09-19-account-name-capture-and-realtor-home.sql': false,
  '2026-10-07-invitation-acceptance-conflict-targets.sql': false,
  '2026-10-07-cobuyer-compare-garage-parity.sql': false,
  '2026-10-07-onboarding-state.sql': false,
};

// After the repair, the newest repository definition of every function.
const EXPECTED_AFTER = {
  accept_invitation: '2026-10-07-invitation-acceptance-conflict-targets.sql',
  claim_prospective_search: '2026-10-07-invitation-acceptance-conflict-targets.sql',
  create_buyer_invitation: '2026-09-16-realtor-started-searches.sql',
  create_prospective_search: '2026-09-16-realtor-started-searches.sql',
  create_realtor_connection_request: '2026-09-19-account-name-capture-and-realtor-home.sql',
  create_realtor_suggestion: '2026-09-19-account-name-capture-and-realtor-home.sql',
  get_realtor_client_roster: '2026-09-19-account-name-capture-and-realtor-home.sql',
  handle_new_user: '2026-09-19-account-name-capture-and-realtor-home.sql',
  invite_prospective_client: '2026-09-19-account-name-capture-and-realtor-home.sql',
  preview_invitation: '2026-09-19-account-name-capture-and-realtor-home.sql',
  resolve_cobuyer_compare_perspectives: '2026-10-07-cobuyer-compare-garage-parity.sql',
  resolve_collaborator_search_context: '2026-09-19-account-name-capture-and-realtor-home.sql',
  resolve_display_name: '2026-09-19-account-name-capture-and-realtor-home.sql',
  save_realtor_note: '2026-09-19-account-name-capture-and-realtor-home.sql',
  suggest_home_tour: '2026-09-19-account-name-capture-and-realtor-home.sql',
};

// Every access-controlled object the repair adds; nothing else may appear.
const EXPECTED_NEW_ACCESS_OBJECTS = [
  'column profiles.first_name', 'column profiles.last_name', 'column profiles.onboarding_state', 'column profiles.onboarding_version',
  'column prospective_searches.client_name', 'column prospective_searches.created_at', 'column prospective_searches.draft_priorities',
  'column prospective_searches.id', 'column prospective_searches.invited_email', 'column prospective_searches.started_by',
  'column prospective_searches.status', 'column prospective_searches.updated_at', 'column search_invitations.prospective_search_id',
  'function claim_prospective_search', 'function create_prospective_search', 'function create_realtor_connection_request',
  'function invite_prospective_client', 'function resolve_display_name',
  'policy prospective_searches.prospective_searches_owner_select', 'policy prospective_searches.prospective_searches_owner_update',
  'table prospective_searches',
];

function seed(db) {
  const ids = {};
  for (const [key, email] of Object.entries({ ciara: 'ciara@example.com', andrew: 'andrew@example.com', rita: 'rita@example.com', pat: 'pat@example.com', newbie: 'newbie@example.com', client: 'client@example.com' })) {
    ids[key] = db.createUser({ email });
  }
  ids.searchOf = Object.fromEntries(db.admin('select user_id, id from public.searches').map((row) => [row.user_id, row.id]));
  const shared = ids.searchOf[ids.ciara];
  db.exec(`
    update public.profiles set onboarding_complete = true where id in ('${ids.ciara}','${ids.andrew}','${ids.rita}','${ids.pat}');
    insert into public.search_members(search_id,user_id,role) values ('${shared}','${ids.andrew}','co_buyer'), ('${shared}','${ids.rita}','realtor');
    update public.profiles set active_search_id = '${shared}' where id = '${ids.andrew}';
    insert into public.search_member_priorities(search_id,user_id,priorities) values
      ('${shared}','${ids.ciara}','{"searchType":"purchase","bedsMin":{"value":"3","tier":"must"}}'),
      ('${ids.searchOf[ids.andrew]}','${ids.andrew}','{"searchType":"purchase","bedsMin":{"value":"4","tier":"must"}}');
    insert into public.homes(user_id,search_id,address,price,beds,garage_spaces) values ('${ids.ciara}','${shared}','1 Lake Shore Rd, Grosse Pointe, MI','450000','4','0');
    insert into public.home_member_state(home_id,user_id,status) select id,'${ids.ciara}','Saved' from public.homes;
    insert into public.realtor_notes(search_id,home_id,author_id,author_display_name,content) select search_id,id,'${ids.rita}','Rita','Roof replaced 2021.' from public.homes;
    insert into public.commute_destinations(search_id,user_id,label,address) values ('${shared}','${ids.ciara}','Work','1 Office Way');
    insert into public.search_invitations(token,search_id,invited_by,invited_email,relationship_type)
      values ('c0000000-0000-4000-8000-000000000001','${ids.searchOf[ids.newbie]}','${ids.newbie}','pat@example.com','co_buyer');
    insert into public.search_invitations(token,search_id,invited_by,invited_email,relationship_type,invitation_direction,inviter_display_name)
      values ('c0000000-0000-4000-8000-000000000002',null,'${ids.rita}','newbie@example.com','realtor','realtor_to_buyer','Rita');
  `);
  return ids;
}

const inventoryOf = (db) => Object.fromEntries(db.admin(INVENTORY).map((row) => [row.migration, row.applied ?? row.evidence]));
const fingerprintsOf = (db) => Object.fromEntries(db.admin(FINGERPRINTS).map((row) => [row.name, row.production_matches]));
const migrationRows = (inventory) => Object.fromEntries(Object.entries(inventory).filter(([key]) => !key.startsWith('FACT')));

const databases = [];
after(() => databases.forEach((db) => db.drop()));

test('the preflight checks every homes column the newest compare projection reads', () => {
  const body = read(`${M}2026-10-07-cobuyer-compare-garage-parity.sql`);
  const preflight = read('supabase/production-repair-preflight.sql');
  for (const column of new Set([...body.matchAll(/v_home\.([a-z_]+)/g)].map((match) => match[1]))) {
    if (['id', 'user_id', 'search_id'].includes(column)) continue;
    assert.match(preflight, new RegExp(`\\('homes','${column}'\\)`), column);
  }
});

test('production-function-fingerprints.sql is generated from the current repository', () => {
  assert.equal(read('supabase/production-function-fingerprints.sql'), fingerprintSql());
});

for (const compareFile of COMPARE_CANDIDATES) {
  const variant = compareFile.replace(M, '');

  dbTest(`[compare = ${variant}] reproduces production's exact inventory, then the revised order repairs it`, async () => {
    const db = createTestDatabase({ schemaSql: productionBaseline(compareFile), steps: [] });
    databases.push(db);
    const ids = seed(db);

    // 1. Same state as production.
    const before = inventoryOf(db);
    assert.deepEqual(migrationRows(before), { ...PRODUCTION_INVENTORY, '2026-09-16-realtor-search-view.sql': true });
    assert.match(before['FACT: accept_invitation conflict clause'], /ambiguous/);
    assert.equal(before['FACT: Realtor-started functions present'], 'none');
    assert.equal(before['FACT: plpgsql.variable_conflict overrides'], 'none');
    assert.equal(before['FACT: preview_invitation returns'], 'TABLE(valid boolean, reason text, relationship_type text, invitation_direction text, inviter_display_name text)');
    const [section0] = db.admin(SECTION_0);
    assert.equal(section0.has_prospective_searches, false);
    assert.equal(section0.has_invitation_prospective_link, false);
    assert.equal(section0.has_invitation_direction, true);
    // The first inventory's garage-parity check reported "applied" here.
    assert.deepEqual(db.admin(`select prosrc not like '%''exterior:Garage''%' as old_check from pg_proc where proname = 'resolve_cobuyer_compare_perspectives'`), [{ old_check: true }]);
    assert.match(fingerprintsOf(db).resolve_cobuyer_compare_perspectives, new RegExp(variant.replace(/[.]/g, '\\.')));
    assert.deepEqual(db.admin(PREFLIGHT).filter((row) => !row.ok), [], 'preflight: all prerequisites present');
    await assert.rejects(acceptInvitation(db.clientFor(ids.pat), 'c0000000-0000-4000-8000-000000000001'), (error) => /ambiguous/.test(error.message));

    // 2. The original plan's hazards: each fails and rolls back completely.
    const data = db.admin(FINGERPRINT_DATA);
    for (const [file, why] of [
      [`${M}2026-09-16-my-search-collaborator-display-name.sql`, /cannot change return type/],
      [`${M}2026-09-19-account-name-capture-and-realtor-home.sql`, /prospective_searches|cannot change return type/],
      [`${M}2026-10-07-invitation-acceptance-conflict-targets.sql`, /prospective_searches/],
    ]) {
      const result = db.applyFile(file);
      assert.equal(result.ok, false, file);
      assert.match(result.error, why, file);
    }
    assert.deepEqual(migrationRows(inventoryOf(db)), migrationRows(before), 'nothing half-applied');
    assert.deepEqual(db.admin(FINGERPRINT_DATA), data);

    // 3. The revised order: every file applies, every existing row unchanged.
    const privilegesBefore = db.admin(PRIVILEGE_SNAPSHOT);
    for (const file of REPAIR_ORDER) {
      const result = db.applyFile(file);
      assert.equal(result.ok, true, `${file}: ${result.error}`);
    }
    assert.deepEqual(db.admin(FINGERPRINT_DATA), data);
    // Permissions: nothing that existed before is changed or removed; the only
    // additions are the new objects the repair is meant to create.
    const privileges = diffSnapshots(privilegesBefore, db.admin(PRIVILEGE_SNAPSHOT));
    assert.deepEqual(privileges.removed, []);
    assert.deepEqual(privileges.changed, []);
    assert.deepEqual(privileges.added.map((entry) => entry.replace(/\(.*$/, '')), EXPECTED_NEW_ACCESS_OBJECTS);
    const repaired = inventoryOf(db);
    for (const [migration, applied] of Object.entries(migrationRows(repaired))) assert.equal(applied, true, migration);
    assert.equal(repaired['FACT: accept_invitation conflict clause'], 'named constraint (fixed)');
    const versions = fingerprintsOf(db);
    for (const [name, file] of Object.entries(EXPECTED_AFTER)) {
      assert.ok(versions[name].includes(file), `${name} should run ${file}, runs ${versions[name]}`);
    }

    // Replaying the bridge later (e.g. a filename-order replay) changes nothing.
    assert.equal(db.applyFile(`${M}2026-10-08-collaborator-context-return-type.sql`).ok, true);
    assert.ok(fingerprintsOf(db).resolve_collaborator_search_context.includes('2026-09-19-account-name-capture-and-realtor-home.sql'));

    // 4. Everything works. (Pat joins a different household: V1 supports one co-buyer per search.)
    assert.equal((await acceptInvitation(db.clientFor(ids.pat), 'c0000000-0000-4000-8000-000000000001')).success, true);
    assert.equal((await previewInvitation(db.clientFor(ids.newbie), 'c0000000-0000-4000-8000-000000000002')).requires_confirmation, false);
    assert.equal((await acceptInvitation(db.clientFor(ids.newbie), 'c0000000-0000-4000-8000-000000000002')).success, true);
    const rita = db.clientFor(ids.rita);
    const draft = await createProspectiveSearch(rita, normalizePriorities({ searchType: 'purchase' }), 'New Client');
    const invite = await inviteProspectiveClient(rita, draft.id, 'client@example.com');
    assert.equal((await claimProspectiveSearch(db.clientFor(ids.client), invite.token, normalizePriorities({ searchType: 'purchase' }))).success, true);
    await updateProfileName(db.clientFor(ids.ciara), ids.ciara, 'Ciara', 'M');

    // Andrew: routed to set up his own preferences on the shared search; his own search untouched.
    const andrew = db.clientFor(ids.andrew);
    const { search, isOwner } = await resolveActiveSearch(andrew, ids.andrew);
    assert.equal(await needsSharedSearchSetup(andrew, ids.andrew, search, isOwner), true);
    assert.equal((await resolveOnboardingSearch(andrew, ids.andrew)).search.id, ids.searchOf[ids.ciara]);
    assert.equal(db.admin(`select priorities->'bedsMin'->>'value' as beds from public.search_member_priorities where user_id = '${ids.andrew}' and search_id = '${ids.searchOf[ids.andrew]}'`)[0].beds, '4');
    // Ciara's My Search shows Andrew by name (the bridged 4-column context).
    assert.equal((await resolveCollaboratorSearchContext(db.clientFor(ids.ciara), { id: ids.searchOf[ids.ciara] })).displayName, 'Andrew');

    // Newest compare behavior: once Andrew sets up a Garage Must Have, his Match
    // is the same from both sides (the parity fix), not the pre-09-18 scoring.
    const garageMust = normalizePriorities({ searchType: 'purchase' });
    garageMust.exterior = { ...garageMust.exterior, customItems: [{ label: 'Garage', kind: 'check' }], tiers: { Garage: 'must' }, order: ['Garage'] };
    await savePriorities(andrew, search, ids.andrew, garageMust);
    const [home] = await getHomesForUser(andrew, ids.andrew, search.id);
    const own = computeMatch(home, garageMust);
    assert.equal(own.pct, 0, 'no garage: the Must Have is a confirmed miss');
    const projected = await resolveCoBuyerComparePerspectives(db.clientFor(ids.ciara), search, [home.id]);
    assert.equal(projected.get(home.id).match.pct, own.pct);
  });
}

dbTest('tour-evaluations.sql must never be applied after the repair: it would silently re-retire Garage', async () => {
  const db = databases[databases.length - 1];
  const garageRetired = () => db.admin(`select prosrc like '%''exterior:Garage''%' as retired from pg_proc where proname = 'resolve_cobuyer_compare_perspectives'`)[0].retired;
  assert.equal(garageRetired(), false);
  assert.equal(db.applyFile(SUPERSEDED[2]).ok, true);
  assert.equal(garageRetired(), true, 'an older file overwrote the newer behavior');
  assert.equal(inventoryOf(db)['2026-10-07-cobuyer-compare-garage-parity.sql'], false, 'the corrected inventory catches the regression');
});
