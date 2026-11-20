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
  assert.match(css, /html:not\(\[data-flh-native\]\) \.pl-native-feature-fallback \{ display: none/);
  assert.match(css, /html\[data-flh-native\] \.pl-feature-showcase \{ display: none/);
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

test('showcase exposes accessible browser controls, keyboard navigation and reduced motion', () => {
  for (const key of ['ArrowLeft', 'ArrowRight', 'Home', 'End']) assert.ok(component.includes(key));
  assert.match(component, /prefers-reduced-motion: reduce.*\? 'auto' : 'smooth'/);
  assert.match(component, /aria-roledescription=\{webShowcase \? 'carousel'/);
  assert.match(component, /aria-roledescription=\{webShowcase \? 'slide'/);
  assert.match(component, /aria-current=\{active === index/);
  assert.match(component, /aria-live="polite" aria-atomic="true"/);
  assert.match(css, /scroll-snap-type: x mandatory/);
  assert.match(css, /grid-auto-columns: 100%/);
});

test('How It Works restores #203 eyebrow styling while retaining centered placement', () => {
  assert.match(css, /\.pl-how > h2.pl-eyebrow \{[^}]*text-align: center; color: var\(--brick-deep\); font: 700 .75rem\/1.3 var\(--font-sans\); letter-spacing: .14em; text-transform: uppercase/);
});


test('editorial artwork uses approved photos with accurate HTML labels and heart states', () => {
  const artwork = fs.readFileSync('src/components/PublicFeatureArtwork.jsx', 'utf8');
  assert.match(artwork, /images\/homepage-previews/);
  assert.match(artwork, /className="pl-source-photo"/);
  assert.match(artwork, /score: 92[\s\S]*score: 87[\s\S]*score: 76/);
  assert.match(artwork, /name="Ciara"[\s\S]*Location', true[\s\S]*Home Office', true[\s\S]*Garage', true/);
  assert.match(artwork, /name="Andrew"[\s\S]*Garage', true[\s\S]*Finished Basement', false[\s\S]*Home Office', true/);
  assert.match(artwork, /pl-art-shared-home/);
  assert.match(component, /pl-showcase-count/);
  assert.match(component, /<noscript><style>/);
  assert.doesNotMatch(artwork, /browser-chrome|iframe|mix-blend-mode|homepage-showcase/);
  assert.match(css, /\.pl-source-photo \{[^}]*overflow: hidden/);
  assert.match(css, /\.pl-feature-artwork \{[^}]*container-type: inline-size/);
});
