import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { isLikelyListingUrl, findHomeByListingUrl } from '../src/lib/listingUrl.js';
import { sanitizeRedirectPath } from '../src/lib/safeRedirect.js';

const read = (p) => fs.readFileSync(p, 'utf8');

const homesBoard = read('src/components/HomesBoard.jsx');
const homeModal = read('src/components/HomeModal.jsx');
const middleware = read('src/middleware.js');
const appLayout = read('src/app/(app)/layout.js');
const signIn = read('src/app/auth/sign-in/page.js');
const signUp = read('src/app/auth/sign-up/page.js');
const authCallback = read('src/app/auth/callback/route.js');
const onboarding = read('src/components/onboarding/Onboarding.jsx');

/* ------------------------------ isLikelyListingUrl ------------------------------ */
/* Part 12 "Basic routing": valid/empty/malformed/unsupported-protocol,      */
/* real execution of the actual predicate, not a source-pattern proxy.      */

test('isLikelyListingUrl: real execution over the basic-routing matrix', () => {
  assert.equal(isLikelyListingUrl('https://www.zillow.com/homedetails/123-Main-St/12345_zpid/'), true);
  assert.equal(isLikelyListingUrl('http://example.com/listing'), true);
  assert.equal(isLikelyListingUrl('  https://example.com/listing  '), true, 'surrounding whitespace should not disqualify a real URL');
  assert.equal(isLikelyListingUrl(''), false, 'empty string (the ?url= case) is not a listing URL');
  assert.equal(isLikelyListingUrl('   '), false, 'whitespace-only is not a listing URL');
  assert.equal(isLikelyListingUrl('not a url at all'), false, 'garbage text is not a listing URL');
  assert.equal(isLikelyListingUrl('ftp://example.com/file'), false, 'unsupported protocol is rejected');
  assert.equal(isLikelyListingUrl('javascript:alert(1)'), false, 'unsupported/dangerous scheme is rejected');
  assert.equal(isLikelyListingUrl('mailto:someone@example.com'), false);
  assert.equal(isLikelyListingUrl('www.zillow.com/homedetails/123'), false, 'missing scheme is rejected, not silently assumed');
  assert.equal(isLikelyListingUrl(null), false);
  assert.equal(isLikelyListingUrl(undefined), false);
  assert.equal(isLikelyListingUrl(42), false);
});

test('handleFind and the /homes?url= intake share the exact same URL predicate — no drift between the two entry points', () => {
  assert.match(homeModal, /import \{ extractAddressFromListingUrl, extractApartmentIdentityFromListingUrl, isLikelyListingUrl \} from '@\/lib\/listingUrl'/);
  assert.match(homeModal, /const looksLikeUrl = isLikelyListingUrl\(raw\);/);
  assert.doesNotMatch(homeModal, /\/\^https\?:\\\/\\\/\/i\.test/, 'the old inline regex should be gone from HomeModal now that it is centralized');
  assert.match(homesBoard, /import \{ isLikelyListingUrl, findHomeByListingUrl \} from '@\/lib\/listingUrl'/);
});

/* ------------------------------ findHomeByListingUrl ------------------------------ */
/* Part 12 "Duplicate behavior" — real execution.                           */

test('findHomeByListingUrl: exact match only, never a fuzzy/address-based guess', () => {
  const homes = [
    { id: 'h1', address: '123 Main St', listingUrl: 'https://www.zillow.com/homedetails/1/' },
    { id: 'h2', address: '456 Oak Ave', listingUrl: 'https://www.zillow.com/homedetails/2/' },
    { id: 'h3', address: '789 Elm Rd', listingUrl: '' },
    { id: 'h4', address: '1 No Url Ln' },
  ];
  assert.equal(findHomeByListingUrl(homes, 'https://www.zillow.com/homedetails/1/'), homes[0]);
  assert.equal(findHomeByListingUrl(homes, '  https://www.zillow.com/homedetails/2/  '), homes[1], 'incoming whitespace is trimmed before comparing');
  assert.equal(findHomeByListingUrl(homes, 'https://www.zillow.com/homedetails/1/?utm=1'), null, 'a different query string is a different URL, not a fuzzy match');
  assert.equal(findHomeByListingUrl(homes, 'https://www.zillow.com/homedetails/999/'), null);
  assert.equal(findHomeByListingUrl(homes, ''), null);
  assert.equal(findHomeByListingUrl(homes, '   '), null);
  assert.equal(findHomeByListingUrl([], 'https://example.com'), null);
  assert.equal(findHomeByListingUrl(null, 'https://example.com'), null);
});

