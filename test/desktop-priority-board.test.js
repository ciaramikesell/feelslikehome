// Desktop priority board (flow 4 at ≥ 1024px). See docs/desktop-priority-board.md.
// The board is a presentation of the same steps, catalog and priorities
// document as the phone screens: these tests pin the desktop screen order,
// every board move, duplicate-proofing, Garage semantics, legacy selections,
// previews and the release-safety contracts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

register('./support/aliasHooks.mjs', import.meta.url);
const { normalizePriorities } = await import('../src/lib/constants.js');
const { chooseSearchType } = await import('../src/lib/onboardingBasics.js');
const { computeMatch } = await import('../src/lib/matching.js');
const { addCriterion, priorityLevels } = await import('../src/lib/searchProfile.js');
const {
  CURRENT_ONBOARDING_VERSION, advanceOnboarding, beginOnboarding, onboardingStepsFor, retreatOnboarding, skipOnboardingStep,
} = await import('../src/lib/onboardingFlow.js');
const {
  BOARD_CATEGORY_STEPS, BOARD_HOUSE_GARAGE, BOARD_STEP, DESKTOP_BOARD_MIN_WIDTH, DESKTOP_BOARD_QUERY, advanceBoard, boardLevel,
  boardSuggestions, desktopProgress, desktopSteps, isBoardStep, placeOnBoard, priorityBoard, retreatBoard,
} = await import('../src/lib/priorityBoard.js');
const {
  PRIORITY_CATEGORIES, addOwnFeature, featureLevel, garageImportance, garageType, heldGaragePreferences, otherChosenPriorities,
  setFeatureLevel, setGarageImportance, setGarageType, switchPrioritySearchType,
} = await import('../src/lib/priorityCategories.js');
const { FEATURE_DESCRIPTION_TEXTS, featureDescription } = await import('../src/lib/featureDescriptions.js');
const { ONBOARDING_PHOTOS, cardImage } = await import('../src/lib/onboardingImages.js');
const { setPetsMoving } = await import('../src/lib/rentalPets.js');

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const OWN = { searchId: '11111111-1111-4111-8111-111111111111', role: 'owner' };
const T0 = '2026-11-15T12:00:00.000Z';
const TYPES = ['home_buy', 'home_rent', 'apartment_rent'];
const fresh = (type = 'home_buy') => chooseSearchType(normalizePriorities({}), type, { presetPropertyType: false });
const stateFor = (type, step) => ({ ...beginOnboarding({ context: OWN, now: T0, targetVersion: 4 }).state, step, answers: { searchType: type } });
const allFeatures = (board) => [...board.groups.flatMap((group) => group.features), ...Object.values(board.columns).flat()];
const find = (board, text) => allFeatures(board).find((feature) => feature.text === text);
const column = (board, tier) => board.columns[tier].map((feature) => feature.text);

/* ---------------------------------- steps ---------------------------------- */

test('desktop screen order: Search type · Basics · Where · [Rental Essentials] · one board · Review', () => {
  const expected = {
    home_buy: ['search_type', 'basics', 'locations', BOARD_STEP, 'review'],
    home_rent: ['search_type', 'basics', 'locations', 'cat_essentials', BOARD_STEP, 'review'],
    apartment_rent: ['search_type', 'basics', 'locations', 'cat_essentials', BOARD_STEP, 'review'],
  };
  for (const type of TYPES) {
    const steps = onboardingStepsFor(4, { answers: { searchType: type } });
    assert.deepEqual(desktopSteps(steps), expected[type], type);
    // The stored flow (and so the phone screens) is untouched.
    assert.ok(steps.filter(isBoardStep).length >= 2, type);
  }
  assert.deepEqual(onboardingStepsFor(4, { answers: { searchType: 'home_buy' } }),
    ['search_type', 'basics', 'locations', 'cat_layout', 'cat_kitchen', 'cat_living', 'cat_bath', 'cat_garage', 'cat_exterior', 'cat_neighborhood', 'review'],
    'phone order unchanged');
  // Question screens (Rental Essentials) are never folded into the board.
  assert.equal(isBoardStep('cat_essentials'), false);
  assert.deepEqual(BOARD_CATEGORY_STEPS, PRIORITY_CATEGORIES.filter((category) => !category.question).map((category) => category.step));
});

