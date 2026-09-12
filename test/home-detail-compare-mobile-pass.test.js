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

test('homeFactRows takes full priorities and hides Home-only physical facts for Apartment-to-Rent searches', () => {
  assert.match(compareBoard, /import \{ TOUR_RATING_KEY, criterionDisplayLabel, isApartmentRental \} from '@\/lib\/constants'/);
  assert.match(compareBoard, /function homeFactRows\(priorities\) \{/);
  assert.match(compareBoard, /const apartment = isApartmentRental\(priorities\);/);
  assert.match(compareBoard, /APARTMENT_IRRELEVANT_FACT_KEYS = new Set\(\['lot', 'garage', 'year'\]\)/);
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
  assert.match(compareBoard, /function PickerChip\(\{ home, priorities, match, isSelected, disabled, onToggle \}\)/);
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
