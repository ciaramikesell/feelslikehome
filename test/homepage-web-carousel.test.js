const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const component = fs.readFileSync('src/components/PublicHomeFeatures.jsx', 'utf8');
const css = fs.readFileSync('src/app/globals.css', 'utf8');
const platform = fs.readFileSync('src/lib/platform.js', 'utf8');

test('website showcase requires web runtime at every width, with late native-flag exclusion', () => {
  assert.match(component, /ensureNativeShellFlag, isNativeApp, NATIVE_SHELL_ATTRIBUTE.*from '@\/lib\/platform'/);
  assert.match(component, /setWebShowcase\(!isNativeApp\(\) && !root.hasAttribute\(NATIVE_SHELL_ATTRIBUTE\)\)/);
  assert.doesNotMatch(component, /narrow.matches|userAgent/);
  assert.match(component, /const \w+ = new MutationObserver\(update\)/);
  assert.match(component, /attributeFilter: \[NATIVE_SHELL_ATTRIBUTE\]/);
  assert.match(component, /if \(!webShowcase \|\| isNativeApp\(\) \|\| document.documentElement.hasAttribute\(NATIVE_SHELL_ATTRIBUTE\)\) return/);
  assert.match(fs.readFileSync('src/app/page.js', 'utf8'), /<div className="flh-web-entry"><PublicLanding \/><\/div>/);
  assert.match(css, /html\[data-flh-native\] \.flh-web-entry \{ display: none !important; \}/);
});

test('actual shared head script flags the iOS bridge before the hosted homepage paints', () => {
  const script = platform.match(/NATIVE_SHELL_FLAG_SCRIPT = `([\s\S]*?)`;/)[1].replace(/\$\{NATIVE_SHELL_ATTRIBUTE\}/g, 'data-flh-native');
  for (const native of [false, true]) {
    const attributes = new Set();
    const window = native ? { webkit: { messageHandlers: { bridge: {} } } } : {};
    vm.runInNewContext(script, { window, document: { documentElement: { setAttribute: key => attributes.add(key) } } });
    assert.equal(attributes.has('data-flh-native'), native);
  }
});

test('showcase exposes accessible tabs, keyboard navigation, touch swipe and reduced motion', () => {
  for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End']) assert.ok(component.includes(key));
  assert.match(component, /goTo\(target, \{ focus: true \}\)/);
  assert.match(component, /aria-controls=\{`pl-step-panel-\$\{id\}`\}/);
  assert.match(component, /aria-labelledby=\{`pl-step-tab-\$\{id\}`\}/);
  assert.match(component, /onPointerUp=\{onPointerUp\}/);
  assert.match(css, /\.pl-step:focus-visible \{ outline: 3px solid var\(--focus-ring\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\n  \.pl-root \*, \.pl-root \*::before, \.pl-root \*::after \{ animation: none !important; transition: none !important; \}/);
  assert.match(css, /\.pl-stage \{[^}]*touch-action: pan-y/);
});

test('editorial artwork uses approved photos with accurate HTML labels and heart states', () => {
  const artwork = fs.readFileSync('src/components/PublicFeatureArtwork.jsx', 'utf8');
  assert.match(artwork, /images\/homepage-previews/);
  assert.match(artwork, /className="pl-source-photo"/);
  assert.match(artwork, /score: 92[\s\S]*score: 87[\s\S]*score: 76/);
  assert.match(artwork, /name="Ciara"[\s\S]*Location', true[\s\S]*Home Office', true[\s\S]*Garage', true/);
  assert.match(artwork, /name="Andrew"[\s\S]*Garage', true[\s\S]*Finished Basement', false[\s\S]*Home Office', true/);
  assert.match(artwork, /pl-art-shared-home/);
  assert.doesNotMatch(artwork, /browser-chrome|iframe|mix-blend-mode/);
  assert.match(css, /\.pl-source-photo \{[^}]*overflow: hidden/);
  assert.match(css, /\.pl-feature-artwork \{[^}]*container-type: inline-size/);
});
