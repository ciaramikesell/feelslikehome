// Home Facts UX (PR #187): one Basement description over the two stored facts,
// Laundry after Basement, HOA status, one freeform School Details field, and the
// generic Notes box shown only while it holds text. Existing values keep
// displaying and evaluating; nothing a person saved is deleted or guessed at.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  BASEMENT_SUGGESTIONS, basementDescriptionPatch, basementFieldValue, basementMatchReading, describeBasement, HOA_STATUS_CHOICES, hoaConflict,
  hoaStatusChoice, hoaStatusValue, LAUNDRY_LOCATION_CHOICES, parseBasementDescription,
} from '../src/lib/homeFacts.js';
import { homeFactAnswer } from '../src/lib/homeFactCriteria.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const facts = read('src/components/HomeFacts.jsx');
const FINISHED = 'features:Finished basement';
const WALKOUT = 'features:Walkout basement';

/* ---------------------------------- Basement ---------------------------------- */

test('basement wording: whole words only, each fact on its own, ambiguity stays Unknown', () => {
  const cases = [
    ['Finished Walkout', 'finished', 'walkout', true],
    ['Unfinished', 'unfinished', null, true],
    ['UNFINISHED basement', 'unfinished', null, true],
    ['Partially Finished', 'partially_finished', null, true],
    ['partly-finished walk-out', 'partially_finished', 'walkout', true],
    ['Finished', 'finished', null, true],
    ['Walkout', null, 'walkout', true],
    ['Walk out', null, 'walkout', true],
    ['Fully finished lower level', 'finished', null, true],
    ['Unfinished Walkout', 'unfinished', 'walkout', true],
    ['Traditional', null, 'traditional', true],
    ['Garden-view', null, 'gardenview', true],
    ['No basement', 'none', 'none', true],
    ['None', 'none', 'none', true],
    ['', null, null, true],
    // Ambiguous: two finishes, two styles, negations, hedges, unknown words.
    ['Finished, unfinished storage', null, null, false],
    ['Walkout or traditional', null, null, false],
    ['No walkout', null, null, false],
    ['Not finished', null, null, false],
    ['Possibly finished', null, null, false],
    ['Finished?', null, null, false],
    ['Daylight', null, null, false],
    ['Walk-up', null, null, false],
    ['Finished with wet bar', 'finished', null, false],
  ];
  for (const [text, condition, style, complete] of cases) {
    assert.deepEqual(parseBasementDescription(text), { basementCondition: condition, basementStyle: style, complete }, text);
  }
  // "Unfinished" never reads as finished; "Finished" never establishes walkout; "Walkout" never establishes finished.
  assert.equal(homeFactAnswer(parseBasementDescription('Unfinished'), FINISHED), 'no');
  assert.equal(homeFactAnswer(parseBasementDescription('Finished'), WALKOUT), undefined);
  assert.equal(homeFactAnswer(parseBasementDescription('Walkout'), FINISHED), undefined);
  assert.deepEqual(BASEMENT_SUGGESTIONS, ['Finished Walkout', 'Finished', 'Partially Finished', 'Unfinished', 'Walkout', 'Unfinished Walkout', 'No basement']);
  // Every suggestion is read completely.
  for (const suggestion of BASEMENT_SUGGESTIONS) assert.equal(parseBasementDescription(suggestion).complete, true, suggestion);
});

test('every stored basement combination still displays, round-trips and reads exactly as before', () => {
  const conditions = [null, 'none', 'unfinished', 'partially_finished', 'finished'];
  const styles = [null, 'none', 'traditional', 'gardenview', 'walkout'];
  for (const condition of conditions) for (const style of styles) {
    const home = { basementCondition: condition, basementStyle: style };
    const shown = basementFieldValue(home);
    if (!condition && !style) { assert.deepEqual(shown, { text: '', source: null, earlierNote: null, offer: null }); continue; }
    assert.equal(shown.source, 'facts');
    assert.equal(shown.text, describeBasement(condition, style));
    // Committing what is shown, unchanged, writes nothing (no silent rewrite of legacy values).
    const contradiction = (condition === 'none') !== (style === 'none') && (condition || style) && !(condition === 'none' && !style) && !(style === 'none' && !condition);
    if (!contradiction) {
      const patch = basementDescriptionPatch(home, shown.text);
      const expected = condition === 'none' || style === 'none' ? { basementCondition: 'none', basementStyle: 'none' } : {};
      const after = { ...home, ...patch };
      // "No basement" with one side Unknown completes to none / none, which reads identically.
      if (Object.keys(patch).length) assert.deepEqual(patch, Object.fromEntries(Object.entries(expected).filter(([key, value]) => home[key] !== value)), `${condition}/${style}`);
      for (const key of [FINISHED, WALKOUT]) assert.equal(homeFactAnswer(after, key), homeFactAnswer(home, key), `${condition}/${style} ${key}`);
    }
    assert.match(basementMatchReading(condition, style), /^Match reads Finished: (Yes|No|Unknown) · Walkout: (Yes|No|Unknown)$/);
  }
  assert.equal(describeBasement('finished', 'walkout'), 'Finished Walkout');
  assert.equal(describeBasement('partially_finished', null), 'Partially Finished');
  assert.equal(describeBasement('none', 'none'), 'No basement');
  assert.equal(describeBasement('finished', 'none'), 'Finished (also marked No basement)');
  assert.equal(basementMatchReading('partially_finished', 'walkout'), 'Match reads Finished: Unknown · Walkout: Yes');
});

