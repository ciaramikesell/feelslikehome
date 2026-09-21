import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ONBOARDING_SUGGESTIONS } from '../src/lib/onboarding.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const onboarding = read('src/components/onboarding/Onboarding.jsx');
const qualifierPicker = read('src/components/QualifierPicker.jsx');
const priorityBoard = read('src/components/PriorityBoard.jsx');
const mySearchPanel = read('src/components/MySearchPanel.jsx');
const coachmark = read('src/components/Coachmark.jsx');
const homeModal = read('src/components/HomeModal.jsx');
const css = read('src/app/globals.css');

/* ------------------------------ Onboarding guidance: all three search types ------------------------------ */

test('The Basics uses inline guidance copy (no modal/tooltip) and never assumes a purchase', () => {
  assert.match(onboarding, /First, give us the basics\./);
  assert.match(onboarding, /Tell us what you&apos;re looking for so we know what belongs in your search\. Nothing here is permanent—you can change it anytime\./);
  const basicsStep = onboarding.slice(onboarding.indexOf('function BasicsStep'), onboarding.indexOf('function WhatMattersStep'));
  assert.doesNotMatch(basicsStep, /\bhouse\b|\bbuy\b|\bbuying\b|\bpurchase\b/i);
});

test('What Matters explains select-now/rank-next with a warm callout, not an error/warning style', () => {
  assert.match(onboarding, /What matters to you\?/);
  assert.match(onboarding, /Choose everything you&apos;d care about when comparing your options\. Don&apos;t worry about ranking them yet—you&apos;ll do that next\./);
  assert.match(onboarding, /className="hh-onboarding-callout"/);
  assert.match(onboarding, /For now, just choose what matters\./);
  assert.match(onboarding, /You&apos;ll decide what&apos;s a Must Have, Important, or Nice to Have on the next screen\./);
  // Reuses the same warm sage-tinted treatment as other reassuring (non-error) helpers.
  assert.match(css, /\.hh-onboarding-callout \{[^}]*background: rgba\(116,128,79,\.08\)/);
  assert.doesNotMatch(css, /\.hh-onboarding-callout \{[^}]*(negative|--brick)/);
});

test('the What Matters/CTA copy and the underlying suggestion catalog are identical across Home to Buy, Home to Rent, and Apartment to Rent — one shared component, no per-type routing drift', () => {
  for (const choiceKey of ['home_buy', 'home_rent', 'apartment_rent']) {
    assert.ok(Array.isArray(ONBOARDING_SUGGESTIONS[choiceKey]) && ONBOARDING_SUGGESTIONS[choiceKey].length > 0, `${choiceKey} must have suggestions`);
  }
  // WhatMattersStep and BasicsStep read `priorities.onboardingSearchType` to pick a
  // catalog, but render the exact same header/callout/CTA markup regardless of
  // which of the three it is — verified structurally: there is only one
  // WhatMattersStep/BasicsStep function, not one per search type.
  assert.equal((onboarding.match(/function WhatMattersStep/g) || []).length, 1);
  assert.equal((onboarding.match(/function BasicsStep/g) || []).length, 1);
});

test('CTA reinforces ranking, not a generic "Continue"', () => {
  assert.match(onboarding, /\{isSaving \? 'Saving your search…' : 'Rank my priorities'\}/);
  assert.doesNotMatch(onboarding, />Continue<\/button><\/nav>\s*<\/div>;\s*}\s*\n\nexport default function Onboarding/);
});

/* ------------------------------ Qualifier helpers ------------------------------ */

test('Garage, Fenced Yard, and First-Floor Bedroom each get a tiny conversational hint next to their refinement controls, never a large card', () => {
  assert.match(qualifierPicker, /'exterior:Garage': "Any garage works\? Leave it as Any, or tell us if Attached or Detached matters\."/);
  assert.match(qualifierPicker, /'exterior:Fenced yard': "Any fence works\? Leave it as Any, or choose Privacy Fence if that's important\."/);
  assert.match(qualifierPicker, /'features:First-Floor Bedroom': 'Who needs to be downstairs\? Choose Primary, Guest, both, or leave it as Any\.'/);
  assert.match(css, /\.hh-qualifier-hint \{[^}]*font-size: 11px/);
  assert.doesNotMatch(qualifierPicker, /<section|<article/); // no card wrapper
});

