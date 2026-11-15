// Real Postgres: priorities written by the desktop priority board persist
// through the existing save path, are byte-for-byte what the phone screens
// write for the same choices, stay each co-buyer's own, and score identically
// in computeMatch (JS) and the SQL Compare scorer — including features moved
// back to the library (never scored), Unknown answers (never a miss), the
// house Garage chip, and apartment Garage Parking. docs/desktop-priority-board.md.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { createTestDatabase, DB_TESTS_ENABLED, DB_SKIP_REASON } from './support/supabaseDb.mjs';

register('./support/aliasHooks.mjs', import.meta.url);
const { computeMatch } = await import('../src/lib/matching.js');
const { normalizePriorities } = await import('../src/lib/constants.js');
const { chooseSearchType } = await import('../src/lib/onboardingBasics.js');
const { criterionAnswerPatch } = await import('../src/lib/matchCriteria.js');
const { addOwnFeature, setFeatureLevel, setGarageImportance, switchPrioritySearchType } = await import('../src/lib/priorityCategories.js');
const { BOARD_HOUSE_GARAGE, advanceBoard, placeOnBoard, priorityBoard } = await import('../src/lib/priorityBoard.js');
const { beginOnboarding } = await import('../src/lib/onboardingFlow.js');
const {
  acceptInvitation, createInvitation, getHomesForUser, resolveCoBuyerComparePerspectives, resolvePriorities, savePriorities, saveHomePersonalState,
} = await import('../src/lib/supabase/collaboration.js');
const { saveOnboardingProgress } = await import('../src/lib/supabase/data.js');

const dbTest = (name, fn) => test(name, { skip: DB_TESTS_ENABLED ? false : DB_SKIP_REASON }, fn);
const feature = (doc, text) => {
  const board = priorityBoard(doc);
  return [...board.groups.flatMap((group) => [...group.features, ...(group.lotChip ? [group.lotChip] : [])]), ...Object.values(board.columns).flat()].find((entry) => entry.text === text);
};
const insertHome = async (client, row) => {
  const { data, error } = await client.from('homes').insert(row).select('id').single();
  if (error) throw new Error(`insert failed: ${error.message}`);
  return data.id;
};
const fresh = (type) => {
  const p = chooseSearchType(normalizePriorities({}), type, { presetPropertyType: false });
  return { ...p, budget: { ...p.budget, value: type === 'home_buy' ? '400000' : '2500' } };
};

let db;
const ids = {};
before(async () => {
  if (!DB_TESTS_ENABLED) return;
  db = createTestDatabase();
  ids.owner = db.createUser({ email: 'owner.board@example.com', firstName: 'Ciara' });
  ids.coBuyer = db.createUser({ email: 'cobuyer.board@example.com', firstName: 'Andrew' });
  ids.search = db.admin(`select id from public.searches where user_id = '${ids.owner}'`)[0].id;
  const invitation = await createInvitation(db.clientFor(ids.owner), ids.search, ids.owner, 'cobuyer.board@example.com', 'co_buyer');
  assert.equal((await acceptInvitation(db.clientFor(ids.coBuyer), invitation.token)).success, true);
});
after(() => db?.drop());

