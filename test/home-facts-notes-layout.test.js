// Home Facts layout refinement + inline Notes / Pros / Cons
// (docs/home-facts-notes-layout.md). Garage and Basement show their two
// existing controls side by side; the shared notes / pros / cons are edited
// below Basement through the overlay's autosave, guarded so one participant
// never silently overwrites another's newer text. No migration. DB tests skip
// unless FLH_TEST_PGHOST is set (docs/database-tests.md).
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { createTestDatabase, DB_TESTS_ENABLED, DB_SKIP_REASON } from './support/supabaseDb.mjs';

register('./support/aliasHooks.mjs', import.meta.url);
const {
  SHARED_NOTE_FIELDS, SHARED_NOTES_CONFLICT, SharedNotesConflictError, acceptInvitation, createInvitation, getHomesForUser,
  saveHomePersonalAndShared, saveHomeSharedFields,
} = await import('../src/lib/supabase/collaboration.js');
const { homeNoteGroups } = await import('../src/lib/homeDisplay.js');
const { BASEMENT_CONDITION_CHOICES, BASEMENT_STYLE_CHOICES, GARAGE_SPACE_CHOICES, GARAGE_TYPE_CHOICES, basementPatch, garagePatch } = await import('../src/lib/homeFacts.js');
const { computeMatch } = await import('../src/lib/matching.js');
const { normalizePriorities } = await import('../src/lib/constants.js');
const { addCriterion } = await import('../src/lib/searchProfile.js');
const { applySearchChoice } = await import('../src/lib/onboarding.js');

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const dbTest = (name, fn) => test(name, { skip: DB_TESTS_ENABLED ? false : DB_SKIP_REASON }, fn);
const facts = read('src/components/HomeFacts.jsx');
const overlay = read('src/components/HomeOverlay.jsx');
const css = read('src/app/globals.css');
const noteFields = read('src/components/NoteListFields.jsx');

/* --------------------------------- layout --------------------------------- */

test('Garage and Basement: the same four separate controls, labels, choices and saves, side by side', () => {
  const garage = facts.match(/<Group id="hf-garage-title" title="Garage">([\s\S]*?)<\/Group>/)[1];
  const basement = facts.match(/<Group id="hf-basement-title" title="Basement">([\s\S]*?)<\/Group>/)[1];
  assert.match(garage, /<Pair>\s*<PairField label="Type" htmlFor="hf-garageType">\{select\('garageType', null, GARAGE_TYPE_CHOICES, \(value\) => save\(garagePatch\(home, 'garageType', value\)\)\)\}<\/PairField>\s*<PairField label="Spaces" htmlFor="hf-garageSpaces"><SelectField id="hf-garageSpaces" value=\{garageSpacesSelectValue\(home\.garageSpaces\)\} choices=\{GARAGE_SPACE_CHOICES\}[^>]*onCommit=\{\(value\) => save\(garagePatch\(home, 'garageSpaces', value\)\)\} \/><\/PairField>\s*<\/Pair>/);
  assert.match(basement, /<Pair>\s*<PairField label="Style" htmlFor="hf-basementStyle">\{select\('basementStyle', null, BASEMENT_STYLE_CHOICES, \(value\) => save\(basementPatch\(home, 'basementStyle', value\)\)\)\}<\/PairField>\s*<PairField label="Condition" htmlFor="hf-basementCondition">\{select\('basementCondition', null, BASEMENT_CONDITION_CHOICES, \(value\) => save\(basementPatch\(home, 'basementCondition', value\)\)\)\}<\/PairField>\s*<\/Pair>/);
  // The earlier free-text basement note still shows when nothing structured is set.
  assert.match(basement, /home\.basementNotes && !home\.basementStyle && !home\.basementCondition/);
  // Options and the None-vs-Unknown rules are unchanged.
  assert.deepEqual(GARAGE_TYPE_CHOICES.map(([key]) => key), ['none', 'attached', 'detached']);
  assert.deepEqual(GARAGE_SPACE_CHOICES.map(([key]) => key), ['0', '1', '2', '3+']);
  assert.deepEqual(BASEMENT_STYLE_CHOICES.map(([key]) => key), ['none', 'traditional', 'gardenview', 'walkout']);
  assert.deepEqual(BASEMENT_CONDITION_CHOICES.map(([key]) => key), ['none', 'unfinished', 'partially_finished', 'finished']);
  assert.deepEqual(garagePatch({}, 'garageType', 'none'), { garageType: 'none', garageSpaces: '0' });
  assert.deepEqual(basementPatch({}, 'basementStyle', 'none'), { basementStyle: 'none', basementCondition: 'none' });
});

