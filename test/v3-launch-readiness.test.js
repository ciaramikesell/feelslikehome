// Milestone 4 (docs/v3-launch-readiness.md): the two first-run fixes found in
// end-to-end QA. Behaviour is proved in scripts/qa/first-run-e2e.mjs; these
// pin the code so the fixes can't silently regress.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { register } from 'node:module';

register('./support/aliasHooks.mjs', import.meta.url);
const read = (p) => fs.readFileSync(p, 'utf8');
const board = read('src/components/HomesBoard.jsx');
const modal = read('src/components/HomeModal.jsx');
const { computeMatch } = await import('../src/lib/matching.js');
const { normalizePriorities } = await import('../src/lib/constants.js');
const { switchPrioritySearchType, setFeatureLevel } = await import('../src/lib/priorityCategories.js');

test('"View home" right after saving: re-issued only while still on /homes, at most three times', () => {
  const open = board.slice(board.indexOf('const openSavedHome = useCallback'), board.indexOf('// Opening a home (card, Edit)'));
  assert.match(open, /router\.push\(target, \{ scroll: false \}\);/);
  assert.match(open, /if \(typeof window === 'undefined' \|\| window\.location\.pathname !== '\/homes' \|\| attempts >= 3\) return;/);
  assert.match(open, /setTimeout\(ensureOpened, 700\);/);
  assert.equal((open.match(/setModalHome\(null\)/g) || []).length, 1, 'the dialog closes once');
});

test('a brand-new home skips the stray router.refresh() (the awaited refreshMyHomes rebuilds the cache); every other save still refreshes', () => {
  assert.match(board, /const saveHome = useCallback\(async \(home, \{ shared = true, optimistic = false, keepModalOpen = false, refresh = true \} = \{\}\) => \{/);
  assert.match(board, /if \(refresh\) router\.refresh\(\);\n\s+return saved;/);
  assert.match(board, /const saved = await saveHome\(home, \{ shared, keepModalOpen: isNew, refresh: !isNew \}\);/);
  assert.match(board, /await refreshMyHomes\(\)\.catch\(\(\) => \{\}\);/, 'the revalidating action still runs for new homes');
  // Other saveHome callers keep the default (refresh).
  assert.equal((board.match(/refresh: !isNew/g) || []).length, 1);
});

test('saved confirmation: with no priorities yet (flag on) it doesn’t promise a fit; otherwise unchanged', () => {
  assert.match(modal, /noPrioritiesYet=\{guidedPriorities && computeMatch\(\{\}, priorities\) === null\}/);
  assert.match(modal, /const guidedPriorities = useFeatureFlag\('guidedPriorities'\);/);
  assert.match(modal, /Your Match starts once you tell FLH what matters—anytime, in My Search\./);
  assert.match(modal, /: <p className="flh-saved-hint">Next, when you’re ready: View \{vocabulary\.singularLower\} shows what FLH found and how it fits your priorities\. Nothing else is required\.<\/p>\}/, 'flag off / with priorities: byte-for-byte the old line');
  // The condition really means "nothing to match against yet".
  const empty = switchPrioritySearchType(normalizePriorities({}), 'home_buy').priorities;
  assert.equal(computeMatch({}, empty), null);
  const one = setFeatureLevel(empty, { categoryKey: 'features', label: 'Home office', custom: false }, 'must');
  assert.notEqual(computeMatch({}, one), null);
  assert.equal(computeMatch({}, one).pct, null, 'and even then no % until something is known');
});

test('no Match, scoring, catalog or flag change in this milestone', () => {
  assert.match(read('src/lib/featureFlags.js'), /return isFlagOn\(env\.FLH_ONBOARDING_V3\);/);
  for (const path of ['src/lib/matching.js', 'src/lib/priorityCategories.js', 'src/lib/onboardingFlow.js', 'src/lib/explorePriorities.js']) assert.doesNotMatch(read(path), /Milestone 4/, path);
});
