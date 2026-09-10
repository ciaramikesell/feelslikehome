import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { defaultPriorities, DEFAULT_SELECTED_TIER, getItemlistCategories } from '../src/lib/constants.js';
import { selectPriorityItem, selectedOrderedItems } from '../src/lib/matching.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('every criterion bank item can be selected, including later suggestions in every intent', () => {
  for (const searchType of ['purchase', 'rental', 'investment']) {
    const priorities = defaultPriorities();
    priorities.searchType = searchType;

    for (const def of getItemlistCategories(searchType)) {
      const renderedBank = [...def.coreItems, ...def.suggestedItems];
      for (const item of renderedBank) {
        priorities[def.key] = selectPriorityItem(priorities[def.key], def, item, DEFAULT_SELECTED_TIER);
      }

      assert.deepEqual(
        selectedOrderedItems(def, priorities).map(({ label }) => label),
        renderedBank.map(({ label }) => label),
        `${searchType}:${def.key}`,
      );
      assert.equal(priorities[def.key].tiers[renderedBank.at(-1).label], DEFAULT_SELECTED_TIER);
    }
  }
});

test('criterion chips retain native button keyboard semantics and independent wrapped targets', () => {
  const board = read('src/components/PriorityBoard.jsx');
  assert.match(board, /<button key=\{item\.label\} type="button" draggable className="hh-chip"/);
  assert.match(board, /className="hh-suggestion-tray"/);
  assert.match(board, /onClick=\{\(\) => selectItem\(def, item\)\}/);
  assert.doesNotMatch(board, /<span[^>]+hh-chip[^>]+onClick/);
  assert.match(read('src/app/globals.css'), /\.hh-chip:focus-visible \{ outline: 3px solid var\(--focus-ring\); outline-offset: 2px; \}/);
});

test('closed feedback control only owns its visible content-sized hit area', () => {
  const feedback = read('src/components/BetaFeedback.jsx');
  const css = read('src/app/globals.css');
  assert.match(feedback, /\{!open && \([\s\S]*className="beta-feedback-tab"/);
  assert.match(feedback, /\{open && \([\s\S]*className="beta-feedback-drawer"/);
  assert.match(css, /\.beta-feedback \{ position: fixed; right: 0; top: 50%;/);
  assert.doesNotMatch(css, /\.beta-feedback \{[^}]*(?:inset|width|height):/);
  assert.match(css, /\.beta-feedback\.is-open \{ left: 14px; \}/);
});

test('signed-out auth makes account creation explicit without removing recovery or sign in', () => {
  const signIn = read('src/app/auth/sign-in/page.js');
  assert.match(signIn, />Sign in</);
  assert.match(signIn, /href="\/auth\/forgot-password"/);
  assert.match(signIn, /New to Feels Like Home\?/);
  assert.match(signIn, /Create an account/);
  assert.match(signIn, /`\/auth\/sign-up\?redirect=\$\{encodeURIComponent\(redirectTo\)\}` : '\/auth\/sign-up'/);
  assert.match(signIn, /supabase\.auth\.signInWithPassword/);
});

test('property-type prompt clearly states multi-select while keeping optional array storage', () => {
  const onboarding = read('src/components/onboarding/Onboarding.jsx');
  assert.match(onboarding, /What kinds of homes are you considering\?[\s\S]*\(optional\)/);
  assert.match(onboarding, /Choose as many as you&apos;d like\./);
  assert.match(onboarding, /selected \? values\.filter[\s\S]*: \[\.\.\.values, value\]/);
  assert.match(onboarding, /aria-pressed=\{selected\}/);
});

test('auth mobile and onboarding brand placement use focused centering classes', () => {
  assert.match(read('src/components/auth/AuthShell.jsx'), /className="afh-brand"/);
  assert.match(read('src/components/onboarding/Onboarding.jsx'), /className="hh-onboarding-brand"/);
  const css = read('src/app/globals.css');
  assert.match(css, /\.hh-onboarding-brand \{ justify-content: center; text-align: center; \}/);
  assert.match(css, /@media \(max-width: 640px\) \{[\s\S]*\.afh-brand \{ justify-content: center; \}/);
});