test('desktop progress counts the board once, wherever the stored category step is', () => {
  const steps = onboardingStepsFor(4, { answers: { searchType: 'home_buy' } });
  for (const step of steps.filter(isBoardStep)) assert.deepEqual(desktopProgress(steps, step), { index: 3, position: 4, total: 4, steps: ['search_type', 'basics', 'locations', BOARD_STEP] }, step);
  assert.equal(desktopProgress(steps, 'review').position, 4);
  const rent = onboardingStepsFor(4, { answers: { searchType: 'home_rent' } });
  assert.deepEqual([desktopProgress(rent, 'cat_essentials').position, desktopProgress(rent, 'cat_exterior').position, desktopProgress(rent, 'cat_exterior').total], [4, 5, 5]);
});

test('Continue completes every category at once; Skip marks each skipped; Back leaves from the first; resume is shared with phones', () => {
  for (const type of TYPES) {
    const state = stateFor(type, onboardingStepsFor(4, { answers: { searchType: type } }).find(isBoardStep));
    const board = onboardingStepsFor(4, state).filter(isBoardStep);
    const next = advanceBoard(4, state, { now: T0 }).state;
    assert.equal(next.step, 'review', type);
    for (const key of board) assert.ok(next.completed.includes(key), `${type} ${key}`);
    assert.deepEqual(next.skipped, []);
    const skipped = advanceBoard(4, state, { skip: true, now: T0 }).state;
    assert.equal(skipped.step, 'review');
    assert.deepEqual(skipped.skipped, board, 'Review offers each category again');
    assert.equal(retreatBoard(4, state, T0).step, type === 'home_buy' ? 'locations' : 'cat_essentials');
    // Same answer whichever category step is stored (a phone left mid-way).
    assert.equal(retreatBoard(4, { ...state, step: board[board.length - 1] }, T0).step, type === 'home_buy' ? 'locations' : 'cat_essentials');
  }
  // A desktop session resumed on a phone continues on the phone screens, and vice versa.
  let state = stateFor('home_buy', 'cat_layout');
  state = advanceOnboarding(4, state, 'cat_layout', T0).state; // phone: one screen
  state = skipOnboardingStep(4, state, 'cat_kitchen', T0).state;
  assert.equal(state.step, 'cat_living');
  assert.equal(isBoardStep(state.step), true, 'a desktop shows the board for it');
  const done = advanceBoard(4, state, { now: T0 }).state;
  assert.deepEqual([done.step, done.skipped], ['review', []], 'Continue on the board clears earlier skips');
  // Back from Review on desktop lands on a board step (the board).
  assert.equal(isBoardStep(retreatOnboarding(4, done, 'review', T0).step), true);
});

/* ------------------------------- board model ------------------------------- */

test('the library is the phone catalog for each kind of search, grouped by the same categories', () => {
  const titles = (type) => priorityBoard(fresh(type)).groups.map((group) => group.title);
  assert.deepEqual(titles('home_buy'), ['Layout & Living Spaces', 'Kitchen', 'Living Room', 'Bathroom', 'Garage', 'Exterior & Property', 'Location & Neighborhood']);
  assert.deepEqual(titles('home_rent'), ['Layout & Living Spaces', 'Rental Features', 'Exterior & Property', 'Location & Neighborhood']);
  assert.deepEqual(titles('apartment_rent'), ['The Unit', 'The Property']);
  for (const type of TYPES) {
    const priorities = fresh(type);
    const board = priorityBoard(priorities);
    for (const group of board.groups) {
      const category = PRIORITY_CATEGORIES.find((entry) => entry.key === group.key);
      const phone = (category ? [...category.features, ...category.suggestions] : []);
      assert.ok(group.features.length > 0, `${type} ${group.title}`);
      for (const feature of group.features) assert.notEqual(feature.level, undefined);
      assert.ok(phone.length >= group.features.length - (group.key === 'garage' ? 1 : 0), `${type} ${group.key}: nothing invented`);
    }
    assert.deepEqual(Object.values(board.columns).flat(), [], 'nothing preselected');
  }
  // Same identities as the phone: apartments use the rental catalog labels.
  const apartment = priorityBoard(fresh('apartment_rent'));
  assert.equal(find(apartment, 'Home Office Space').id, 'features:Home Office');
  assert.equal(find(apartment, 'Garage Parking').id, 'exterior:Garage');
  assert.equal(find(priorityBoard(fresh('home_buy')), 'Home Office').id, 'features:Home office');
});

