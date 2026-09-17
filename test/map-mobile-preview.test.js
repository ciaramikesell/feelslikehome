const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');

const map = readFileSync('src/components/SavedHomesMap.jsx', 'utf8');
const css = readFileSync('src/app/globals.css', 'utf8');

test('map starts unobstructed and selection remains available from markers and the mapped-home list', () => {
  assert.match(map, /useState\(null\)/);
  assert.match(map, /marker\.addListener\('click', \(\) => setSelection\(\{ type: 'home', id: home\.id \}\)\)/);
  assert.match(map, /onClick=\{\(\) => setSelection\(\{ type: 'home', id: home\.id \}\)\}/);
});

test('small screens hide desktop-only listing media, facts and saved status', () => {
  const block = css.match(/@media \(max-width: 820px\) \{[\s\S]*?\n\}/)?.[0] || '';
  assert.match(block, /\.hh-map-preview-media, \.hh-map-preview-facts, \.hh-map-status \{ display: none; \}/);
  assert.match(block, /bottom: 30px/);
  assert.match(block, /min-height: 44px/);
});

test('mobile stage remains a useful map surface while page sections remain scrollable', () => {
  assert.match(css, /height: clamp\(320px, 42dvh, 360px\)/);
  assert.match(css, /\.hh-map-frame \.hh-map-layout > section \{ flex-shrink: 0; max-height: 190px; overflow-y: auto; \}/);
});

test('compact preview preserves identity, participant Match and canonical actions', () => {
  assert.match(map, /homeIdentity\(selected, priorities\)\.primary/);
  assert.match(map, /match\.pct\}% Match/);
  assert.match(map, /href=\{`\/homes\/\$\{encodeURIComponent\(selected\.id\)\}`\}/);
  assert.match(map, /maps\.apple\.com\/\?daddr=/);
});