dbTest('board-written priorities equal the phone’s, round-trip unchanged, stay per buyer, and JS = SQL at every step', async () => {
  const owner = db.clientFor(ids.owner);
  const coBuyer = db.clientFor(ids.coBuyer);

  // Owner on the desktop board: drag, move between columns, remove, add their own, rank the garage.
  let board = fresh('home_buy');
  board = placeOnBoard(board, feature(board, 'Countertop Seating'), 'must');
  board = placeOnBoard(board, feature(board, 'Kitchen Island'), 'nice');
  board = placeOnBoard(board, feature(board, 'Kitchen Island'), 'important');
  board = placeOnBoard(board, feature(board, 'Soaking Tub'), 'nice');
  board = placeOnBoard(board, feature(board, 'Soaking Tub'), 'none');
  board = placeOnBoard(board, BOARD_HOUSE_GARAGE, 'important');
  const own = addOwnFeature(board, 'kitchen', 'Pot filler');
  board = placeOnBoard(own.priorities, own.feature, 'nice');

  // The same choices on the phone screens.
  let phone = fresh('home_buy');
  phone = setFeatureLevel(phone, { categoryKey: 'features', label: 'Countertop Seating', custom: true, group: 'kitchen' }, 'must');
  phone = setFeatureLevel(phone, { categoryKey: 'features', label: 'Kitchen Island', custom: false }, 'nice');
  phone = setFeatureLevel(phone, { categoryKey: 'features', label: 'Kitchen Island', custom: false }, 'important');
  phone = setFeatureLevel(phone, { categoryKey: 'features', label: 'Soaking Tub', custom: false }, 'nice');
  phone = setFeatureLevel(phone, { categoryKey: 'features', label: 'Soaking Tub', custom: false }, 'none');
  phone = setGarageImportance(phone, 'important');
  const phoneOwn = addOwnFeature(phone, 'kitchen', 'Pot filler');
  phone = setFeatureLevel(phoneOwn.priorities, phoneOwn.feature, 'nice');
  assert.deepEqual(normalizePriorities(board), normalizePriorities(phone), 'one document, whichever screen wrote it');

  // Co-buyer on a phone: their own, different levels.
  let theirs = fresh('home_buy');
  theirs = setFeatureLevel(theirs, { categoryKey: 'features', label: 'Soaking Tub', custom: false }, 'must');
  theirs = setGarageImportance(theirs, 'not_important');

  await savePriorities(owner, { id: ids.search }, ids.owner, board);
  await savePriorities(coBuyer, { id: ids.search }, ids.coBuyer, theirs);
  const ownerStored = normalizePriorities(await resolvePriorities(owner, { id: ids.search }, ids.owner));
  const coBuyerStored = normalizePriorities(await resolvePriorities(coBuyer, { id: ids.search }, ids.coBuyer));
  assert.deepEqual(ownerStored, normalizePriorities(board), 'reads back exactly');
  assert.deepEqual(coBuyerStored, normalizePriorities(theirs), 'the co-buyer’s document is their own');
  assert.deepEqual(Object.fromEntries(Object.entries(priorityBoard(ownerStored).columns).map(([tier, items]) => [tier, items.map((item) => item.text)])),
    { must: ['Countertop Seating'], important: ['Kitchen Island', 'Garage'], nice: ['Pot filler'] });

  const homeIds = {};
  for (const [name, garageSpaces] of [['noGarage', '0'], ['garage', '2'], ['unknown', '']]) {
    homeIds[name] = await insertHome(owner, { user_id: ids.owner, search_id: ids.search, address: `${name} Board Ln, Royal Oak, MI 48073`, price: '350000', garage_spaces: garageSpaces });
  }
  const both = async (subject, viewer) => {
    const priorities = normalizePriorities(await resolvePriorities(db.clientFor(subject), { id: ids.search }, subject));
    const homes = await getHomesForUser(db.clientFor(subject), subject, ids.search);
    const projected = await resolveCoBuyerComparePerspectives(db.clientFor(viewer), { id: ids.search }, Object.values(homeIds));
    const out = {};
    for (const [name, id] of Object.entries(homeIds)) {
      const mine = computeMatch(homes.find((home) => home.id === id), priorities);
      const seen = projected.get(id).match;
      assert.deepEqual([seen.pct, seen.selectedCount, seen.evaluatedCount], [mine.pct, mine.selectedCount, mine.evaluatedCount], `JS = SQL on ${name}`);
      out[name] = mine;
    }
    return out;
  };
  let ownerMatch = await both(ids.owner, ids.coBuyer);
  const item = (match, key) => match.allSelected.find((entry) => entry.key === key);
  assert.equal(item(ownerMatch.unknown, 'exterior:Garage').evaluated, false, 'unknown garage: never a miss');
  assert.deepEqual([item(ownerMatch.noGarage, 'exterior:Garage').met, item(ownerMatch.garage, 'exterior:Garage').met], [false, true]);
  assert.equal(item(ownerMatch.garage, 'features:Soaking Tub'), undefined, 'moved back to the library: not part of Match');
  assert.equal(item(ownerMatch.garage, 'features:Countertop Seating').evaluated, false, 'own Yes/No unanswered: Unknown');
  const coBuyerMatch = await both(ids.coBuyer, ids.owner);
  assert.equal(item(coBuyerMatch.noGarage, 'exterior:Garage'), undefined, 'the co-buyer’s Not important never marks a home down');

  // Owner answers their Must Have No on one home: a miss for them only.
  const [home] = await getHomesForUser(owner, ids.owner, ids.search, { homeId: homeIds.garage });
  await saveHomePersonalState(owner, { ...home, ...criterionAnswerPatch(home, 'features:Countertop Seating', 'no', ownerStored.searchType).personal }, ids.owner, ids.search);
  ownerMatch = await both(ids.owner, ids.coBuyer);
  assert.equal(item(ownerMatch.garage, 'features:Countertop Seating').met, false);
  assert.deepEqual((await both(ids.coBuyer, ids.owner)).garage.pct, coBuyerMatch.garage.pct, 'the owner’s answer is not the co-buyer’s');

  // Finishing the board stores ordinary flow-4 progress and leaves priorities alone.
  const begun = beginOnboarding({ context: { searchId: ids.search, role: 'owner' }, targetVersion: 4 }).state;
  const progress = advanceBoard(4, { ...begun, step: 'cat_layout', answers: { searchType: 'home_buy' } }).state;
  assert.equal(await saveOnboardingProgress(owner, ids.owner, { version: 4, state: progress }), true);
  const [row] = db.admin(`select onboarding_state from public.profiles where id = '${ids.owner}'`);
  assert.equal(row.onboarding_state.step, 'review');
  assert.deepEqual(normalizePriorities(await resolvePriorities(owner, { id: ids.search }, ids.owner)), ownerStored);
});

