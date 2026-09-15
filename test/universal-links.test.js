import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveDeepLinkPath } from '../src/lib/deepLink.js';
import { buildAasa } from '../src/lib/aasa.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

/* ------------------------------- resolveDeepLinkPath ------------------------------- */
// The entire native bridge's trust boundary. Real execution, not just source
// pattern matching — this is a pure function with no Capacitor/React
// dependency, so there's no reason to fake it.

test('accepts ordinary FLH product routes and preserves them exactly', () => {
  assert.equal(resolveDeepLinkPath('https://feelslikehome.app/'), '/');
  assert.equal(resolveDeepLinkPath('https://feelslikehome.app/homes'), '/homes');
  assert.equal(resolveDeepLinkPath('https://feelslikehome.app/homes/abc123'), '/homes/abc123');
  assert.equal(resolveDeepLinkPath('https://feelslikehome.app/invite/tok_xyz'), '/invite/tok_xyz');
});

test('preserves query string and hash without decoding, re-encoding, or interpretation', () => {
  // The critical #73 case: a listing URL nested inside ?url= must survive
  // byte-for-byte, including its own internal percent-encoding.
  const nested = 'https://feelslikehome.app/homes?url=https%3A%2F%2Fwww.zillow.com%2Fhomedetails%2F123-Main-St%2F';
  assert.equal(resolveDeepLinkPath(nested), '/homes?url=https%3A%2F%2Fwww.zillow.com%2Fhomedetails%2F123-Main-St%2F');

  assert.equal(resolveDeepLinkPath('https://feelslikehome.app/homes#section'), '/homes#section');
  assert.equal(resolveDeepLinkPath('https://feelslikehome.app/homes?a=1&b=2#frag'), '/homes?a=1&b=2#frag');
});

test('rejects malformed input instead of throwing', () => {
  assert.equal(resolveDeepLinkPath('not a url'), null);
  assert.equal(resolveDeepLinkPath(''), null);
  assert.equal(resolveDeepLinkPath('   '), null);
});

test('rejects every non-FLH or spoofed hostname via exact match, never a substring/suffix check', () => {
  assert.equal(resolveDeepLinkPath('https://evil.com/homes'), null);
  assert.equal(resolveDeepLinkPath('https://sub.feelslikehome.app/homes'), null);
  assert.equal(resolveDeepLinkPath('https://feelslikehome.app.evil.com/homes'), null);
  assert.equal(resolveDeepLinkPath('https://evil.com/feelslikehome.app/homes'), null);
  assert.equal(resolveDeepLinkPath('https://notfeelslikehome.app/homes'), null);
  // www is deliberately not trusted until repo/production behavior confirms
  // it's an intentionally supported alias — see the Associated Domains
  // entitlement, which also omits it.
  assert.equal(resolveDeepLinkPath('https://www.feelslikehome.app/homes'), null);
});

test('rejects non-HTTPS and dangerous schemes', () => {
  assert.equal(resolveDeepLinkPath('http://feelslikehome.app/homes'), null);
  assert.equal(resolveDeepLinkPath('javascript:alert(1)'), null);
  assert.equal(resolveDeepLinkPath('file:///etc/passwd'), null);
});

test('repeated calls with the same URL are deterministic (idempotent)', () => {
  const url = 'https://feelslikehome.app/homes/abc123';
  assert.equal(resolveDeepLinkPath(url), resolveDeepLinkPath(url));
});

/* ------------------------------------- AASA structure ------------------------------------- */

test('AASA is a spec-valid, inert document when APPLE_TEAM_ID is unset — never a guessed identifier', () => {
  const aasa = buildAasa('');
  assert.deepEqual(aasa, { applinks: { apps: [], details: [] } });
});

test('AASA builds a real application identifier once a team id is provided, with a durable exclude-infra/allow-everything-else route policy', () => {
  const aasa = buildAasa('ABCDE12345');
  const detail = aasa.applinks.details[0];
  assert.deepEqual(detail.appIDs, ['ABCDE12345.app.feelslikehome.mobile']);

  const components = detail.components;
  const excluded = components.filter((c) => c.exclude);
  const catchAll = components.filter((c) => !c.exclude);

  // Infra paths are excluded...
  assert.ok(excluded.some((c) => c['/'] === '/api/*'));
  assert.ok(excluded.some((c) => c['/'] === '/_next/*'));
  assert.ok(excluded.some((c) => c['/'] === '/.well-known/*'));

  // ...but everything else is eligible via one catch-all, not an
  // ever-growing list of today's screens — so a brand-new product route
  // (Detail, invite, a future Realtor/helper surface) is automatically
  // covered without touching this file.
  assert.deepEqual(catchAll, [{ '/': '*' }]);
  // Order matters for AASA matching: the catch-all must be last so the
  // exclusions above are evaluated first.
  assert.equal(components.at(-1)['/'], '*');
});

/* ------------------------------------ hosting / middleware ------------------------------------ */

