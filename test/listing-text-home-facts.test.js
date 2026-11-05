// Smart Listing Details Paste (src/lib/listingTextHomeFacts.js,
// docs/smart-listing-details-paste.md): pasted listing text suggests shared Home
// Facts with the sentence that states each one. Nothing is written until the
// buyer chooses Use, and then only into an empty field. Match scoring, personal
// answers and the Match Reveal trigger are unchanged.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  HOME_FACT_SUGGESTION_FIELDS, applyHomeFactSuggestion, combineImportResults, importResultWithHomeFacts,
  personalSuggestionStatus, personalSuggestionsAnsweredBy, readHomeFactsFromText, resuggestHomeFacts, suggestHomeFacts, undoHomeFactSuggestion, visiblePersonalSuggestions,
} from '../src/lib/listingTextHomeFacts.js';
import { resuggestListingAnswers, suggestListingAnswers } from '../src/lib/listingTextAnswers.js';
import { listingImportSnapshot } from '../src/lib/importSnapshot.js';
import { fieldProvenance } from '../src/lib/homeProvenance.js';
import { computeMatch } from '../src/lib/matching.js';
import { resolveCriterionAnswer } from '../src/lib/homeFactCriteria.js';
import { crossedRevealThreshold, matchCompleteness } from '../src/lib/matchReveal.js';
import { emptyHome, normalizePriorities } from '../src/lib/constants.js';
import { addCriterion } from '../src/lib/searchProfile.js';
import { switchSearchType } from '../src/lib/whatMattersCatalog.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const facts = (text, home = {}) => Object.fromEntries(suggestHomeFacts(text, home).map((item) => [item.field, item.value]));
const start = (type) => switchSearchType(normalizePriorities({}), type).priorities;
const select = (priorities, ...entries) => entries.reduce((next, [categoryKey, label, tier = 'important']) => addCriterion(next, { categoryKey, label, kind: 'check' }, tier), priorities);

/* --------------------------------- Each field --------------------------------- */

test('basement condition and style: only what the text names outright', () => {
  assert.deepEqual(facts('Finished walkout basement with a wet bar.'), { basementCondition: 'finished', basementStyle: 'walkout' });
  assert.deepEqual(facts('The basement is fully finished.'), { basementCondition: 'finished' });
  assert.deepEqual(facts('Unfinished basement offers great storage.'), { basementCondition: 'unfinished' });
  assert.deepEqual(facts('Partially finished basement with rec room.'), { basementCondition: 'partially_finished' });
  assert.deepEqual(facts('Lower level walks out to the patio.'), { basementStyle: 'walkout' });
  assert.deepEqual(facts('Slab foundation. No basement.'), { basementCondition: 'none' });
  // "Not finished" could be partly finished: no condition is suggested.
  assert.deepEqual(facts('Basement is not finished.'), {});
  assert.deepEqual(facts('Basement could be finished for extra living space.'), {});
  assert.deepEqual(facts('Basement is ready to finish.'), {});
  assert.deepEqual(facts('Plans available for a future finished basement.'), {});
  assert.deepEqual(facts('Crawl space only.'), {});
  // Contrary wording anywhere, even hedged or "as-is", cancels the suggestion.
  assert.deepEqual(facts('Finished basement with a bar. Per seller, the basement is unfinished and sold as-is.'), {});
  assert.deepEqual(facts('Finished basement. Partially finished lower level.'), {});
  assert.deepEqual(facts('Basement.'), {});
  assert.deepEqual(facts('Finished basement apartment with its own entrance.'), {}, 'a unit in the basement says nothing about the basement itself');
  // Contradictions answer nothing.
  assert.deepEqual(facts('Finished basement. The basement is unfinished.'), {});
  assert.deepEqual(facts('No basement. Walkout lower level.'), {});
  assert.deepEqual(facts('No basement. Laundry in the basement.'), {}, 'laundry placed in a basement contradicts "no basement"');
});

test('laundry location: one stated location, never hookups or "upstairs"', () => {
  assert.deepEqual(facts('Laundry on the main level.'), { laundryLocation: 'first_floor' });
  assert.deepEqual(facts('First-floor laundry room off the kitchen.'), { laundryLocation: 'first_floor' });
  assert.deepEqual(facts('Second-floor laundry next to the bedrooms.'), { laundryLocation: 'second_floor' });
  assert.deepEqual(facts('Laundry is in the basement.'), { laundryLocation: 'basement' });
  assert.deepEqual(facts('Upstairs laundry.'), {}, 'upstairs is not necessarily the second floor');
  assert.deepEqual(facts('Laundry hookups in the basement.'), {});
  assert.deepEqual(facts('Room for first-floor laundry.'), {});
  assert.deepEqual(facts('Community laundry on the first floor.'), {});
  assert.deepEqual(facts('First-floor laundry. Laundry in the basement.'), {}, 'two locations conflict');
});

