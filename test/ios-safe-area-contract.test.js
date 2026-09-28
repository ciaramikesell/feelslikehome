import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Automated tests cannot render real iOS safe areas; these pin the layout
// contract that the physical-device checks (docs/ios-safe-area-contract.md)
// verify on hardware.
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const css = read('src/app/globals.css');
const rootLayout = read('src/app/layout.js');
const capConfig = read('capacitor.config.js');

test('the premise: edge-to-edge WebView with viewport-fit=cover and Capacitor’s default (never) content inset', () => {
  assert.match(rootLayout, /viewportFit: 'cover'/);
  // If ios.contentInset is ever set, iOS itself would inset the WebView and
  // the body-owned padding below would double it — revisit the contract.
  assert.doesNotMatch(capConfig, /contentInset/);
});

test('one owner for in-flow content: body pads by the top inset; tokens derive from env()', () => {
  assert.match(css, /--flh-safe-top: env\(safe-area-inset-top, 0px\);/);
  assert.match(css, /--flh-safe-bottom: env\(safe-area-inset-bottom, 0px\);/);
  assert.match(css, /body \{ padding-top: var\(--flh-safe-top\); \}/);
  for (const n of [10, 20, 24, 32]) {
    assert.match(css, new RegExp(`--flh-flow-top-${n}: calc\\(max\\(${n}px, var\\(--flh-safe-top\\)\\) - var\\(--flh-safe-top\\)\\);`));
  }
});

test('flow-top spacing reproduces the former max(N, inset) position without double padding', () => {
  const flowTop = (n, inset) => Math.max(n, inset) - inset;
  for (const inset of [0, 20, 47, 59]) {
    for (const n of [10, 20, 24, 32]) assert.equal(inset + flowTop(n, inset), Math.max(n, inset));
  }
});

test('scrolled content can never show under the status bar: a fixed guard paints the inset strip', () => {
  const guard = css.match(/body::before \{[^}]*\}/)?.[0] || '';
  assert.match(guard, /position: fixed; z-index: 45; top: 0; left: 0; right: 0;/);
  assert.match(guard, /height: var\(--flh-safe-top\)/);
  assert.match(guard, /pointer-events: none/);
  // Above sticky page chrome (20) and the bottom bars; below modal backdrops (50) and sheets (55).
  assert.match(css, /\.hh-modal-backdrop \{ position: fixed; inset: 0;[^}]*z-index: 50; \}/);
  assert.match(css, /position: fixed; inset: 0; z-index: 55;/);
});

test('no in-flow element pads for the top inset itself; only fixed overlays read it directly', () => {
  const direct = css.split('\n').filter((line) => line.includes('env(safe-area-inset-top'));
  assert.deepEqual(direct.map((line) => line.trim().slice(0, 40)), [
    'max-height: calc(90vh - env(safe-area-in', // .hh-sheet (fixed)
    '.hh-how-to { max-height: calc(100dvh - e', // how-to sheet (fixed)
    '.hh-edit-home-modal > .hh-edit-home-head', // edit workspace (fixed backdrop, padding 0)
    '--flh-safe-top: env(safe-area-inset-top,', // the token itself
  ]);
  assert.doesNotMatch(css, /\.hh-native \.hh-app-header/);
});

test('shells: public, auth, onboarding, and authenticated headers use body’s inset, not their own', () => {
  assert.match(css, /\.hh-app-header \{ padding-top: var\(--flh-flow-top-10\); \}/);
  assert.match(css, /\.flh-onboarding \{[^}]*padding: var\(--flh-flow-top-20\) 0/);
  assert.match(css, /\.hh-onboarding-shell \{[^}]*padding: var\(--flh-flow-top-24\) 16px/);
  assert.match(css, /gap: 28px; padding: var\(--flh-flow-top-32\) 22px/);
  assert.match(css, /\.pl-root\{[^}]*min-height:calc\(100vh - var\(--flh-safe-top\)\)/);
  // The public skip link is fixed: it offsets for the inset and hides fully above it.
  assert.match(css, /\.pl-skip\{[^}]*top:calc\(10px \+ var\(--flh-safe-top\)\);[^}]*transform:translateY\(calc\(-100% - 20px - var\(--flh-safe-top\)\)\)\}/);
});

