// Source guarantees for the home overlay (docs/home-overlay-phase-2.md). The
// behavior itself is exercised against real Postgres in a real browser by
// scripts/qa/home-overlay-e2e.mjs and in test/home-overlay-db.test.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const overlay = read('src/components/HomeOverlay.jsx');
const layout = read('src/app/(app)/homes/(board)/layout.js');
const page = read('src/app/(app)/homes/(board)/[homeId]/page.js');
const board = read('src/components/HomesBoard.jsx');
const facts = read('src/components/HomeFacts.jsx');
const fields = read('src/components/FactFields.jsx');
const criteria = read('src/components/MatchCriteria.jsx');

test('My Homes is a layout that stays mounted under a real /homes/[homeId] route', () => {
  assert.ok(!existsSync(new URL('../src/app/(app)/homes/page.js', import.meta.url)), 'the old /homes page moved into the (board) layout');
  assert.ok(!existsSync(new URL('../src/app/(app)/homes/[homeId]/page.js', import.meta.url)));
  assert.match(layout, /<HomesWorkspace initialHomes=\{homesWithSignal\}/);
  assert.match(layout, /<HomesBoard\s+mode="homes"/);
  assert.match(layout, /\{children\}\s*<\/HomesWorkspace>/);
  assert.match(page, /return <HomeOverlay key=\{home\.id\} serverHome=/);
  assert.ok(existsSync(new URL('../src/app/(app)/homes/(board)/[homeId]/loading.js', import.meta.url)));
  // The board shares its homes with the overlay when under the layout.
  assert.match(board, /const homes = workspace\?\.homes \?\? localHomes;/);
});

test('legacy links keep working: ?section=, ?home=, ?added= and return pages', () => {
  assert.match(page, /const SECTIONS = new Set\(\['facts', 'match', 'tour'\]\);/);
  assert.match(page, /const RETURN_PAGES = new Set\(\['tour', 'favorites', 'archive', 'compare', 'map'\]\);/);
  assert.match(board, /router\.replace\(`\/homes\/\$\{encodeURIComponent\(requestedHome\.id\)\}`, \{ scroll: false \}\);/);
  assert.match(overlay, /if \(section === 'match'\) requestAnimationFrame\(\(\) => matchRef\.current\?\.scrollIntoView/);
  assert.match(overlay, /url\.searchParams\.delete\('added'\);/);
});

test('the overlay is an accessible modal: labelled dialog, focus moved in and trapped, Escape, scroll lock, focus restored', () => {
  assert.match(overlay, /role="dialog" aria-modal="true" aria-labelledby="flh-overlay-title"/);
  assert.match(overlay, /titleRef\.current\?\.focus\(\{ preventScroll: true \}\);/);
  assert.match(overlay, /if \(event\.key === 'Escape'\) \{/);
  assert.match(overlay, /if \(event\.key !== 'Tab' \|\| !dialogRef\.current\) return;/);
  assert.match(overlay, /root\.style\.overflow = 'hidden';/);
  assert.match(overlay, /previouslyFocused\.focus\?\.\(\{ preventScroll: true \}\)/);
  // A nested menu's Escape closes only the menu.
  assert.match(fields, /event\.stopPropagation\(\);\s*setOpen\(false\);/);
});

test('Close never discards an edit: it commits drafts, waits for saves, and stops on a failure', () => {
  assert.match(overlay, /const ok = force \|\| await autosave\.settle\(\);\s*if \(!ok\) \{ setCloseBlocked\(true\); setClosing\(false\); return; \}/);
  assert.match(overlay, /Close without saving them/);
  assert.match(overlay, /await refreshMyHomes\(\)\.catch\(\(\) => \{\}\);/);
  assert.match(read('src/lib/useHomeAutosave.js'), /window\.addEventListener\('beforeunload', warn\)/);
});

test('one continuous scroll: no tabs or section switcher, no Edit or Save buttons, no success banner', () => {
  assert.doesNotMatch(overlay + facts, /role="tab"|WORKSPACE_SECTIONS|flh-hf-welcome|We found your home\./);
  assert.match(overlay, /<HomeFacts [^>]*editor=\{editor\}/);
  assert.match(overlay, /<MatchCriteria home=\{home\} priorities=\{priorities\} match=\{match\} onAnswer=\{answerCriterion\}/);
  assert.doesNotMatch(facts, /flh-hf-edit|EditorShell|Save /);
});

test('shared facts autosave as partial updates; personal answers only to the caller\'s own row', () => {
  assert.match(overlay, /writeShared: \(patch\) => saveHomeSharedFields\(createClient\(\), serverHome\.id, patch\)/);
  assert.match(overlay, /writePersonal: \(snapshot\) => saveHomePersonalState\(createClient\(\), snapshot, userId, searchId\)/);
  const fn = read('src/lib/supabase/collaboration.js').match(/export async function saveHomeSharedFields\([\s\S]*?\n\}/)[0];
  assert.match(fn, /if \(unknown\.length\) throw new Error/);
  assert.match(fn, /supabase\.from\('homes'\)\.update\(row\)\.eq\('id', homeId\)/);
  assert.doesNotMatch(fn, /home_member_state|upsert|insert/);
});

test('Realtors keep a read-only workspace; the overlay never renders for them', () => {
  assert.match(read('src/app/(app)/people/[searchId]/homes/[homeId]/page.js'), /readOnly backHref=/);
  assert.match(facts, /const isReadOnly = readOnly \|\| !editor;/);
  assert.match(fields, /if \(readOnly\) \{\s*return <span className=\{`flh-fact-text/);
  assert.match(criteria, /: readOnly \? <span className=\{`flh-mc2-state/);
});

test('Laundry Location is shown only when the database has it, as Unknown + three locations', () => {
  assert.match(facts, /const laundryKnownToDatabase = home\.laundryLocation !== undefined;/);
  assert.match(facts, /\{laundryKnownToDatabase && <div className="flh-hf2-mini is-wide"><label htmlFor="hf-laundryLocation">Laundry location<\/label>/);
  assert.match(fields, /<option value="">\{unknownLabel\}<\/option>/);
});

test('Tour Feedback keeps its own view of the overlay with every existing control', () => {
  assert.match(overlay, /<TourFeedback[\s\S]*onRecordTake=\{\(\) => setReflecting\(true\)\}[\s\S]*onSaveNotes=[\s\S]*onAnswerInPerson=/);
  assert.match(overlay, /<RealtorContributions searchId=\{searchId\} homeId=\{home\.id\}/);
  assert.match(overlay, /<PostTourModal home=\{home\}/);
  assert.match(overlay, /Tour feedback &amp; notes/);
  // Cards still record a take directly.
  assert.match(board, /I toured this home/);
});

test('missing values are visibly Unknown and never written by just looking at a field', () => {
  assert.match(fields, /const unknown = value === null \|\| value === undefined \|\| String\(value\)\.trim\(\) === '';/);
  assert.match(fields, /if \(!touched\.current \|\| text === null\) return;/);
  assert.match(read('src/app/globals.css'), /\.flh-quiet\.is-boxed\.is-unknown \.flh-quiet-input \{ background: var\(--warm-unknown\);/);
});