test('library → column, column → column, column → library; every feature in exactly one place; same writes as the phone', () => {
  for (const type of TYPES) {
    let p = fresh(type);
    const ids = allFeatures(priorityBoard(p)).map((feature) => feature.id);
    const [a, b, c] = priorityBoard(p).groups.flatMap((group) => group.features);
    p = placeOnBoard(p, a, 'must');
    p = placeOnBoard(p, b, 'nice');
    p = placeOnBoard(p, c, 'important');
    let board = priorityBoard(p);
    assert.deepEqual([column(board, 'must'), column(board, 'important'), column(board, 'nice')], [[a.text], [c.text], [b.text]], type);
    // Exactly once, and the set of features never changes.
    const now = allFeatures(board).map((feature) => feature.id);
    assert.equal(new Set(now).size, now.length, `${type}: no duplicates`);
    assert.deepEqual([...now].sort(), [...ids].sort());
    // Column → column; dropping where it already is changes nothing.
    p = placeOnBoard(p, a, 'nice');
    assert.equal(placeOnBoard(p, a, 'nice'), p);
    board = priorityBoard(p);
    assert.deepEqual(column(board, 'must'), []);
    assert.ok(column(board, 'nice').includes(a.text));
    // Column → library: "don't care" (the phone's Not important), never a No.
    p = placeOnBoard(p, a, 'none');
    assert.equal(placeOnBoard(p, a, 'none'), p, 'already in the library');
    board = priorityBoard(p);
    assert.equal(boardLevel(p, a), null);
    assert.ok(board.groups.some((group) => group.features.some((feature) => feature.id === a.id)));
    assert.equal(p[a.categoryKey].tiers[a.label], 'dontcare');
    // Identical to the phone's importance sheet writes.
    let phone = fresh(type);
    phone = setFeatureLevel(phone, a, 'must');
    phone = setFeatureLevel(phone, b, 'nice');
    phone = setFeatureLevel(phone, c, 'important');
    phone = setFeatureLevel(phone, a, 'nice');
    phone = setFeatureLevel(phone, a, 'none');
    assert.deepEqual(p, phone, `${type}: one document, one write path`);
  }
});

test('a feature removed to the library never counts against a home; Unknown is never No', () => {
  let p = fresh('home_buy');
  const board = priorityBoard(p);
  const seating = find(board, 'Countertop Seating');
  p = placeOnBoard(p, seating, 'must');
  const home = { price: '300000', checks: {}, ratings: {} };
  const unknown = computeMatch(home, p);
  assert.equal(unknown.allSelected.find((item) => item.key === 'features:Countertop Seating').evaluated, false, 'unknown is not evaluated');
  // An explicit No is the string 'no'; historical boolean false stays Unknown.
  assert.equal(computeMatch({ ...home, checks: { 'features:Countertop Seating': false } }, p).allSelected[0].evaluated, false);
  const answeredNo = { ...home, checks: { 'features:Countertop Seating': 'no' } };
  const no = computeMatch(answeredNo, p);
  assert.equal(no.allSelected.find((item) => item.key === 'features:Countertop Seating').met, false, 'an explicit No is a miss');
  p = placeOnBoard(p, seating, 'none');
  const removed = computeMatch(answeredNo, p);
  assert.equal(Boolean(removed?.allSelected?.some((item) => item.key === 'features:Countertop Seating')), false, 'removed: not part of Match at all');
});

