const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const component = fs.readFileSync('src/components/PublicHomeFeatures.jsx', 'utf8');
const css = fs.readFileSync('src/app/globals.css', 'utf8');
const platform = fs.readFileSync('src/lib/platform.js', 'utf8');

test('mobile carousel requires web runtime plus narrow width, with late native-flag exclusion', () => {
  assert.match(component, /ensureNativeShellFlag, isNativeApp, NATIVE_SHELL_ATTRIBUTE.*from '@\/lib\/platform'/);
  assert.match(component, /narrow.matches && !isNativeApp\(\) && !root.hasAttribute\(NATIVE_SHELL_ATTRIBUTE\)/);
  assert.match(component, /const \w+ = new MutationObserver\(update\)/);
  assert.match(component, /attributeFilter: \[NATIVE_SHELL_ATTRIBUTE\]/);
  assert.match(component, /if \(!carousel \|\| isNativeApp\(\) \|\| document.documentElement.hasAttribute\(NATIVE_SHELL_ATTRIBUTE\)\) return/);
  assert.match(css, /html:not\(\[data-flh-native\]\) \.pl-how\[data-web-carousel="true"\] \.pl-editorial-grid/);
  assert.match(css, /html\[data-flh-native\] \.pl-carousel-navigation \{ display: none/);
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

test('carousel exposes accessible native controls, keyboard navigation and reduced motion', () => {
  for (const key of ['ArrowLeft', 'ArrowRight', 'Home', 'End']) assert.ok(component.includes(key));
  assert.match(component, /prefers-reduced-motion: reduce.*\? 'auto' : 'smooth'/);
  assert.match(component, /aria-roledescription=\{carousel \? 'carousel'/);
  assert.match(component, /aria-roledescription=\{carousel \? 'slide'/);
  assert.match(component, /aria-current=\{active === index/);
  assert.match(component, /aria-live="polite" aria-atomic="true"/);
  assert.match(css, /scroll-snap-type: x mandatory/);
  assert.match(css, /grid-auto-columns: calc\(100% - 40px\)/);
});

test('How It Works restores #203 eyebrow styling while retaining centered placement', () => {
  assert.match(css, /\.pl-how > h2.pl-eyebrow \{[^}]*text-align: center; color: var\(--brick-deep\); font: 700 .75rem\/1.3 var\(--font-sans\); letter-spacing: .14em; text-transform: uppercase/);
});