test('the /homes?url= effect checks for an existing home before opening Add Home, and routes to it rather than duplicating', () => {
  const urlEffect = homesBoard.match(/useEffect\(\(\) => \{\s*const rawUrl[\s\S]*?\n {2}\}, \[mode, searchParams, router, homes, openHomeModal\]\);/)?.[0] || '';
  assert.ok(urlEffect, 'expected the ?url= effect');
  assert.match(urlEffect, /const existing = findHomeByListingUrl\(homes, rawUrl\);/);
  assert.match(urlEffect, /router\.replace\(`\/homes\/\$\{encodeURIComponent\(existing\.id\)\}`\);/);
  // The duplicate branch must return before ever opening a second Add Home.
  const existingIdx = urlEffect.indexOf('if (existing)');
  const openIdx = urlEffect.indexOf('openHomeModal(validUrl');
  assert.ok(existingIdx !== -1 && openIdx !== -1 && existingIdx < openIdx, 'the existing-home check must run, and be able to return, before openHomeModal for a new one');
});

/* ------------------------------ Part 2: canonical intake states ------------------------------ */

test('state A: no url param does not touch the intake effect at all (mode/absence guard)', () => {
  assert.match(homesBoard, /if \(mode !== 'homes' \|\| rawUrl === null \|\| autoOpenedRef\.current\) return;/);
});

test('state B: empty or non-URL values open a bare Add Home — no fabricated listingUrl, no auto-lookup', () => {
  assert.match(homesBoard, /openHomeModal\(validUrl \? \{ \.\.\.emptyHome\(\), listingUrl: rawUrl\.trim\(\) \} : emptyHome\(\), \{ autoFind: validUrl \}\)/);
  // Real-execution proof that "garbage" and "empty" both fail validUrl and
  // therefore take the emptyHome()/autoFind:false branch above.
  for (const bad of ['', '   ', 'not-a-url', 'javascript:alert(1)', 'ftp://x.com']) {
    assert.equal(isLikelyListingUrl(bad), false, `"${bad}" must not be treated as a real listing URL`);
  }
});