test('Home to Buy Garage is one chip with the existing identity; details appear once it matters; Not important on removal', () => {
  let p = fresh('home_buy');
  let board = priorityBoard(p);
  const garage = board.groups.find((group) => group.key === 'garage');
  assert.deepEqual(garage.features.map((feature) => feature.text), ['Garage'], 'details hidden until a garage matters');
  assert.equal(garage.garageDetailsHidden, true);
  p = placeOnBoard(p, BOARD_HOUSE_GARAGE, 'important');
  assert.deepEqual([garageImportance(p), featureLevel(p, BOARD_HOUSE_GARAGE)], ['important', 'important']);
  assert.deepEqual(p, setGarageImportance(fresh('home_buy'), 'important'), 'the same write as the phone’s garage question');
  board = priorityBoard(p);
  assert.deepEqual(board.groups.find((group) => group.key === 'garage').features.map((feature) => feature.text), ['Workbench', 'Garage Extension', 'Door to Backyard']);
  p = setGarageType(p, 'attached');
  p = placeOnBoard(p, BOARD_HOUSE_GARAGE, 'none');
  assert.equal(garageImportance(p), 'not_important');
  assert.equal(garageType(p), 'attached', 'attached / detached is kept, as on the phone');
  // A chosen detail keeps details visible even when the garage itself is removed.
  p = placeOnBoard(p, find(priorityBoard(placeOnBoard(p, BOARD_HOUSE_GARAGE, 'nice')), 'Workbench'), 'nice');
  assert.equal(priorityBoard(p).groups.find((group) => group.key === 'garage').garageDetailsHidden, false);
});

test('house Garage and apartment Garage Parking stay separate across switches; heldGarage is untouched by the board', () => {
  let p = placeOnBoard(fresh('home_buy'), BOARD_HOUSE_GARAGE, 'must');
  p = setGarageType(p, 'detached');
  p = switchPrioritySearchType(p, 'apartment_rent').priorities;
  let board = priorityBoard(p);
  assert.equal(find(board, 'Garage Parking').level, null, 'a house Garage never becomes Garage Parking');
  assert.deepEqual(heldGaragePreferences(p), { house: { tier: 'must', garagePreference: 'detached' } });
  p = placeOnBoard(p, find(board, 'Garage Parking'), 'nice');
  board = priorityBoard(p);
  assert.deepEqual(column(board, 'nice'), ['Garage Parking']);
  assert.deepEqual(heldGaragePreferences(p), { house: { tier: 'must', garagePreference: 'detached' } }, 'the held house garage is not rewritten');
  p = switchPrioritySearchType(p, 'home_buy').priorities;
  board = priorityBoard(p);
  assert.deepEqual(column(board, 'must'), ['Garage'], 'the house garage comes back');
  assert.equal(garageType(p), 'detached');
  assert.deepEqual(heldGaragePreferences(p), { apartment: { tier: 'nice' } });
});

test('Add your own: canonical suggestions first, duplicate-proof across case and punctuation, then the importance', () => {
  let p = fresh('home_buy');
  let board = priorityBoard(p);
  assert.deepEqual(boardSuggestions(board, 'island').map(({ feature, groupTitle }) => [feature.text, groupTitle]), [['Kitchen Island', 'Kitchen']]);
  assert.deepEqual(boardSuggestions(board, ' TUB ').map(({ feature }) => feature.text), ['Soaking Tub', 'Separate Shower / Tub']);
  // Once ranked, a feature is on the board, so it isn't suggested again.
  p = placeOnBoard(p, find(board, 'Kitchen Island'), 'must');
  assert.deepEqual(boardSuggestions(priorityBoard(p), 'island'), []);
  // Typed text that is already offered reuses that feature (any category).
  const porch = addOwnFeature(p, 'kitchen', 'front   PORCH!');
  assert.equal(porch.feature.id, 'exterior:Front porch');
  assert.equal(porch.homeCategory, 'layout');
  // A new feature is created once, on the chosen category, then ranked.
  const wine = addOwnFeature(p, 'kitchen', 'Wine fridge');
  p = placeOnBoard(wine.priorities, wine.feature, 'nice');
  const again = addOwnFeature(p, 'living', 'wine-fridge');
  assert.equal(again.feature.label, 'Wine fridge');
  assert.deepEqual(again.priorities, normalizePriorities(p), 'nothing added twice');
  board = priorityBoard(p);
  assert.deepEqual(column(board, 'nice'), ['Wine fridge']);
  assert.equal(allFeatures(board).filter((feature) => /wine/i.test(feature.text)).length, 1);
  assert.equal(featureDescription(board.columns.nice[0]).startsWith('Your own priority'), true);
});

