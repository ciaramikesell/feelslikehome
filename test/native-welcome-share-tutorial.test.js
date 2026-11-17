// Native iOS welcome + interactive share tutorial (Milestone 1,
// docs/native-welcome-share-tutorial.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import capacitorConfig from '../capacitor.config.js';
import { NATIVE_SHELL_ATTRIBUTE, NATIVE_SHELL_FLAG_SCRIPT, ensureNativeShellFlag, isNativeApp, isNativePluginAvailable } from '../src/lib/platform.js';

const read = (p) => fs.readFileSync(p, 'utf8');
const layout = read('src/app/layout.js');
const root = read('src/app/page.js');
const welcome = read('src/components/NativeWelcome.jsx');
const landing = read('src/components/PublicLanding.jsx');
const tutorial = read('src/components/ShareTutorial.jsx');
const haptics = read('src/lib/haptics.js');
const account = read('src/components/AccountSettings.jsx');
const css = read('src/app/globals.css');
const welcomeCss = css.slice(css.indexOf('/* ── Native welcome + share tutorial'), css.indexOf('/* ── Account & Settings'));

// Runs the inline <head> script against a fake window/document.
function runFlagScript(windowProps) {
  const attributes = new Map();
  const document = { documentElement: { setAttribute: (name, value) => attributes.set(name, value) } };
  const window = { ...windowProps };
  vm.runInNewContext(NATIVE_SHELL_FLAG_SCRIPT, { window, document });
  return attributes;
}

/* ----------------------------- native detection ----------------------------- */

test('the first-paint flag is set only when a Capacitor native bridge exists', () => {
  assert.equal(runFlagScript({}).has(NATIVE_SHELL_ATTRIBUTE), false, 'ordinary browser');
  assert.equal(runFlagScript({ webkit: {} }).has(NATIVE_SHELL_ATTRIBUTE), false, 'Safari has window.webkit but no bridge handler');
  assert.equal(runFlagScript({ webkit: { messageHandlers: {} } }).has(NATIVE_SHELL_ATTRIBUTE), false);
  assert.equal(runFlagScript({ webkit: { messageHandlers: { bridge: {} } } }).has(NATIVE_SHELL_ATTRIBUTE), true, 'Capacitor iOS');
  assert.equal(runFlagScript({ androidBridge: {} }).has(NATIVE_SHELL_ATTRIBUTE), true, 'Capacitor Android');
});

test('the flag never uses the user agent, viewport width or URL, and never throws', () => {
  assert.doesNotMatch(NATIVE_SHELL_FLAG_SCRIPT, /userAgent|navigator|innerWidth|matchMedia|screen|location|href/);
  assert.doesNotThrow(() => vm.runInNewContext(NATIVE_SHELL_FLAG_SCRIPT, { window: {}, document: {} }));
});

test('the root layout inlines the flag script in <head>, before any body content', () => {
  assert.match(layout, /import \{ NATIVE_SHELL_FLAG_SCRIPT \} from '@\/lib\/platform'/);
  assert.match(layout, /<html lang="en" suppressHydrationWarning>\s*(\{\/\*[\s\S]*?\*\/\}\s*)?(\/\/.*\s*)*<head>[\s\S]*dangerouslySetInnerHTML=\{\{ __html: NATIVE_SHELL_FLAG_SCRIPT \}\}[\s\S]*<\/head>\s*<body>/);
});

test('outside the shell every native helper resolves false', () => {
  assert.equal(isNativeApp(), false);
  assert.equal(isNativePluginAvailable('Haptics'), false);
  const root = { hasAttribute: () => false, setAttribute: () => { throw new Error('must not touch the web page'); } };
  assert.equal(ensureNativeShellFlag(root), 'web');
});

test('inside the shell the head script logs one QA line for Xcode; in a browser it logs nothing', () => {
  const logs = [];
  const console = { info: (line) => logs.push(line) };
  vm.runInNewContext(NATIVE_SHELL_FLAG_SCRIPT, { window: { console }, document: { documentElement: { setAttribute() {} } } });
  assert.deepEqual(logs, []);
  vm.runInNewContext(NATIVE_SHELL_FLAG_SCRIPT, { window: { console, webkit: { messageHandlers: { bridge: {} } } }, document: { documentElement: { setAttribute() {} } } });
  assert.deepEqual(logs, ['[FLH Native QA] native flag set before first paint']);
});