test('primary bedroom: Main floor or Upstairs only when said', () => {
  assert.deepEqual(facts('Primary suite on the first floor with a private bath.'), { primaryBedroomLocation: 'Main Floor' });
  assert.deepEqual(facts('Main-level primary bedroom.'), { primaryBedroomLocation: 'Main Floor' });
  assert.deepEqual(facts('Primary bedroom upstairs.'), { primaryBedroomLocation: 'Upstairs' });
  assert.deepEqual(facts('All four bedrooms are upstairs.'), { primaryBedroomLocation: 'Upstairs' });
  assert.deepEqual(facts('Bedroom on the main level.'), {}, 'a bedroom is not the primary');
  assert.deepEqual(facts('Optional first-floor primary suite.'), {});
  assert.deepEqual(facts('No first-floor primary.'), {}, 'not on the main floor is not proof it is upstairs');
});

test('garage type and spaces', () => {
  assert.deepEqual(facts('Attached 2-car garage.'), { garageType: 'attached', garageSpaces: '2' });
  assert.deepEqual(facts('Two car attached garage with storage.'), { garageType: 'attached', garageSpaces: '2' });
  assert.deepEqual(facts('Oversized 2.5 car detached garage.'), { garageType: 'detached', garageSpaces: '2.5' });
  assert.deepEqual(facts('Garage spaces: 3'), { garageSpaces: '3' });
  assert.deepEqual(facts('Parking\nGarage: 2\nDriveway'), { garageSpaces: '2' });
  assert.deepEqual(facts('No garage.'), { garageSpaces: '0' });
  assert.deepEqual(facts('Garage: none'), { garageSpaces: '0' });
  assert.deepEqual(facts('Detached garage 24x30 with workshop.'), { garageType: 'detached' }, '"garage 24" is never 24 spaces');
  assert.deepEqual(facts('No garage door opener.'), {});
  assert.deepEqual(facts('Room for a 3-car garage.'), {});
  assert.deepEqual(facts('Detached carport.'), {});
  assert.deepEqual(facts('2-car garage converted to a family room.'), {});
  assert.deepEqual(facts('Attached garage and a detached garage.'), {}, 'both types conflict');
  assert.deepEqual(facts('2-car garage plus a 3-car garage out back.'), {}, 'two counts conflict');
  assert.deepEqual(facts('Shared garage space available for rent.'), {});
});

test('HOA fee: a regular fee with an explicit period only', () => {
  assert.deepEqual(facts('HOA $85/month covers snow removal.'), { hoaFeeMonthly: 85 });
  assert.deepEqual(facts('HOA fee: $250 monthly.'), { hoaFeeMonthly: 250 });
  assert.deepEqual(facts('HOA dues of $1,200 per year.'), { hoaFeeMonthly: 100 });
  assert.deepEqual(facts('Annual HOA dues: $600.'), { hoaFeeMonthly: 50 });
  assert.deepEqual(facts('$450 quarterly association fee.'), { hoaFeeMonthly: 150 });
  assert.deepEqual(facts('HOA fee $250.'), {}, 'no period, no fee');
  assert.deepEqual(facts('No HOA.'), {}, '"No HOA" is not a $0 fee');
  assert.deepEqual(facts('Special assessment of $2,000 per year.'), {});
  assert.deepEqual(facts('HOA transfer fee $300 per year.'), {});
  assert.deepEqual(facts('Approximately $90/month HOA.'), {});
  assert.deepEqual(facts('Voluntary HOA $50/year.'), {});
  assert.deepEqual(facts('HOA $85/month. HOA dues $1,500 per year.'), {}, 'two different fees conflict');
  const [fee] = suggestHomeFacts('HOA dues: $1,200 annually.');
  assert.equal(fee.display, '$100/mo ($1,200 per year)');
});

/* ---------------------------------- Schools ----------------------------------- */

test('schools: a district the listing names, never inferred, ranked or verified', () => {
  assert.deepEqual(facts('Located in the award-winning Rochester Community Schools.'), { schoolDistrict: 'Rochester Community Schools' });
  assert.deepEqual(facts('Top-Rated Novi Community School District.'), { schoolDistrict: 'Novi Community School District' });
  assert.deepEqual(facts('Home is in the Plymouth-Canton school district.'), { schoolDistrict: 'Plymouth-Canton School District' });
  assert.deepEqual(facts('School district: Ann Arbor Public Schools\nElementary school: Lakewood Elementary School  Grades: K-5  Distance: 0.4 mi\nMiddle school: Forsythe Middle School\nHigh school: Pioneer High School (8/10)'), {
    schoolDistrict: 'Ann Arbor Public Schools', elementarySchool: 'Lakewood Elementary School', middleSchool: 'Forsythe Middle School', highSchool: 'Pioneer High School',
  });
  assert.deepEqual(facts('Great kitchen. School district: Troy School District. Big yard.'), { schoolDistrict: 'Troy School District' });
  // Praise, rankings and nearness are not a district.
  for (const text of ['Top-rated schools!', 'Award-winning schools nearby.', 'Minutes from Novi Community School District.', 'Walking distance to Rochester Community Schools.',
    'Close to Ann Arbor Public Schools.', 'Buyer to verify school district: Troy School District.', 'Schools of choice: Walled Lake Consolidated Schools.',
    'School district: TBD', 'School district: Unknown', 'Public Schools', 'Private Catholic Schools.', 'Near the Lakeview Academy.']) {
    assert.deepEqual(facts(text), {}, text);
  }
  // Two districts named: ambiguous.
  assert.deepEqual(facts('Northville Public Schools or Novi Community Schools.'), {});
  assert.deepEqual(facts('Northville Public Schools. Ann Arbor Public Schools.'), {});
  // An address, city or ZIP is never turned into a district.
  assert.deepEqual(facts('123 Maple St, Ann Arbor, MI 48104. 3 beds, 2 baths.'), {});
  const [district] = suggestHomeFacts('Rochester Community Schools.');
  assert.equal(district.school, true);
});

