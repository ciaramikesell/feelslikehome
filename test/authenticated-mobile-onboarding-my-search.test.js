import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MOBILE_PRIMARY_TABS, TIER_META, normalizePriorities, getItemlistCategories } from '../src/lib/constants.js';
import { computeMatch } from '../src/lib/matching.js';
import { ONBOARDING_SUGGESTIONS, applySearchChoice } from '../src/lib/onboarding.js';
import {
  CONDITION_CHOICES, LAYOUT_CHOICES, addCriterion, addCustomCriterion, availableCriteriaGroups, basicsFieldsFor,
  basicsSummary, isCriterionSelected, matchShapingPriorityCount, moveCriterion, offeredCriteriaGroups, placeDraftError,
  placesSummary, planPlaceChanges, priorityLevels, sanitizeNumericInput, searchStatusCopy, selectedPriorityCount,
  setGaragePreference, toggleCriterion,
} from '../src/lib/searchProfile.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const offeredLabels = (priorities) => offeredCriteriaGroups(priorities).flatMap((group) => group.items.map((item) => item.displayLabel));
const levelNames = (priorities) => Object.fromEntries(priorityLevels(priorities).map((level) => [level.tier, level.items.map((item) => item.displayLabel)]));
const criterion = (priorities, displayLabel) => offeredCriteriaGroups(priorities).flatMap((group) => group.items).find((item) => item.displayLabel === displayLabel);
const buy = () => applySearchChoice({}, 'home_buy');

/* --------------------------------- Onboarding: The Basics --------------------------------- */

test('all three search types map to their existing intents and property types', () => {
  const [homeBuy, homeRent, apartment] = ['home_buy', 'home_rent', 'apartment_rent'].map((key) => applySearchChoice({}, key));
  assert.deepEqual([homeBuy.searchType, homeRent.searchType, apartment.searchType], ['purchase', 'rental', 'rental']);
  assert.deepEqual([homeBuy.onboardingSearchType, homeRent.onboardingSearchType, apartment.onboardingSearchType], ['home_buy', 'home_rent', 'apartment_rent']);
  const onboarding = read('src/components/onboarding/Onboarding.jsx');
  assert.match(onboarding, /home_buy: 'Home to Buy', home_rent: 'Home to Rent', apartment_rent: 'Apartment to Rent'/);
});

test('Basics field applicability is audited per search type, not cloned from purchase', () => {
  assert.deepEqual(basicsFieldsFor('home_buy'), { budgetLabel: 'Maximum budget', budgetPlaceholder: '450,000', lotSize: true, propertyTypes: ['house', 'condo', 'multifamily'], layout: true, condition: true });
  assert.deepEqual(basicsFieldsFor('home_rent'), { budgetLabel: 'Maximum monthly rent', budgetPlaceholder: '2,200', lotSize: true, propertyTypes: ['house', 'townhome', 'condo'], layout: false, condition: false });
  assert.deepEqual(basicsFieldsFor('apartment_rent'), { budgetLabel: 'Maximum monthly rent', budgetPlaceholder: '2,200', lotSize: false, propertyTypes: [], layout: false, condition: false });
  assert.deepEqual(LAYOUT_CHOICES.map(({ label }) => label), ['Ranch', 'Two Story', 'Other']);
  assert.deepEqual(CONDITION_CHOICES.map(({ label }) => label), ['New Construction', 'Move-in Ready', 'Renovation Potential']);
  // Stored values stay the ones Home Edit and Match already compare against.
  assert.deepEqual(LAYOUT_CHOICES.map(({ value }) => value), ['Ranch / Single Story', 'Two Story', 'Other']);
  assert.equal(CONDITION_CHOICES[1].value, 'Move-In Ready');
});

test('numeric Basics keep only what Match can read; lot size and baths accept fractions', () => {
  assert.equal(sanitizeNumericInput('$650,000'), '650000');
  assert.equal(sanitizeNumericInput('.25', { decimal: true }), '.25');
  assert.equal(sanitizeNumericInput('2.5.1', { decimal: true }), '2.51');
  assert.equal(sanitizeNumericInput('abc'), '');
});