dbTest('apartment Garage Parking from the board: scored once, JS = SQL; the held house Garage is invisible to both', async () => {
  const a = db.createUser({ email: 'board.apt.a@example.com', firstName: 'Apt' });
  const b = db.createUser({ email: 'board.apt.b@example.com', firstName: 'Mate' });
  const search = db.admin(`select id from public.searches where user_id = '${a}'`)[0].id;
  const invitation = await createInvitation(db.clientFor(a), search, a, 'board.apt.b@example.com', 'co_buyer');
  assert.equal((await acceptInvitation(db.clientFor(b), invitation.token)).success, true);

  // A ranked a house Garage, switched to an apartment, then ranked Garage Parking on the board.
  let aDoc = placeOnBoard(fresh('home_buy'), BOARD_HOUSE_GARAGE, 'must');
  aDoc = switchPrioritySearchType(aDoc, 'apartment_rent').priorities;
  aDoc = { ...aDoc, budget: { ...aDoc.budget, value: '2500' } };
  aDoc = placeOnBoard(aDoc, feature(aDoc, 'Garage Parking'), 'nice');
  aDoc = placeOnBoard(aDoc, feature(aDoc, 'In-Unit Laundry'), 'important');
  assert.deepEqual(aDoc.exterior.heldGarage, { house: { tier: 'must' } });
  const bDoc = placeOnBoard(fresh('apartment_rent'), feature(fresh('apartment_rent'), 'Fitness Center'), 'must');
  await savePriorities(db.clientFor(a), { id: search }, a, aDoc);
  await savePriorities(db.clientFor(b), { id: search }, b, bDoc);

  const homeIds = [];
  for (const [n, spaces] of [['1', '1'], ['2', '0'], ['3', '']]) {
    homeIds.push(await insertHome(db.clientFor(a), { user_id: a, search_id: search, address: `${n} Board Apt, Royal Oak, MI 48073`, price: '2400', garage_spaces: spaces }));
  }
  const check = async (doc) => {
    await savePriorities(db.clientFor(a), { id: search }, a, doc);
    const priorities = normalizePriorities(await resolvePriorities(db.clientFor(a), { id: search }, a));
    const homes = await getHomesForUser(db.clientFor(a), a, search);
    const projected = await resolveCoBuyerComparePerspectives(db.clientFor(b), { id: search }, homeIds);
    return homeIds.map((id) => {
      const mine = computeMatch(homes.find((home) => home.id === id), priorities);
      const seen = projected.get(id).match;
      assert.deepEqual([seen.pct, seen.selectedCount, seen.evaluatedCount], [mine.pct, mine.selectedCount, mine.evaluatedCount], 'JS = SQL');
      assert.equal(mine.allSelected.filter((entry) => entry.key === 'exterior:Garage').length, 1, 'Garage Parking scored once');
      return [mine.pct, mine.selectedCount, mine.evaluatedCount];
    });
  };
  const withHeld = await check(aDoc);
  const { heldGarage, ...exterior } = aDoc.exterior;
  assert.deepEqual(await check({ ...aDoc, exterior }), withHeld, 'the held house Garage changes neither score');
});