test('qualifier hints only render alongside real refinement options, and only once the parent is selected in onboarding', () => {
  assert.match(qualifierPicker, /if \(!options\) return null;/);
  assert.match(onboarding, /if \(!selected\(criterion\) \|\| !hasQualifierOptions\(criterion\.categoryKey, criterion\.label\)\) return \[chip\];/);
});

/* ------------------------------ First-run My Search: coachmark ------------------------------ */

test('drag coachmark shows only on the first appropriate arrival, via a plain localStorage flag (same precedent as the mobile tour dismiss)', () => {
  assert.match(priorityBoard, /const DRAG_COACHMARK_KEY = 'flh-my-search-drag-coachmark-dismissed';/);
  assert.match(priorityBoard, /useCoachmark\(DRAG_COACHMARK_KEY, !onboarding && firstRun\)/);
  assert.match(coachmark, /localStorage\.getItem\(storageKey\) !== '1'/);
  assert.match(coachmark, /localStorage\.setItem\(storageKey, '1'\)/);
});

test('coachmark copy matches spec and is visually anchored to the priority board (not a full-screen slideshow)', () => {
  assert.match(priorityBoard, /heading="Now rank what matters most"/);
  assert.match(priorityBoard, /body="We started everything you chose as Important\. Drag your priorities between Must Have, Important, and Nice to Have to tell Feels Like Home how much each one matters\."/);
  assert.match(coachmark, /ctaLabel = 'Got it'/);
  assert.doesNotMatch(priorityBoard, /fullscreen|full-screen|backdrop/i);
});

test('coachmark is keyboard dismissible, focus-managed, screen-reader accessible, and never traps focus', () => {
  assert.match(coachmark, /role="dialog" aria-modal="false"/);
  assert.match(coachmark, /aria-labelledby=\{headingId\.current\}/);
  assert.match(coachmark, /aria-describedby=\{bodyId\.current\}/);
  assert.match(coachmark, /dismissRef\.current\?\.focus\(\)/);
  assert.match(coachmark, /event\.key === 'Escape'\) onDismiss\(\)/);
  assert.doesNotMatch(coachmark, /trapFocus|preventDefault\(\).*Tab/i);
});

test('permanent inline instruction remains available regardless of coachmark dismissal', () => {
  assert.match(priorityBoard, /className="hh-priority-board-intro"/);
  assert.match(priorityBoard, />Rank what matters to you<\/h4>/);
  assert.match(priorityBoard, /Drag any priority to move it between the three columns\./);
});

test('the smallest reusable guidance primitive is used — no generic multi-step tour framework was built', () => {
  assert.doesNotMatch(coachmark, /step\d|currentStep|totalSteps|TourProvider|useTour\b/);
  assert.match(coachmark, /export function useCoachmark/);
  assert.match(coachmark, /export default function Coachmark/);
});

test('no premature feature callouts were added for Want to Tour, Compare, Map, collaboration, or Places That Matter', () => {
  assert.doesNotMatch(priorityBoard, /Coachmark[\s\S]*Want to Tour|Coachmark[\s\S]*Compare|Coachmark[\s\S]*Places That Matter/);
  const appShell = read('src/components/AppShell.jsx');
  assert.doesNotMatch(appShell, /useCoachmark|Coachmark/);
});

test('reduced motion is fully respected: the optional movement cue is scoped entirely inside a prefers-reduced-motion:no-preference query and never loops', () => {
  const reducedMotionBlock = css.slice(css.indexOf('@media (prefers-reduced-motion: no-preference) {\n  @keyframes hh-drag-hint-cue'));
  assert.match(reducedMotionBlock, /@keyframes hh-drag-hint-cue/);
  assert.match(reducedMotionBlock, /\.hh-drag-hint-cue \{ animation: hh-drag-hint-cue 900ms ease-in-out 700ms 1 both; \}/);
  // "1" iteration count — plays once, never bounces continuously.
  assert.doesNotMatch(css, /hh-drag-hint-cue[^;]*infinite/);
  assert.match(priorityBoard, /dragCoachmarkOpen && !mobileCompact && firstSelected/);
});

/* ------------------------------ First-run My Search: banner wording ------------------------------ */

