#!/usr/bin/env node
// Browser QA for the native iOS welcome + share tutorial
// (docs/native-welcome-share-tutorial.md). DEVELOPMENT ONLY.
//
//   1. FLH_TEST_PGHOST=… FLH_TEST_PGPORT=… node scripts/qa/supabase-standin.mjs 54321 > standin.json
//   2. NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=qa npx next build && … npx next start -p 3200
//   3. FLH_TEST_PGHOST=… FLH_TEST_PGPORT=… node scripts/qa/native-welcome-qa.mjs standin.json <outDir> [baseUrl]
//
// "Native" pages are emulated as faithfully as a Linux browser allows: before
// any page script runs, the page gets what Capacitor's iOS shell injects at
// document start — a `webkit.messageHandlers.bridge` handler, the
// `window.Capacitor` global, Capacitor's own native-bridge.js (copied from
// node_modules/@capacitor/ios) and plugin headers for App and Haptics. A fake
// native side records every plugin call and can deliver `appUrlOpen` exactly
// the way AppPlugin.swift does. Plain pages get none of it (desktop, mobile
// Safari emulation). This is not a substitute for Xcode/Simulator QA.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { chromium, devices } from 'playwright';

const [infoPath, outArg, base = 'http://localhost:3200'] = process.argv.slice(2);
if (!infoPath || !outArg) throw new Error('Usage: native-welcome-qa.mjs <standin.json> <outDir> [baseUrl]');
const info = JSON.parse(readFileSync(infoPath, 'utf8').split('\n')[0]);
const outDir = resolve(outArg);
mkdirSync(outDir, { recursive: true });
const pg = ['-X', '-q', '-A', '-t', '-h', process.env.FLH_TEST_PGHOST, '-p', process.env.FLH_TEST_PGPORT || '5432', '-U', 'postgres', '-d', info.database];
const psql = (sql) => {
  const result = spawnSync('psql', [...pg, '-v', 'ON_ERROR_STOP=1', '-c', sql], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
};
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const results = [];
const check = (name, condition, detail = '') => { results.push({ name, ok: Boolean(condition), detail }); console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };

const nativeBridgeJs = readFileSync('node_modules/@capacitor/ios/Capacitor/Capacitor/assets/native-bridge.js', 'utf8');
const header = (name, methods) => ({ name, methods: [{ name: 'addListener' }, { name: 'removeListener' }, { name: 'removeAllListeners', rtype: 'promise' }, ...methods.map((m) => ({ name: m, rtype: 'promise' }))] });
const HEADERS = [
  header('App', ['exitApp', 'getInfo', 'getLaunchUrl', 'getState', 'minimizeApp', 'toggleBackButtonHandler']),
  header('Haptics', ['impact', 'notification', 'vibrate', 'selectionStart', 'selectionChanged', 'selectionEnd']),
];
// What CAPBridgeViewController injects (JSExport.swift), in the same order,
// plus a fake native side that answers promise calls and records everything.
const NATIVE_INIT = `
  window.__nativeCalls = [];
  window.__appUrlCallbacks = [];
  window.webkit = { messageHandlers: { bridge: { postMessage(data) {
    window.__nativeCalls.push({ plugin: data.pluginId, method: data.methodName, options: data.options });
    if (data.pluginId === 'App' && data.methodName === 'addListener' && data.options && data.options.eventName === 'appUrlOpen') window.__appUrlCallbacks.push(data.callbackId);
    if (data.methodName !== 'addListener') setTimeout(() => window.Capacitor.fromNative({ callbackId: data.callbackId, pluginId: data.pluginId, methodName: data.methodName, success: true, data: {} }), 0);
  } } } };
  window.Capacitor = { DEBUG: false, isLoggingEnabled: false, Plugins: {} };
  window.WEBVIEW_SERVER_URL = '';
  ${nativeBridgeJs}
  (function (w) { var a = (w.Capacitor = w.Capacitor || {}); var h = (a.PluginHeaders = a.PluginHeaders || []); ${HEADERS.map((h) => `h.push(${JSON.stringify(h)});`).join(' ')} })(window);
  // Deliver a Universal Link the way AppPlugin.swift does (retained event).
  window.__openUniversalLink = (url) => window.__appUrlCallbacks.forEach((callbackId) => window.Capacitor.fromNative({ callbackId, pluginId: 'App', methodName: 'addListener', success: true, save: true, data: { url } }));
`;
// Samples, on every frame from the very first, which signed-out entry is
// visible. Any frame with the public homepage visible inside the "app" is a flash.
const FRAME_SAMPLER = `
  window.__frames = [];
  (function sample() {
    const visible = (sel) => { const el = document.querySelector(sel); return !!el && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().height > 0; };
    if (document.body) window.__frames.push({ landing: visible('.pl-root'), welcome: visible('.flh-welcome'), path: location.pathname });
    requestAnimationFrame(sample);
  })();
`;

const sizes = { w320: { width: 320, height: 568 }, w375: { width: 375, height: 667 }, w390: { width: 390, height: 844 }, w430: { width: 430, height: 932 } };
const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {});
const consoleErrors = [];
const IGNORED = /favicon|Failed to load resource|maps\.googleapis|youtube|Download the React DevTools|not implemented on|ERR_|net::/i;

