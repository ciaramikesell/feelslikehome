// Home card Notes / Pros / Cons previews (docs/home-card-notes-preview.md).
// Notes, pros and cons stay the shared home's existing notes / pros / cons
// text columns: one entry per written line, never per comma. No migration.
// The card shows "Notes (n) · Pros (n) · Cons (n)" for the ones written, each
// previewed on hover (mouse), tap (touch) or focus (keyboard). DB tests skip
// unless FLH_TEST_PGHOST is set (docs/database-tests.md).
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { createTestDatabase, DB_TESTS_ENABLED, DB_SKIP_REASON } from './support/supabaseDb.mjs';

register('./support/aliasHooks.mjs', import.meta.url);
const { homeNoteGroups, noteEntries, noteFieldCount } = await import('../src/lib/homeDisplay.js');
const {
  acceptInvitation, createInvitation, getHomesForUser, saveHomePersonalAndShared, saveHomeSharedFields,
} = await import('../src/lib/supabase/collaboration.js');

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const dbTest = (name, fn) => test(name, { skip: DB_TESTS_ENABLED ? false : DB_SKIP_REASON }, fn);
const card = read('src/components/HomesBoard.jsx');
const preview = read('src/components/HomeNotesPreview.jsx');
const fields = read('src/components/NoteListFields.jsx');
const modal = read('src/components/HomeModal.jsx');
const css = read('src/app/globals.css');

/* --------------------------------- entries --------------------------------- */

test('entries: one per written line, commas kept, blank lines and typed list markers dropped', () => {
  assert.deepEqual(noteEntries('Great backyard\nUpdated kitchen\n\n  Quiet street  '), ['Great backyard', 'Updated kitchen', 'Quiet street']);
  assert.deepEqual(noteEntries('Bright, open living room, Huge backyard'), ['Bright, open living room, Huge backyard']);
  assert.deepEqual(noteEntries('- Small primary bedroom\n• Only one full bath\n* Busy road nearby\n1. Roof is 20 years old\r\n2) Needs paint'), ['Small primary bedroom', 'Only one full bath', 'Busy road nearby', 'Roof is 20 years old', 'Needs paint']);
  // A number that is part of the entry stays.
  assert.deepEqual(noteEntries('2 car garage\n$5k toward closing'), ['2 car garage', '$5k toward closing']);
  for (const empty of ['', '   \n  ', null, undefined, 42]) assert.deepEqual(noteEntries(empty), [], String(empty));
});

test('groups: Notes, Pros, Cons in that order, only the written ones; older condition notes count as Notes', () => {
  const home = {
    notes: 'Seller offering $5k toward closing costs\nOccupancy after closing required\nTaxes seem high',
    pros: 'Great backyard\nUpdated kitchen\nQuiet street',
    cons: 'Small primary bedroom\nOnly one full bath\nBusy road nearby',
  };
  assert.deepEqual(homeNoteGroups(home).map(({ label, entries }) => `${label} (${entries.length})`), ['Notes (3)', 'Pros (3)', 'Cons (3)']);
  assert.deepEqual(homeNoteGroups({ cons: 'Busy road' }).map((group) => group.key), ['cons']);
  assert.deepEqual(homeNoteGroups({ notes: 'Ask about roof', conditionNotes: 'Furnace is old' })[0].entries, ['Ask about roof', 'Furnace is old']);
  assert.deepEqual(homeNoteGroups({ notes: '  ', pros: '', cons: null }), []);
  assert.deepEqual(homeNoteGroups(null), []);
  // An existing one-line, comma-separated pro is one entry, as before.
  assert.equal(homeNoteGroups({ pros: 'Bright, open living room, Huge backyard' })[0].entries.length, 1);
  assert.equal(noteFieldCount({ pros: 'a\nb', cons: 'c' }), 2, 'the per-field count helper is unchanged');
});

/* ----------------------------------- card ----------------------------------- */