test('optional Basics are genuinely optional: nothing entered renders nothing', () => {
  const summary = basicsSummary(buy());
  assert.deepEqual(summary.numbers, []);
  // House is the existing Home to Buy default type (applySearchChoice); nothing else is set.
  assert.deepEqual(summary.details, [{ key: 'types', label: 'Home types', values: ['House'] }]);
});

test('Home Condition remains Basics (search definition), never a weighted criterion', () => {
  for (const key of ['home_buy', 'home_rent']) {
    const labels = offeredLabels(applySearchChoice({}, key));
    for (const condition of ['New Construction', 'Move-in Ready', 'Renovation Potential']) assert.ok(!labels.includes(condition), `${condition} offered for ${key}`);
  }
  // Choosing a condition in Basics stores it on homeCondition, whose tier stays the
  // existing Match-neutral default — it never becomes a board priority.
  const priorities = { ...buy(), homeCondition: { values: ['Move-In Ready'], tier: 'dontcare' } };
  assert.equal(selectedPriorityCount(priorities), 0);
  const match = computeMatch({ homeCondition: ['New Construction'] }, priorities);
  assert.ok(!match.allSelected.some((item) => item.key === 'homeCondition'));
});

/* --------------------------------- Onboarding: What Matters --------------------------------- */

test('canonical weighted Home criteria are exactly the approved taxonomy, grouped by category', () => {
  const groups = offeredCriteriaGroups(buy()).map((group) => [group.title, group.items.map((item) => item.displayLabel)]);
  assert.deepEqual(groups, [
    ['Location', ['Reputable Schools', 'Walkable to Town', 'Parks Nearby', 'Quiet Street', 'Bustling Street', 'Near Waterfront', 'Walkable Schools', 'No HOA']],
    ['Home Features', ['Finished Basement', 'Walkout Basement', 'First-Floor Primary', 'Guest Bedroom', 'Primary Ensuite', 'First-Floor Laundry', 'Home Office', 'Central Air', 'Fireplace']],
    ['Exterior & Property', ['Deck / Patio', 'Fenced Yard', 'Privacy Fencing', 'Garage', 'Large Backyard', 'Front Porch', 'Pool', 'Landscaping']],
  ]);
  assert.ok(offeredLabels(buy()).includes('Guest Bedroom'));
  for (const absent of ['Guest / In-Law Suite', 'Charming Neighborhood', 'Attached Garage', 'Detached Garage']) assert.ok(!offeredLabels(buy()).includes(absent));
});

test('Home to Rent uses the canonical Home criteria except No HOA; Apartment to Rent keeps its own taxonomy', () => {
  const rent = applySearchChoice({}, 'home_rent');
  assert.deepEqual(offeredLabels(rent), offeredLabels(buy()).filter((label) => label !== 'No HOA'));
  assert.deepEqual(ONBOARDING_SUGGESTIONS.apartment_rent.flatMap(([, items]) => items.map((item) => item.displayLabel)),
    ['In-Unit Laundry', 'Central Air', 'Dishwasher', 'Updated Interior', 'Balcony / Patio', 'Home Office Space', 'Parking', 'Fitness Center', 'Pool', 'Secure Entry', 'Outdoor Space', 'Elevator', 'Pet-Friendly', 'Quiet Community', 'Social Community', 'On-Site Management', 'Privacy', 'Surrounding Neighborhood']);
  // An existing rental selection with the same meaning is never offered twice.
  const existing = normalizePriorities({ ...rent, features: { tiers: { 'Home Office': 'important' }, customItems: [{ label: 'Home Office', kind: 'check' }] } });
  const available = availableCriteriaGroups(existing).flatMap((group) => group.items.map((item) => item.displayLabel));
  assert.ok(!available.includes('Home Office'));
});