test('school text never becomes a Reputable Schools answer', () => {
  const buyer = select(start('home_buy'), ['location', 'Reputable Schools', 'must'], ['location', 'Walkable schools']);
  const text = 'Award-winning Rochester Community Schools! Top-rated schools. Walk to Musson Elementary.';
  assert.deepEqual(suggestListingAnswers(text, buyer), []);
  assert.equal(suggestHomeFacts(text).some((item) => /Reputable|Walkable/.test(item.field)), false);
  const home = applyHomeFactSuggestion(emptyHome(), suggestHomeFacts(text)[0]);
  assert.equal(resolveCriterionAnswer(home, 'location:Reputable Schools', {}).value, undefined, 'still Unknown');
});

/* -------------------------------- Long paragraphs -------------------------------- */

const REAL_WORLD = `Welcome to 4120 Lakeview Ct! This beautifully updated 4 bed, 3.5 bath colonial sits on a quiet cul-de-sac in the sought-after Rochester Community Schools. The open floor plan features hardwood floors, a chef's kitchen with quartz counters and a walk-in pantry, and a cozy gas fireplace in the family room. Primary suite on the first floor with a walk-in closet. The primary bedroom has an ensuite bath. Three more bedrooms upstairs share a Jack-and-Jill bath. Laundry on the main level. The finished walkout basement adds a rec room, full bath and plenty of storage. Attached 2-car garage. Fully fenced backyard with a paver patio. HOA $40/month covers common area maintenance and the community pool. Roof replaced in 2019. Seller is offering a closing credit.`;

test('a long real-world description: every stated fact, nothing else', () => {
  assert.deepEqual(facts(REAL_WORLD), {
    basementCondition: 'finished', basementStyle: 'walkout', laundryLocation: 'first_floor', primaryBedroomLocation: 'Main Floor',
    garageType: 'attached', garageSpaces: '2', hoaFeeMonthly: 40, schoolDistrict: 'Rochester Community Schools',
  });
  for (const item of suggestHomeFacts(REAL_WORLD)) assert.ok(REAL_WORLD.replace(/\s+/g, ' ').includes(item.evidence.replace(/…$/, '')), `evidence is the listing's own sentence: ${item.evidence}`);
});

const CONFLICTED = `Charming bungalow! Finished basement with a bar. NOTE: per seller, the basement is unfinished and sold as-is. Laundry on the first floor; laundry room in the basement as well. Primary bedroom on the main level. Primary bedroom upstairs with vaulted ceilings. Detached 1-car garage. HOA fee: $25 monthly. Annual HOA dues $600. Northville Public Schools. Close to Novi Community Schools.`;

test('a long description that contradicts itself suggests only what it says once', () => {
  assert.deepEqual(facts(CONFLICTED), { garageType: 'detached', garageSpaces: '1', schoolDistrict: 'Northville Public Schools' });
});

const HEDGED = `Bring your vision! Basement could be finished. Space for a future 3-car garage. Laundry hookups on the second floor. Possible first-floor primary suite. Buyer to verify HOA, est. $100/month. Top-rated schools nearby. Taxes and school assignment subject to change.`;

test('a description that only hedges suggests nothing', () => {
  assert.deepEqual(readHomeFactsFromText(HEDGED), []);
  assert.deepEqual(readHomeFactsFromText(''), []);
  assert.deepEqual(readHomeFactsFromText(null), []);
});

/* ------------------------------ Never overwrite ------------------------------- */

