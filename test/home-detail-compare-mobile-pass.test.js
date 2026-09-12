import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(p, 'utf8');

const mobileDisclosure = read('src/components/MobileDisclosure.jsx');
const homesBoard = read('src/components/HomesBoard.jsx');
const homeDetail = read('src/components/HomeDetail.jsx');
const compareBoard = read('src/components/CompareBoard.jsx');
const globalsCss = read('src/app/globals.css');

/* ------------------------------ MobileDisclosure ------------------------------ */

test('MobileDisclosure generalizes the card disclosure pattern with the same default behavior', () => {
  assert.match(mobileDisclosure, /export default function MobileDisclosure\(\{ label = 'More details', breakpoint = 640, className = 'hh-card-context', children \}\)/);
  assert.match(mobileDisclosure, /useState\(true\)/);
  assert.match(mobileDisclosure, /window\.matchMedia\(`\(max-width: \$\{breakpoint\}px\)`\)/);
  assert.match(mobileDisclosure, /hh-card-context-details/);
  assert.match(mobileDisclosure, /hh-card-context-summary/);
});

test('HomesBoard reuses the shared MobileDisclosure instead of a local CardContextDisclosure', () => {
  assert.doesNotMatch(homesBoard, /function CardContextDisclosure/);
  assert.match(homesBoard, /import MobileDisclosure from '@\/components\/MobileDisclosure'/);
  assert.match(homesBoard, /<MobileDisclosure>/);
});

test('Home Detail reuses the same shared disclosure for a long commute list, not a parallel implementation', () => {
  assert.match(homeDetail, /import MobileDisclosure from '@\/components\/MobileDisclosure'/);
  assert.match(homeDetail, /commuteDestinations\.length > 2 \?[\s\S]{0,120}<MobileDisclosure/);
});

/* -------------------------------- Home Detail hero -------------------------------- */

test('mobile hero puts the photo before identity, matching the spec\'d hierarchy', () => {
  const mobileHero = globalsCss.match(/@media\(max-width:720px\) \{[\s\S]*?\n\}/)?.[0] || '';
  assert.ok(mobileHero, 'expected the ≤720px hero breakpoint block');
  assert.match(mobileHero, /\.hh-detail-photo \{[^}]*order: 1;/);
  assert.match(mobileHero, /\.hh-detail-identity \{[^}]*order: 2;/);
});

/* ------------------------------ Compare: apartment-aware facts ------------------------------ */