test('selected and unselected criteria toggle, and everything selected starts as Important', () => {
  let priorities = buy();
  const fireplace = criterion(priorities, 'Fireplace');
  priorities = toggleCriterion(priorities, fireplace);
  assert.ok(isCriterionSelected(priorities, 'features', 'Fireplace'));
  assert.equal(priorities.features.tiers.Fireplace, 'important');
  priorities = toggleCriterion(priorities, fireplace);
  assert.ok(!isCriterionSelected(priorities, 'features', 'Fireplace'));
  // Stored identity is kept for a later re-selection; only the tier changed.
  assert.ok(priorities.features.customItems.some((item) => item.label === 'Fireplace'));
});

test('Garage is the weighted parent; Attached/Detached is an optional qualifier that never changes Match', () => {
  let priorities = addCriterion(buy(), criterion(buy(), 'Garage'));
  priorities = setGaragePreference(priorities, 'attached');
  assert.equal(priorities.exterior.garagePreference, 'attached');
  assert.deepEqual(priorityLevels(priorities)[1].items.map((item) => [item.displayLabel, item.qualifier]), [['Garage', 'Attached']]);
  assert.equal(setGaragePreference(priorities, 'carport').exterior.garagePreference, 'attached');
  // Scored from the home's existing garage-spaces fact, identically for any qualifier.
  for (const preference of ['any', 'attached', 'detached']) {
    const withPreference = setGaragePreference(priorities, preference);
    const withGarage = computeMatch({ garageSpaces: '2' }, withPreference).allSelected.find((item) => item.key === 'exterior:Garage');
    assert.equal(withGarage.met, true);
    const unknown = computeMatch({}, withPreference).allSelected.find((item) => item.key === 'exterior:Garage');
    assert.equal(unknown.evaluated, false);
  }
  assert.equal(computeMatch({ garageSpaces: '0' }, priorities).allSelected.find((item) => item.key === 'exterior:Garage').met, false);
});

test('custom priorities are the buyer’s own, start Important, and never duplicate an offered one', () => {
  const offered = offeredCriteriaGroups(buy()).flatMap((group) => group.items);
  let priorities = addCustomCriterion(buy(), 'features', '  Mudroom ', offered);
  assert.equal(priorities.features.tiers.Mudroom, 'important');
  assert.deepEqual(priorities.features.customItems.at(-1), { label: 'Mudroom', kind: 'check', source: 'custom' });
  priorities = addCustomCriterion(priorities, 'location', 'garage', offered);
  assert.equal(priorities.exterior.tiers.Garage, 'important');
  assert.equal(priorities.location.tiers.garage, undefined);
  const before = selectedPriorityCount(priorities);
  priorities = addCustomCriterion(priorities, 'features', 'MUDROOM', offered);
  assert.equal(selectedPriorityCount(priorities), before);
});

test('What Matters selections carry into Rank Priorities as Important', () => {
  let priorities = buy();
  for (const label of ['Home Office', 'Fenced Yard', 'Central Air']) priorities = toggleCriterion(priorities, criterion(priorities, label));
  assert.deepEqual(levelNames(priorities), { must: [], important: ['Home Office', 'Central Air', 'Fenced Yard'], nice: [] });
});

/* --------------------------------- Onboarding: Rank Priorities --------------------------------- */

test('drag and tap both move a priority by changing only its level', () => {
  let priorities = buy();
  for (const label of ['Home Office', 'Fireplace']) priorities = toggleCriterion(priorities, criterion(priorities, label));
  priorities = moveCriterion(priorities, 'features', 'Home office', 'must');
  priorities = moveCriterion(priorities, 'features', 'Fireplace', 'nice');
  assert.deepEqual(levelNames(priorities), { must: ['Home Office'], important: [], nice: ['Fireplace'] });
  const board = read('src/components/RankBoard.jsx');
  // Drag (pointer) and tap (level picker) share the same onMove(item, tier).
  assert.match(board, /onMove\(current\.item, current\.overTier\)/);
  assert.match(board, /const choose = \(tier\) => \{ if \(picker && tier !== picker\.tier\) onMove\(picker, tier\); setPicker\(null\); \};/);
});