test('a field that holds anything — 0, none, $0, typed text — is never suggested or changed', () => {
  const home = { ...emptyHome(), garageSpaces: '0', basementCondition: 'none', hoaFeeMonthly: 0, laundryLocation: 'basement', schoolDistrict: 'Avondale School District', primaryBedroomLocation: 'Upstairs', garageType: 'detached' };
  assert.deepEqual(suggestHomeFacts(REAL_WORLD, home), [], 'nothing for filled fields, and walkout would contradict "none"');
  for (const suggestion of suggestHomeFacts(REAL_WORLD)) {
    const after = applyHomeFactSuggestion(home, suggestion);
    assert.equal(after[suggestion.field], home[suggestion.field], suggestion.field);
  }
  // A walkout suggestion never lands beside a "no basement" condition.
  const walkout = suggestHomeFacts('Walkout basement.')[0];
  assert.equal(applyHomeFactSuggestion({ basementCondition: 'none' }, walkout).basementStyle, undefined);
  assert.equal(HOME_FACT_SUGGESTION_FIELDS.includes('checks'), false);
});

test('Use fills an empty field; Undo takes back only what Use wrote', () => {
  const [condition] = suggestHomeFacts('Finished basement.');
  const home = { ...emptyHome(), checks: { 'features:Fireplace': true } };
  const used = applyHomeFactSuggestion(home, condition);
  assert.equal(used.basementCondition, 'finished');
  assert.deepEqual(used.checks, home.checks, 'personal answers untouched');
  assert.equal(undoHomeFactSuggestion(used, condition).basementCondition, null);
  // The buyer changed it after Use: Undo leaves their value.
  assert.equal(undoHomeFactSuggestion({ ...used, basementCondition: 'partially_finished' }, condition).basementCondition, 'partially_finished');
  const [spaces] = suggestHomeFacts('2-car garage.');
  assert.equal(undoHomeFactSuggestion(applyHomeFactSuggestion(emptyHome(), spaces), spaces).garageSpaces, '', 'garage spaces is a text column: Unknown is empty');
});

test('rerunning on new text keeps a used fact it still supports and clears the rest', () => {
  const first = suggestHomeFacts('Finished basement. Laundry on the main level.');
  let home = first.reduce(applyHomeFactSuggestion, emptyHome());
  const used = Object.fromEntries(first.map((item) => [item.id, item]));
  home = { ...home, primaryBedroomLocation: 'Main Floor' }; // typed by the buyer
  const rerun = resuggestHomeFacts('Finished basement. Attached garage.', home, used);
  assert.equal(rerun.home.basementCondition, 'finished');
  assert.equal(rerun.home.laundryLocation, null);
  assert.equal(rerun.home.primaryBedroomLocation, 'Main Floor', 'a typed value is never touched');
  assert.deepEqual(rerun.cleared, ['Laundry']);
  assert.deepEqual(Object.values(rerun.used).map((item) => item.field), ['basementCondition']);
  assert.ok(rerun.suggestions.some((item) => item.field === 'garageType'));
});

/* ----------------------- Shared vs personal, one prompt per fact ----------------------- */

// One buyer who selected criteria Home Facts answer (#167) and ones it can't.
const dedupeBuyer = () => select(start('home_buy'), ['features', 'Finished basement'], ['features', 'First-floor laundry'], ['features', 'First-Floor Primary'],
  ['features', 'Primary ensuite'], ['exterior', 'Fenced yard'], ['features', 'Fireplace']);
const keysOf = (items) => items.map((item) => item.key).sort();
const status = (items, key, context) => personalSuggestionStatus(items.find((item) => item.key === key), context);

test('pending: a shared suggestion that would answer a criterion holds its personal question on one row', () => {
  const personal = suggestListingAnswers(REAL_WORLD, dedupeBuyer());
  const shared = suggestHomeFacts(REAL_WORLD);
  const context = { home: emptyHome(), factSuggestions: shared, factDecisions: {} };
  assert.equal(status(personal, 'features:Finished basement', context), 'held');
  assert.equal(status(personal, 'features:First-floor laundry', context), 'held');
  assert.equal(status(personal, 'features:First-Floor Primary', context), 'held');
  // Criteria with no shared field are never held.
  assert.deepEqual(keysOf(visiblePersonalSuggestions(personal, context)), ['exterior:Fenced yard', 'features:Fireplace', 'features:Primary ensuite']);
  // The shared row names what it would also answer.
  const basement = shared.find((item) => item.field === 'basementCondition');
  assert.deepEqual(personalSuggestionsAnsweredBy(basement, personal, emptyHome()).map((item) => item.key), ['features:Finished basement']);
  const school = shared.find((item) => item.field === 'schoolDistrict');
  assert.deepEqual(personalSuggestionsAnsweredBy(school, personal, emptyHome()), [], 'a district answers no Match criterion');
});

test('skipped: the fact stays Unknown and the personal question comes back — never a No', () => {
  const personal = suggestListingAnswers(REAL_WORLD, dedupeBuyer());
  const shared = suggestHomeFacts(REAL_WORLD);
  const basement = shared.find((item) => item.field === 'basementCondition');
  const home = emptyHome();
  const context = { home, factSuggestions: shared, factDecisions: { [basement.id]: 'skipped' } };
  assert.equal(status(personal, 'features:Finished basement', context), 'show');
  assert.equal(home.basementCondition, null, 'Skip writes nothing');
  assert.equal(resolveCriterionAnswer(home, 'features:Finished basement', {}).value, undefined, 'Unknown, not No');
  // The returned personal suggestion is still the listing's Yes, for this buyer to confirm.
  assert.equal(personal.find((item) => item.key === 'features:Finished basement').answer, true);
  // Other held criteria are unaffected by skipping the basement.
  assert.equal(status(personal, 'features:First-floor laundry', context), 'held');
});

