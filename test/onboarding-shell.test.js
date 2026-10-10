// Onboarding V2 shell (Phase 1): the frame must stay scoped to onboarding and
// follow the spacing guardrails agreed for the redesign.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const css = read('src/app/globals.css');
const shellCss = css.slice(css.indexOf('/* ── Onboarding V2 shell (Phase 1)'));

test('every shell rule is scoped to onboarding', () => {
  const selectors = shellCss.replace(/\/\*[\s\S]*?\*\//g, '').match(/[^{}]+(?=\{)/g).map((s) => s.trim()).filter((s) => !s.startsWith('@media'));
  for (const selector of selectors) {
    for (const part of selector.split(',')) {
      assert.match(part.trim(), /flh-onboarding-root|^\.flh-ob-/, `unscoped selector: ${part.trim()}`);
    }
  }
});

test('the shell avoids viewport-height layouts and fixed heights on content', () => {
  assert.doesNotMatch(shellCss, /\d+vh|100dvh|position: fixed/);
  assert.doesNotMatch(shellCss, /(?<![-\w])height: (?!3px|42px|44px|28px)\d+px/);
});

test('progress reflects the real flow, not a fixed six', () => {
  const shell = read('src/components/onboarding/OnboardingShell.jsx');
  assert.match(shell, /style=\{\{ '--ob-steps': progress\.total \}\}/);
  assert.match(shell, /progress\.steps\.map\(\(key, index\) => <span key=\{key\} className=\{index < progress\.position \? 'is-done' : ''\} \/>\)/);
  assert.match(shellCss, /grid-template-columns: repeat\(var\(--ob-steps, 1\), minmax\(0, 1fr\)\)/);
});

test('desktop actions are in normal document flow; phones keep the sticky bar', () => {
  const desktop = shellCss.slice(shellCss.indexOf('@media (min-width: 960px)'));
  assert.match(desktop, /\.flh-onboarding-root \.flh-onboarding-actions \{ position: static;/);
  assert.match(css, /\.flh-onboarding-actions \{ position: sticky; bottom: 0;/);
});

test('the shell keeps the existing safe-area contract', () => {
  assert.match(shellCss, /\.flh-onboarding-root \.flh-onboarding \{ padding-top: var\(--flh-flow-top-10\); \}/);
  assert.match(shellCss, /top: calc\(var\(--flh-safe-top\) \+ 56px\)/);
  assert.match(css, /body \{ padding-top: var\(--flh-safe-top\); \}/);
});