async function context({ native = false, viewport = sizes.w390, signedIn = null, reducedMotion = 'no-preference', device = null } = {}) {
  const ctx = await browser.newContext(device ? { ...device, reducedMotion } : { viewport, deviceScaleFactor: 2, isMobile: viewport.width < 600, hasTouch: viewport.width < 600, reducedMotion });
  if (native) await ctx.addInitScript(NATIVE_INIT);
  await ctx.addInitScript(FRAME_SAMPLER);
  if (signedIn) await ctx.addCookies([{ name: 'sb-localhost-auth-token', value: `base64-${Buffer.from(JSON.stringify(signedIn.session)).toString('base64url')}`, domain: 'localhost', path: '/' }]);
  ctx.on('page', (page) => page.on('console', (m) => { if (m.type() === 'error' && !IGNORED.test(m.text())) consoleErrors.push(m.text()); }));
  return ctx;
}
const shot = (page, name) => page.screenshot({ path: join(outDir, `${name}.png`) });
const isVisible = (page, sel) => page.locator(sel).first().isVisible();

/* -------------------- web: public homepage stays the homepage -------------------- */
for (const [label, opts] of [['desktop-1440', { viewport: { width: 1440, height: 900 } }], ['mobile-safari-390', { device: devices['iPhone 13'] }]]) {
  const ctx = await context(opts);
  const page = await ctx.newPage();
  await page.goto(`${base}/`, { waitUntil: 'networkidle' });
  const flagged = await page.evaluate(() => document.documentElement.hasAttribute('data-flh-native'));
  check(`${label}: no native flag in an ordinary browser`, !flagged);
  check(`${label}: public homepage visible`, await isVisible(page, '.pl-root'));
  check(`${label}: native welcome never shown`, !(await isVisible(page, '.flh-welcome')) && (await page.evaluate(() => window.__frames.every((f) => !f.welcome))));
  await shot(page, `web-${label}-homepage`);
  await ctx.close();
}

/* ---------------------- native: signed-out first launch ---------------------- */
{
  // Hold every JS chunk back so the screenshot is the server HTML + CSS
  // alone — the state before hydration — and prove the welcome is already there.
  const ctx = await context({ native: true });
  const page = await ctx.newPage();
  let release;
  const gate = new Promise((r) => { release = r; });
  await page.route('**/_next/static/chunks/**', async (route) => { await gate; route.continue(); });
  await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(400);
  check('native cold launch: welcome painted before hydration', await isVisible(page, '.flh-welcome'));
  check('native cold launch: homepage hidden before hydration', !(await isVisible(page, '.pl-root')));
  await shot(page, 'native-before-hydration-390');
  release();
  await page.waitForLoadState('networkidle');
  const frames = await page.evaluate(() => window.__frames);
  check('native cold launch: public homepage visible on 0 frames', frames.length > 0 && frames.every((f) => !f.landing), `${frames.length} frames sampled`);
  await ctx.close();
}