test('accepted: a used shared fact settles the criterion; Undo puts it back to pending', () => {
  const personal = suggestListingAnswers(REAL_WORLD, dedupeBuyer());
  const shared = suggestHomeFacts(REAL_WORLD);
  const laundry = shared.find((item) => item.field === 'laundryLocation');
  const home = applyHomeFactSuggestion(emptyHome(), laundry);
  const context = { home, factSuggestions: shared, factDecisions: { [laundry.id]: 'used' } };
  assert.equal(status(personal, 'features:First-floor laundry', context), 'settled');
  assert.equal(resolveCriterionAnswer(home, 'features:First-floor laundry', {}).source, 'home_facts');
  assert.deepEqual(personalSuggestionsAnsweredBy(laundry, personal, home), [], 'a used fact names nothing');
  const undone = undoHomeFactSuggestion(home, laundry);
  assert.equal(status(personal, 'features:First-floor laundry', { home: undone, factSuggestions: shared, factDecisions: {} }), 'held');
});

test('previously determined: a fact already on the home settles it; a value that answers nothing does not', () => {
  const personal = suggestListingAnswers(REAL_WORLD, dedupeBuyer());
  // From the lookup or typed: no shared suggestion is offered for it, and the personal question is settled.
  const known = { ...emptyHome(), laundryLocation: 'first_floor', basementCondition: 'unfinished' };
  assert.equal(suggestHomeFacts(REAL_WORLD, known).some((item) => ['laundryLocation', 'basementCondition'].includes(item.field)), false);
  assert.equal(status(personal, 'features:First-floor laundry', { home: known }), 'settled');
  assert.equal(status(personal, 'features:Finished basement', { home: known }), 'settled', 'Unfinished answers Finished basement (No)');
  // Partially finished answers neither Yes nor No: the buyer keeps their own question.
  const partial = { ...emptyHome(), basementCondition: 'partially_finished' };
  assert.equal(status(personal, 'features:Finished basement', { home: partial, factSuggestions: suggestHomeFacts(REAL_WORLD, partial) }), 'show');
  // Laundry in the basement says nothing about the first floor (Laundry never answers No).
  assert.equal(status(personal, 'features:First-floor laundry', { home: { ...emptyHome(), laundryLocation: 'basement' } }), 'show');
});

test('explicit answers and #165 stale-evidence protection are unchanged', () => {
  const buyer = dedupeBuyer();
  // A buyer who already answered gets no suggestion at all, whatever the shared state.
  assert.equal(suggestListingAnswers(REAL_WORLD, buyer, { 'features:Finished basement': 'no' }).some((item) => item.key === 'features:Finished basement'), false);
  // Their explicit No still overrides a used fact in Match.
  const home = suggestHomeFacts(REAL_WORLD).reduce(applyHomeFactSuggestion, emptyHome());
  assert.equal(resolveCriterionAnswer(home, 'features:Finished basement', { 'features:Finished basement': 'no' }).value, 'no');
  // A personal answer confirmed after Skip is re-checked by a rerun exactly as before.
  const [confirmed] = suggestListingAnswers('Finished basement.', buyer).filter((item) => item.key === 'features:Finished basement');
  const checks = { [confirmed.key]: confirmed.answer };
  const rerun = resuggestListingAnswers('No basement information here.', buyer, checks, { [confirmed.key]: confirmed.answer });
  assert.deepEqual(rerun.cleared, ['features:Finished basement']);
  assert.equal(rerun.checks['features:Finished basement'], undefined);
});

test('co-buyers: each buyer\'s Match and suggestions stay their own', () => {
  const owner = dedupeBuyer();
  const coBuyer = select(start('home_buy'), ['features', 'Finished basement', 'must'], ['features', 'Walkout basement']);
  const shared = suggestHomeFacts(REAL_WORLD);
  const basement = shared.find((item) => item.field === 'basementCondition');
  // The owner skips the shared fact and confirms their own Yes: only the owner's checks change.
  const ownerPersonal = suggestListingAnswers(REAL_WORLD, owner);
  assert.equal(status(ownerPersonal, 'features:Finished basement', { home: emptyHome(), factSuggestions: shared, factDecisions: { [basement.id]: 'skipped' } }), 'show');
  const ownerChecks = { 'features:Finished basement': true };
  const home = emptyHome();
  assert.equal(computeMatch({ ...home, checks: ownerChecks }, owner).allSelected.find((item) => item.key === 'features:Finished basement').met, true);
  assert.equal(computeMatch({ ...home, checks: {} }, coBuyer).allSelected.find((item) => item.key === 'features:Finished basement').evaluated, false, 'the co-buyer is still Unknown');
  // The co-buyer, pasting the same text, gets their own suggestions; the shared state is the home's.
  const coPersonal = suggestListingAnswers(REAL_WORLD, coBuyer);
  assert.deepEqual(keysOf(coPersonal), ['features:Finished basement', 'features:Walkout basement']);
  assert.equal(status(coPersonal, 'features:Walkout basement', { home, factSuggestions: shared, factDecisions: {} }), 'held');
  // Once a buyer uses the shared fact, it answers both buyers through Home Facts unless one overrides.
  const withFact = applyHomeFactSuggestion(home, basement);
  assert.equal(resolveCriterionAnswer(withFact, 'features:Finished basement', {}).source, 'home_facts');
  assert.equal(resolveCriterionAnswer(withFact, 'features:Finished basement', { 'features:Finished basement': 'no' }).value, 'no', "a co-buyer's own No still wins for them");
  assert.equal(status(coPersonal, 'features:Finished basement', { home: withFact }), 'settled');
});