test('final persistence: onboarding saves through the participant’s own row before completing', () => {
  const onboarding = read('src/components/onboarding/Onboarding.jsx');
  assert.match(onboarding, /savePriorities\(createClient\(\), \{ id: searchId \}, userId, next\)/);
  assert.match(onboarding, /await flush\(\);\n\s+await completeOnboarding\(createClient\(\), userId\);/);
  assert.match(onboarding, /onMove=\{\(item, tier\) => patch\(\(next\) => moveCriterion\(next, item\.categoryKey, item\.label, tier\)\)\}/);
});

test('Unknown ≠ mismatch is unchanged for the new and legacy criteria', () => {
  for (const label of ['Guest Bedroom', 'Garage', 'Privacy Fencing']) {
    const priorities = toggleCriterion(buy(), criterion(buy(), label));
    const match = computeMatch({ checks: {} }, priorities);
    assert.ok(match.allSelected.every((item) => item.evaluated === false), `${label} must stay Unknown`);
    assert.equal(match.pct, null);
  }
});

test('discontinued offerings are never offered again, but existing selections keep counting in Match', () => {
  const legacy = normalizePriorities({ ...buy(), features: { tiers: { 'Move-in Ready': 'must', 'Guest / In-Law Suite': 'important' }, customItems: [{ label: 'Move-in Ready', kind: 'check' }, { label: 'Guest / In-Law Suite', kind: 'check' }] }, exterior: { tiers: { 'Attached garage': 'nice' }, customItems: [{ label: 'Attached garage', kind: 'check' }] } });
  assert.deepEqual(levelNames(legacy), { must: ['Move-in Ready'], important: ['Guest / In-Law Suite'], nice: ['Attached Garage'] });
  const match = computeMatch({ checks: { 'features:Move-in Ready': true, 'exterior:Attached garage': 'no' } }, legacy);
  assert.ok(match.allSelected.some((item) => item.key === 'features:Move-in Ready' && item.met === true));
  assert.ok(match.allSelected.some((item) => item.key === 'exterior:Attached garage' && item.met === false));
  assert.equal(matchShapingPriorityCount(legacy), 3);
  const deselected = moveCriterion(legacy, 'features', 'Move-in Ready', 'dontcare');
  const available = availableCriteriaGroups(deselected).flatMap((group) => group.items.map((item) => item.label));
  assert.ok(!available.includes('Move-in Ready'));
  assert.ok(!available.includes('Attached garage'));
});

/* --------------------------------- My Search overview --------------------------------- */

test('a populated overview summarizes all three levels by name and the Basics as readable parts', () => {
  let priorities = normalizePriorities({
    ...buy(),
    budget: { value: '650,000', tier: 'important' }, bedsMin: { value: '3', tier: 'important' }, bathsMin: { value: '2', tier: 'nice' },
    sqftTarget: { value: '1800', tier: 'nice' }, lotSizeTarget: { value: '.25', tier: 'dontcare' },
    preferredPropertyTypes: { values: ['house', 'condo'], tier: 'important' },
    homeLayout: { values: ['Two Story'], tier: 'dontcare' }, homeCondition: { values: ['Move-In Ready', 'Renovation Potential'], tier: 'dontcare' },
  });
  for (const [label, tier] of [['Home Office', 'must'], ['Fenced Yard', 'must'], ['Central Air', 'important'], ['First-Floor Primary', 'important'], ['Garage', 'important'], ['No HOA', 'nice'], ['Large Backyard', 'nice'], ['Fireplace', 'nice']]) {
    priorities = addCriterion(priorities, criterion(priorities, label), tier);
  }
  assert.deepEqual(levelNames(priorities), {
    must: ['Home Office', 'Fenced Yard'],
    important: ['Central Air', 'First-Floor Primary', 'Garage'],
    nice: ['No HOA', 'Fireplace', 'Large Backyard'],
  });
  assert.equal(selectedPriorityCount(priorities), 8);
  assert.deepEqual(basicsSummary(priorities), {
    experienceLabel: 'Home to Buy',
    numbers: ['$650,000 maximum', '3+ bedrooms', '2+ bathrooms', '1,800+ sq ft', '.25+ acres'],
    details: [
      { key: 'types', label: 'Home types', values: ['House', 'Condo'] },
      { key: 'layout', label: 'Layout', values: ['Two Story'] },
      { key: 'condition', label: 'Condition', values: ['Move-in Ready', 'Renovation Potential'] },
    ],
    setCount: 8,
  });
});

