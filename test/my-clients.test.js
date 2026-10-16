// My Clients: card grouping, duplicate flags (never merges), the proposed
// criteria form, and the source-level privacy rules of the UI.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

register('./support/aliasHooks.mjs', import.meta.url);
const {
  buildClientCards, buyerSearchSummary, criteriaSummary, draftFromForm, formFromRecord, parseLocations, recordFromRow, validateForm, wishlistLabels,
} = await import('../src/lib/clientRecords.js');

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const record = (overrides) => recordFromRow({ id: overrides.id, client_name: null, status: 'draft', draft_priorities: {}, preferred_locations: [], created_at: '2026-10-01', ...overrides });
const relationship = (id, names, extra = {}) => ({ id, user_id: `${id}-owner`, people: names.map((display_name) => ({ display_name })), activeCount: 2, wantToTourCount: 1, ...extra });

test('one card per connected search, however many private records point at it; disconnected records keep only the Realtor’s own data', () => {
  const records = [
    record({ id: 'a', client_name: 'Olive', status: 'connected', search_id: 's1', notes: 'first', created_at: '2026-10-01' }),
    record({ id: 'b', client_name: 'Olive again', status: 'connected', search_id: 's1', created_at: '2026-10-05' }),
    record({ id: 'c', client_name: 'Former', status: 'connected', search_id: 's-gone', notes: 'kept' }),
    record({ id: 'd', client_name: 'Jamie', status: 'draft' }),
    record({ id: 'e', client_name: 'Pat', status: 'invited', invited_email: 'pat@example.com' }),
  ];
  const { connected, prospective, disconnected } = buildClientCards({ records, relationships: [relationship('s1', ['Olive', 'Casey']), relationship('s2', ['Blair'])] });
  assert.deepEqual(connected.map((card) => [card.searchId, card.record?.id || null, card.extraRecords.map((r) => r.id), card.flags]), [
    ['s1', 'a', ['b'], ['multiple_records']],
    ['s2', null, [], []],
  ]);
  assert.deepEqual(disconnected.map((card) => card.record.id), ['c']);
  assert.deepEqual(prospective.map((card) => card.record.id), ['d', 'e']);
});

test('possible duplicates are flagged for the Realtor to reconcile, never merged or linked', () => {
  const records = [
    record({ id: 'p1', client_name: 'Casey Lee', contact_email: 'casey@example.com' }),
    record({ id: 'p2', client_name: 'C. Lee', invited_email: 'CASEY@example.com', status: 'invited' }),
    record({ id: 'p3', client_name: 'Blair' }),
  ];
  const { connected, prospective } = buildClientCards({ records, relationships: [relationship('s1', ['Blair'])] });
  const byId = Object.fromEntries(prospective.map((card) => [card.record.id, card]));
  assert.deepEqual(byId.p1.flags, ['same_email']);
  assert.deepEqual(byId.p2.flags, ['same_email']);
  assert.deepEqual([byId.p3.flags, byId.p3.possibleMatch], [['name_matches_connected'], 'Blair']);
  // Still three separate prospective records, and the connected card has none linked.
  assert.equal(prospective.length, 3);
  assert.equal(connected[0].record, null);
  assert.ok(prospective.every((card) => card.record.searchId === null));
});

test('a connected card summarizes the buyers’ own preferences: owner first, areas from every buyer', () => {
  const rows = [
    { user_id: 'co', priorities: { searchType: 'purchase', budget: { value: '1' }, searchAreas: [{ placeId: 'p2', name: 'Hoboken', type: 'city' }] } },
    { user_id: 'owner', priorities: { searchType: 'purchase', budget: { value: '650000' }, bedsMin: { value: '3' }, searchAreas: [{ placeId: 'p1', name: 'Montclair', type: 'city' }] } },
  ];
  assert.deepEqual(buyerSearchSummary(rows, 'owner'), { criteria: ['Up to $650,000', '3+ beds'], areas: ['Montclair', 'Hoboken'] });
  assert.deepEqual(buyerSearchSummary([], 'owner'), { criteria: [], areas: [] });
  assert.deepEqual(criteriaSummary({ searchType: 'rental', budget: { value: '2800' }, bathsMin: { value: '1' } }), ['Up to $2,800/mo', '1+ baths']);
});