/* ------------------------- Snapshot, provenance, provider ------------------------- */

test('used facts join the snapshot with their sentences and read as From listing', () => {
  const suggestions = suggestHomeFacts(REAL_WORLD);
  const home = suggestions.reduce(applyHomeFactSuggestion, emptyHome());
  const used = Object.fromEntries(suggestions.map((item) => [item.id, item]));
  const rentcast = { fields: { beds: '4', garageSpaces: '3' }, listingFacts: [], descriptionFeatures: [], searchedAddress: '4120 Lakeview Ct' };
  const snapshot = listingImportSnapshot(importResultWithHomeFacts(rentcast, used, { ...home, garageSpaces: '3' }), 'x');
  assert.equal(snapshot.source, 'rentcast');
  assert.equal(snapshot.fields.beds, '4');
  assert.equal(snapshot.fields.garageSpaces, '3', "the provider's value stays");
  assert.equal(snapshot.fields.basementCondition, 'finished');
  assert.equal(snapshot.fields.schoolDistrict, 'Rochester Community Schools');
  const evidence = snapshot.pastedFacts.find((item) => item.field === 'basementStyle');
  assert.equal(evidence.sourceProvider, 'user_paste');
  assert.match(evidence.evidence, /finished walkout basement/i);
  assert.equal(snapshot.pastedFacts.some((item) => item.field === 'garageSpaces'), false, 'garage spaces were not used from the text');
  assert.equal(fieldProvenance('finished', snapshot, 'basementCondition'), 'listing');
  assert.equal(fieldProvenance('unfinished', snapshot, 'basementCondition'), 'you');
  // Nothing used: the import result is unchanged (and none is created).
  assert.equal(importResultWithHomeFacts(rentcast, {}, home), rentcast);
  assert.equal(importResultWithHomeFacts(null, {}, home), null);
  // Used without any lookup: a pasted-text snapshot.
  assert.equal(listingImportSnapshot(importResultWithHomeFacts(null, used, home), 'x').source, 'pasted_text');
  // A used fact the buyer later changed is not claimed as from the listing.
  assert.equal(importResultWithHomeFacts(null, used, { ...home, basementCondition: 'unfinished' }).fields.basementCondition, undefined);
});

test('pasting after a lookup adds to it instead of replacing it', () => {
  const provider = { fields: { price: '400000', beds: '4' }, listing: { status: 'active' }, sources: { property: 'ok', listing: 'ok' }, listingFacts: [{ key: 'roof' }], descriptionFeatures: [], searchedAddress: 'x' };
  const text = { fields: { beds: '3', yearBuilt: '1990' }, descriptionFeatures: [{ id: 'listing-text-fireplace' }], suggestions: [], source: 'raw-text' };
  const combined = combineImportResults(provider, text);
  assert.deepEqual(combined.fields, { yearBuilt: '1990', price: '400000', beds: '4' });
  assert.deepEqual(combined.pastedFields, ['yearBuilt']);
  assert.equal(combined.listing.status, 'active');
  assert.equal(combined.searchedAddress, 'x');
  assert.equal(combined.descriptionFeatures.length, 1);
  assert.equal(listingImportSnapshot(combined, 'x').source, 'rentcast');
  assert.deepEqual(listingImportSnapshot(combined, 'x').pastedFields, ['yearBuilt']);
  assert.equal(combineImportResults(null, text), text);
});

/* --------------------------- Match and Match Reveal --------------------------- */

function revealBuyer() {
  let p = start('home_buy');
  p.bedsMin = { value: '3', tier: 'important' };
  return select(p, ['features', 'Finished basement', 'must'], ['features', 'First-floor laundry'], ['features', 'First-Floor Primary'], ['exterior', 'Garage']);
}

