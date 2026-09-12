import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { isNativeApp } from '../src/lib/platform.js';

const read = (p) => fs.readFileSync(p, 'utf8');

const bootScreen = read('src/components/NativeBootScreen.jsx');
const rootLoading = read('src/app/loading.js');
const appLoading = read('src/app/(app)/loading.js');
const authShell = read('src/components/auth/AuthShell.jsx');
const appShell = read('src/components/AppShell.jsx');
const globalsCss = read('src/app/globals.css');
const sheet = read('src/components/Sheet.jsx');
const archiveModal = read('src/components/ArchiveConfirmModal.jsx');
const homesBoard = read('src/components/HomesBoard.jsx');
const homeModal = read('src/components/HomeModal.jsx');

/* -------------------------- native boot experience -------------------------- */

test('the native boot screen is gated on isNativeApp() and renders nothing by default (web/SSR)', () => {
  assert.match(bootScreen, /import \{ isNativeApp \} from '@\/lib\/platform'/);
  assert.match(bootScreen, /if \(!isNativeApp\(\)\) return;/);
  assert.match(bootScreen, /if \(!native\) return null;/);
  // Real behavior, not just source pattern: outside a Capacitor shell (this
  // Node test run) isNativeApp() is false, matching what web/desktop/mobile
  // Safari see at every point in the boot screen's lifecycle.
  assert.equal(isNativeApp(), false);
});

