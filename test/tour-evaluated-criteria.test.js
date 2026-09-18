import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getItemlistCategories, normalizePriorities } from '../src/lib/constants.js';
import { computeMatch } from '../src/lib/matching.js';
import { appendPostTourNote, applyPostTourVerdict } from '../src/lib/lifecycle.js';

const expected = {
  'Location & Surroundings': ['Near downtown area','Groceries nearby','Parks nearby','Walkable schools','Near waterfront','Quiet street','Tree-lined street'],
  'Home Features': ['First-floor laundry','Guest suite','Fireplace','Home office','Primary ensuite','Central air','Finished basement','Walkout basement'],
  'Exterior & Property': ['Fenced yard','Pool','Patio / deck','Detached garage','Attached garage','Large backyard','Landscaping','Front porch'],
};

test('purchase catalog is the exact pre-tour My Search catalog', () => {
  const categories = getItemlistCategories('purchase');
  assert.deepEqual(Object.fromEntries(categories.map((c) => [c.title, [...c.coreItems,...c.suggestedItems].map((i) => i.label)])), expected);
  const labels = Object.values(expected).flat();
  for (const removed of ['On-Site Management','Fitness Center','Secure Entry','Elevator','Pets Allowed','Utilities Included','Curb Appeal','Layout / Flow','Privacy','Natural Light']) assert.ok(!labels.includes(removed));
});

test('legacy subjective built-ins are preserved in JSON but excluded from Match Unknowns', () => {
  const p = normalizePriorities({ searchType:'purchase', homeFeel:{ tiers:{'Natural Light':'must'}, customItems:[{label:'Natural Light',kind:'rating'}] }, features:{tiers:{Fireplace:'important'},customItems:[{label:'Fireplace',kind:'check'}]} });
  assert.equal(p.homeFeel.tiers['Natural Light'], 'must');
  const match = computeMatch({checks:{}}, p);
  assert.deepEqual(match.allSelected.map((item) => item.key), ['features:Fireplace']);
  assert.equal(match.allSelected[0].evaluated, false);
  assert.equal(match.allSelected[0].met, null);
});

test('explicit custom criteria remain supported even when their label resembles a retired built-in', () => {
  const p = normalizePriorities({searchType:'purchase',homeFeel:{tiers:{Privacy:'nice'},customItems:[{label:'Privacy',kind:'check',source:'custom'}]}});
  // Home Feel is intentionally not an active purchase family; custom choices use one of the three visible families.
  p.exterior.tiers.Privacy='nice'; p.exterior.customItems=[{label:'Privacy',kind:'check',source:'custom'}];
  assert.ok(computeMatch({checks:{}},p).allSelected.some((item)=>item.key==='exterior:Privacy'));
});

test('post-tour V2 is reaction-first, optional, fixed to four evaluations, and has no stars/archive action', () => {
  const modal=readFileSync(new URL('../src/components/PostTourModal.jsx',import.meta.url),'utf8');
  assert.ok(modal.indexOf('Where are you at with this home?') < modal.indexOf('How did it feel in person?'));
  for (const label of ['Curb Appeal','Layout','Privacy','Neighborhood',"Didn’t like it",'Neutral','Loved it','Save my take','Keep reviewing']) assert.match(modal,new RegExp(label));
  assert.doesNotMatch(modal,/StarInput|TOUR_RATING_KEY|Archive home|StandOutGroup/);
  assert.match(modal,/role="radiogroup"/);
});

test('post-tour evaluations cannot affect Match and note appending is non-destructive', () => {
  const p=normalizePriorities({searchType:'purchase',features:{tiers:{Fireplace:'important'},customItems:[{label:'Fireplace',kind:'check'}]}});
  const before=computeMatch({checks:{'features:Fireplace':true},ratings:{}},p).pct;
  const after=computeMatch({checks:{'features:Fireplace':true},ratings:{'tour-v2:layout':'negative'}},p).pct;
  assert.equal(after,before);
  assert.equal(appendPostTourNote('Existing note','Fresh note'),'Existing note\n\nFresh note');
  const result=applyPostTourVerdict({status:'Want to Tour',notes:'Existing note',ratings:{}},'not_for_me',{noteEntry:'Fresh note',ratings:{'tour-v2:layout':'negative'}},'now');
  assert.equal(result.status,'Want to Tour'); assert.equal(result.notes,'Existing note\n\nFresh note'); assert.equal(result.reaction,'not_for_me');
});

test('participant and Realtor mutation boundaries remain enforced by the existing owner path', () => {
  const collaboration=readFileSync(new URL('../src/lib/supabase/collaboration.js',import.meta.url),'utf8');
  const detail=readFileSync(new URL('../src/components/HomeDetail.jsx',import.meta.url),'utf8');
  assert.match(collaboration,/user_id: userId/); assert.match(collaboration,/from\('home_member_state'\)\.upsert/);
  assert.match(detail,/!readOnly && reflecting && <PostTourModal/);
});