// Home to Rent Ideal lot size (#184, D4) ranked on the desktop board: the same
// document as the phone's sheet, JS = SQL for co-renters while it is ranked,
// moved back to the library, cleared, and re-entered (never re-ranked by itself).
dbTest('Home to Rent lot size from the board: board = phone, JS = SQL through rank → library → clear → re-enter', async () => {
  const { lotSizeValue, setLotSizeImportance, setLotSizeValue } = await import('../src/lib/priorityCategories.js');
  const a = db.createUser({ email: 'board.lot.a@example.com', firstName: 'Acre' });
  const b = db.createUser({ email: 'board.lot.b@example.com', firstName: 'Other' });
  const search = db.admin(`select id from public.searches where user_id = '${a}'`)[0].id;
  const invitation = await createInvitation(db.clientFor(a), search, a, 'board.lot.b@example.com', 'co_buyer');
  assert.equal((await acceptInvitation(db.clientFor(b), invitation.token)).success, true);
  const lot = (doc) => feature(doc, `Ideal lot size · ${lotSizeValue(doc)}+ acres`);

  let board = setLotSizeValue(fresh('home_rent'), '0.5');
  board = placeOnBoard(board, lot(board), 'must');
  const phone = setLotSizeImportance(setLotSizeValue(fresh('home_rent'), '0.5'), 'must');
  assert.deepEqual(normalizePriorities(board), normalizePriorities(phone));
  const theirs = setLotSizeImportance(setLotSizeValue(fresh('home_rent'), '2'), 'nice');
  await savePriorities(db.clientFor(b), { id: search }, b, theirs);

  const homeIds = [];
  for (const [name, acres] of [['big', '1 acres'], ['small', '0.25 acres'], ['unknown', '']]) {
    homeIds.push(await insertHome(db.clientFor(a), { user_id: a, search_id: search, address: `${name} Board Acre Ln, Royal Oak, MI 48073`, price: '2400', lot_size: acres }));
  }
  const check = async (doc, label) => {
    await savePriorities(db.clientFor(a), { id: search }, a, doc);
    const priorities = normalizePriorities(await resolvePriorities(db.clientFor(a), { id: search }, a));
    assert.deepEqual(priorities.lotSizeTarget, normalizePriorities(doc).lotSizeTarget, `${label}: round-trip`);
    const homes = await getHomesForUser(db.clientFor(a), a, search);
    const projected = await resolveCoBuyerComparePerspectives(db.clientFor(b), { id: search }, homeIds);
    return homeIds.map((id) => {
      const mine = computeMatch(homes.find((home) => home.id === id), priorities);
      const seen = projected.get(id).match;
      assert.deepEqual([seen.pct, seen.selectedCount, seen.evaluatedCount], [mine.pct, mine.selectedCount, mine.evaluatedCount], `${label}: JS = SQL`);
      return mine.allSelected.find((item) => item.key === 'lotSize') || null;
    });
  };
  const bRow = () => JSON.stringify(db.admin(`select priorities from public.search_member_priorities where search_id = '${search}' and user_id = '${b}'`)[0].priorities);
  const before = bRow();

  let [big, small, unknown] = await check(board, 'ranked Must Have');
  assert.deepEqual([big.met, small.met, unknown.evaluated], [true, false, false], 'unknown lot size is never a miss');
  board = placeOnBoard(board, lot(board), 'none');
  [big, small, unknown] = await check(board, 'back to the library');
  assert.deepEqual([big, small, unknown], [null, null, null], 'unranked acreage is not in Match');
  board = placeOnBoard(board, lot(board), 'important');
  board = setLotSizeValue(board, '');
  assert.deepEqual(board.lotSizeTarget, { value: '', tier: 'dontcare' });
  [big, small, unknown] = await check(board, 'cleared');
  assert.deepEqual([big, small, unknown], [null, null, null]);
  board = setLotSizeValue(board, '0.5');
  [big, small, unknown] = await check(board, 're-entered');
  assert.deepEqual([big, small, unknown], [null, null, null], 're-entered acreage starts unranked');
  assert.equal(bRow(), before, 'the other renter’s row is byte-identical');
});