test('card: the previews sit below Commute and above the tour / action rows; nothing renders when nothing is written', () => {
  const at = (needle) => { const index = card.indexOf(needle); assert.ok(index > -1, needle); return index; };
  assert.ok(at('className="hh-card-commute"') < at(') : notesPreview}'));
  assert.ok(at(') : notesPreview}') < at("mode === 'tour' && wantToTourState?.wantToTourLabel"));
  assert.ok(at(') : notesPreview}') < at('className="hh-home-card-actions"'));
  assert.match(preview, /const groups = homeNoteGroups\(home\);/);
  assert.match(preview, /if \(!groups\.length\) return null;/);
  assert.match(preview, /\{label\} \(\{entries\.length\}\)/);
  // The preview links to the home's Tour Feedback, where the shared notes are edited.
  assert.match(card, /href=\{`\$\{homeHref\}\$\{homeHref\.includes\('\?'\) \? '&' : '\?'\}section=tour`\}/);
  assert.match(preview, /<Link className="hh-note-popover-link" href=\{href\} scroll=\{false\} onClick=\{onOpen\}>View or edit notes<\/Link>/);
});

test('preview interactions: mouse hover, touch tap, keyboard focus / Enter / Escape, outside tap closes', () => {
  // Hover previews only for a real mouse (a touch tap must not open-then-toggle).
  assert.match(preview, /onPointerEnter=\{\(event\) => \{ if \(event\.pointerType === 'mouse'\) preview\(key\); \}\}/);
  assert.match(preview, /onPointerLeave=\{\(event\) => \{ if \(event\.pointerType === 'mouse'\) setOpen\(\(current\) => \(current\?\.pinned \? current : null\)\); \}\}/);
  // Tap / click / Enter / Space pin it open; a second activation closes it.
  assert.match(preview, /onClick=\{\(\) => setOpen\(\(current\) => \(current\?\.key === key && current\.pinned \? null : \{ key, pinned: true \}\)\)\}/);
  // Keyboard focus previews it; Escape closes and returns focus; outside pointerdown closes.
  assert.match(preview, /onFocus=\{\(event\) => \{ if \(event\.currentTarget\.matches\(':focus-visible'\)\) preview\(key, \{ fromFocus: true \}\); \}\}/);
  assert.match(preview, /return current\?\.pinned && !fromFocus \? current : \{ key, pinned: false \};/, 'hover never steals a pinned preview');
  assert.match(preview, /event\.key === 'Escape'/);
  assert.match(preview, /trigger\?\.focus\(\{ preventScroll: true \}\)/);
  assert.match(preview, /event\.type === 'pointerdown' && !rootRef\.current\?\.contains\(event\.target\)/);
  assert.match(preview, /onBlur=\{\(event\) => \{ if \(!event\.currentTarget\.contains\(event\.relatedTarget\)\) setOpen\(null\); \}\}/);
  // Real buttons, with state exposed.
  assert.match(preview, /<button\s+type="button"/);
  assert.match(preview, /aria-expanded=\{expanded\}/);
  assert.match(preview, /aria-controls=\{expanded \? panelId : undefined\}/);
  assert.match(preview, /role="region" aria-label=\{`\$\{label\} for \$\{address\}`\}/);
});

test('preview styles: quiet link-like counts, focus ring, 44px touch targets, popover bounded to the card', () => {
  assert.match(css, /\.hh-note-preview-trigger:focus-visible \{ outline: 2px solid var\(--focus-ring\);/);
  assert.match(css, /@media \(max-width: 700px\), \(pointer: coarse\) \{ \.hh-note-preview-trigger \{ min-height: 44px; \} \}/);
  const popover = css.match(/\.hh-note-popover \{([^}]*)\}/)?.[1] || '';
  assert.match(popover, /left: 0;/);
  assert.match(popover, /width: min\(280px, 100cqw\);/, 'never wider than the card');
  assert.match(popover, /max-height: 240px; overflow: auto;/);
  assert.match(css, /\.hh-note-popover li \{[^}]*overflow-wrap: anywhere;/);
});

/* --------------------------------- editing --------------------------------- */