test('used facts reach Match only through the existing Home Facts readings; scoring is unchanged', () => {
  const priorities = revealBuyer();
  const suggestions = suggestHomeFacts(REAL_WORLD);
  const fromPaste = suggestions.reduce(applyHomeFactSuggestion, { ...emptyHome(), beds: '4' });
  const typed = { ...emptyHome(), beds: '4', basementCondition: 'finished', basementStyle: 'walkout', laundryLocation: 'first_floor', primaryBedroomLocation: 'Main Floor', garageType: 'attached', garageSpaces: '2', hoaFeeMonthly: 40, schoolDistrict: 'Rochester Community Schools' };
  assert.deepEqual(computeMatch(fromPaste, priorities), computeMatch(typed, priorities), 'a used suggestion scores exactly like the same fact typed in Home Facts');
  const rows = computeMatch(fromPaste, priorities).allSelected.filter((item) => item.source === 'home_facts').map((item) => item.key).sort();
  assert.deepEqual(rows, ['exterior:Garage', 'features:Finished basement', 'features:First-Floor Primary', 'features:First-floor laundry']);
  // The buyer's own answer still overrides the fact.
  assert.equal(resolveCriterionAnswer({ ...fromPaste }, 'features:Finished basement', { 'features:Finished basement': 'no' }).value, 'no');
});

test('Match Reveal: facts completed in Add Home raise the baseline, so the reveal does not fire later for that home', () => {
  const priorities = revealBuyer();
  const before = { ...emptyHome(), beds: '4' };
  const completed = suggestHomeFacts(REAL_WORLD).reduce(applyHomeFactSuggestion, before);
  const baselineEmpty = matchCompleteness(computeMatch(before, priorities));
  const baselineCompleted = matchCompleteness(computeMatch(completed, priorities));
  assert.equal(baselineEmpty.unlocked, false);
  assert.equal(baselineCompleted.unlocked, true, 'the home arrives on My Homes already past the threshold');
  // Add Home never triggers (#170); the overlay's baseline is the persisted home,
  // so a later save on an already-unlocked home never crosses.
  assert.equal(crossedRevealThreshold(baselineCompleted, baselineCompleted), false);
  // A home that arrives below the threshold still reveals on the buyer's own save that crosses it.
  const partial = suggestHomeFacts('Finished basement.').reduce(applyHomeFactSuggestion, before);
  const partialBaseline = matchCompleteness(computeMatch(partial, priorities));
  assert.equal(partialBaseline.unlocked, false);
  const afterSave = matchCompleteness(computeMatch({ ...partial, laundryLocation: 'first_floor', garageSpaces: '2' }, priorities));
  assert.equal(crossedRevealThreshold(partialBaseline, afterSave), true);
  // Add Home itself has no reveal path.
  const modal = read('src/components/HomeModal.jsx');
  assert.doesNotMatch(modal, /claimMatchReveal|crossedRevealThreshold|MatchReveal/);
});

/* ------------------------------- Add Home wiring ------------------------------- */