test('the boot screen reuses the existing brand assets and has no artificial delay gating its own appearance', () => {
  assert.match(bootScreen, /import \{ BrandMark, Wordmark \} from '@\/components\/ui'/);
  assert.match(bootScreen, /<BrandMark/);
  assert.match(bootScreen, /<Wordmark/);
  assert.match(bootScreen, /Finding your way home/);
  // The one setTimeout that exists only reveals secondary copy after the
  // real resolution is already taking a while — it must never gate `native`
  // itself, which is set synchronously as soon as isNativeApp() is checked.
  assert.match(bootScreen, /setNative\(true\);\s*\/\//);
});

test('loading.js at the root and (app) segments render the native boot screen as a Suspense fallback', () => {
  for (const source of [rootLoading, appLoading]) {
    assert.match(source, /import NativeBootScreen from '@\/components\/NativeBootScreen'/);
    assert.match(source, /<NativeBootScreen\s*\/>/);
  }
});

/* --------------------------- native auth presentation --------------------------- */

test('AuthShell swaps to a simplified native presentation without touching the desktop/web marketing layout', () => {
  assert.match(authShell, /^'use client';/);
  assert.match(authShell, /import \{ isNativeApp \} from '@\/lib\/platform'/);
  assert.match(authShell, /useEffect\(\(\) => \{ if \(isNativeApp\(\)\) setNative\(true\); \}, \[\]\);/);
  assert.match(authShell, /You found the homes\. We&apos;ll help you choose\./);
  // The native branch must return before the two-column marketing grid is
  // ever reached, and must not render the BENEFITS marketing list.
  const nativeBranch = authShell.match(/if \(native\) \{[\s\S]*?\n  \}/)?.[0] || '';
  assert.ok(nativeBranch, 'expected an `if (native) { ... }` early-return branch');
  assert.doesNotMatch(nativeBranch, /BENEFITS/);
  assert.match(nativeBranch, /afh-native-root/);
  assert.match(authShell, /afh-grid/); // the original marketing layout is still present for web
});

/* ------------------------------ installed-app chrome ------------------------------ */

test('AppShell applies one centralized hh-native class instead of scattering Capacitor checks', () => {
  assert.match(appShell, /import \{ isNativeApp \} from '@\/lib\/platform'/);
  assert.match(appShell, /useEffect\(\(\) => \{ if \(isNativeApp\(\)\) setNative\(true\); \}, \[\]\);/);
  assert.match(appShell, /className=\{`hh-root \$\{native \? 'hh-native' : ''\}`\}/);
});

test('the native shell gets its own top safe-area padding on the shared app header', () => {
  assert.match(globalsCss, /\.hh-native \.hh-app-header \{ padding-top: max\(10px, env\(safe-area-inset-top\)\); \}/);
});

/* -------------------------------- Sheet primitive -------------------------------- */

test('Sheet is an accessible dialog with focus handling, Escape dismissal, and backdrop tap', () => {
  assert.match(sheet, /role="dialog"/);
  assert.match(sheet, /aria-modal="true"/);
  assert.match(sheet, /event\.key === 'Escape'/);
  assert.match(sheet, /event\.key !== 'Tab'/);
  assert.match(sheet, /dismissOnBackdrop && event\.target === event\.currentTarget && onClose\(\)/);
  assert.match(sheet, /document\.body\.style\.overflow = 'hidden'/);
});

test('Sheet renders as a bottom sheet on mobile and a centered dialog on desktop, above the mobile nav', () => {
  assert.match(globalsCss, /\.hh-sheet-backdrop \{[\s\S]*?z-index: 55;/);
  assert.match(globalsCss, /@media \(max-width: 700px\) \{\s*\n\s*\/\* Below the phone boundary this becomes an actual bottom sheet/);
  assert.match(globalsCss, /\.hh-sheet \{[\s\S]*?border-radius: 20px 20px 0 0;/);
  assert.match(globalsCss, /padding-bottom: env\(safe-area-inset-bottom\);/);
});

test('ArchiveConfirmModal and the HomesBoard delete confirmation are migrated onto Sheet as the proof-of-concept', () => {
  assert.match(archiveModal, /import Sheet from '@\/components\/Sheet'/);
  assert.match(archiveModal, /<Sheet open size="compact" title="Archive this home\?"/);
  assert.doesNotMatch(archiveModal, /hh-modal-backdrop/);

  assert.match(homesBoard, /import Sheet from '@\/components\/Sheet'/);
  const confirmModalFn = homesBoard.match(/function ConfirmModal\([\s\S]*?\n\}/)?.[0] || '';
  assert.match(confirmModalFn, /<Sheet open size="compact"/);
  assert.doesNotMatch(confirmModalFn, /hh-modal-backdrop/);
});

test('HomeModal.jsx (Add Home) was deliberately left off the Sheet primitive in this pass', () => {
  assert.doesNotMatch(homeModal, /from '@\/components\/Sheet'/);
});

/* ---------------------------- Share-to-FLH preparation ---------------------------- */

test('/homes?url=<listing URL> opens Add Home pre-filled and auto-looked-up, reusing the existing Find-a-home flow', () => {
  assert.match(homesBoard, /searchParams\.get\('url'\)/);
  assert.match(homesBoard, /openHomeModal\(\{ \.\.\.emptyHome\(\), listingUrl: sharedUrl \}, \{ autoFind: true \}\)/);
  assert.match(homesBoard, /autoFindOnMount=\{modalAutoFind\}/);

  assert.match(homeModal, /autoFindOnMount = false/);
  assert.match(homeModal, /if \(autoFindOnMount && findInput\.trim\(\)\) handleFind\(\);/);
  assert.match(homeModal, /see \/homes\?url= in HomesBoard\.jsx/);
});

test('regression: clearing the ?url= query param cannot disable a shared-URL modal\'s one-time auto-find', () => {
  // The bug this guards against: deriving autoFindOnMount from a live
  // searchParams.get('url') read at render time, which flips back to false
  // the instant router.replace('/homes') clears the param — silently
  // breaking auto-find for the exact modal that was just opened because of
  // it. The fix captures the intent once, at the moment the param is
  // consumed, into modalAutoFind — a value HomeModal reads once itself
  // (autoFindOnMount is only read inside a useEffect with an empty
  // dependency array), so it survives the URL being cleared right after.

  // 1. autoFindOnMount is never wired straight to a searchParams read —
  //    the only place 'url' is read at all is inside the one effect that
  //    consumes it; nowhere near the JSX that renders <HomeModal>.
  const urlReads = homesBoard.match(/searchParams\.get\('url'\)/g) || [];
  assert.equal(urlReads.length, 1, 'searchParams.get(\'url\') must be read exactly once, at consumption time — not re-derived elsewhere');
  assert.doesNotMatch(homesBoard, /autoFindOnMount=\{[^}]*searchParams/);

  // 2. The url-effect captures autoFind:true into state synchronously,
  //    before/alongside the router.replace call that clears the param —
  //    not in some later effect that could race with it.
  const urlEffect = homesBoard.match(/useEffect\(\(\) => \{\s*const sharedUrl[\s\S]*?\n {2}\}, \[mode, searchParams, router, openHomeModal\]\);/)?.[0] || '';
  assert.ok(urlEffect, 'expected the ?url= effect to be present');
  const openIdx = urlEffect.indexOf('openHomeModal(');
  const replaceIdx = urlEffect.indexOf("router.replace('/homes')");
  assert.ok(openIdx !== -1 && replaceIdx !== -1 && openIdx < replaceIdx, 'openHomeModal (capturing autoFind) must run before router.replace clears the param');
  assert.match(urlEffect, /autoFind: true/);

  // 3. Every other place a home is opened explicitly does NOT request
  //    autoFind — regular Add/Edit Home must stay autoFindOnMount=false,
  //    confirming the flag isn't just globally stuck on.
  const otherOpens = [...homesBoard.matchAll(/openHomeModal\([^;]*?\)(?=[,;)])/gs)]
    .map((m) => m[0])
    .filter((call) => !call.includes('autoFind: true'));
  assert.ok(otherOpens.length >= 4, 'expected multiple non-auto-find openHomeModal call sites (?add=1, ?home=, both Add buttons)');
  for (const call of otherOpens) assert.doesNotMatch(call, /autoFind:\s*true/);
  // The archive/homes Edit buttons pass openHomeModal by reference — no
  // wrapper could sneak autoFind:true onto them even if someone tried.
  const onEditSites = homesBoard.match(/onEdit=\{openHomeModal\}/g) || [];
  assert.equal(onEditSites.length, 2, 'expected both Edit-home call sites (archive mode + homes mode) to pass openHomeModal directly');

  // 4. openHomeModal itself defaults autoFind to false and is the only
  //    thing allowed to set modalAutoFind — no other code path can leave a
  //    stale `true` behind for an unrelated later open.
  assert.match(homesBoard, /const openHomeModal = useCallback\(\(home, \{ autoFind = false \} = \{\}\) => \{/);
  const setModalAutoFindCalls = homesBoard.match(/setModalAutoFind\(/g) || [];
  assert.equal(setModalAutoFindCalls.length, 1, 'setModalAutoFind must be called from exactly one place: inside openHomeModal');
});

/* ------------------------------- production preservation ------------------------------- */

test('no component outside src/lib/platform.js imports @capacitor/core directly', () => {
  const srcDir = path.join(process.cwd(), 'src');
  const offenders = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(js|jsx)$/.test(entry.name) && full !== path.join(srcDir, 'lib', 'platform.js')) {
        const content = fs.readFileSync(full, 'utf8');
        if (/@capacitor\/core/.test(content)) offenders.push(full);
      }
    }
  };
  walk(srcDir);
  assert.deepEqual(offenders, []);
});