test('a post-hydration check confirms the flag in the shell and repairs it if the head script missed', () => {
  const check = read('src/components/NativeShellFlagCheck.jsx');
  assert.match(layout, /<NativeShellFlagCheck \/>/);
  assert.match(check, /ensureNativeShellFlag\(\)/);
  assert.match(check, /first-paint native flag confirmed/);
  assert.match(check, /first-paint native flag was MISSING; set after hydration/);
  const platform = read('src/lib/platform.js');
  assert.match(platform, /if \(!isNativeApp\(\) \|\| !root\) return 'web';\s*if \(root\.hasAttribute\(NATIVE_SHELL_ATTRIBUTE\)\) return 'confirmed';\s*root\.setAttribute\(NATIVE_SHELL_ATTRIBUTE, ''\);\s*return 'corrected';/);
});

/* ------------------------------- routing safety ------------------------------- */

test('signed-out root renders both entries without any redirect; signed-in routing is unchanged', () => {
  assert.match(root, /if \(!user\) return <><NativeWelcome \/><div className="flh-web-entry"><PublicLanding \/><\/div><\/>;/);
  assert.match(root, /redirect\(realtor \? REALTOR_WORKSPACE_PATH : '\/onboarding'\)/);
  assert.match(root, /redirect\('\/homes'\)/);
  // The welcome is a presentation, not a router: nothing in it can pull a
  // deep link, invitation or shared listing away from its destination.
  assert.doesNotMatch(welcome, /useRouter|redirect\(|router\.|window\.location|localStorage|sessionStorage|document\.cookie/);
});

test('CSS picks the surface before first paint: welcome only in the native shell, homepage everywhere else', () => {
  assert.match(welcomeCss, /html:not\(\[data-flh-native\]\) \.flh-welcome, html:not\(\[data-flh-native\]\) \.flh-native-only \{ display: none !important; \}/);
  assert.match(welcomeCss, /html\[data-flh-native\] \.flh-web-entry \{ display: none !important; \}/);
  // No viewport-width rule decides which entry is shown.
  for (const block of welcomeCss.match(/@media[^{]*\{[^}]*\}/g) || []) {
    assert.doesNotMatch(block, /flh-web-entry|data-flh-native/);
  }
});

test('the public homepage itself is untouched', () => {
  assert.doesNotMatch(landing, /NativeWelcome|isNativeApp|flh-native/);
});

/* -------------------------------- the welcome -------------------------------- */

test('the welcome reuses the exact desktop homepage hero photograph', () => {
  const heroSrc = landing.match(/<figure className="pl-hero-visual"><Image src="([^"]+)"/)?.[1];
  assert.equal(heroSrc, '/images/Warm Cottage.png');
  assert.match(welcome, new RegExp(`WELCOME_HERO_SRC = '${heroSrc}'`));
  // Same sizes as the hero and no second priority preload, so ordinary
  // browsers fetch nothing extra for the hidden welcome.
  const heroSizes = landing.match(/<figure className="pl-hero-visual"><Image [^>]*sizes="([^"]+)"/)?.[1];
  assert.match(welcome, new RegExp(`WELCOME_HERO_SIZES = '${heroSizes.replace(/[()]/g, '\\$&')}'`));
  assert.match(welcome, /<Image src=\{WELCOME_HERO_SRC\}[^>]*sizes=\{WELCOME_HERO_SIZES\}/);
  assert.doesNotMatch(welcome.match(/<Image src=\{WELCOME_HERO_SRC\}[^>]*>/)[0], /priority/);
  assert.ok(fs.existsSync(`public${heroSrc}`));
});

test('the welcome has the approved copy and the existing auth paths', () => {
  assert.match(welcome, /A little closer to home\./);
  assert.match(welcome, /Already found a few homes you love\?/);
  assert.match(welcome, /<Link href="\/auth\/sign-up"[^>]*>Get Started/);
  assert.match(welcome, /<Link href="\/auth\/sign-in"[^>]*>Already have an account\? <b>Sign in<\/b>/);
});

test('the share tutorial is optional from the welcome — never opened automatically', () => {
  assert.match(welcome, /useState\(false\)/);
  assert.match(welcome, /onClick=\{\(\) => setTutorialOpen\(true\)\}/);
  assert.doesNotMatch(welcome, /useEffect/);
});

/* ------------------------------- share tutorial ------------------------------- */

test('the tutorial is an accessible, clearly simulated dialog with Skip and Back', () => {
  assert.match(tutorial, /role="dialog" aria-modal="true" aria-labelledby="flh-st-title"/);
  assert.match(tutorial, /Practice run · a pretend Share Sheet/);
  assert.match(tutorial, />Skip<\/button>/);
  assert.match(tutorial, /<ChevronLeft[^>]*\/> Back<\/button>/);
  assert.match(tutorial, /event\.key === 'Escape'/);
  assert.match(tutorial, /titleRef\.current\?\.focus\(\)/);
  assert.match(tutorial, /restoreFocusRef/);
});