test('Add Home offers the optional paste after any lookup, never requires it, and keeps the reviews apart', () => {
  const modal = read('src/components/HomeModal.jsx');
  assert.match(modal, /Copy the listing description or property features and paste them here\. We’ll fill in what we can\. School details work too\./);
  // The found card (success, failed or empty lookup) carries the paste area.
  assert.match(modal, /const quickAdd = importLanding && isNewHome && !vocabulary\.apartment && \['success', 'text-success', 'empty', 'error'\]\.includes\(importPhase\)/);
  assert.match(modal, /<ListingDetailsPaste paste=\{paste\} \/>\s*<HomeFactReview review=\{factReview\} \/>\s*<ListingAnswerReview review=\{answerReview\} \/>/);
  assert.match(modal, /<span className="flh-optional-tag">Optional<\/span>/);
  // Adding the home never depends on pasting.
  assert.match(modal, /disabled=\{saving \|\| !form\.address\.trim\(\)\}><Plus size=\{16\} aria-hidden="true" \/> \{saving \? 'Adding…' : 'Add to My Homes'\}/);
  assert.doesNotMatch(modal, /Can.t find the home\?/, 'no longer framed as error recovery');
  // A lookup that succeeded is kept when text is pasted after it.
  assert.match(modal, /setImportResult\(combineImportResults\(providerResult, /);
  // Shared facts are written only by Use, into empty fields.
  const handlers = modal.match(/const useFact = [\s\S]*?const factReview = /)[0];
  assert.match(handlers, /applyHomeFactSuggestion/);
  assert.doesNotMatch(handlers, /onSave|createClient|fetch\(|submit\(|checks/);
  // Personal answers stay separate, and a shared fact removes the duplicate personal prompt.
  assert.match(modal, /const answers = rerun\.suggestions;/, 'every personal suggestion is kept; visibility follows the shared state');
  assert.match(modal, /personalSuggestionStatus\(suggestion, \{ home: form, factSuggestions, factDecisions \}\) === 'show'/);
  assert.match(modal, /Also answers your Match: <b>\{answers\.join\(', '\)\}<\/b>\. Skip keeps this fact Unknown, and you can still answer/);
  assert.match(modal, /These are for your Match only/);
  assert.match(modal, /FLH hasn’t verified it or checked school boundaries/);
});

test('the reader is pure: no network, storage or model calls', () => {
  const lib = read('src/lib/listingTextHomeFacts.js');
  assert.doesNotMatch(lib, /fetch\(|supabase|localStorage|anthropic|openai|XMLHttpRequest|import\(/i);
});

/* ---------------------- Counts, Notes / Pros / Cons (#171) ---------------------- */

test('detail counts are truthful: no double counting of lookup and pasted text', async () => {
  const { countListingDetails } = await import('../src/lib/listingFacts.js');
  const { importedDetailCount } = await import('../src/lib/homeFacts.js');
  const { listingTextEvidence } = await import('../src/lib/listingTextAnswers.js');
  const provider = { fields: { price: '335000', beds: '5', garageSpaces: '2' }, listingFacts: [], descriptionFeatures: [], searchedAddress: 'x' };
  const lookupCount = importedDetailCount(provider);
  // Text that restates a lookup field adds nothing; a new field adds one.
  const text = { fields: { beds: '4', yearBuilt: '1990' }, descriptionFeatures: [], suggestions: [], source: 'raw-text' };
  const once = combineImportResults(provider, text);
  assert.equal(importedDetailCount(once), lookupCount + 1);
  // Pasting again starts from the lookup, never from the previous combination.
  assert.deepEqual(combineImportResults(provider, text), once);
  // A used fact and the evidence sentence for the same concept count once.
  const evidence = listingTextEvidence('Finished walkout basement. Gas fireplace.');
  const used = Object.fromEntries(suggestHomeFacts('Finished walkout basement.').map((item) => [item.id, item]));
  const home = Object.values(used).reduce(applyHomeFactSuggestion, emptyHome());
  const saved = listingImportSnapshot(importResultWithHomeFacts({ ...provider, descriptionFeatures: evidence }, used, home), 'x');
  // 3 lookup fields + condition + style + the fireplace evidence; the basement evidence is covered.
  assert.equal(importedDetailCount(saved), 6);
  assert.equal(countListingDetails(saved.fields, saved.listingFacts, saved.descriptionFeatures), 6);
  // Without the used facts, the same evidence still counts (nothing hidden).
  assert.equal(importedDetailCount(listingImportSnapshot({ ...provider, descriptionFeatures: evidence }, 'x')), 3 + evidence.length);
  // The found card counts what the lookup returned, not the pasted text.
  assert.match(read('src/components/HomeModal.jsx'), /const count = found \? importedDetailCount\(lookupResult \|\| importResult\) : 0;/);
});

test('pasting never writes Notes / Pros / Cons; seller concessions stay out (documented follow-up)', async () => {
  const { extractEnrichmentSuggestions } = await import('../src/lib/importReview.js');
  const text = 'Seller offering $5,000 toward closing costs. Seller will contribute $5,000 toward closing costs.';
  assert.deepEqual(suggestHomeFacts(text), []);
  // The existing Notes rules don't read a dollar concession, and Notes
  // suggestions are not shown in Add Home today: nothing reaches Notes.
  assert.deepEqual(extractEnrichmentSuggestions(text, {}), []);
  const home = { ...emptyHome(), notes: 'Ask about sewer', pros: 'Big yard', cons: 'Busy road' };
  const after = suggestHomeFacts(REAL_WORLD).reduce(applyHomeFactSuggestion, home);
  assert.deepEqual([after.notes, after.pros, after.cons], ['Ask about sewer', 'Big yard', 'Busy road']);
  assert.equal(HOME_FACT_SUGGESTION_FIELDS.some((field) => ['notes', 'pros', 'cons'].includes(field)), false);
  const modal = read('src/components/HomeModal.jsx');
  const autofill = modal.match(/const runAutofill = \(\) => \{[\s\S]*?\n {2}\};/)[0];
  assert.doesNotMatch(autofill, /\.(?:notes|pros|cons)\b|\b(?:notes|pros|cons)\s*:|appendSuggestionToNotes|appendAllSuggestions/, 'pasting leaves Notes / Pros / Cons as typed');
});

test('the found card keeps one order: paste, Home Facts, personal answers, then the optional Notes / Pros / Cons', () => {
  const modal = read('src/components/HomeModal.jsx');
  const card = modal.match(/function ImportFoundCard[\s\S]*?\n\}/)[0];
  const at = (needle) => card.indexOf(needle);
  const order = ['<ListingDetailsPaste', '<HomeFactReview', '<ListingAnswerReview', 'className="hh-details flh-found-notes"', '<NoteListFields form={form} set={set} idPrefix="add-home" />', 'Add to My Homes'].map(at);
  assert.ok(order.every((index) => index > 0), `missing: ${order}`);
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  // Distinct ids: the paste box never collides with the Notes fields.
  assert.doesNotMatch(read('src/components/NoteListFields.jsx'), /flh-listing-paste-text/);
});