test('states C/D/E (supported, partial apartment, unsupported) are unchanged pre-existing HomeModal behavior, preserved verbatim', () => {
  assert.match(homeModal, /We found the property\./);
  assert.match(homeModal, /We just need the street address\./);
  assert.match(homeModal, /We couldn't get much from that link, but you can still add the property\./);
  assert.match(homeModal, /listingUrl: raw/); // original URL preserved on the form in the unsupported-URL branch
});

/* ------------------------------ sanitizeRedirectPath ------------------------------ */
/* Part 3 auth preservation — real execution, including open-redirect vectors. */

test('sanitizeRedirectPath: accepts only same-origin relative paths, rejects every open-redirect shape', () => {
  assert.equal(sanitizeRedirectPath('/homes?url=https%3A%2F%2Fwww.zillow.com%2Fhomedetails%2F1%2F'), '/homes?url=https%3A%2F%2Fwww.zillow.com%2Fhomedetails%2F1%2F');
  assert.equal(sanitizeRedirectPath('/homes'), '/homes');
  assert.equal(sanitizeRedirectPath('/'), '/');

  // Open-redirect shapes — all must be rejected.
  assert.equal(sanitizeRedirectPath('https://evil.com'), null, 'absolute URL with a scheme');
  assert.equal(sanitizeRedirectPath('http://evil.com/phish'), null);
  assert.equal(sanitizeRedirectPath('//evil.com'), null, 'protocol-relative URL');
  assert.equal(sanitizeRedirectPath('///evil.com'), null);
  assert.equal(sanitizeRedirectPath('\\\\evil.com'), null, 'backslash host-separator trick');
  assert.equal(sanitizeRedirectPath('evil.com'), null, 'no leading slash at all');
  assert.equal(sanitizeRedirectPath(''), null);
  assert.equal(sanitizeRedirectPath('   '), null);
  assert.equal(sanitizeRedirectPath(null), null);
  assert.equal(sanitizeRedirectPath(undefined), null);
  assert.equal(sanitizeRedirectPath(42), null);
});

/* ------------------------------ Part 3: auth preservation wiring ------------------------------ */

test('middleware exposes the current path/query via a header, without touching the existing session-refresh logic', () => {
  assert.match(middleware, /request\.headers\.set\('x-pathname', request\.nextUrl\.pathname \+ request\.nextUrl\.search\);/);
  assert.match(middleware, /await supabase\.auth\.getUser\(\);/); // unchanged
});

test('(app)/layout.js preserves the intended destination through both the sign-in and onboarding redirects', () => {
  assert.match(appLayout, /import \{ headers \} from 'next\/headers'/);
  assert.match(appLayout, /import \{ sanitizeRedirectPath \} from '@\/lib\/safeRedirect'/);
  assert.match(appLayout, /requestHeaders\.get\('x-pathname'\)/);
  assert.match(appLayout, /if \(!user\) redirect\(withRedirectParam\('\/auth\/sign-in', await currentPathForRedirect\(\)\)\);/);
  assert.match(appLayout, /if \(!profile\?\.onboarding_complete\) redirect\(withRedirectParam\('\/onboarding', await currentPathForRedirect\(\)\)\);/);
});

test('sign-in, sign-up, and the auth callback all validate redirect/next before trusting it', () => {
  assert.match(signIn, /import \{ sanitizeRedirectPath \} from '@\/lib\/safeRedirect'/);
  assert.match(signIn, /const redirectTo = sanitizeRedirectPath\(searchParams\.get\('redirect'\)\) \|\| '\/';/);
  assert.match(signUp, /import \{ sanitizeRedirectPath \} from '@\/lib\/safeRedirect'/);
  assert.match(signUp, /const redirectTo = sanitizeRedirectPath\(searchParams\.get\('redirect'\)\) \|\| '\/';/);
  assert.match(authCallback, /import \{ sanitizeRedirectPath \} from '@\/lib\/safeRedirect'/);
  assert.match(authCallback, /const next = sanitizeRedirectPath\(searchParams\.get\('next'\)\) \?\? '\/';/);
});

test('onboarding honors a pending redirect destination on completion, without changing anything else about onboarding', () => {
  assert.match(onboarding, /import \{ useRouter, useSearchParams \} from 'next\/navigation'/);
  assert.match(onboarding, /import \{ sanitizeRedirectPath \} from '@\/lib\/safeRedirect'/);
  assert.match(onboarding, /const pendingRedirect = sanitizeRedirectPath\(searchParams\.get\('redirect'\)\);/);
  assert.match(onboarding, /router\.push\(pendingRedirect \|\| '\/search\?welcome=1'\)/);
  // Nothing else about the onboarding steps/copy/progress model changed.
  assert.match(onboarding, /const steps = \['The basics', 'What matters', 'Dealbreakers', 'My Search'\];/);
});

/* ------------------------------ Part 4/5: idempotence & query cleanup ------------------------------ */

test('the intake effect is a single one-shot guard shared with ?add=1/?home=, and always uses replace (never push)', () => {
  assert.match(homesBoard, /const autoOpenedRef = useRef\(false\);/);
  const replaceCalls = (homesBoard.match(/router\.replace\(/g) || []).length;
  assert.ok(replaceCalls >= 3, 'expected router.replace used by all three auto-open effects (?add=1, ?home=, ?url=)');
  assert.doesNotMatch(homesBoard, /router\.push\('\/homes'\)/, 'consuming these params must never push a new history entry');
});

test('regression guard: importer failure/retry behavior in HomeModal is untouched by this pass', () => {
  assert.match(homeModal, /Intentionally do NOT set lastLookupAddress here/);
  assert.match(homeModal, /We couldn't look up that address right now — you can enter details manually below\./);
  assert.match(homeModal, /We couldn't reach the property data provider — you can enter details manually below\./);
});

/* ------------------------------ Part 9: mobile/native compatibility ------------------------------ */

test('no native-only branch was introduced for the intake path', () => {
  assert.doesNotMatch(homesBoard, /isNativeApp/);
});