test('typing a description writes only what changed, keeps the person\'s words, and never deletes an earlier note silently', () => {
  // A new description: both facts, no note needed.
  assert.deepEqual(basementDescriptionPatch({}, 'Finished Walkout'), { basementCondition: 'finished', basementStyle: 'walkout' });
  // Editing "Finished Walkout" down to "Finished": walkout returns to Unknown (never "traditional").
  assert.deepEqual(basementDescriptionPatch({ basementCondition: 'finished', basementStyle: 'walkout' }, 'Finished'), { basementStyle: null });
  // Words FLH can't fully read are kept as typed; what it can read is used.
  assert.deepEqual(basementDescriptionPatch({}, 'Finished with wet bar'), { basementCondition: 'finished', basementNotes: 'Finished with wet bar' });
  assert.deepEqual(basementFieldValue({ basementCondition: 'finished', basementNotes: 'Finished with wet bar' }).text, 'Finished with wet bar');
  // Ambiguous wording: both facts Unknown, words kept.
  assert.deepEqual(basementDescriptionPatch({ basementCondition: 'finished' }, 'Finished, unfinished storage'), { basementCondition: null, basementNotes: 'Finished, unfinished storage' });
  // An earlier note (imported or typed before) is shown but never read for Match until used.
  const legacy = { basementNotes: 'Finished walk-out w/ bar' };
  assert.deepEqual(basementFieldValue(legacy), { text: 'Finished walk-out w/ bar', source: 'earlier_note', earlierNote: null, offer: { basementCondition: 'finished', basementStyle: 'walkout' } });
  assert.equal(homeFactAnswer(legacy, FINISHED), undefined, 'not read until someone chooses Use');
  // Facts set some other way leave the note visible beside them.
  assert.equal(basementFieldValue({ basementCondition: 'unfinished', basementNotes: 'Finished walk-out w/ bar' }).earlierNote, 'Finished walk-out w/ bar');
  // Clearing the field clears the facts; the note only when it was what the field showed.
  assert.deepEqual(basementDescriptionPatch({ basementCondition: 'finished', basementStyle: 'walkout', basementNotes: 'Old listing note' }, ''), { basementCondition: null, basementStyle: null });
  assert.deepEqual(basementDescriptionPatch(legacy, ''), { basementNotes: '' });
  // An unchanged commit writes nothing.
  assert.deepEqual(basementDescriptionPatch({ basementCondition: 'finished', basementStyle: 'walkout' }, 'Finished Walkout'), {});
});

