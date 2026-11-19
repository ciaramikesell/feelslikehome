// Milestone 3 (docs/onboarding-motion-polish.md): motion, haptics and category
// polish for the V3 category screens in onboarding AND Explore My Priorities.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { register } from 'node:module';

register('./support/aliasHooks.mjs', import.meta.url);
const read = (p) => fs.readFileSync(p, 'utf8');
const { PRIORITY_CATEGORIES } = await import('../src/lib/priorityCategories.js');
const { LEVEL_COPY } = await import('../src/lib/searchProfile.js');
const css = read('src/app/globals.css');
const motionCss = css.slice(css.indexOf('/* ── Milestone 3: onboarding motion & feedback'), css.indexOf('/* ── Account & Settings'));
const flow = read('src/components/onboarding/priority/PriorityFlow.jsx');
const card = read('src/components/onboarding/priority/FeatureCard.jsx');
const sheet = read('src/components/onboarding/priority/ImportanceSheet.jsx');
const onboarding = read('src/components/onboarding/Onboarding.jsx');
const explore = read('src/components/explore/ExplorePriorities.jsx');
const review = read('src/components/onboarding/priority/PriorityReview.jsx');

const scenario = (name) => JSON.parse(spawnSync(process.execPath, ['test/support/hapticsScenario.mjs', name], { encoding: 'utf8' }).stdout.trim().split('\n').pop());

/* --------------------------------- copy --------------------------------- */

test('every category has a short, conversational heading and at most one brief sentence', () => {
  for (const category of PRIORITY_CATEGORIES) {
    assert.equal(category.heading.length, 2, category.key);
    const heading = category.heading.join('');
    assert.ok(heading.length <= 42, `${category.key}: “${heading}” is short`);
    assert.ok((category.lead.match(/[.?!](\s|$)/g) || []).length <= 2, `${category.key}: brief lead`);
    assert.ok(category.lead.length <= 60, `${category.key}: “${category.lead}”`);
  }
  const byKey = Object.fromEntries(PRIORITY_CATEGORIES.map((category) => [category.key, category.heading.join('')]));
  assert.equal(byKey.kitchen, 'What’s cooking in your dream kitchen?');
  assert.equal(byKey.bath, 'What makes a bathroom feel just right?');
  assert.equal(byKey.garage, 'Let’s talk garage space');
  assert.equal(byKey.exterior, 'Let’s step outside');
  assert.equal(byKey.neighborhood, 'What makes a neighborhood feel like home?');
});

test('the tap instruction appears once per search (its first card screen), not on every screen', () => {
  const tap = PRIORITY_CATEGORIES.filter((category) => /Tap anything/.test(category.lead)).map((category) => category.key);
  assert.deepEqual(tap, ['layout', 'rent_layout', 'apt_unit']);
  assert.equal(PRIORITY_CATEGORIES.filter((category) => /Choose only what you’d weigh/.test(category.lead)).length, 0, 'the old repeated line is gone');
});

test('titles, identities and the importance words are unchanged: copy never blurs the levels', () => {
  assert.deepEqual(PRIORITY_CATEGORIES.map((category) => category.title), [
    'Rental Essentials', 'Layout & Living Spaces', 'Kitchen', 'Living Room', 'Bathroom', 'Garage', 'Layout & Living Spaces', 'Rental Features', 'The Unit', 'The Property', 'Exterior & Property', 'Location & Neighborhood',
  ]);
  assert.deepEqual(['must', 'important', 'nice'].map((tier) => LEVEL_COPY[tier].heading), ['Must Have', 'Important', 'Nice to Have']);
  assert.match(sheet, /\{level \? 'Remove · Not important' : 'Not important'\}/);
});

/* ------------------------------- haptics ------------------------------- */

test('haptics through the guarded helper: exact calls on a native build; silent on the web and on builds without the plugin; never throws', () => {
  assert.deepEqual(scenario('native').calls.map((call) => `${call.method}${call.options?.style ? `:${call.options.style}` : ''}${call.options?.type ? `:${call.options.type}` : ''}`), ['selectionChanged', 'impact:LIGHT', 'notification:SUCCESS']);
  for (const name of ['web', 'native-no-plugin']) assert.deepEqual(scenario(name), { calls: [], threw: null, unhandled: [] }, name);
  const failing = scenario('native-failing');
  assert.equal(failing.threw, null);
  assert.deepEqual(failing.unhandled, [], 'a failing haptic engine never surfaces an error');
});

test('selection haptic: only on choosing an importance (sheet levels, Not important, garage importance)', () => {
  assert.match(flow, /const choose = \(tier\) => \{\n\s+if \(closing\) return;\n\s+const \{ feature \} = sheet;\n[\s\S]*?selectionHaptic\(\);\n\s+patch\(\(next\) => writeLevel\(next, feature, tier\)\);/);
  assert.match(flow, /if \(importance !== choice\.key\) selectionHaptic\(\);\n\s+patch\(\(next\) => setGarageImportance\(next, choice\.key\)\);/);
  assert.equal((flow.match(/selectionHaptic\(\)/g) || []).length, 2, 'nowhere else in the category flow');
  // Never on navigation: the footer, Back, Skip, Continue and the top bar don't touch haptics.
  const footer = flow.slice(flow.indexOf('export function PriorityFooter'), flow.indexOf('// A numeric target'));
  assert.doesNotMatch(footer, /Haptic/);
});

test('confirmation haptic: only after a real save succeeds (finishing onboarding; leaving Explore after an edit)', () => {
  assert.match(onboarding, /await services\.completeOnboarding\(userId, \{ version, state: completeOnboardingState\(version, progressRef\.current\) \}\);\n[\s\S]{0,120}\}\n\s+\/\/ One light tap, only once everything has actually been saved\.\n\s+if \(priorityFlow\) confirmHaptic\(\);\n\s+leave\(pendingRedirect \|\| destination\);/);
  assert.match(explore, /if \(lastWriteFailed\.current\) \{ setLeaving\(false\); return; \}\n[\s\S]{0,140}if \(edited\) confirmHaptic\(\);/);
  for (const source of [onboarding, explore]) assert.doesNotMatch(source, /selectionHaptic|successHaptic/);
  assert.equal((onboarding.match(/confirmHaptic\(\)/g) || []).length, 1);
  assert.equal((explore.match(/confirmHaptic\(\)/g) || []).length, 1);
});