test('legacy selections not offered by onboarding stay in their column, can move, and can be put back after removal', () => {
  let p = fresh('home_buy');
  p = addCriterion(p, { categoryKey: 'features', label: 'Second-Floor Laundry', kind: 'check' }, 'important');
  p = addCriterion(p, { categoryKey: 'location', label: 'Dead-End Street', kind: 'check' }, 'nice');
  assert.equal(otherChosenPriorities(p).length, 2);
  let board = priorityBoard(p);
  assert.deepEqual([column(board, 'important'), column(board, 'nice')], [['Second-Floor Laundry'], ['Dead-End Street']]);
  const laundry = board.columns.important[0];
  assert.equal(laundry.role, 'other');
  p = placeOnBoard(p, laundry, 'must');
  assert.deepEqual(column(priorityBoard(p), 'must'), ['Second-Floor Laundry']);
  p = placeOnBoard(p, laundry, 'none');
  board = priorityBoard(p, { earlierRemoved: [laundry] });
  assert.deepEqual(board.groups.at(-1).features.map((feature) => feature.text), ['Second-Floor Laundry'], 'kept in the library this visit');
  assert.equal(board.groups.at(-1).title, 'From earlier');
  // Never deleted from the document: the custom item / catalog identity remains.
  assert.equal(p.features.tiers['Second-Floor Laundry'], 'dontcare');
});

test('renters: the pets answer’s Pet-Friendly is shown once, in its column; Rental Essentials is not on the board', () => {
  let p = setPetsMoving(fresh('home_rent'), 'yes', T0).priorities;
  const board = priorityBoard(p);
  assert.deepEqual(column(board, 'must'), ['Pet-Friendly']);
  assert.equal(allFeatures(board).filter((feature) => feature.text === 'Pet-Friendly').length, 1);
  assert.equal(board.groups.some((group) => group.key === 'essentials'), false);
  // Moving it is an explicit renter edit through the canonical write (ends FLH's automatic ownership).
  p = placeOnBoard(p, board.columns.must[0], 'important');
  assert.equal(p.features.tiers['Pets Allowed'], 'important');
  assert.equal(p.features.petsAuto, undefined);
  // Lot size stays a Home to Buy / Home to Rent field, never an apartment one.
  assert.equal(priorityBoard(fresh('home_rent')).groups.find((group) => group.key === 'exterior').lotSize, true);
  assert.equal(priorityBoard(fresh('apartment_rent')).groups.some((group) => group.lotSize), false);
});

test('co-buyers: the board only ever changes the document it is given', () => {
  const owner = placeOnBoard(fresh('home_buy'), find(priorityBoard(fresh('home_buy')), 'Fireplace'), 'must');
  const coBuyer = fresh('home_buy');
  const snapshot = JSON.stringify(coBuyer);
  placeOnBoard(coBuyer, find(priorityBoard(coBuyer), 'Soaking Tub'), 'nice');
  assert.equal(JSON.stringify(coBuyer), snapshot, 'pure: no shared or mutated state');
  assert.deepEqual(priorityLevels(owner).flatMap((level) => level.items).map((item) => item.label), ['Fireplace']);
});

/* ------------------------------- previews ---------------------------------- */