test('Basics adapt to rentals and never render NaN, undefined, or empty separators', () => {
  const rent = basicsSummary({ ...applySearchChoice({}, 'home_rent'), budget: { value: '2,200' }, bathsMin: { value: '1' }, lotSizeTarget: { value: '1.5' } });
  assert.deepEqual(rent.numbers, ['$2,200/mo maximum', '1+ bathroom', '1.5+ acres']);
  assert.equal(rent.experienceLabel, 'Home to Rent');
  const apartment = basicsSummary({ ...applySearchChoice({}, 'apartment_rent'), lotSizeTarget: { value: '2' }, bedsMin: { value: 'two' } });
  assert.deepEqual(apartment.numbers, []);
  assert.deepEqual(apartment.details, []);
  const garbage = basicsSummary({ searchType: 'purchase', budget: { value: 'NaN' }, sqftTarget: { value: undefined }, homeLayout: { values: [null, '', 'No Preference'] }, preferredPropertyTypes: { values: [undefined] } });
  const rendered = JSON.stringify(garbage);
  assert.doesNotMatch(rendered, /NaN|undefined|null|· ·|··/);
  assert.equal(garbage.setCount, 0);
});

test('empty, new, and mature searches use the right status language', () => {
  assert.equal(searchStatusCopy({ count: 3, firstRun: true }).title, 'Your search is ready.');
  assert.deepEqual(searchStatusCopy({ count: 8 }), { title: '8 priorities shape your Match', body: 'Changes here update how your homes measure up.' });
  assert.equal(searchStatusCopy({ count: 1 }).title, '1 priority shapes your Match');
  assert.match(searchStatusCopy({ count: 0 }).title, /Nothing is shaping your Match yet/);
  assert.equal(selectedPriorityCount({}), 0);
  assert.deepEqual(basicsSummary({}).setCount, 0);
  const panel = read('src/components/MySearchPanel.jsx');
  assert.match(panel, /Nothing ranked yet\./);
  assert.match(panel, /<SearchStatus count=\{matchShapingPriorityCount\(priorities\)\} firstRun=\{firstRun\} \/>/);
});

test('the overview opens focused editors instead of being one enormous form', () => {
  const panel = read('src/components/MySearchPanel.jsx');
  assert.match(panel, /href="\/search\/priorities"/);
  assert.match(panel, /href="\/search\/places"/);
  assert.doesNotMatch(panel, /<RankBoard|<PlacesEditor|<CommuteDestinations|How Match Scores Work/);
  assert.doesNotMatch(panel, /Home criteria/);
  assert.match(panel, /What I’m Looking For/);
});

/* --------------------------------- Rank Priorities editor --------------------------------- */