test('the form round-trips the proposed criteria in the shape buyers use, and keeps criteria it does not show', () => {
  const form = { ...formFromRecord(null), name: 'Jamie', budget: '$600,000', beds: '3', baths: '2', locations: 'Maplewood, South Orange, maplewood', wishlist: [] };
  const draft = draftFromForm(form);
  assert.deepEqual([draft.searchType, draft.onboardingSearchType, draft.budget.value, draft.bedsMin.value, draft.bathsMin.value], ['purchase', 'home_buy', '600000', '3', '2']);
  assert.deepEqual(parseLocations(form.locations), ['Maplewood', 'South Orange']);

  const withWish = draftFromForm({ ...form, wishlist: [formFromRecord(null).wishlist[0] || 'features:Central Air'].filter(Boolean) });
  const back = formFromRecord({ draftPriorities: withWish });
  assert.equal(back.budget, '600000');
  assert.ok(wishlistLabels(withWish).length <= 6);

  // A criterion edited in the full setup flow (sqft) survives a quick edit here.
  const fuller = { ...draft, sqftTarget: { value: '1800', tier: 'important' } };
  assert.equal(draftFromForm(formFromRecord({ draftPriorities: fuller }), fuller).sqftTarget.value, '1800');
});

test('only a name is required, and only for a prospective client', () => {
  const blank = formFromRecord(null);
  assert.deepEqual(Object.keys(validateForm(blank)), ['name']);
  assert.deepEqual(validateForm(blank, { connected: true }), {});
  assert.deepEqual(Object.keys(validateForm({ ...blank, name: 'Sam', contactEmail: 'nope' })), ['contactEmail']);
});

test('the UI never edits buyer data or ships buyer documents to the browser', () => {
  const page = read('src/app/(app)/people/page.js');
  // Buyer preference documents are reduced on the server; only summaries reach the cards.
  assert.match(page, /buyerSearchSummary\(priorities\.filter/);
  assert.doesNotMatch(page, /'use client'/);
  const form = read('src/components/ClientRecordForm.jsx');
  // Connected records save the Realtor's own details only — never criteria.
  assert.match(form, /if \(connected\) \{\n\s+if \(!id\) id = await openConnectedClientRecord\(supabase, connectedSearchId\);\n\s+await updateClientRecord\(supabase, id, details\);/);
  assert.doesNotMatch(form, /savePriorities|search_member_priorities|home_member_state/);
  for (const file of ['src/components/ClientRecordView.jsx', 'src/components/ClientPrivateNotes.jsx', 'src/components/AddClient.jsx']) {
    assert.doesNotMatch(read(file), /savePriorities|search_member_priorities|home_member_state|localStorage|sessionStorage/, file);
  }
  // The record page decides "still connected" from live membership on every request.
  assert.match(read('src/app/(app)/people/clients/[id]/page.js'), /from\('search_members'\)\.select\('search_id'\)\.eq\('search_id', record\.searchId\)\.eq\('user_id', user\.id\)\.eq\('role', 'realtor'\)/);
});

test('claiming keeps a buyer’s existing priorities and names the search before confirming', () => {
  const confirm = read('src/app/invite/[token]/confirm/page.js');
  assert.match(confirm, /getRealtorConnectionTarget\(supabase\)/);
  assert.match(confirm, /if \(!target\.searchId\) redirect\(`\/invite\/\$\{token\}`\)/);
  assert.match(confirm, /if \(existing\) return <KeepPrioritiesClaim/);
  assert.match(read('src/app/invite/[token]/confirm/KeepPrioritiesClaim.jsx'), /claimProspectiveSearch\(createClient\(\), token, null, searchId\)/);
  assert.match(read('src/components/ClientSearchSetup.jsx'), /claimProspectiveSearch\(supabase, token, finalPriorities\(\), targetSearchId\)/);
  const invitePage = read('src/app/invite/[token]/page.js');
  assert.match(invitePage, /preview\.valid && preview\.invitation_direction === 'realtor_to_buyer'\n/);
});
