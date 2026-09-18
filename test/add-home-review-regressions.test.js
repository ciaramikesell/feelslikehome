import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const modal = readFileSync(new URL('../src/components/HomeModal.jsx', import.meta.url), 'utf8');
const autocomplete = readFileSync(new URL('../src/components/AddressAutocomplete.jsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/app/globals.css', import.meta.url), 'utf8');

test('Add Home listing evidence is a sibling reference region inside the workspace', () => {
  assert.match(modal, /hh-workspace-shell[\s\S]*hh-edit-home-columns[\s\S]*hh-workspace-inspector[\s\S]*<\/div>\s*\{saveErrorMsg/);
  assert.match(css, /\.hh-workspace-shell\.has-inspector\{grid-template-columns:minmax\(0,1fr\) 292px/);
  assert.match(css, /\.hh-workspace-inspector \.hh-found-panel\{display:block;position:sticky/);
  assert.doesNotMatch(css, /@media\(max-width:900px\)[^\n]*\.hh-workspace-inspector\{order:-1\}/);
  assert.match(modal, /id="flh-listing-details"[\s\S]*aria-label="What FLH found"[\s\S]*tabIndex=\{-1\}/);
  assert.match(modal, /aria-controls="flh-listing-details" onClick=\{showInspector\}/);
});

test('suggestion selection closes immediately and blocks a programmatic-value requery', () => {
  const choose = autocomplete.match(/const choose = async[\s\S]*?\n  \};/)?.[0] || '';
  assert.ok(choose.indexOf('closeMenu()') < choose.indexOf('await place.fetchFields'), 'menu closes before place details resolve');
  assert.ok(choose.indexOf('userEditedRef.current = false') < choose.indexOf('onSelectRef.current'), 'selection is programmatic before parent value changes');
  assert.match(autocomplete, /if \(!userEditedRef\.current \|\| !places\?\.AutocompleteSuggestion/);
  assert.match(autocomplete, /requestId\.current \+= 1;[\s\S]*setSuggestions\(\[\]\);[\s\S]*setActiveIndex\(-1\);[\s\S]*setMenuOpen\(false\)/);
});

test('autocomplete supports keyboard selection, Escape, outside click, blur, and later edits', () => {
  assert.match(autocomplete, /event\.key === 'ArrowDown' \|\| event\.key === 'ArrowUp'/);
  assert.match(autocomplete, /event\.key === 'Enter'[\s\S]*choose\(suggestions\[activeIndex\]\)/);
  assert.match(autocomplete, /event\.key === 'Escape'[\s\S]*closeMenu\(\)/);
  assert.match(autocomplete, /document\.addEventListener\('pointerdown', dismissOutside\)/);
  assert.match(autocomplete, /onBlur=\{\(event\) => \{[\s\S]*contains\(event\.relatedTarget\)[\s\S]*closeMenu\(\)/);
  assert.match(autocomplete, /onMouseDown=\{\(event\) => event\.preventDefault\(\)\}/);
  assert.match(autocomplete, /onChange=\{\(event\) => onChange\(\(userEditedRef\.current = true/);
  assert.match(autocomplete, /fetchFields\(\{ fields: \['formattedAddress'\] \}\)[\s\S]*onSelectRef\.current\(place\.formattedAddress\)/);
});