test('Rank Priorities editor edits a draft: Save writes the participant’s own row, Cancel/Back discard', () => {
  const editor = read('src/components/RankPrioritiesEditor.jsx');
  assert.match(editor, /const \[draft, setDraft\] = useState\(\(\) => normalizePriorities\(initialPriorities\)\)/);
  assert.match(editor, /await savePriorities\(createClient\(\), search, userId, draft\);/);
  assert.match(editor, /<SubpageHeader title="Rank Priorities" onBack=\{leave\} onCancel=\{leave\} \/>/);
  assert.match(editor, /const leave = \(\) => router\.push\('\/search'\);/);
  assert.match(editor, /Save priorities/);
  assert.match(editor, /changes will update how your homes measure up/);
  assert.match(editor, /Add a priority/);
  const page = read('src/app/(app)/search/priorities/page.js');
  assert.match(page, /resolvePriorities\(supabase, search, user\.id\)/);
});

/* --------------------------------- Places That Matter --------------------------------- */

test('Places summary names every place in stored order', () => {
  assert.deepEqual(placesSummary([{ label: 'Mom' }, { label: "Dad's" }]), { count: 2, names: "Mom · Dad's", countLabel: '2 places' });
  assert.deepEqual(placesSummary([{ label: 'Work' }]).countLabel, '1 place');
  assert.deepEqual(placesSummary([]), { count: 0, names: '', countLabel: '0 places' });
});

test('Places editor turns edits into the existing per-row operations, preserving labels, addresses, and thresholds', () => {
  const saved = [
    { id: 'a', label: 'Work', address: '1001 Woodward Ave, Detroit, MI', maxDriveMinutes: 30, coordinateStatus: 'pending' },
    { id: 'b', label: "Mom's", address: '44501 N Bunker Hill Dr', maxDriveMinutes: 40 },
    { id: 'c', label: "Dad's", address: '15325 Crestwood Dr', maxDriveMinutes: null },
  ];
  const draft = [
    { ...saved[0], key: 'a' },
    { ...saved[1], key: 'b', label: 'Mom', maxDriveMinutes: '45' },
    { id: null, key: 'new-1', label: ' School ', address: ' 1 School Rd ', maxDriveMinutes: '' },
  ];
  assert.deepEqual(planPlaceChanges(saved, draft), {
    creates: [{ key: 'new-1', values: { label: 'School', address: '1 School Rd', maxDriveMinutes: null } }],
    updates: [{ id: 'b', changes: { label: 'Mom', maxDriveMinutes: 45 } }],
    deletes: ['c'],
  });
  // Pending/missing commute data never removes a place; unchanged places are untouched.
  assert.deepEqual(planPlaceChanges(saved, saved), { creates: [], updates: [], deletes: [] });
});

test('place validation mirrors the existing rules', () => {
  assert.equal(placeDraftError({ label: 'Work', address: '1 Main', maxDriveMinutes: '' }), null);
  assert.equal(placeDraftError({ label: 'Work', address: '1 Main', maxDriveMinutes: '30' }), null);
  assert.match(placeDraftError({ label: '', address: '1 Main' }), /name/);
  assert.match(placeDraftError({ label: 'Work', address: ' ' }), /address/);
  assert.match(placeDraftError({ label: 'Work', address: '1 Main', maxDriveMinutes: '0' }), /minutes/);
  assert.match(placeDraftError({ label: 'Work', address: '1 Main', maxDriveMinutes: '1441' }), /minutes/);
});

test('Places editor: add, edit, delete, custom labels, thresholds, and a draft-then-save flow', () => {
  const editor = read('src/components/PlacesEditor.jsx');
  assert.match(editor, /<SubpageHeader title="Places that matter" onBack=\{leave\} onCancel=\{leave\} \/>/);
  assert.match(editor, /aria-label=\{`Edit \$\{place\.label\}`\}/);
  assert.match(editor, /aria-label=\{`Remove \$\{place\.label\}`\}/);
  assert.match(editor, /Add another place/);
  assert.match(editor, /Save places/);
  assert.match(editor, /\{minutes\} min max/);
  assert.match(editor, /No limit set/);
  // Commute times are never invented on this screen.
  assert.doesNotMatch(editor, /min drive|minutes away|commuteEvaluation/);
  assert.match(editor, /Match|compare homes/);
  const page = read('src/app/(app)/search/places/page.js');
  assert.match(page, /getCommuteDestinations\(supabase, search\.id, user\.id\)/);
});

