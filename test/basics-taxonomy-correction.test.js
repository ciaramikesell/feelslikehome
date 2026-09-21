import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  normalizePriorities, defaultPriorities, LAYOUT_OPTIONS, HOME_CONDITION_OPTIONS,
  MULTISELECT_CATEGORIES, showsMultiselectCategory, isApartmentRental,
} from '../src/lib/constants.js';
import { parseNum } from '../src/lib/matching.js';
import { searchIntentCapabilities } from '../src/lib/searchIntent.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

/* ------------------------------ Root cause: the $NaN / NaN+ bug ------------------------------ */

test('parseNum safely handles the exact comma-formatted strings the Basics inputs actually produce', () => {
  // These are the literal placeholder shapes shown by both Onboarding's and My
  // Search's budget/sqft inputs ("450,000", "1,800") — a user typing exactly what
  // the placeholder shows previously produced Number("450,000") === NaN.
  assert.equal(parseNum('450,000'), 450000);
  assert.equal(parseNum('1,800'), 1800);
  assert.equal(parseNum(''), null);
  assert.equal(parseNum(undefined), null);
  assert.equal(Number.isNaN(parseNum('450,000')), false);
});

test('MySearchPanel builds the "What I\'m Looking For" summary using the safe parseNum helper, not raw Number()', () => {
  const panel = read('src/components/MySearchPanel.jsx');
  assert.match(panel, /import \{ parseNum \} from '@\/lib\/matching'/);
  assert.match(panel, /const budget = parseNum\(p\.budget\?\.value\)/);
  assert.match(panel, /const sqft = parseNum\(p\.sqftTarget\?\.value\)/);
  // The raw, NaN-prone pattern must never reappear in the summary builder.
  assert.doesNotMatch(panel, /Number\(p\.budget\.value\)/);
  assert.doesNotMatch(panel, /Number\(p\.sqftTarget\.value\)/);
});

test('a comma-formatted budget/sqft never renders NaN, $NaN, undefined, or null in the summary logic', () => {
  // Exercises the exact real-world input path: a user types the placeholder value
  // verbatim into a plain text field, exactly as My Search's ObjectiveRow allows.
  const budget = parseNum('450,000');
  const sqft = parseNum('1,800');
  const budgetLine = budget !== null ? `Up to $${budget.toLocaleString()}` : null;
  const sqftLine = sqft !== null ? `${sqft.toLocaleString()}+ sq ft` : null;
  assert.equal(budgetLine, 'Up to $450,000');
  assert.equal(sqftLine, '1,800+ sq ft');
  for (const line of [budgetLine, sqftLine]) {
    assert.doesNotMatch(line, /NaN/);
    assert.doesNotMatch(line, /undefined|null/);
  }
});

test('an absent budget/sqft/lot size renders nothing (no empty "$NaN" or "NaN+" placeholder row)', () => {
  const p = defaultPriorities();
  assert.equal(parseNum(p.budget.value), null);
  assert.equal(parseNum(p.sqftTarget.value), null);
  assert.equal(parseNum(p.lotSizeTarget.value), null);
});

/* ------------------------------ Basics round-trip through normalizePriorities ------------------------------ */

test('budget and square footage survive normalizePriorities unchanged (the round-trip the bug lived in)', () => {
  const p = normalizePriorities({ searchType: 'purchase', budget: { value: '450,000', tier: 'important' }, sqftTarget: { value: '1,800', tier: 'nice' } });
  assert.equal(p.budget.value, '450,000');
  assert.equal(p.sqftTarget.value, '1,800');
  assert.equal(parseNum(p.budget.value), 450000);
  assert.equal(parseNum(p.sqftTarget.value), 1800);
});

test('minimum lot size persists through normalizePriorities and supports fractional values', () => {
  const p = normalizePriorities({ searchType: 'purchase', lotSizeTarget: { value: '0.25', tier: 'dontcare' } });
  assert.equal(p.lotSizeTarget.value, '0.25');
  assert.equal(parseNum(p.lotSizeTarget.value), 0.25);
});

/* ------------------------------ New Basics fields: onboarding collects the same canonical fields My Search edits ------------------------------ */

test('onboarding Basics collects Minimum Lot Size, Home Types, Home Layout, and Home Condition using the same predicates My Search uses', () => {
  const onboarding = read('src/components/onboarding/Onboarding.jsx');
  const panel = read('src/components/MySearchPanel.jsx');
  // Reuses the exact same gating helpers as My Search's BasicsCard — the
  // drift-prevention mechanism this pass relies on instead of a full shared
  // component (onboarding has no per-field tier picker; My Search does).
  assert.match(onboarding, /import \{ normalizePriorities, hasQualifierOptions, MULTISELECT_CATEGORIES, showsMultiselectCategory, isApartmentRental \} from '@\/lib\/constants'/);
  assert.match(onboarding, /!isApartmentRental\(priorities\) && <BasicsField label="Minimum lot size"/);
  assert.match(onboarding, /MULTISELECT_CATEGORIES\.filter\(\(def\) => showsMultiselectCategory\(def\.key, priorities\.searchType\)\)\.map/);
  assert.match(onboarding, /What kinds of homes are you considering\?/);
  assert.match(panel, /!isApartmentRental\(p\) && <ObjectiveRow label="Minimum Lot Size"/);
  assert.match(panel, /MULTISELECT_CATEGORIES\.filter\(\(def\) => showsMultiselectCategory\(def\.key, p\.searchType\)\)\.map/);
});