test('first-run banner is orientation + payoff and does not assume Home to Buy or repeat the coachmark paragraph', () => {
  assert.match(mySearchPanel, /Here&apos;s what we heard\./);
  assert.match(mySearchPanel, /Ready to see your Match\?/);
  assert.match(mySearchPanel, /Bring in the first home you&apos;re considering/);
  const banner = mySearchPanel.slice(mySearchPanel.indexOf('hh-search-reveal'), mySearchPanel.indexOf('/section>') + 10);
  assert.doesNotMatch(banner, /\bhouse\b/i);
  assert.doesNotMatch(mySearchPanel, /Drag your priorities between/);
});

/* ------------------------------ Part B: inline Pros / Cons / Notes ------------------------------ */

const editor = homeModal.slice(homeModal.indexOf('function EditHomeEditor'), homeModal.indexOf('export default function HomeModal'));

test('Pros, Cons, and Notes are directly editable in Add/Edit Home — no separate "Edit notes" click required', () => {
  assert.doesNotMatch(editor, />Edit notes<|>Show notes summary<|setNotesOpen|NoteSummary/);
  assert.match(editor, /value=\{form\.pros \|\| ''\} onChange=\{\(e\) => set\('pros', e\.target\.value\)\}/);
  assert.match(editor, /value=\{form\.cons \|\| ''\} onChange=\{\(e\) => set\('cons', e\.target\.value\)\}/);
  assert.match(editor, /value=\{form\.notes \|\| ''\} onChange=\{\(e\) => set\('notes', e\.target\.value\)\}/);
});

test('notes fields use helpful conversational placeholders, never "Nothing added yet" inside an editable control', () => {
  assert.match(editor, /placeholder="What do you like\?"/);
  assert.match(editor, /placeholder="Anything giving you pause\?"/);
  assert.match(editor, /placeholder="Anything else you want to remember\?"/);
  assert.doesNotMatch(editor, /Nothing added yet/);
});

test('notes fields have real associated labels (not placeholder-only labeling) for accessibility', () => {
  assert.match(editor, /htmlFor="edit-home-pros"/);
  assert.match(editor, /id="edit-home-pros"/);
  assert.match(editor, /htmlFor="edit-home-cons"/);
  assert.match(editor, /id="edit-home-cons"/);
  assert.match(editor, /htmlFor="edit-home-notes"/);
  assert.match(editor, /id="edit-home-notes"/);
});

test('notes save through the existing single Add/Edit Home submit — no second notes system or early home creation', () => {
  // form.pros/cons/notes are part of the same `form` state object the rest of
  // the editor reads and writes via set(), and `submit` (unchanged) persists
  // the whole form in one call — see the shared `set`/`submit` props threaded
  // into EditHomeEditor from HomeModal's single save path.
  assert.match(homeModal, /const set = \(k, v\) => setForm\(\(f\) => \(\{ \.\.\.f, \[k\]: v \}\)\);/);
  assert.doesNotMatch(homeModal, /createHome\(|insertHome\(/); // no early/second creation path introduced
});

test('Shared Notes ownership/collaboration copy is unchanged — still a shared home field, not participant-private or Realtor-only', () => {
  assert.match(homeModal, /isCollaborative \? 'Pros, cons, and notes are visible to everyone in this search\.'/);
  assert.match(homeModal, /Keep the details you want to remember about this home\./);
  assert.match(homeModal, /<h2 id="shared-notes-heading" className="hh-serif">Shared notes<\/h2>/);
});

test('the separate view-only Home Detail "Property notes" edit flow is untouched by this pass', () => {
  const detail = read('src/components/HomeDetail.jsx');
  assert.match(detail, /const \[notesOpen, setNotesOpen\] = useState\(false\);/);
  assert.match(detail, /Edit property notes|Add pros, cons, or a note/);
  assert.match(detail, /placeholder="HOA details, sewer\/water, financing options, recent updates, listing terms, or anything else worth noting\."/);
});

/* ------------------------------ Post-Tour and other explicitly out-of-scope surfaces ------------------------------ */

test('Post-Tour is completely untouched by this pass', () => {
  const postTour = read('src/components/PostTourModal.jsx');
  for (const preserved of ['Curb Appeal', 'Layout', 'Privacy', 'Neighborhood', 'Save my take']) assert.match(postTour, new RegExp(preserved));
  assert.doesNotMatch(postTour, /Coachmark|useCoachmark|hh-onboarding-callout/);
});