for (const [key, viewport] of Object.entries(sizes)) {
  const ctx = await context({ native: true, viewport });
  const page = await ctx.newPage();
  await page.goto(`${base}/`, { waitUntil: 'networkidle' });
  const primary = await page.getByRole('link', { name: /Get Started/ }).boundingBox();
  const secondary = await page.getByRole('link', { name: /Already have an account\? Sign in/ }).boundingBox();
  const scrollable = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
  check(`native ${key}: Get Started and Sign in fully visible without scrolling`, primary && secondary && secondary.y + secondary.height <= viewport.height, `sign-in bottom ${Math.round(secondary.y + secondary.height)} / ${viewport.height}, overflow ${scrollable}px`);
  check(`native ${key}: tap targets ≥ 44px`, primary.height >= 44 && secondary.height >= 44);
  const hero = await page.locator('.flh-welcome-photo img').getAttribute('src');
  check(`native ${key}: hero is the desktop homepage photo`, decodeURIComponent(hero).includes('/images/Warm Cottage.png'), hero);
  await shot(page, `native-welcome-${key.slice(1)}`);
  await ctx.close();
}

/* ------------------------- native: Get Started / Sign in ------------------------- */
for (const [name, path] of [['Get Started', '/auth/sign-up'], ['Already have an account? Sign in', '/auth/sign-in']]) {
  const ctx = await context({ native: true });
  const page = await ctx.newPage();
  await page.goto(`${base}/`, { waitUntil: 'networkidle' });
  await page.getByRole('link', { name }).click();
  await page.waitForURL(`**${path}`);
  await page.waitForSelector('.afh-native-root');
  check(`native: "${name}" opens the existing ${path}`, new URL(page.url()).pathname === path);
  await shot(page, `native-${path.split('/').pop()}-390`);
  await ctx.close();
}
{
  // Real sign-in through the existing form, as the seeded owner.
  const ctx = await context({ native: true });
  const page = await ctx.newPage();
  await page.goto(`${base}/`, { waitUntil: 'networkidle' });
  await page.getByRole('link', { name: 'Already have an account? Sign in' }).click();
  await page.waitForURL('**/auth/sign-in');
  await page.locator('#sign-in-email, input[type=email]').first().fill(info.users.owner.email);
  await page.locator('#sign-in-password').fill('qa-password');
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL('**/homes**', { timeout: 20000 });
  check('native: signing in from the welcome reaches My Homes', new URL(page.url()).pathname === '/homes');
  await ctx.close();
}

/* -------------------------- native: returning, signed in -------------------------- */
{
  const ctx = await context({ native: true, signedIn: info.users.owner });
  const page = await ctx.newPage();
  await page.goto(`${base}/`, { waitUntil: 'networkidle' });
  const frames = await page.evaluate(() => window.__frames);
  check('native signed-in launch: lands on My Homes', new URL(page.url()).pathname === '/homes');
  check('native signed-in launch: welcome and homepage never painted', frames.every((f) => !f.welcome && !f.landing), `${frames.length} frames`);
  await shot(page, 'native-signed-in-homes-390');
  await ctx.close();
}

/* ------------------------------ native: deep links ------------------------------ */
const token = psql(`insert into public.search_invitations (search_id, invited_by, invited_email, relationship_type)
  values ('${info.search}', '${info.users.owner.id}', 'new.cobuyer.qa@example.com', 'co_buyer') returning token`).split('\n')[0];
