import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const detail = fs.readFileSync('src/components/HomeDetail.jsx', 'utf8');
const editor = fs.readFileSync('src/components/HomeModal.jsx', 'utf8');
const compare = fs.readFileSync('src/components/CompareBoard.jsx', 'utf8');
const css = fs.readFileSync('src/app/globals.css', 'utf8');

test('Home Detail gives facts and personal relationship regions usable responsive width', () => {
  assert.match(detail, /Section eyebrow="Property facts" className="hh-detail-section-wide"/);
  assert.match(detail, /className="hh-detail-relationship hh-detail-section-wide"/);
  assert.match(css, /\.hh-detail-section-wide \{ max-width: 960px; \}/);
  assert.match(css, /@media\(max-width:960px\)[\s\S]*\.hh-detail-section-wide \{ max-width: 100%; \}/);
  assert.match(css, /@media\(max-width:720px\)[\s\S]*\.hh-detail-evaluation \{ grid-template-columns: 1fr;/);
});

test('Home Detail editor is attached to the dossier and reuses canonical persistence', () => {
  assert.match(detail, /HomeModal presentation="detail-panel"/);
  assert.match(detail, /onSave=\{saveWhole\}/);
  assert.match(detail, /saveHomePersonalAndShared\(createClient\(\), next, userId, searchId\)/);
  assert.match(editor, /presentation = 'modal'/);
  assert.match(editor, /hh-detail-editor-panel/);
  assert.match(css, /\.hh-detail-editor-backdrop \{ justify-content: flex-end;/);
});

test('Home Detail keeps participant relationship writes on the personal path', () => {
  assert.match(detail, /saveHomePersonalState\(createClient\(\), next, userId, searchId\)/);
  assert.match(detail, /These choices are yours to control\. Your collaborator can see them and keeps their own\./);
  assert.match(detail, /savePersonal\(toggleFavorite\(home\)\)/);
  assert.match(detail, /savePersonal\(\{ status: home\.status === 'Want to Tour'/);
});

test('Home Detail intent-specific facts remain canonical', () => {
  assert.match(detail, /formatHomePrice\(home\.price, priorities\.searchType\)/);
  assert.match(detail, /showsRentalFacts \? \[/);
  assert.match(detail, /\.\.\.\(!showsRentalFacts \? \[/);
  assert.match(detail, /\['HOA'/);
  assert.match(detail, /\['Available On'/);
});

test('Compare photography scales distinctly for two, three, and four homes', () => {
  assert.match(compare, /data-count=\{selected\.length\}/);
  for (const count of [2, 3, 4]) {
    assert.match(css, new RegExp(`\\.hh-compare-identity-grid\\[data-count="${count}"\\] \\.hh-compare-photo`));
  }
  assert.match(css, /\.hh-compare-photo \{[^}]*height: 148px;/);
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*\.hh-compare-identity-grid\[data-count\] \.hh-compare-photo/);
});

test('Compare retains participant Match and unknown semantics without winner logic', () => {
  assert.match(compare, /computeMatch\(/);
  assert.match(compare, /label="You" match=\{match\}/);
  assert.match(compare, /Not enough information yet/);
  assert.doesNotMatch(compare, /Couple Match|Winner!|combined Match|AI recommendation/);
});

// Regression: CommuteSection referenced `priorities` (via homeIdentity) without
// ever receiving it as a prop, throwing "priorities is not defined" and
// crashing the whole Compare page for any search with a commute destination
// configured — on any device/width, not just mobile.
test('Compare\'s CommuteSection receives priorities rather than referencing an out-of-scope variable', () => {
  assert.match(compare, /function CommuteSection\(\{[^}]*\bpriorities\b[^}]*\}\)/);
  assert.match(compare, /<CommuteSection[^>]*\bpriorities=\{priorities\}/);
});