/* -------------------------------- motion -------------------------------- */

test('motion is CSS-only, quick (≤ 260ms), one-shot, and off under Reduce Motion', () => {
  assert.doesNotMatch(motionCss, /infinite|alternate/);
  for (const [, seconds] of motionCss.matchAll(/(?:animation|transition)[^;]*?(\d*\.\d+)s/g)) assert.ok(Number(seconds) <= 0.26, `${seconds}s`);
  const reduced = motionCss.slice(motionCss.indexOf('@media (prefers-reduced-motion: reduce)'));
  assert.match(reduced, /\.flh-ob-pf-card:active[\s\S]*\{ transform: none; \}/);
  assert.match(reduced, /\.flh-ob-pf-card\.is-just-set[\s\S]*\{ animation: none; \}/);
  // The app-wide rule still neutralises anything else.
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\*, \*::before, \*::after \{[^}]*animation-duration: \.01ms !important;/);
  // No animation library was added.
  const pkg = JSON.parse(read('package.json'));
  assert.deepEqual(Object.keys(pkg.dependencies).filter((name) => /motion|spring|gsap|anime|lottie/i.test(name)), []);
});

test('the choice lands once per change, never on first render, and never loops', () => {
  assert.match(card, /if \(!level \|\| was === level\) return undefined;\n\s+setJustSet\(true\);\n\s+const timer = setTimeout\(\(\) => setJustSet\(false\), 400\);/);
  assert.match(card, /\$\{justSet \? ' is-just-set' : ''\}/);
  assert.match(card, /aria-label=\{`\$\{feature\.text\}/, 'the accessible name still states the level in words');
});

test('the importance sheet slides away on phones only, never under Reduce Motion; every other Sheet is unchanged', () => {
  assert.match(flow, /window\.matchMedia\('\(max-width: 700px\)'\)\.matches && !window\.matchMedia\('\(prefers-reduced-motion: reduce\)'\)\.matches/);
  assert.match(flow, /export const SHEET_CLOSE_MS = 180;/);
  assert.match(sheet, /<Sheet open=\{open\} closing=\{closing\}/);
  const primitive = read('src/components/Sheet.jsx');
  assert.match(primitive, /closing = false,/);
  assert.match(primitive, /onMouseDown=\{\(event\) => !closing && dismissOnBackdrop/);
  assert.match(motionCss, /@media \(max-width: 700px\) \{\n\s+\.flh-onboarding-root \.hh-sheet-backdrop:has\(> \.flh-ob-pf-sheet\)/);
  assert.match(motionCss, /\.flh-onboarding-root \.hh-sheet-backdrop\.is-closing > \.hh-sheet \{ animation: flh-ob-sheet-down \.18s/);
});

/* ------------------------- progress and completion ------------------------- */

test('progress: one slim segmented bar per category in Explore, as in onboarding; features are never counted', () => {
  assert.match(explore, /className="flh-ob-progress flh-explore-progress" style=\{\{ '--ob-steps': steps\.length \}\} aria-hidden="true"/);
  assert.match(explore, /steps\.map\(\(key, index\) => <span key=\{key\} className=\{index < position \? 'is-done' : ''\} \/>\)/);
});

test('a small completion moment after the last category (not after edits from Review)', () => {
  assert.match(onboarding, /if \(!wasEditing && next\.step === 'review' && fromStep !== 'review'\) setArrivedAtReview\(true\);/);
  assert.match(onboarding, /const editFromReview = \(targetStep\) => \{\n\s+setArrivedAtReview\(false\);/);
  assert.match(onboarding, /celebrate: arrivedAtReview/);
  assert.match(review, /\{celebrate \? 'Nicely done\. ' : ''\}/);
  // Truthful: it celebrates the person's choices, never a found or verified home.
  assert.doesNotMatch(review.replace(/^\s*\/\/.*$|\{\/\*[\s\S]*?\*\/\}/gm, ''), /found your|perfect home|verified|we found/i);
  // Explore: once, at the end of a full walk-through only.
  assert.match(explore, /else \{ open\(null\); setNotice\('You’ve been through every category\. Your choices are saved\.'\); \}/);
});

/* ------------------------------ release safety ------------------------------ */

test('scope: data, scoring, identities, flags and routing are untouched', () => {
  for (const path of ['src/lib/matching.js', 'src/lib/featureFlags.js', 'src/lib/explorePriorities.js', 'src/lib/onboardingFlow.js', 'src/lib/supabase/collaboration.js']) {
    const source = read(path);
    assert.doesNotMatch(source, /Milestone 3/, `${path} is not part of Milestone 3`);
  }
  assert.match(read('src/lib/featureFlags.js'), /export function onboardingV3Enabled\(env = process\.env\) \{\n\s+return isFlagOn\(env\.FLH_ONBOARDING_V3\);/);
});