test('the AASA route is served with no auth/redirect middleware interference', () => {
  const middleware = read('src/middleware.js');
  assert.match(middleware, /\\\.well-known\//);
});

test('the AASA route sets a real Content-Type and sensible caching, never HTML/no-store-forever', () => {
  const route = read('src/app/.well-known/apple-app-site-association/route.js');
  assert.match(route, /NextResponse\.json\(/);
  assert.match(route, /Cache-Control.*public, max-age=3600/);
});

/* --------------------------------------- native bridge --------------------------------------- */

test('DeepLinkBridge is gated on isNativeApp(), uses the official appUrlOpen event, and navigates the existing router rather than reloading the WebView', () => {
  const bridge = read('src/components/DeepLinkBridge.jsx');
  assert.match(bridge, /^'use client';/);
  assert.match(bridge, /import \{ App \} from '@capacitor\/app'/);
  assert.match(bridge, /import \{ resolveDeepLinkPath \} from '@\/lib\/deepLink'/);
  assert.match(bridge, /if \(!isNativeApp\(\)\) return;/);
  assert.match(bridge, /App\.addListener\('appUrlOpen', \(\{ url \}\) => \{/);
  assert.match(bridge, /router\.replace\(path\)/);
  // Never a hard reload/second router.
  assert.doesNotMatch(bridge, /window\.location/);
  // Cleans up its own listener on unmount.
  assert.match(bridge, /handle\?\.remove\(\)/);
});

test('DeepLinkBridge is mounted once, globally, in the root layout', () => {
  const layout = read('src/app/layout.js');
  assert.match(layout, /import DeepLinkBridge from '@\/components\/DeepLinkBridge'/);
  assert.match(layout, /<DeepLinkBridge \/>/);
});

/* -------------------------------------- Apple identity -------------------------------------- */

test('Associated Domains grants exactly applinks:feelslikehome.app — no wildcard, no www, no unrelated capabilities', () => {
  const entitlements = read('ios/App/App/App.entitlements');
  assert.match(entitlements, /<string>applinks:feelslikehome\.app<\/string>/);
  assert.doesNotMatch(entitlements, /applinks:www\.feelslikehome\.app/);
  assert.doesNotMatch(entitlements, /applinks:\*/);
  for (const capability of [
    'com.apple.developer.homekit', 'com.apple.developer.healthkit',
    'com.apple.developer.nfc', 'com.apple.developer.push-notifications',
    'com.apple.security.application-groups', 'com.apple.developer.app-clips',
  ]) {
    assert.doesNotMatch(entitlements, new RegExp(capability.replace(/\./g, '\\.')));
  }
});

test('the entitlement is wired into both Debug and Release build configurations of the App target', () => {
  const pbxproj = read('ios/App/App.xcodeproj/project.pbxproj');
  const matches = pbxproj.match(/CODE_SIGN_ENTITLEMENTS = App\/App\.entitlements;/g) || [];
  assert.equal(matches.length, 2, 'expected CODE_SIGN_ENTITLEMENTS on both Debug and Release');
});

test('no Apple Team ID was invented — DEVELOPMENT_TEAM stays unset, a real account/signing decision left to the product owner', () => {
  const pbxproj = read('ios/App/App.xcodeproj/project.pbxproj');
  assert.doesNotMatch(pbxproj, /DEVELOPMENT_TEAM = [A-Z0-9]/);
});

test('the bundle identifier is unchanged, not silently redecided', () => {
  const pbxproj = read('ios/App/App.xcodeproj/project.pbxproj');
  const matches = pbxproj.match(/PRODUCT_BUNDLE_IDENTIFIER = app\.feelslikehome\.mobile;/g) || [];
  assert.equal(matches.length, 2);
});

/* -------------------------------------- scope guards -------------------------------------- */

test('no custom URL scheme was introduced', () => {
  const infoPlist = read('ios/App/App/Info.plist');
  assert.doesNotMatch(infoPlist, /CFBundleURLTypes/);
  assert.doesNotMatch(infoPlist, /feelslikehome:\/\//);
  const config = read('capacitor.config.js');
  assert.doesNotMatch(config, /feelslikehome:\/\//);
});

test('no Share Extension target or App Groups were added — that is #75', () => {
  const pbxproj = read('ios/App/App.xcodeproj/project.pbxproj');
  assert.doesNotMatch(pbxproj, /ShareExtension/);
  assert.doesNotMatch(pbxproj, /com\.apple\.security\.application-groups/);
});

test('no Realtor/helper routes, roles, or schema were introduced', () => {
  const bridge = read('src/components/DeepLinkBridge.jsx');
  const aasaRoute = read('src/app/.well-known/apple-app-site-association/route.js');
  for (const source of [bridge, aasaRoute]) {
    assert.doesNotMatch(source, /realtor/i);
    assert.doesNotMatch(source, /\bhelper\b/i);
  }
});