test('sticky chrome sticks just below the status bar', () => {
  assert.match(css, /\.flh-subpage-header \{ position: sticky; top: var\(--flh-safe-top\);/);
  assert.match(css, /\.hh-focused-route \.flh-subpage-header \{ padding-top: var\(--flh-flow-top-10\); \}/);
});

test('phone overlays keep title/close below the status bar and actions above the home indicator', () => {
  assert.match(css, /\.hh-modal-backdrop \{ padding: var\(--flh-safe-top\) 0 0; \}/);
  assert.match(css, /\.hh-modal \{ min-height: calc\(100dvh - var\(--flh-safe-top\)\); margin: 0; padding: 22px 16px calc\(30px \+ var\(--flh-safe-bottom\)\); border-radius: 0; \}/);
  // Record Your Take (bottom sheet on phones) never grows into the status bar.
  assert.match(css, /@media \(max-width: 560px\) \{[\s\S]*?\.hh-post-tour-modal \{ max-height: calc\(100dvh - var\(--flh-safe-top\)\); \}/);
  assert.match(css, /\.hh-post-tour-modal\{[^}]*padding-bottom:max\(24px,env\(safe-area-inset-bottom\)\)\}/);
  // The edit workspace keeps its own header inset inside its fixed, unpadded backdrop.
  assert.match(css, /\.hh-edit-home-modal > \.hh-edit-home-header \{ padding-top: max\(12px, env\(safe-area-inset-top\)\); \}/);
});

test('Feedback clears the mobile nav + home indicator, Home Detail’s action bar, and the end of the page', () => {
  assert.match(css, /--flh-mobile-nav-h: 63px;/);
  assert.match(css, /\.beta-feedback \{ top: auto; bottom: calc\(var\(--flh-mobile-nav-h\) \+ 8px \+ var\(--flh-safe-bottom\)\); right: 14px; transform: none; \}/);
  assert.match(css, /\.hh-root:not\(\.hh-focused-route\):not\(:has\(\.hh-map-frame\)\):has\(> \.beta-feedback\) \{ padding-bottom: calc\(var\(--flh-mobile-nav-h\) \+ var\(--flh-feedback-clearance\) \+ 16px \+ var\(--flh-safe-bottom\)\); \}/);
  assert.match(css, /\.hh-root:has\(\.flh-detail-action-bar\) \.beta-feedback \{ bottom: calc\(var\(--flh-mobile-nav-h\) \+ 64px \+ 8px \+ var\(--flh-safe-bottom\)\); \}/);
  // Geometry: the tab's bottom edge sits above the top of the detail action bar
  // (bar: bottom 62px + ~56px tall; tab: bottom 63 + 64 + 8 = 135px).
  const bar = css.match(/\.flh-detail-action-bar \{ position: fixed; z-index: 39; left: 0; right: 0; bottom: calc\((\d+)px/);
  assert.ok(bar && Number(bar[1]) + 56 < 63 + 64 + 8);
  // Focused editors still hide it; Map keeps its own route-owned bottom flow.
  assert.match(css, /\.hh-root:has\(\.hh-map-frame\) \{ padding-bottom: 0; \}/);
  assert.match(css, /\.hh-focused-route \.hh-mobile-nav, \.hh-focused-route \.beta-feedback \{ display: none; \}/);
});

test('the public masthead keeps the brand mark and Menu at full size on narrow phones', () => {
  assert.match(css, /@media \(max-width: 640px\) \{\n  \.pl-header \{ gap: 12px; \}\n  \.pl-brand \{ min-width: 0; \}\n  \.pl-brand > :first-child, \.pl-mobile-menu \{ flex-shrink: 0; \}/);
});