test('Add Home and Edit Home both edit Notes / Pros / Cons with the same light fields; Add keeps them optional and collapsed', () => {
  assert.match(modal, /<NoteListFields form=\{form\} set=\{set\} idPrefix="edit-home" \/>/);
  assert.match(modal, /<details className="hh-details flh-found-notes">[\s\S]*?<NoteListFields form=\{form\} set=\{set\} idPrefix="add-home" \/>[\s\S]*?<\/details>/);
  assert.doesNotMatch(modal, /<details className="hh-details flh-found-notes" open/);
  // Order on the fields matches the card; each says "one per line".
  assert.deepEqual([...fields.matchAll(/key: '(\w+)', label: '(\w+)'/g)].map((m) => m[2]), ['Notes', 'Pros', 'Cons']);
  assert.match(fields, /'One per line'/);
  assert.match(fields, /onChange=\{\(event\) => set\(key, event\.target\.value\)\}/, 'saved exactly as typed');
  // Still the one shared save: no new storage path, no new field names.
  assert.match(modal, /await onSave\(\{ \.\.\.form, \.\.\.coordinates, lotSize, photoUrl: finalPhotoUrl,/);
  const collaboration = read('src/lib/supabase/collaboration.js');
  assert.match(collaboration, /'notes', 'pros', 'cons', 'latitude'/);
});

test('no migration and no Match, filter, compare, import or Floor Plans change', () => {
  for (const path of ['src/lib/matching.js', 'src/lib/homeFilters.js', 'src/components/CompareBoard.jsx', 'src/lib/rentcast.js', 'src/lib/listingTextAnswers.js', 'src/components/FloorPlans.jsx', 'src/lib/featureFlags.js']) {
    assert.doesNotMatch(read(path), /homeNoteGroups|noteEntries|HomeNotesPreview|NoteListFields/, path);
  }
});

/* ------------------------------- real Postgres ------------------------------- */

let db;
const ids = {};
before(async () => {
  if (!DB_TESTS_ENABLED) return;
  db = createTestDatabase();
  for (const key of ['owner', 'coBuyer']) ids[key] = db.createUser({ email: `${key}.notes@example.com` });
  ids.search = db.admin(`select id from public.searches where user_id = '${ids.owner}'`)[0].id;
  const invitation = await createInvitation(db.clientFor(ids.owner), ids.search, ids.owner, 'coBuyer.notes@example.com', 'co_buyer');
  assert.equal((await acceptInvitation(db.clientFor(ids.coBuyer), invitation.token)).success, true);
});
after(() => db?.drop());

dbTest('Notes / Pros / Cons save with a new home, edit, and read back the same for a co-buyer', async () => {
  const owner = db.clientFor(ids.owner);
  const coBuyer = db.clientFor(ids.coBuyer);
  const added = await saveHomePersonalAndShared(owner, {
    address: '12 Notes Ct', status: 'Saved', checks: {}, ratings: {},
    notes: 'Seller offering $5k toward closing costs\nTaxes seem high',
    pros: 'Great backyard\nUpdated kitchen\nQuiet street',
    cons: '',
  }, ids.owner, ids.search);
  const stored = db.admin(`select notes, pros, cons from public.homes where id = '${added.id}'`)[0];
  assert.equal(stored.pros, 'Great backyard\nUpdated kitchen\nQuiet street', 'stored exactly as typed');
  assert.equal(stored.cons, '');

  let [mine] = await getHomesForUser(owner, ids.owner, ids.search, { homeId: added.id });
  assert.deepEqual(homeNoteGroups(mine).map((group) => [group.key, group.entries.length]), [['notes', 2], ['pros', 3]]);

  // The co-buyer edits the shared Cons; both see the same three groups.
  await saveHomeSharedFields(coBuyer, added.id, { cons: 'Small primary bedroom\nBusy road nearby' });
  [mine] = await getHomesForUser(owner, ids.owner, ids.search, { homeId: added.id });
  const [theirs] = await getHomesForUser(coBuyer, ids.coBuyer, ids.search, { homeId: added.id });
  assert.deepEqual(homeNoteGroups(mine), homeNoteGroups(theirs));
  assert.deepEqual(homeNoteGroups(theirs).map((group) => `${group.label} (${group.entries.length})`), ['Notes (2)', 'Pros (3)', 'Cons (2)']);

  // Clearing a field removes its count; nothing else changes.
  await saveHomeSharedFields(owner, added.id, { notes: '' });
  [mine] = await getHomesForUser(owner, ids.owner, ids.search, { homeId: added.id });
  assert.deepEqual(homeNoteGroups(mine).map((group) => group.key), ['pros', 'cons']);
});