test('Home Types supports multiple simultaneous selections and never implies an implicit House default', () => {
  const p = defaultPriorities();
  assert.deepEqual(p.preferredPropertyTypes.values, []); // no selection, never implicit House
  const capabilities = searchIntentCapabilities('purchase');
  assert.ok(capabilities.preferredPropertyTypeOptions.includes('house'));
  assert.ok(capabilities.preferredPropertyTypeOptions.includes('condo'));
  assert.ok(capabilities.preferredPropertyTypeOptions.includes('multifamily'));
  const withBoth = normalizePriorities({ searchType: 'purchase', preferredPropertyTypes: { values: ['house', 'condo'], tier: 'important' } });
  assert.deepEqual(withBoth.preferredPropertyTypes.values, ['house', 'condo']); // House + Condo both valid together
});

test('Home Layout supports Ranch/Two Story/Other only, and Home Condition supports the three specified options — neither has an explicit "No Preference"', () => {
  assert.deepEqual(LAYOUT_OPTIONS, ['Ranch', 'Two Story', 'Other']);
  assert.deepEqual(HOME_CONDITION_OPTIONS, ['New Construction', 'Move-in Ready', 'Renovation Potential']);
  const layoutDef = MULTISELECT_CATEGORIES.find((def) => def.key === 'homeLayout');
  const conditionDef = MULTISELECT_CATEGORIES.find((def) => def.key === 'homeCondition');
  assert.equal(layoutDef.optional, true);
  assert.equal(conditionDef.optional, true);
});

test('Home Condition supports multiple simultaneous selections (e.g. Move-in Ready + Renovation Potential)', () => {
  const p = normalizePriorities({ searchType: 'purchase', homeCondition: { values: ['Move-in Ready', 'Renovation Potential'], tier: 'dontcare' } });
  assert.deepEqual(p.homeCondition.values, ['Move-in Ready', 'Renovation Potential']);
});

test('no selection for Home Types/Layout/Condition means open/unspecified — never an implicit default', () => {
  const p = defaultPriorities();
  assert.deepEqual(p.preferredPropertyTypes.values, []);
  assert.deepEqual(p.homeLayout.values, []);
  assert.deepEqual(p.homeCondition.values, []);
});

test('the old "More specific layout preferences" bedroom sub-picker is removed from My Search, but its stored data model is preserved non-destructively', () => {
  const panel = read('src/components/MySearchPanel.jsx');
  assert.doesNotMatch(panel, /BedroomSubPreferences/);
  assert.doesNotMatch(panel, /More specific layout preferences/);
  assert.doesNotMatch(panel, /SINGLESELECT_CATEGORIES/);
  // The underlying fields still exist in the data model and still score in Match —
  // only the UI control that collected them is gone (see computeMatch's
  // SINGLESELECT_CATEGORIES.forEach, untouched by this pass).
  const p = defaultPriorities();
  assert.ok(Object.hasOwn(p, 'primaryBedroomLocation'));
  assert.ok(Object.hasOwn(p, 'secondaryBedroomLocation'));
});

/* ------------------------------ Legacy value-casing folds (non-destructive) ------------------------------ */

test('a legacy "Ranch / Single Story" layout value safely renames to "Ranch"; unmappable legacy values ("Split Level") are preserved untouched, not guessed', () => {
  const renamed = normalizePriorities({ searchType: 'purchase', homeLayout: { values: ['Ranch / Single Story'], tier: 'dontcare' } });
  assert.deepEqual(renamed.homeLayout.values, ['Ranch']);
  const preserved = normalizePriorities({ searchType: 'purchase', homeLayout: { values: ['Split Level'], tier: 'dontcare' } });
  assert.deepEqual(preserved.homeLayout.values, ['Split Level']); // no equivalent among Ranch/Two Story/Other — left as-is
});

test('a legacy "Move-In Ready" home condition value safely renames to "Move-in Ready" casing', () => {
  const renamed = normalizePriorities({ searchType: 'purchase', homeCondition: { values: ['Move-In Ready'], tier: 'dontcare' } });
  assert.deepEqual(renamed.homeCondition.values, ['Move-in Ready']);
});

/* ------------------------------ Rentals field-set audit ------------------------------ */

test('apartment rentals never show Minimum Lot Size or Home Condition; home rentals keep Minimum Lot Size but not Home Layout/Home Condition', () => {
  assert.equal(isApartmentRental('apartment_rent'), true);
  assert.equal(isApartmentRental('home_rent'), false);
  assert.equal(showsMultiselectCategory('homeLayout', 'rental'), false); // purchase-only, per showsHomeLayout
  assert.equal(showsMultiselectCategory('homeCondition', 'rental'), false); // simple-rental-hidden, per isSimpleRentalType
  assert.equal(showsMultiselectCategory('homeLayout', 'purchase'), true);
  assert.equal(showsMultiselectCategory('homeCondition', 'purchase'), true);
});
