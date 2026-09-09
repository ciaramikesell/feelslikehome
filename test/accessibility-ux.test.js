import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('priority and reaction chips use buttons with exposed selection state', () => {
  for (const path of [
    'src/components/onboarding/Onboarding.jsx',
    'src/components/MySearchPanel.jsx',
    'src/components/HomeModal.jsx',
    'src/components/PostTourModal.jsx',
  ]) {
    const source = read(path);
    assert.doesNotMatch(source, /<span[^>]+hh-chip[^>]+onClick/);
    assert.match(source, /<button type="button"[^>]+hh-chip[^>]+aria-pressed=/);
  }
});

test('contained UX recovery and truthful copy remain in place', () => {
  assert.match(read('src/components/HomeModal.jsx'), /aria-label="Close"/);
  assert.match(read('src/components/CompareBoard.jsx'), /href="\/homes\?add=1"/);
  assert.doesNotMatch(read('src/components/HomeDetail.jsx'), /Back to homes/);
  assert.match(read('src/components/SavedHomesMap.jsx'), /map isn't available right now/);
  assert.doesNotMatch(read('src/components/SavedHomesMap.jsx'), /Map setup is needed/);
  assert.match(read('src/app/invite/[token]/AcceptInvitationClient.jsx'), /Sign in with another account/);
});

test('narrow post-tour layout stacks and neutral facts do not declare a winner', () => {
  const css = read('src/app/globals.css');
  assert.match(css, /@media\(max-width:420px\)[\s\S]*\.hh-post-tour-verdicts, \.hh-post-tour-standouts \{ grid-template-columns: 1fr; \}/);
  const compare = read('src/components/CompareBoard.jsx');
  assert.doesNotMatch(compare, /function bestIndex/);
  assert.doesNotMatch(compare, /i === winner/);
});

test('auth stays contained and Home Detail actions retain clear hierarchy', () => {
  const css = read('src/app/globals.css');
  const detail = read('src/components/HomeDetail.jsx');
  assert.match(css, /\.afh-grid \{[^}]*grid-template-columns: minmax\(0,55fr\) minmax\(380px,45fr\)/);
  assert.match(css, /\.afh-panel \{[^}]*max-width: 380px/);
  assert.match(css, /@media \(max-width: 880px\) \{[\s\S]*?\.afh-grid \{ grid-template-columns: 1fr; \}/);
  assert.match(css, /\.hh-detail-section \{[^}]*border-top:/);
  assert.match(detail, /hh-detail-take-action/);
  assert.match(detail, /hh-detail-notes-action/);
  assert.match(detail, /hh-detail-toured-state/);
});
