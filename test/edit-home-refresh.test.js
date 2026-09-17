import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const modal = readFileSync(new URL('../src/components/HomeModal.jsx', import.meta.url), 'utf8');
const persistence = readFileSync(new URL('../src/lib/supabase/collaboration.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/app/globals.css', import.meta.url), 'utf8');

test('Edit Home persistence never sends or selects the stale floor-plan image field', () => {
  const runtimeContract = persistence.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  assert.doesNotMatch(runtimeContract, /floor_plan_image_url/);
  assert.doesNotMatch(runtimeContract, /floorPlanImageUrl/);
  assert.match(persistence, /function homeToSharedRow[\s\S]*address: home\.address[\s\S]*listing_url: home\.listingUrl[\s\S]*photo_url: home\.photoUrl/);
});

test('save failures stay visible, edits stay mounted, and duplicate submission is guarded synchronously', () => {
  assert.match(modal, /if \(!form\.address\.trim\(\) \|\| savingRef\.current\) return;/);
  assert.match(modal, /savingRef\.current = true/);
  assert.match(modal, /setSaveErrorMsg\("We couldn't save this home\.[\s\S]*changes here haven't been lost\."\)/);
  assert.match(modal, /role="alert">\{saveErrorMsg\}/);
});

test('Unknown, Yes, and No use distinct explicit Match values', () => {
  assert.match(modal, /\['yes', 'Yes', true\], \['no', 'No', 'no'\], \['unknown', 'Unknown', undefined\]/);
  assert.match(modal, /if \(value === undefined\) delete next\[k\]/);
  assert.doesNotMatch(modal, /value \|\| false/);
});

test('Edit Home has the refreshed information architecture without decision actions', () => {
  const editor = modal.slice(modal.indexOf('function EditHomeEditor'), modal.indexOf('export default function HomeModal'));
  for (const copy of ['Edit home', 'Property address', 'Home photo', 'Key details', 'Home details', 'Personalized Match', 'Shared notes', 'Save changes']) assert.match(editor, new RegExp(copy));
  for (const unrelated of ['Want to tour', 'ArchiveIcon', 'ExternalLink']) assert.doesNotMatch(editor, new RegExp(unrelated));
  assert.doesNotMatch(editor, /RAW IMPORTED ADDRESS|STANDARDIZED GPS ADDRESS|Floor-plan image|floorPlanImageUrl/);
  assert.match(editor, /showPhotoUrlInput &&/);
});

test('Edit Home uses dialog focus management and responsive two-to-one column layout', () => {
  assert.match(modal, /role="dialog" aria-modal="true" aria-labelledby="edit-home-title"/);
  assert.match(modal, /event\.key === 'Escape'/);
  assert.match(modal, /event\.key !== 'Tab'/);
  assert.match(css, /\.hh-edit-home-columns \{[^}]*grid-template-columns: minmax\(0, \.9fr\) minmax\(0, 1\.1fr\)/);
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*\.hh-edit-home-columns \{[^}]*grid-template-columns: minmax\(0, 1fr\)/);
});

test('shared facts and participant-owned state retain separate persistence paths', () => {
  assert.match(persistence, /from\('homes'\)\.upsert\(sharedRow\)/);
  assert.match(persistence, /from\('home_member_state'\)\.upsert/);
  assert.match(persistence, /user_id: userId/);
  assert.doesNotMatch(persistence, /service_role/);
});