test('the person performs each step: tap Share, then tap Feels Like Home, then a success moment', () => {
  assert.match(tutorial, /SHARE_TUTORIAL_STEPS = \['listing', 'sheet', 'saved'\]/);
  assert.match(tutorial, /className=\{`flh-st-share[^`]*`\} onClick=\{tapShare\}/);
  assert.match(tutorial, /className="flh-st-app is-flh is-target flh-press" onClick=\{tapFlh\}/);
  assert.match(tutorial, /const tapShare = \(\) => \{ confirmHaptic\(\); setHint\(null\); setStep\('sheet'\); \};/);
  assert.match(tutorial, /const tapFlh = \(\) => \{ confirmHaptic\(\); setHint\(null\); setStep\('saved'\); \};/);
  assert.match(tutorial, /Practice again/);
});

test('the tutorial is replayable and stores nothing', () => {
  assert.doesNotMatch(tutorial, /localStorage|sessionStorage|document\.cookie|createClient|fetch\(/);
});

test('the tutorial explains the Share Extension accurately', () => {
  assert.match(tutorial, /Practice only — no listing is imported or saved here\./);
  assert.match(tutorial, /varies by app and iOS version/);
  assert.match(tutorial, /Copy the listing link and paste it into Add Home/);
  assert.match(tutorial, /not an Add to Home Screen shortcut/);
  assert.match(tutorial, /copy the link and paste it into Add Home instead/);
});

test('the example listing is fictional and uses existing FLH photography', () => {
  assert.match(tutorial, /photo: '\/images\/onboarding\/front-porch\.webp'/);
  assert.ok(fs.existsSync('public/images/onboarding/front-porch.webp'));
});

test('Account offers the tutorial again inside the app, without signing out', () => {
  assert.match(account, /import ShareTutorial from '@\/components\/ShareTutorial'/);
  assert.match(account, /className="flh-card flh-account-section flh-native-only" aria-labelledby="account-help"/);
  assert.match(account, /Practice sharing a home/);
  assert.match(account, /\{shareTutorialOpen && <ShareTutorial onClose=\{\(\) => setShareTutorialOpen\(false\)\} \/>\}/);
});

/* ------------------------------ motion & haptics ------------------------------ */

test('haptics are native-only, plugin-checked, never throw, and fire only on real taps/success', () => {
  assert.match(haptics, /import \{ isNativePluginAvailable \} from '@\/lib\/platform'/);
  assert.match(haptics, /if \(!isNativePluginAvailable\('Haptics'\)\) return;/);
  assert.match(haptics, /\.catch\(\(\) => \{\}\)/);
  assert.doesNotMatch(haptics, /@capacitor\/core/);
  assert.doesNotMatch(welcome, /Haptic/); // no haptics on plain navigation (Get Started / Sign in)
  assert.match(tutorial, /useEffect\(\(\) => \{ if \(step === 'saved'\) successHaptic\(\); \}, \[step\]\);/);
});

test('motion is subtle, finite, and respects Reduce Motion', () => {
  assert.match(welcomeCss, /@media \(prefers-reduced-motion: reduce\) \{ \.flh-press:active \{ transform: none; \} \}/);
  // Beckoning rings run a fixed number of times — never an infinite bounce.
  assert.doesNotMatch(welcomeCss, /infinite/);
  assert.match(welcomeCss, /animation: flh-st-beckon 1\.5s ease-out 2;/);
  // The global reduced-motion rule (top of globals.css) still neutralises every animation here.
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\*, \*::before, \*::after \{[^}]*animation-duration: \.01ms !important;/);
});

/* ------------------------------ native project ------------------------------ */

test('the Haptics plugin is added through Capacitor SPM only; identifiers and entitlements are unchanged', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.match(pkg.dependencies['@capacitor/haptics'], /^\^8\./);
  const spm = read('ios/App/CapApp-SPM/Package.swift');
  assert.match(spm, /\.package\(name: "CapacitorHaptics", path: "\.\.\/\.\.\/\.\.\/node_modules\/@capacitor\/haptics"\)/);
  assert.match(spm, /\.product\(name: "CapacitorHaptics", package: "CapacitorHaptics"\)/);
  assert.equal(capacitorConfig.appId, 'app.feelslikehome.mobile');
  assert.equal(capacitorConfig.server.url, 'https://feelslikehome.app');
  assert.match(read('ios/App/App/App.entitlements'), /applinks:feelslikehome\.app/);
});