test('Places input focus regression: a Sheet no longer re-runs its focus effect on every parent render', () => {
  const sheet = read('src/components/Sheet.jsx');
  assert.match(sheet, /const onCloseRef = useRef\(onClose\);\n\s+onCloseRef\.current = onClose;/);
  assert.match(sheet, /\}, \[open\]\);/);
  assert.doesNotMatch(sheet, /\}, \[open, onClose\]\);/);
});

/* --------------------------------- Searching Together --------------------------------- */

test('searching alone vs. together, without averaging, and with Realtor invites through the existing flow', () => {
  const panel = read('src/components/MySearchPanel.jsx');
  const invite = read('src/components/InviteCoBuyer.jsx');
  assert.match(panel, /Searching Together/);
  assert.match(panel, /You’re searching alone\./);
  assert.match(panel, /Invite a co-buyer or Realtor →/);
  assert.match(panel, /Both perspectives shape every Match\./);
  assert.match(panel, /The house is ours\. The opinion is mine\. The conversation is shared\./);
  assert.doesNotMatch(panel, /average|combined score|household/i);
  assert.match(invite, /value="realtor"/);
  assert.match(read('src/app/(app)/search/places/page.js'), /canInvite=\{isOwner && participantIds\.length < 2\}/);
});

/* --------------------------------- Navigation & safe areas --------------------------------- */

test('bottom navigation keeps the five buyer destinations with terracotta active emphasis', () => {
  assert.deepEqual(MOBILE_PRIMARY_TABS.map(({ label, href }) => [label, href]), [['Homes', '/homes'], ['Tour', '/tour'], ['Compare', '/compare'], ['Map', '/map'], ['Search', '/search']]);
  const css = read('src/app/globals.css');
  assert.match(css, /\.hh-mobile-nav-item\.active \{ color: var\(--brick\); \}/);
  const shell = read('src/components/AppShell.jsx');
  assert.match(shell, /pathname === href \|\| pathname\.startsWith\(`\$\{href\}\/`\)/);
});

test('focused editors own the phone screen and respect iOS safe areas', () => {
  const shell = read('src/components/AppShell.jsx');
  const css = read('src/app/globals.css');
  assert.match(shell, /FOCUSED_MOBILE_ROUTES = Object\.freeze\(\['\/search\/priorities', '\/search\/places'\]\)/);
  assert.match(css, /\.hh-focused-route \.hh-mobile-nav, \.hh-focused-route \.beta-feedback \{ display: none; \}/);
  assert.match(css, /\.flh-action-bar \{[^}]*padding: 18px 16px calc\(12px \+ env\(safe-area-inset-bottom\)\)/);
  assert.match(css, /\.flh-has-action-bar \{ padding-bottom: calc\(128px \+ env\(safe-area-inset-bottom\)\); \}/);
  // Top inset is owned by body; the sticky header sticks just below it.
  assert.match(css, /\.hh-focused-route \.flh-subpage-header \{ padding-top: var\(--flh-flow-top-10\); \}/);
  assert.match(css, /\.flh-subpage-header \{ position: sticky; top: var\(--flh-safe-top\);/);
  assert.match(css, /\.flh-onboarding \{[^}]*padding: var\(--flh-flow-top-20\) 0 calc\(24px \+ env\(safe-area-inset-bottom\)\)/);
  // iOS doesn't zoom inputs at 16px.
  assert.match(css, /\.flh-input \{[^}]*font: 400 16px/);
});

test('Match weights and the Unknown rule are untouched by this pass', () => {
  assert.deepEqual([TIER_META.must.weight, TIER_META.important.weight, TIER_META.nice.weight], [4, 2, 1]);
  assert.deepEqual(getItemlistCategories('purchase').map((def) => def.key), ['location', 'features', 'exterior']);
});