test('pair CSS: equal columns, never wider than the column, stacks into rows below 360px', () => {
  assert.match(css, /\.flh-hf2-column-side \{ container: hf-side \/ inline-size; \}/);
  assert.match(css, /\.flh-hf-pair \{ display: grid; grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
  assert.match(css, /\.flh-hf-pair-field \{ display: grid; gap: 4px; min-width: 0;/);
  assert.match(css, /@container hf-side \(max-width: 359px\) \{\s*\.flh-hf-pair \{ grid-template-columns: minmax\(0, 1fr\); gap: 0; \}\s*\.flh-hf-pair-field \{ grid-template-columns: minmax\(0, 44%\) minmax\(0, 1fr\);/);
  // The shared select still fills its cell and keeps its 16px phone size.
  assert.match(css, /\.flh-select select \{ width: 100%;/);
});

test('Notes, Pros & Cons sit below Basement in the right column; read-only viewers see them only when written', () => {
  const side = facts.indexOf('className="flh-hf2-column flh-hf2-column-side"');
  const order = ['id="hf-garage-title"', 'id="hf-basement-title"', 'id="hf-notes-title"'].map((needle) => facts.indexOf(needle, side));
  assert.ok(side > facts.indexOf('id="hf-basic-title"') && order.every((index, i) => index > (i ? order[i - 1] : side)), `order ${order}`);
  assert.match(facts, /\{\(available\.garage \|\| available\.basement \|\| showNotes\) && <div className="flh-hf2-column flh-hf2-column-side">/);
  assert.match(facts, /const showNotes = !isReadOnly \|\| NOTE_LIST_FIELDS\.some\(\(\{ key \}\) => noteEntries\(home\[key\]\)\.length > 0\);/);
  assert.match(facts, /<h3 id="hf-notes-title" className="flh-hf-block-title">Notes, Pros &amp; Cons<\/h3>/);
  // Same labels, order and placeholders as Add / Edit Home (NoteListFields).
  assert.match(noteFields, /export const NOTE_LIST_FIELDS = Object\.freeze\(\[/);
  assert.deepEqual([...noteFields.matchAll(/key: '(\w+)', label: '(\w+)'/g)].map((m) => m[1]), [...SHARED_NOTE_FIELDS]);
  // No other Match, filter or Home Facts rule reads them.
  for (const path of ['src/lib/matching.js', 'src/lib/homeFacts.js', 'src/lib/homeFilters.js', 'src/lib/matchReveal.js']) assert.doesNotMatch(read(path), /NOTE_LIST_FIELDS|SHARED_NOTE_FIELDS|\.pros\b|\.cons\b/, path);
});

test('note fields save as typed after a pause, on leaving the field, and on Close; failures show on the field', () => {
  const field = facts.match(/function NoteTextField\([\s\S]*?\n\}/)[0];
  assert.match(field, /if \(text !== null && text !== \(stored \?\? ''\)\) save\(text\);/);
  assert.match(field, /registerDraft\?\.\(id, \(\) => commitRef\.current\(\)\);/);
  assert.match(field, /timer\.current = setTimeout\(\(\) => commitRef\.current\(\), NOTE_DEBOUNCE_MS\);/);
  assert.match(field, /onBlur=\{\(\) => \{ commitRef\.current\(\); setDraft\(null\); \}\}/);
  assert.match(field, /useEffect\(\(\) => \(\) => \{ clearTimeout\(timer\.current\); commitRef\.current\(\); \}, \[\]\);/);
  assert.match(field, /aria-describedby=\{hintId\} aria-invalid=\{failed \|\| undefined\}/);
  assert.match(field, /<label className="flh-hf-note-label" htmlFor=\{id\}>/);
  assert.match(facts, /failed=\{failed\(key\)\} registerDraft=\{editor\?\.registerDraft\} onCommit=\{\(text\) => save\(\{ \[key\]: text \}\)\}/);
  assert.match(css, /\.flh-hf-note-input \{ font-size: 16px; \}/, 'no iOS zoom on focus');
});

test('overlay: notes go through the guarded write; a conflict is shown with Keep mine / Use theirs; card previews read the same local home', () => {
  assert.match(overlay, /const noteFields = SHARED_NOTE_FIELDS\.filter\(\(field\) => field in patch\);/);
  assert.match(overlay, /if \(error\?\.code === SHARED_NOTES_CONFLICT\) setNotesConflict\(\(current\) => \(\{ \.\.\.current, \.\.\.error\.current \}\)\);/);
  assert.match(overlay, /Object\.assign\(notesSeen\.current, notes\);/, 'what was saved is what this buyer has seen');
  // Reset only on a new server read, never on a re-render.
  assert.match(overlay, /if \(seenServerHome\.current === serverHome\) return;\s*seenServerHome\.current = serverHome;\s*if \(!hasUnsavedRef\.current\(\)\) notesSeen\.current = pickNotes\(serverHome\);\s*\}, \[serverHome\]\);/);
  assert.match(overlay, /\{notesConflict && <NotesConflict conflict=\{notesConflict\} onKeepMine=\{keepMyNotes\} onUseTheirs=\{takeTheirNotes\} \/>\}/);
  assert.match(overlay, /const takeTheirNotes = \(\) => \{[\s\S]*?autosave\.saveShared\(theirs\);/);
  assert.match(overlay, /<SaveState status=\{autosave\.status\} onRetry=\{autosave\.retry\} conflict=\{!!notesConflict\} \/>/, 'no Retry that would only conflict again');
  // applyLocal updates the board's copy, which the Home Card previews render.
  assert.match(overlay, /const applyLocal = useCallback\(\(patch\) => updateHome\(serverHome\.id, patch\), \[updateHome, serverHome\.id\]\);/);
  assert.match(read('src/components/HomesBoard.jsx'), /<HomeNotesPreview home=\{home\}/);
  // Match Reveal still fires only from this buyer's completed saves.
  assert.match(overlay, /useEffect\(\(\) => \{ if \(autosave\.status === 'saved'\) considerReveal\(homeRef\.current\); \}, \[autosave\.status, autosave\.savedVersion, considerReveal\]\);/);
  // Tour Feedback keeps its notes editor, through the same autosave.
  assert.match(overlay, /onSaveNotes=\{\(draft\) => applyAndConfirm\(\{ \.\.\.homeRef\.current, \.\.\.draft \}\)\}/);
});

test('notes never change Match: same score with and without them', () => {
  let priorities = applySearchChoice(normalizePriorities({}), 'home_buy');
  priorities = addCriterion(priorities, { categoryKey: 'exterior', label: 'Garage', kind: 'check' }, 'must');
  priorities.budget = { value: '500000', tier: 'important' };
  const home = { price: '450000', garageSpaces: '2', basementStyle: 'walkout', checks: {}, ratings: {} };
  const withNotes = { ...home, notes: 'Taxes seem high', pros: 'Garage is huge\nWalkout basement', cons: 'No garage door opener' };
  assert.deepEqual(computeMatch(withNotes, priorities), computeMatch(home, priorities));
});

test('the conflict error carries the current text and a stable code', () => {
  const error = new SharedNotesConflictError({ pros: 'Theirs' });
  assert.equal(error.code, SHARED_NOTES_CONFLICT);
  assert.deepEqual(error.current, { pros: 'Theirs' });
  assert.deepEqual([...SHARED_NOTE_FIELDS], ['notes', 'pros', 'cons']);
});

/* ------------------------------- real Postgres ------------------------------- */

let db;
const ids = {};
before(async () => {
  if (!DB_TESTS_ENABLED) return;
  db = createTestDatabase();
  for (const key of ['owner', 'coBuyer', 'outsider']) ids[key] = db.createUser({ email: `${key}.hfnotes@example.com` });
  ids.search = db.admin(`select id from public.searches where user_id = '${ids.owner}'`)[0].id;
  const invitation = await createInvitation(db.clientFor(ids.owner), ids.search, ids.owner, 'coBuyer.hfnotes@example.com', 'co_buyer');
  assert.equal((await acceptInvitation(db.clientFor(ids.coBuyer), invitation.token)).success, true);
});
after(() => db?.drop());

const row = (id) => db.admin(`select notes, pros, cons, garage_spaces, garage_type, basement_style from public.homes where id = '${id}'`)[0];
const newHome = (client, extra = {}) => saveHomePersonalAndShared(client, { address: `${Math.random().toString(36).slice(2, 8)} Notes Ln`, status: 'Saved', checks: {}, ratings: {}, garageSpaces: '2', ...extra }, ids.owner, ids.search);
const isConflict = (pattern) => (error) => { assert.equal(error.code, SHARED_NOTES_CONFLICT); assert.deepEqual(error.current, pattern); return true; };

dbTest('a guarded note write saves only that column and shows on every participant\'s card', async () => {
  const owner = db.clientFor(ids.owner);
  const home = await newHome(owner, { pros: 'Great backyard' });
  await saveHomeSharedFields(owner, home.id, { pros: 'Great backyard\nUpdated kitchen' }, { expected: { pros: 'Great backyard' } });
  assert.deepEqual(row(home.id), { notes: '', pros: 'Great backyard\nUpdated kitchen', cons: '', garage_spaces: '2', garage_type: null, basement_style: null });
  const [theirs] = await getHomesForUser(db.clientFor(ids.coBuyer), ids.coBuyer, ids.search, { homeId: home.id });
  assert.deepEqual(homeNoteGroups(theirs).map((group) => `${group.label} (${group.entries.length})`), ['Pros (2)']);
});

dbTest('a co-buyer\'s newer text is never overwritten: conflict with their text, nothing written', async () => {
  const owner = db.clientFor(ids.owner);
  const coBuyer = db.clientFor(ids.coBuyer);
  const home = await newHome(owner, { cons: 'Busy road' });
  // Both start from "Busy road". The co-buyer saves first.
  await saveHomeSharedFields(coBuyer, home.id, { cons: 'Busy road\nSmall yard' }, { expected: { cons: 'Busy road' } });
  await assert.rejects(saveHomeSharedFields(owner, home.id, { cons: 'Busy road\nRoof is old' }, { expected: { cons: 'Busy road' } }), isConflict({ cons: 'Busy road\nSmall yard' }));
  assert.equal(row(home.id).cons, 'Busy road\nSmall yard');
  // "Keep mine": the owner has now seen their text and saves deliberately.
  await saveHomeSharedFields(owner, home.id, { cons: 'Busy road\nRoof is old' }, { expected: { cons: 'Busy road\nSmall yard' } });
  assert.equal(row(home.id).cons, 'Busy road\nRoof is old');
  // Both typing the same text is not a conflict.
  await saveHomeSharedFields(coBuyer, home.id, { cons: 'Busy road\nRoof is old' }, { expected: { cons: 'Busy road\nSmall yard' } });
});

dbTest('only the changed note conflicts; another field or fact changing in between does not block or get overwritten', async () => {
  const owner = db.clientFor(ids.owner);
  const coBuyer = db.clientFor(ids.coBuyer);
  const home = await newHome(owner, { notes: 'Taxes seem high', pros: 'Quiet street' });
  // The co-buyer changes Notes and a garage fact; the owner then edits Pros only.
  await saveHomeSharedFields(coBuyer, home.id, { notes: 'Taxes seem high\nAsk about HOA' }, { expected: { notes: 'Taxes seem high' } });
  await saveHomeSharedFields(coBuyer, home.id, garagePatch({ garageSpaces: '2' }, 'garageType', 'detached'));
  await saveHomeSharedFields(owner, home.id, { pros: 'Quiet street\nBig trees' }, { expected: { pros: 'Quiet street' } });
  assert.deepEqual(row(home.id), { notes: 'Taxes seem high\nAsk about HOA', pros: 'Quiet street\nBig trees', cons: '', garage_spaces: '2', garage_type: 'detached', basement_style: null });
  // A stale write of both Notes and Pros conflicts on Notes alone and writes neither.
  await assert.rejects(saveHomeSharedFields(owner, home.id, { notes: 'Mine', pros: 'Quiet street\nBig trees\nPark' }, { expected: { notes: 'Taxes seem high', pros: 'Quiet street\nBig trees' } }), isConflict({ notes: 'Taxes seem high\nAsk about HOA' }));
  assert.equal(row(home.id).pros, 'Quiet street\nBig trees');
});

dbTest('a change landing between the check and the write is caught (updated_at), never overwritten', async () => {
  const owner = db.clientFor(ids.owner);
  // The first read of the row lets another participant's write land right after it.
  const racing = (sql) => {
    let raced = false;
    return { ...owner, from(table) {
      const query = owner.from(table);
      if (raced || table !== 'homes') return query;
      raced = true;
      const then = query.then.bind(query);
      query.then = (resolve, reject) => then((value) => { db.exec(sql); return value; }).then(resolve, reject);
      return query;
    } };
  };
  const home = await newHome(owner, { pros: 'A' });
  await assert.rejects(saveHomeSharedFields(racing(`update public.homes set pros = E'A\\nTheirs' where id = '${home.id}'`), home.id, { pros: 'A\nMine' }, { expected: { pros: 'A' } }), isConflict({ pros: 'A\nTheirs' }));
  assert.equal(row(home.id).pros, 'A\nTheirs');
  // A different fact racing in: the write retries against the new version and keeps it.
  await saveHomeSharedFields(racing(`update public.homes set basement_style = 'walkout' where id = '${home.id}'`), home.id, { pros: 'A\nTheirs\nMine' }, { expected: { pros: 'A\nTheirs' } });
  assert.deepEqual([row(home.id).pros, row(home.id).basement_style], ['A\nTheirs\nMine', 'walkout']);
});

dbTest('permissions are unchanged: a non-member cannot read or write the notes (an error, not a conflict)', async () => {
  const home = await newHome(db.clientFor(ids.owner), { notes: 'Private to this search' });
  await assert.rejects(saveHomeSharedFields(db.clientFor(ids.outsider), home.id, { notes: 'Hijack' }, { expected: { notes: 'Private to this search' } }), (error) => { assert.notEqual(error.code, SHARED_NOTES_CONFLICT); return true; });
  await assert.rejects(saveHomeSharedFields(db.clientFor(ids.outsider), home.id, { notes: 'Hijack' }));
  assert.equal(row(home.id).notes, 'Private to this search');
});