const listing = 'https://www.zillow.com/homedetails/41-Maple-St-Troy-MI-48084/123_zpid/?utm=share#photos';
const sharedPath = `/homes?url=${encodeURIComponent(listing)}`;
{
  const ctx = await context({ native: true });
  const page = await ctx.newPage();
  await page.goto(`${base}/invite/${token}`, { waitUntil: 'networkidle' });
  const frames = await page.evaluate(() => window.__frames);
  const inviteUrl = new URL(page.url());
  // /invite/[token] itself sends a signed-out visitor to sign-in with the
  // invitation kept as ?redirect= (unchanged behaviour); the welcome must never intervene.
  check('native signed-out invitation link: sign-in keeps the invitation, never the welcome', inviteUrl.pathname === '/auth/sign-in' && inviteUrl.searchParams.get('redirect') === `/invite/${token}` && frames.every((f) => !f.welcome), `${inviteUrl.pathname}?redirect=/invite/<token>`);
  await shot(page, 'native-deeplink-invitation-signed-out');
  await page.goto(`${base}${sharedPath}`, { waitUntil: 'networkidle' });
  const url = new URL(page.url());
  check('native signed-out shared listing: sign-in keeps the full destination', url.pathname === '/auth/sign-in' && url.searchParams.get('redirect') === sharedPath, `${url.pathname}?redirect=${url.searchParams.get('redirect')}`);
  await ctx.close();
}
{
  // Cold start via Universal Link: the shell loads "/" (the welcome), then
  // Capacitor delivers appUrlOpen; DeepLinkBridge must still win.
  const ctx = await context({ native: true });
  const page = await ctx.newPage();
  await page.goto(`${base}/`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__appUrlCallbacks.length > 0);
  await page.evaluate((url) => window.__openUniversalLink(url), `https://feelslikehome.app/invite/${token}`);
  await page.waitForURL(`**/invite/${token}**`);
  check('native Universal Link over the welcome: routes to the invitation', new URL(page.url()).pathname.startsWith(`/invite/${token}`));
  await ctx.close();
}
{
  const ctx = await context({ native: true, signedIn: info.users.owner });
  const page = await ctx.newPage();
  await page.goto(`${base}/`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__appUrlCallbacks.length > 0);
  await page.evaluate((url) => window.__openUniversalLink(url), `https://feelslikehome.app${sharedPath}`);
  // Add Home is the specific dialog (#73's ?url= intake), not just any
  // dialog — the existing first-run tour can also be open on My Homes.
  const addHome = page.locator('.hh-add-home-modal[aria-labelledby="add-home-title"]');
  await addHome.waitFor({ timeout: 20000 });
  await page.waitForFunction(() => [...document.querySelectorAll('.hh-add-home-modal input')].some((i) => i.value === '41 Maple St, Troy, MI 48084'), null, { timeout: 20000 }).catch(() => {});
  const values = await addHome.locator('input').evaluateAll((inputs) => inputs.map((i) => i.value));
  // The address comes from #73's URL parser on the shared Zillow link (the
  // RentCast lookup itself is unreachable in local QA and falls back to manual).
  check('native Share Extension link (signed in): Add Home opens with the shared listing', new URL(page.url()).pathname === '/homes' && values.includes('41 Maple St, Troy, MI 48084'), values.filter(Boolean).join(' | '));
  await page.waitForTimeout(800);
  await shot(page, 'native-deeplink-shared-listing-signed-in');
  await ctx.close();
}