test('homeFactRows takes full priorities and hides only the genuinely Home-only physical fact (Lot) for Apartment-to-Rent searches', () => {
  assert.match(compareBoard, /import \{ TOUR_RATING_KEY, criterionDisplayLabel, isApartmentRental \} from '@\/lib\/constants'/);
  assert.match(compareBoard, /function homeFactRows\(priorities\) \{/);
  assert.match(compareBoard, /const apartment = isApartmentRental\(priorities\);/);
  // Lot has no per-unit meaning for a shared community. Garage and Year
  // built ARE valid, real apartment/community facts when known (assigned
  // parking, when the building was built) — they must NOT be categorically
  // suppressed just because the search is Apartment to Rent.
  assert.match(compareBoard, /APARTMENT_IRRELEVANT_FACT_KEYS = new Set\(\['lot'\]\)/);
  assert.doesNotMatch(compareBoard, /APARTMENT_IRRELEVANT_FACT_KEYS = new Set\(\[[^\]]*'garage'/);
  assert.doesNotMatch(compareBoard, /APARTMENT_IRRELEVANT_FACT_KEYS = new Set\(\[[^\]]*'year'/);
  assert.match(compareBoard, /homeFactRows\(priorities\)\.filter/);
  // Beds/baths/sqft/days-on-market are still per-listing facts for an
  // apartment unit, so PHYSICAL_FACT_ROWS itself must stay shared — a
  // filtered copy is built per call, never mutated in place.
  assert.match(compareBoard, /const physicalRows = apartment \? PHYSICAL_FACT_ROWS\.filter\(\(row\) => !APARTMENT_IRRELEVANT_FACT_KEYS\.has\(row\.key\)\) : PHYSICAL_FACT_ROWS;/);
});

/* ------------------------------ Compare: vertical mobile rows ------------------------------ */

test('Must-Haves, What matters to you, and {Singular} facts all go through the shared CompareRowsSection', () => {
  const usages = compareBoard.match(/<CompareRowsSection[\s\S]*?\/>/g) || [];
  assert.equal(usages.length, 3, 'expected exactly three CompareRowsSection usages (Must-Haves, What matters, Facts)');
  assert.match(compareBoard, /title="Must-Haves"/);
  assert.match(compareBoard, /title="What matters to you"/);
});

test('CompareRowsSection renders both a desktop grid and a mobile vertical grouping, like CommuteSection', () => {
  const section = compareBoard.match(/function CompareRowsSection\([\s\S]*?\n\}/)?.[0] || '';
  assert.ok(section);
  assert.match(section, /hh-compare-rows-desktop hh-scrollx/);
  assert.match(section, /hh-compare-rows-mobile/);
  assert.match(section, /hh-compare-rows-mobile-group/);
});

test('the compare-rows CSS toggles desktop/mobile at the same 640px boundary as Commute, never a JS-computed layout', () => {
  assert.match(globalsCss, /\.hh-compare-rows-mobile \{ display: none; \}/);
  const block = globalsCss.match(/@media \(max-width: 640px\) \{\s*\n\s*\.hh-compare-rows-desktop[\s\S]*?\n\}/)?.[0] || '';
  assert.ok(block, 'expected a 640px block toggling .hh-compare-rows-desktop/.hh-compare-rows-mobile');
  assert.match(block, /\.hh-compare-rows-desktop \{ display: none; \}/);
  assert.match(block, /\.hh-compare-rows-mobile \{ display: flex;/);
});

/* ------------------------------ Compare: contender picker ------------------------------ */

test('the contender picker shows a thumbnail/fallback, identity, and a quick Match badge per home', () => {
  assert.match(compareBoard, /function PickerChip\(\{ home, priorities, match, matchTrustworthy, isSelected, disabled, onToggle \}\)/);
  assert.match(compareBoard, /hh-compare-picker-thumb/);
  assert.match(compareBoard, /hh-compare-picker-name/);
  assert.match(compareBoard, /hh-compare-picker-match/);
  // Falls back to the same empty-photo icon used elsewhere — no new
  // placeholder system introduced for this.
  assert.match(compareBoard, /<HomeIcon size=\{13\}/);
});

test('the picker computes Match for every candidate home, not only the ones currently selected, and never touches commute/scoring logic', () => {
  assert.match(compareBoard, /const pickerMatches = useMemo\(\(\) => \{/);
  assert.match(compareBoard, /homes\.forEach\(\(home\) => byId\.set\(home\.id, computeMatch\(home, priorities\)\)\)/);
  // Deliberately no commute evaluation passed here — see the code comment;
  // this must never be confused with the real per-selected-home matches used
  // for the actual comparison rows below.
  assert.doesNotMatch(compareBoard, /computeMatch\(home, priorities, evaluateCommute/);
});

/* --------------------------- picker Match trust guard --------------------------- */

test('PickerChip never labels a number "% Match" unless matchTrustworthy says so — untrustworthy shows neither a stale nor a guessed percentage', () => {
  const chip = compareBoard.match(/function PickerChip\([\s\S]*?\n\}/)?.[0] || '';
  assert.ok(chip);
  // Exactly one branch is allowed to render match.pct, and it must require
  // matchTrustworthy in the same condition — not check it separately from a
  // sibling branch that could independently fall through to the number.
  assert.match(chip, /matchTrustworthy && match\?\.pct != null \? \(\s*<span className="hh-compare-picker-match" style=\{\{ color: matchColor\(match\.pct\) \}\}>\{match\.pct\}% Match<\/span>/);
  // The untrustworthy branch is a fixed string, not derived from match at all.
  assert.match(chip, /: \(\s*<span className="hh-compare-picker-match is-unset">Select to see Match<\/span>\s*\)/);
  const pctOccurrences = chip.match(/match\.pct/g) || [];
  assert.equal(pctOccurrences.length, 2, 'match.pct should appear exactly twice: the trustworthy guard condition and its own display — never inside the untrustworthy branch');
});

test('the picker only ever trusts its no-commute Match when Commute is not actually a selected priority', () => {
  assert.match(compareBoard, /const commuteIsSelectedPriority = useMemo\(/);
  assert.match(compareBoard, /m\?\.allSelected\?\.some\(\(c\) => c\.key === 'location:Commute'\)/);
  assert.match(compareBoard, /const pickerMatchTrustworthy = !commuteIsSelectedPriority;/);
  assert.match(compareBoard, /matchTrustworthy=\{pickerMatchTrustworthy\}/);
});

test('regression: the no-commute picker Match is byte-for-byte identical to the canonical commute-aware Match whenever Commute is not selected, and provably diverges when it is', async () => {
  // Real execution, not a source pattern — this is the actual claim being
  // protected: "a percentage labeled Match must mean the same thing
  // everywhere." matching.js and commute.js are plain modules with no JSX,
  // so they can be imported and run directly, same as the existing
  // isNativeApp()/homeIdentity() real-logic tests elsewhere in this suite.
  const { computeMatch } = await import('../src/lib/matching.js');
  const { evaluateCommute } = await import('../src/lib/commute.js');

  const home = { id: 'h1', address: '123 Main St', price: '400000' };
  const destinations = [{ id: 'd1', label: 'Work', address: '456 Work Ave', maxDriveMinutes: 20 }];
  const resolvedOk = () => ({ status: 'ok', minutes: 10 });

  // Case A: Commute is NOT a selected priority at all — nothing in
  // priorities makes computeMatch look at commuteEvaluation, so the
  // no-commute picker calculation already IS the canonical one.
  const noCommutePriorities = { searchType: 'buy', bedsMin: { value: '2', tier: 'important' } };
  const picker = computeMatch(home, noCommutePriorities);
  const canonical = computeMatch(home, noCommutePriorities, evaluateCommute(destinations, resolvedOk));
  assert.deepEqual(picker, canonical);
  assert.equal(picker.allSelected.some((c) => c.key === 'location:Commute'), false);

  // Case B: Commute IS a selected priority — the exact scenario the fix
  // guards against. WithOUT commute data (what the picker would compute),
  // Commute reads as not-evaluated and there's nothing else selected, so
  // pct is null ("not enough information"). WITH real commute data (what
  // the same home would show the moment it's actually selected), Commute
  // evaluates as met and pct becomes 100. Same home, same priorities, two
  // different percentages — proving why the picker must not show either one
  // unlabeled as trustworthy "Match".
  const commutePriorities = { searchType: 'buy', location: { tiers: { Commute: 'must' } } };
  const withoutCommute = computeMatch(home, commutePriorities);
  const withCommute = computeMatch(home, commutePriorities, evaluateCommute(destinations, resolvedOk));
  assert.equal(withoutCommute.pct, null);
  assert.equal(withCommute.pct, 100);
  assert.notEqual(withoutCommute.pct, withCommute.pct);
  // And the structural signal CompareBoard uses to detect this case is
  // present on the no-commute result, which is all it ever has to work with.
  assert.equal(withoutCommute.allSelected.some((c) => c.key === 'location:Commute'), true);
});

test('touch targets on the new picker chips meet the ~44px guidance', () => {
  assert.match(globalsCss, /\.hh-compare-picker-chip \{[^}]*min-height: 44px;/);
});

/* ------------------------------ unknown-vs-failure guard ------------------------------ */

test('regression guard: Match/Compare unknown-vs-missed-vs-met visual language is untouched by this pass', () => {
  // CriteriaValue's three states must still exist exactly as before — this
  // pass changed row *layout*, never how met/missed/unknown are decided or
  // colored. Missed must never be styled with a failure/red treatment.
  assert.match(compareBoard, /is-unknown.*Not evaluated/);
  assert.match(compareBoard, /c\.met \? 'is-met' : 'is-missed'/);
  assert.doesNotMatch(compareBoard, /is-missed[^}]*color:\s*var\(--brick\)/);
});