test('Basement UI: one field with suggestions and a plain "Match reads" line; Use for an earlier note is an explicit click', () => {
  const basement = facts.match(/<Group id="hf-basement-title" title="Basement">([\s\S]*?)<\/Group>/)[1];
  assert.match(basement, /<datalist id="hf-basement-options">\{BASEMENT_SUGGESTIONS\.map/);
  assert.match(basement, /basementMatchReading\(home\.basementCondition, home\.basementStyle\)/);
  assert.match(basement, /onClick=\{\(\) => save\(Object\.fromEntries\(Object\.entries\(basement\.offer\)\.filter/);
  assert.match(basement, /Earlier note, not yet read for Match\./);
  assert.match(read('src/lib/homeFactCriteria.js'), /finishedBasement: \['hf-basement', 'Basement'\]/);
});

/* --------------------------------- Laundry --------------------------------- */

test('Laundry: after Basement in Home Facts, Main Floor answers Main Floor Laundry Yes, nothing answers No', () => {
  assert.deepEqual(LAUNDRY_LOCATION_CHOICES[0], ['first_floor', 'Main Floor']);
  for (const [location, answer] of [['first_floor', true], ['basement', undefined], ['second_floor', undefined], [null, undefined], [undefined, undefined]]) {
    assert.equal(homeFactAnswer({ laundryLocation: location }, 'features:First-floor laundry'), answer, String(location));
  }
  const side = facts.slice(facts.indexOf('className="flh-hf2-column flh-hf2-column-side"'));
  assert.ok(side.indexOf('id="hf-basement-title"') < side.indexOf('id="hf-laundry-title"'));
  assert.doesNotMatch(facts.match(/<section className="flh-hf2-header"[\s\S]*?<\/section>/)[0], /laundry/i, 'not in the photo / summary section');
});

/* ----------------------------------- HOA ----------------------------------- */

test('HOA status: a separate, explicit control; a $0 fee never sets it; a disagreement is said, not resolved', () => {
  assert.deepEqual(HOA_STATUS_CHOICES, [['yes', 'Has an HOA'], ['no', 'No HOA']]);
  assert.deepEqual([hoaStatusChoice(true), hoaStatusChoice(false), hoaStatusChoice(null), hoaStatusChoice(undefined)], ['yes', 'no', '', '']);
  assert.deepEqual([hoaStatusValue('yes'), hoaStatusValue('no'), hoaStatusValue(''), hoaStatusValue(null)], [true, false, null, null]);
  assert.equal(hoaConflict({ hasHoa: false, hoaFeeMonthly: 125 }), true);
  for (const home of [{ hasHoa: false, hoaFeeMonthly: 0 }, { hasHoa: true, hoaFeeMonthly: 0 }, { hasHoa: null, hoaFeeMonthly: 125 }, { hasHoa: false, hoaFeeMonthly: null }]) assert.equal(hoaConflict(home), false);
  assert.match(facts, /hoaKnownToDatabase && <Row label="HOA" htmlFor="hf-hasHoa"><SelectField id="hf-hasHoa" value=\{hoaStatusChoice\(home\.hasHoa\)\}/);
  assert.match(facts, /onCommit=\{\(choice\) => save\(\{ hasHoa: hoaStatusValue\(choice\) \}\)\}/);
  // The fee control and its "$0 is not No HOA" wording are unchanged.
  assert.match(facts, /<Row label="HOA fee" hint=\{isReadOnly \? null : 'Enter 0 for a \$0 monthly fee'\}/);
});

/* --------------------------------- Schools --------------------------------- */

test('School Details: one freeform field beside the district; saved school names stay; nothing is looked up', () => {
  const schools = facts.match(/<Group id="hf-schools-title" title="School Details">([\s\S]*?)<\/Group>/)[1];
  assert.match(schools, /<Row label="District" htmlFor="hf-schoolDistrict">\{text\('schoolDistrict'\)\}<\/Row>/);
  assert.match(schools, /text\('schoolsNotes', null, \{ parse: parseLegacyText, multiline: true/);
  assert.match(schools, /\[\['elementarySchool', 'Elementary'\], \['middleSchool', 'Middle'\], \['highSchool', 'High'\]\]\.filter\(\(\[field\]\) => home\[field\]\)/);
  assert.doesNotMatch(facts + read('src/lib/homeFacts.js'), /boundary lookup|fetch\(|geocode/i);
});

/* ---------------------------------- Notes ---------------------------------- */

test('Notes: the empty generic box is gone from Home Facts and Add / Edit Home; existing notes stay visible and editable', () => {
  const noteFields = read('src/components/NoteListFields.jsx');
  for (const source of [facts, noteFields]) {
    assert.match(source, /notesShown\.current = true;/);
    assert.match(source, /key !== 'notes' \|\| notesShown\.current/);
  }
  // Notes are still written by tours and by "Add to notes" from a pasted listing, and still shown on cards and Compare.
  assert.match(read('src/lib/lifecycle.js'), /const notes = appendPostTourNote\(home\.notes, noteEntry\);/);
  assert.match(read('src/components/HomeModal.jsx'), /notes: appendSuggestionToNotes\(f\.notes, suggestion\)/);
  assert.match(read('src/components/TourFeedback.jsx'), /<label className="wide">Notes<textarea/);
  assert.match(read('src/lib/supabase/collaboration.js'), /'notes', 'pros', 'cons', 'latitude'/, 'still a shared field: nothing is dropped from saves');
  assert.match(read('src/components/HomeModal.jsx'), /<summary>Add pros or cons <span>Optional · shared with this search<\/span>/);
});
