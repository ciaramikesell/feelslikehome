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
  const system = read('src/components/MobileSystem.jsx');
  assert.match(system, /<button type="button" className=\{`flh-choice-chip \$\{selected \? 'is-selected' : ''\}`\} aria-pressed=\{selected\} onClick=\{onClick\}/);
  assert.match(read('src/app/globals.css'), /\.flh-chip-row \{ display: flex; flex-wrap: wrap; gap: 8px; \}/);
  for (const path of ['src/components/onboarding/Onboarding.jsx', 'src/components/RankPrioritiesEditor.jsx']) {
    assert.match(read(path), /<ChoiceChip /);
    assert.doesNotMatch(read(path), /<span[^>]+chip[^>]+onClick/);
  }
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
  const authForm = read('src/components/auth/AuthForm.jsx');
  assert.match(signIn, /<AuthForm redirectTo=\{redirectTo\}/);
  assert.match(authForm, /'Sign in'/);
  assert.match(authForm, /href="\/auth\/forgot-password"/);
  assert.match(authForm, /New to Feels Like Home\?/);
  assert.match(authForm, /Create an account/);
  assert.match(authForm, /supabase\.auth\.signInWithPassword/);
});

test('new onboarding search choices set an explicit, accessible rental subtype', () => {
  const onboarding = read('src/components/onboarding/Onboarding.jsx');
  const system = read('src/components/MobileSystem.jsx');
  assert.match(onboarding, /NEW_SEARCH_CHOICES\.map/);
  assert.match(onboarding, /selected=\{choice === option\.key\}/);
  assert.match(system, /className=\{`flh-select-card \$\{selected \? 'is-selected' : ''\}`\} aria-pressed=\{selected\}/);
  assert.match(onboarding, /applySearchChoice\(next, option\.key\)/);
});

test('auth mobile and onboarding brand placement use focused centering classes', () => {
  assert.match(read('src/components/auth/AuthShell.jsx'), /className="afh-brand"/);
  assert.match(read('src/components/onboarding/Onboarding.jsx'), /className="flh-onboarding-brand"/);
  const css = read('src/app/globals.css');
  assert.match(css, /\.flh-onboarding-brand \{[^}]*justify-content: center/);
  assert.match(css, /@media \(max-width: 640px\) \{[\s\S]*\.afh-brand \{ justify-content: center; \}/);
});