/* ------------------------------ share tutorial ------------------------------ */
{
  const ctx = await context({ native: true });
  const page = await ctx.newPage();
  await page.goto(`${base}/`, { waitUntil: 'networkidle' });
  const trigger = page.getByRole('button', { name: /See how saving a home works/ });
  await trigger.click();
  const dialog = page.getByRole('dialog');
  check('tutorial: opens as a dialog from the welcome', await dialog.isVisible());
  check('tutorial: focus starts on the one-line instruction', await page.evaluate(() => document.activeElement?.id === 'flh-st-title'));
  await shot(page, 'tutorial-1-tap-share-390');
  await page.getByRole('button', { name: 'Share', exact: true }).click();
  await page.waitForSelector('.flh-st-sheet');
  await page.waitForTimeout(500);
  await shot(page, 'tutorial-2-share-sheet-390');
  await page.getByRole('button', { name: 'Message' }).click();
  check('tutorial: a wrong tile gives a gentle hint, not a dead end', /look for Feels Like Home/.test(await page.locator('.flh-st-hint').innerText()));
  await page.getByRole('button', { name: 'More' }).click();
  check('tutorial: More explains More → Edit → Favorites', /More → Edit/.test(await page.locator('.flh-st-hint').innerText()));
  await shot(page, 'tutorial-2b-more-hint-390');
  await page.getByRole('button', { name: /Back/ }).click();
  check('tutorial: Back returns to the listing step', await page.getByRole('button', { name: 'Share', exact: true }).isVisible() && !(await isVisible(page, '.flh-st-sheet')));
  await page.getByRole('button', { name: 'Share', exact: true }).click();
  await page.getByRole('button', { name: 'Feels Like Home' }).click();
  await page.waitForSelector('.flh-st-saved');
  await page.waitForTimeout(700);
  await shot(page, 'tutorial-3-saved-390');
  await page.locator('.flh-st').evaluate((el) => el.scrollTo(0, el.scrollHeight));
  await shot(page, 'tutorial-3b-good-to-know-390');
  const calls = await page.evaluate(() => window.__nativeCalls.filter((c) => c.plugin === 'Haptics').map((c) => `${c.method}${c.options?.style ? `:${c.options.style}` : ''}${c.options?.type ? `:${c.options.type}` : ''}`));
  check('haptics: light impact on each highlighted tap, selection on other tiles, success once', JSON.stringify(calls) === JSON.stringify(['impact:LIGHT', 'selectionChanged', 'selectionChanged', 'impact:LIGHT', 'impact:LIGHT', 'notification:SUCCESS']), calls.join(', '));
  await page.getByRole('button', { name: 'Practice again' }).click();
  check('tutorial: Practice again replays from step 1', await page.getByRole('button', { name: 'Share', exact: true }).isVisible());
  await page.getByRole('button', { name: 'Skip' }).click();
  check('tutorial: Skip closes it, back on the welcome', !(await dialog.count()) && await isVisible(page, '.flh-welcome'));
  check('tutorial: focus returns to the trigger', await page.evaluate(() => document.activeElement?.classList.contains('flh-welcome-tour')));
  await trigger.click();
  await page.keyboard.press('Escape');
  check('tutorial: Escape closes it', !(await dialog.count()));
  const haptics = await page.evaluate(() => window.__nativeCalls.filter((c) => c.plugin === 'Haptics').length);
  check('haptics: none on opening/closing the tutorial or on navigation', haptics === 6, `${haptics} haptic calls in total`);
  await ctx.close();
}
{
  // Keyboard only, the way a switch/keyboard or screen-reader user would.
  const ctx = await context({ native: true });
  const page = await ctx.newPage();
  await page.goto(`${base}/`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /See how saving a home works/ }).focus();
  await page.keyboard.press('Enter');
  const reach = async (name) => { for (let i = 0; i < 20; i += 1) { await page.keyboard.press('Tab'); if (await page.evaluate((n) => (document.activeElement?.innerText || document.activeElement?.getAttribute('aria-label') || '').trim() === n, name)) return true; } return false; };
  check('keyboard: Tab reaches Share', await reach('Share'));
  await page.keyboard.press('Enter');
  check('keyboard: Tab reaches Feels Like Home', await reach('Feels Like Home'));
  await page.keyboard.press('Enter');
  check('keyboard: reaches the saved step and Done', await page.locator('.flh-st-saved').isVisible() && await reach('Done'));
  let trapped = true;
  for (let i = 0; i < 12; i += 1) { await page.keyboard.press('Tab'); if (!(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]')))) trapped = false; }
  check('keyboard: focus stays inside the dialog', trapped);
  const tree = await page.locator('[role="dialog"]').ariaSnapshot();
  writeFileSync(join(outDir, 'tutorial-saved-aria.txt'), tree);
  check('screen reader: the saved step exposes heading, facts and Done', /heading "Saved to Feels Like Home\."/.test(tree) && /button "Done"/.test(tree));
  await ctx.close();
}
{
  const ctx = await context({ native: true, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  await page.goto(`${base}/`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /See how saving a home works/ }).click();
  const beckon = await page.locator('.flh-st-share').evaluate((el) => getComputedStyle(el).animationDuration);
  await page.getByRole('button', { name: 'Share', exact: true }).click();
  const sheet = await page.locator('.flh-st-sheet').evaluate((el) => getComputedStyle(el).animationDuration);
  const press = await page.locator('.flh-st-app.is-flh').evaluate((el) => getComputedStyle(el).transitionDuration);
  check('Reduce Motion: highlight, sheet slide and press spring are effectively off', [beckon, sheet, press].every((d) => parseFloat(d) < 0.001), `${beckon} / ${sheet} / ${press}`);
  await page.getByRole('button', { name: 'Feels Like Home' }).click();
  check('Reduce Motion: tutorial still completes', await page.locator('.flh-st-saved').isVisible());
  await shot(page, 'tutorial-reduced-motion-saved-390');
  await ctx.close();
}
for (const [key, viewport] of [['320', sizes.w320], ['430', sizes.w430]]) {
  const ctx = await context({ native: true, viewport });
  const page = await ctx.newPage();
  await page.goto(`${base}/`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /See how saving a home works/ }).click();
  await shot(page, `tutorial-1-tap-share-${key}`);
  await page.getByRole('button', { name: 'Share', exact: true }).click();
  await page.waitForTimeout(500);
  const sheet = await page.locator('.flh-st-sheet').boundingBox();
  const flh = await page.getByRole('button', { name: 'Feels Like Home' }).boundingBox();
  check(`tutorial ${key}: Feels Like Home tile on screen and tappable`, flh && flh.x >= 0 && flh.x + flh.width <= viewport.width && flh.height >= 44 && sheet);
  await shot(page, `tutorial-2-share-sheet-${key}`);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  check(`tutorial ${key}: no horizontal page overflow`, overflow <= 0, `${overflow}px`);
  await ctx.close();
}

/* ------------------------- replay from Account → Help ------------------------- */
{
  const ctx = await context({ native: true, signedIn: info.users.owner });
  const page = await ctx.newPage();
  await page.goto(`${base}/account`, { waitUntil: 'networkidle' });
  const help = page.getByRole('button', { name: 'Practice sharing a home' });
  check('Account (native): Help offers the share tutorial', await help.isVisible());
  await help.scrollIntoViewIfNeeded();
  await shot(page, 'native-account-help-390');
  await help.click();
  check('Account (native): tutorial opens without signing out', await page.getByRole('dialog').isVisible() && new URL(page.url()).pathname === '/account');
  await page.getByRole('button', { name: 'Skip' }).click();
  await ctx.close();
}
{
  const ctx = await context({ signedIn: info.users.owner, device: devices['iPhone 13'] });
  const page = await ctx.newPage();
  await page.goto(`${base}/account`, { waitUntil: 'networkidle' });
  check('Account (mobile Safari): no Share Extension help where the extension cannot exist', !(await page.getByRole('button', { name: 'Practice sharing a home' }).isVisible()));
  await ctx.close();
}

await browser.close();
check('no unexpected console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
writeFileSync(join(outDir, 'results.json'), JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