test('every board feature has a written description and a manifest image or icon; nothing new is downloaded', () => {
  for (const type of TYPES) {
    let p = fresh(type);
    if (type === 'home_buy') p = placeOnBoard(p, BOARD_HOUSE_GARAGE, 'nice');
    for (const feature of allFeatures(priorityBoard(p))) {
      const sentence = featureDescription(feature);
      assert.ok(sentence.length > 10 && sentence.length < 110 && /\.$/.test(sentence), `${type} ${feature.text}`);
      assert.ok(!/^Your own|^A priority you chose/.test(sentence), `${type} ${feature.text} has its own description`);
      assert.ok(cardImage(feature.art) || feature.icon, `${type} ${feature.text} has a photo or an icon fallback`);
      if (feature.art && ONBOARDING_PHOTOS[feature.art]) assert.match(cardImage(feature.art).src, /^\/images\/onboarding\/cards\/[a-z-]+-400\.webp$/);
    }
  }
  assert.equal(new Set(FEATURE_DESCRIPTION_TEXTS).size, FEATURE_DESCRIPTION_TEXTS.length);
  assert.notEqual(featureDescription({ text: 'Garage' }), featureDescription({ text: 'Garage Parking' }), 'house and apartment garages read differently');
  const source = read('src/components/onboarding/priority/PriorityBoard.jsx');
  assert.doesNotMatch(source, /https?:\/\//, 'no remote images');
  assert.match(source, /<FeatureVisual feature=\{preview\.feature\}/, 'the preview reuses the card visual (photo → illustration → icon)');
});

/* ------------------------------ UI contracts ------------------------------- */

test('board UI: drag, click and keyboard all use the canonical writes; previews are decorative and gated', () => {
  const board = read('src/components/onboarding/priority/PriorityBoard.jsx');
  const code = board.split('\n').filter((line) => !line.trim().startsWith('//')).join('\n');
  assert.match(board, /placeOnBoard\(next, feature, target\)/, 'every move goes through placeOnBoard');
  assert.doesNotMatch(code, /setFeatureLevel|moveCriterion|addCriterion|savePriorities|supabase/, 'no second write path, no direct storage');
  assert.match(board, /addOwnFeature\(priorities, category, text\)/);
  assert.match(board, /draggable/);
  assert.match(board, /aria-haspopup="dialog"/);
  assert.match(board, /role="dialog"/);
  assert.match(board, /aria-describedby=\{descId\}/, 'the description is available without hovering');
  assert.match(board, /className="flh-ob-board-preview" aria-hidden="true"/);
  assert.match(board, /event\.pointerType === 'mouse'/, 'hover previews only for a mouse');
  assert.match(board, /matches\(':focus-visible'\)/, 'focus previews for keyboard users');
  assert.match(board, /previewHide\(\);\n\s+setChooser\(null\);/, 'dragging hides the preview');
  assert.match(board, /HOVER_DELAY_MS = \d{3}/);
  assert.match(board, /Undo/);
  assert.match(board, /role="status" aria-live="polite"/);
  // Breakpoint: one explicit, tested constant; server render is always the phone flow.
  assert.equal(DESKTOP_BOARD_MIN_WIDTH, 1024);
  assert.equal(DESKTOP_BOARD_QUERY, '(min-width: 1024px)');
  const hook = read('src/components/onboarding/priority/useDesktopBoard.js');
  assert.match(hook, /const serverSnapshot = \(\) => false;/);
  assert.match(hook, /matchMedia\(DESKTOP_BOARD_QUERY\)/);
  const flow = read('src/components/onboarding/priority/PriorityFlow.jsx');
  assert.match(flow, /if \(board && isBoardStep\(step\)\)/, 'the board only replaces card categories, only on desktop');
  const onboarding = read('src/components/onboarding/Onboarding.jsx');
  assert.match(onboarding, /const desktopBoard = useDesktopBoard\(\) && priorityFlow;/, 'flows 1–3 never see the board');
  assert.match(onboarding, /advanceBoard\(version, progressRef\.current, \{ skip \}\)/);
  assert.match(onboarding, /retreatBoard\(version, progressRef\.current\)/);
  // Board CSS is scoped to the onboarding root.
  const css = read('src/app/globals.css');
  const block = css.slice(css.indexOf('/* ── Desktop priority board'), css.indexOf('/* ── Mobile Priority Onboarding V3'));
  for (const rule of block.split('\n').filter((line) => /^\s*\.[a-z]/.test(line))) assert.match(rule, /\.flh-onboarding-root/, rule);
});

test('release safety: live flow version and flag unchanged; no scoring or storage changes', () => {
  assert.equal(CURRENT_ONBOARDING_VERSION, 1);
  assert.match(read('src/app/onboarding/page.js'), /onboardingV3Enabled\(\) \? 4 : CURRENT_ONBOARDING_VERSION/);
  const model = read('src/lib/priorityBoard.js');
  assert.doesNotMatch(model, /computeMatch|matching\.js|supabase/);
});
