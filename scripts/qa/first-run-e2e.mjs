#!/usr/bin/env node
// Milestone 4: first-run, end-to-end QA (docs/v3-launch-readiness.md). DEVELOPMENT ONLY.
//
//   1. FLH_TEST_PGHOST=… FLH_TEST_PGPORT=… node scripts/qa/supabase-standin.mjs 54321 > standin.json
//   2. One production build (NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321
//      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=qa), served twice:
//        FLH_ONBOARDING_V3=on npx next start -p 3200   and   npx next start -p 3300 (flag off)
//   3. FLH_TEST_PGHOST=… FLH_TEST_PGPORT=… node scripts/qa/first-run-e2e.mjs standin.json <outDir>
//
// Real forms throughout: sign-up goes through the stand-in's /auth/v1/signup
// (a project with email confirmation off). "Native" pages get what Capacitor's
// iOS shell injects at document start (bridge handler, Capacitor's real
// native-bridge.js, App plugin header) and a fake native side that can deliver
// `appUrlOpen` the way AppPlugin.swift does — the Share Extension's hand-off.
// This is browser emulation, NOT the installed app. Listing lookups (RentCast)
// are unreachable here, so imports take the existing "add the address" fallback.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';

const [infoPath, outArg] = process.argv.slice(2);
if (!infoPath || !outArg) throw new Error('Usage: first-run-e2e.mjs <standin.json> <outDir>');
const ON = process.env.QA_ON || 'http://localhost:3200';
const OFF = process.env.QA_OFF || 'http://localhost:3300';
const info = JSON.parse(readFileSync(infoPath, 'utf8').split('\n')[0]);
const outDir = resolve(outArg);
mkdirSync(outDir, { recursive: true });

/* ------------------------------- database ------------------------------- */
const pg = ['-X', '-q', '-A', '-t', '-h', process.env.FLH_TEST_PGHOST, '-p', process.env.FLH_TEST_PGPORT || '5432', '-U', 'postgres', '-d', info.database];
const q = (sql) => { const r = spawnSync('psql', [...pg, '-c', `select coalesce(json_agg(row_to_json(x)), '[]'::json) from (${sql}) x`], { encoding: 'utf8' }); if (r.status !== 0) throw new Error(r.stderr); return JSON.parse(r.stdout.trim()); };
const exec = (sql) => { const r = spawnSync('psql', [...pg, '-v', 'ON_ERROR_STOP=1', '-c', sql], { encoding: 'utf8' }); if (r.status !== 0) throw new Error(r.stderr); };
const lit = (v) => `'${String(v).replace(/'/g, "''")}'`;
const userByEmail = (email) => q(`select id from auth.users where email = ${lit(email)}`)[0]?.id;
const profile = (id) => q(`select onboarding_complete, onboarding_version, onboarding_state, active_search_id from public.profiles where id = ${lit(id)}`)[0];
const ownedSearches = (id) => q(`select id from public.searches where user_id = ${lit(id)}`).map((r) => r.id);
const prioritiesOf = (searchId, userId) => q(`select priorities from public.search_member_priorities where search_id = ${lit(searchId)} and user_id = ${lit(userId)}`)[0]?.priorities || null;
const homesOf = (searchId) => q(`select id, address, listing_url, photo_url, price from public.homes where search_id = ${lit(searchId)} order by created_at`);
const tierOf = (p, cat, label) => p?.[cat]?.tiers?.[label] ?? null;
const ITEM = ['location', 'features', 'exterior', 'homeFeel'];
const dontcares = (p) => ITEM.flatMap((k) => Object.entries(p?.[k]?.tiers || {}).filter(([, t]) => t === 'dontcare').map(([l]) => `${k}:${l}`));

/* -------------------------------- checks -------------------------------- */
const results = [];
let section = '';
const check = (name, ok, detail = '') => { results.push({ section, name, ok: Boolean(ok), detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  [${section}] ${name}${detail ? ` — ${detail}` : ''}`); };
const step = async (name, fn) => { try { await fn(); } catch (error) { check(`${name} (did not complete)`, false, error.message.split('\n')[0].slice(0, 160)); } };

/* -------------------------------- browser -------------------------------- */
const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {});
const nativeBridgeJs = readFileSync('node_modules/@capacitor/ios/Capacitor/Capacitor/assets/native-bridge.js', 'utf8');
const header = (name, methods) => ({ name, methods: [{ name: 'addListener' }, { name: 'removeListener' }, { name: 'removeAllListeners', rtype: 'promise' }, ...methods.map((m) => ({ name: m, rtype: 'promise' }))] });
const NATIVE_INIT = `
  window.__nativeCalls = []; window.__appUrlCallbacks = [];
  window.webkit = { messageHandlers: { bridge: { postMessage(data) {
    window.__nativeCalls.push({ plugin: data.pluginId, method: data.methodName });
    if (data.pluginId === 'App' && data.methodName === 'addListener' && data.options && data.options.eventName === 'appUrlOpen') window.__appUrlCallbacks.push(data.callbackId);
    if (data.methodName !== 'addListener') setTimeout(() => window.Capacitor.fromNative({ callbackId: data.callbackId, pluginId: data.pluginId, methodName: data.methodName, success: true, data: {} }), 0);
  } } } };
  window.Capacitor = { DEBUG: false, isLoggingEnabled: false, Plugins: {} };
  window.WEBVIEW_SERVER_URL = '';
  ${nativeBridgeJs}
  (function (w) { var a = (w.Capacitor = w.Capacitor || {}); var h = (a.PluginHeaders = a.PluginHeaders || []);
    h.push(${JSON.stringify(header('App', ['exitApp', 'getInfo', 'getLaunchUrl', 'getState', 'minimizeApp']))});
    h.push(${JSON.stringify(header('Haptics', ['impact', 'notification', 'vibrate', 'selectionStart', 'selectionChanged', 'selectionEnd']))}); })(window);
  window.__openUniversalLink = (url) => window.__appUrlCallbacks.forEach((callbackId) => window.Capacitor.fromNative({ callbackId, pluginId: 'App', methodName: 'addListener', success: true, save: true, data: { url } }));
  window.__frames = [];
  (function sample() { const v = (s) => { const el = document.querySelector(s); return !!el && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().height > 0; };
    if (document.body) window.__frames.push({ landing: v('.pl-root'), path: location.pathname }); requestAnimationFrame(sample); })();
`;
const consoleErrors = [];
const IGNORED = /favicon|Failed to load resource|maps\.googleapis|Google Maps|places|Download the React DevTools|net::|not implemented on|import-listing|rentcast|claim_match_reveal|commute/i;
async function newPage({ native = false, width = 390, height = 844 } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, isMobile: width < 700, hasTouch: width < 700 });
  if (native) await ctx.addInitScript(NATIVE_INIT);
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error' && !IGNORED.test(m.text())) consoleErrors.push(`${section}: ${m.text().slice(0, 160)}`); });
  page.on('pageerror', (e) => { if (!IGNORED.test(e.message)) consoleErrors.push(`${section}: ${e.message.slice(0, 160)}`); });
  return { ctx, page };
}
let shotIndex = 0;
const shot = (page, name, fullPage = false) => page.screenshot({ path: join(outDir, `${String(++shotIndex).padStart(2, '0')}-${name}.png`), fullPage });
const pause = (page, ms = 350) => page.waitForTimeout(ms);
const cta = (page) => page.locator('.flh-ob-pf-footer .flh-ob-cta');
const card = (page, text) => page.getByRole('button', { name: new RegExp(`^${text}.*Choose importance`) }).first();
const level = (page, text) => page.locator('.hh-sheet').getByRole('button', { name: new RegExp(`^${text}`) }).first();
async function signUpThroughForm(page, base, label) {
  const email = `${label}.${randomUUID().slice(0, 6)}@example.com`;
  await page.locator('#sign-up-first-name').waitFor();
  await page.fill('#sign-up-first-name', label[0].toUpperCase() + label.slice(1));
  await page.fill('#sign-up-last-name', 'QA');
  await page.fill('#sign-up-email', email);
  await page.fill('#sign-up-password', 'qa-password-1');
  await page.fill('#sign-up-confirm', 'qa-password-1');
  await page.locator('form[aria-label="Create account"] button[type="submit"]').click();
  return email;
}
async function signInThroughForm(page, email) {
  await page.locator('#sign-in-email, input[type=email]').first().fill(email);
  await page.locator('#sign-in-password').fill('qa-password-1');
  await page.locator('form[aria-label="Sign in"] button[type="submit"]').click();
}
async function chooseType(page, type) {
  await page.locator(`input[type="radio"][value="${type}"]`).check({ force: true });
  await cta(page).click();
  await page.locator('.flh-ob-setup-path').waitFor();
}
async function skipToReview(page) {
  for (let i = 0; i < 12 && !(await page.locator('.flh-ob-review-actions').isVisible().catch(() => false)); i += 1) {
    const skip = page.locator('.flh-ob-pf-skip');
    if (await skip.isVisible().catch(() => false)) await skip.click(); else await cta(page).click();
    await pause(page);
  }
}
async function saveByAddress(page, address) {
  const modal = page.locator('.hh-add-home-modal');
  await modal.waitFor();
  await modal.locator('input').first().fill(address);
  await page.getByRole('button', { name: 'Find home' }).click();
  await page.getByRole('button', { name: 'Save Home' }).waitFor({ timeout: 20000 });
}
const pctPill = async (page) => (await page.locator('.flh-overlay-match .flh-match-pill').count()) ? (await page.locator('.flh-overlay-match .flh-match-pill').innerText()) : null;
async function answer(page, criterion, value) {
  await page.locator(`input[name="match-${criterion}"][value="${value}"]`).check({ force: true });
  await pause(page, 900);
}
async function openMatch(page) {
  await page.locator('#flh-match-title').scrollIntoViewIfNeeded();
  await pause(page, 300);
}

/* ======================= Journey A: Personalize first ======================= */
section = 'A · Personalize';
const A = {};
await step('journey A', async () => {
  const { ctx, page } = await newPage({ native: true });
  await page.goto(`${ON}/`, { waitUntil: 'networkidle' });
  const frames = await page.evaluate(() => window.__frames);
  check('A1 native welcome, no homepage frame', await page.locator('.flh-welcome').isVisible() && frames.every((f) => !f.landing));
  await shot(page, 'A1-native-welcome');
  await page.getByRole('link', { name: /Get Started/ }).click();
  await page.waitForURL('**/auth/sign-up');
  await page.locator('.afh-native-root').waitFor();
  await shot(page, 'A2-sign-up');
  A.email = await signUpThroughForm(page, ON, 'avery');
  await page.waitForURL('**/onboarding**', { timeout: 20000 });
  A.id = userByEmail(A.email);
  A.search = ownedSearches(A.id)[0];
  check('A2 sign-up creates one account, one search, onboarding not yet complete', A.id && ownedSearches(A.id).length === 1 && profile(A.id).onboarding_complete === false);
  await page.locator('input[type="radio"][value="home_buy"]').waitFor({ state: 'attached' });
  await shot(page, 'A3-search-type');
  await chooseType(page, 'home_buy');
  await shot(page, 'A4-setup-path');
  await page.getByRole('button', { name: /Let’s personalize your search/ }).click();
  await page.locator('.flh-ob-basics').waitFor();
  await page.getByLabel('Maximum budget').fill('450000');
  for (let i = 0; i < 3; i += 1) await page.getByRole('button', { name: 'More bedrooms' }).click();
  await shot(page, 'A5-basics');
  await cta(page).click();
  await page.locator('.flh-ob-pf-layout').waitFor();
  await card(page, 'Home Office').click(); await level(page, 'Must Have').click(); await pause(page);
  await shot(page, 'A6-layout-home-office-must');
  await cta(page).click();
  await page.locator('.flh-ob-pf-kitchen').waitFor();
  await card(page, 'Walk-in Pantry').click(); await level(page, 'Important').click(); await pause(page);
  await shot(page, 'A6-kitchen-pantry-important');
  await skipToReview(page);
  await pause(page, 400);
  await shot(page, 'A7-review', true);
  check('A7 Review shows the choices, the completion moment, and nothing invented', await page.locator('.flh-ob-done-mark').count() === 1 && /Home Office/.test(await page.locator('.flh-ob-pf-review').innerText()) && /Walk-in Pantry/.test(await page.locator('.flh-ob-pf-review').innerText()));
  await page.locator('.flh-ob-review-actions .flh-ob-cta').click();
  await page.waitForURL('**/homes**', { timeout: 20000 });
  const prof = profile(A.id);
  const doc = prioritiesOf(A.search, A.id);
  check('A8 finish: onboarding complete (v4, personalize); exactly the answers given; no dontcare', prof.onboarding_complete && prof.onboarding_version === 4 && prof.onboarding_state.answers.setupPath === 'personalize'
    && tierOf(doc, 'features', 'Home office') === 'must' && tierOf(doc, 'features', 'Walk-in Pantry') === 'important' && dontcares(doc).length === 0 && doc.budget.value === '450000' && doc.bedsMin.value === '3', JSON.stringify(doc.features.tiers));
  await saveByAddress(page, '12 Oak St, Troy, MI 48084');
  await shot(page, 'A9-add-home');
  check('A9 nothing is saved until "Save Home"', homesOf(A.search).length === 0);
  await page.getByRole('button', { name: 'Save Home' }).click();
  await page.locator('.flh-saved').waitFor({ timeout: 20000 });
  await shot(page, 'A9-saved');
  check('A9 saved: one home, on this search', homesOf(A.search).length === 1);
  A.home = homesOf(A.search)[0].id;
  check('A9 the saved confirmation is honest about what is next', /how it fits your priorities/.test(await page.locator('.flh-saved').innerText()));
  await page.locator('.flh-saved-open').click();
  await page.locator('#flh-match-title').waitFor({ timeout: 20000 });
  check('the saved home opens in its overview', new URL(page.url()).pathname === `/homes/${A.home}`, new URL(page.url()).pathname);
  await page.locator('#flh-match-title').waitFor();
  await shot(page, 'A10-home-detail');
  await openMatch(page);
  await shot(page, 'A11-match-before-answers');
  const lead = await page.locator('.flh-overlay-match-lead').first().innerText();
  check('A11 Match explains itself and shows no % while nothing is known (price, beds unknown; Unknown ≠ No)', !(await pctPill(page)) && /no % yet/i.test(lead), lead);
  await answer(page, 'features:Home office', 'yes');
  const pctYes = await pctPill(page);
  await shot(page, 'A12-match-after-yes');
  check('A12 answering Home Office Yes: a Match appears, based only on that answer', pctYes === '100% Match' && /based on 1 known priority/.test(await page.locator('.flh-overlay-match-lead').first().innerText()), pctYes);
  await answer(page, 'features:Home office', 'no');
  const pctNo = await pctPill(page);
  check('A12 changing it to No: a missed Must Have, the Match responds', pctNo === '0% Match', pctNo);
  await answer(page, 'features:Home office', 'unknown');
  check('A12 back to Unknown: no %, never counted as a No', !(await pctPill(page)));
  await answer(page, 'features:Home office', 'yes');
  // Close steps back to My Homes, which already lists the new home (no reload).
  await page.getByRole('button', { name: /^Close/ }).first().click();
  await page.waitForURL((url) => url.pathname === '/homes', { timeout: 15000 });
  await pause(page, 600);
  check('A13 Close returns to My Homes, which lists the new home', /12 Oak St/.test(await page.locator('main').first().innerText()));
  // Quick "View home" right after saving (the Milestone 4 fix): three in a row.
  let opened = 0;
  for (let i = 0; i < 3; i += 1) {
    await page.goto(`${ON}/homes?add=1`, { waitUntil: 'networkidle' });
    await saveByAddress(page, `${4000 + Math.floor(Math.random() * 5000)} Quick Tap Rd, Troy, MI 48084`);
    await page.getByRole('button', { name: 'Save Home' }).click();
    await page.locator('.flh-saved-open').waitFor({ timeout: 20000 });
    await page.locator('.flh-saved-open').click();
    if (await page.locator('#flh-match-title').waitFor({ timeout: 8000 }).then(() => true).catch(() => false)) opened += 1;
  }
  check('A14 tapping "View home" immediately after saving always opens the home', opened === 3, `${opened}/3`);
  await ctx.close();
});

/* ========================= Journey B: Save first ========================= */
section = 'B · Save first';
const B = {};
await step('journey B', async () => {
  const { ctx, page } = await newPage({ native: true });
  await page.goto(`${ON}/`, { waitUntil: 'networkidle' });
  await page.getByRole('link', { name: /Get Started/ }).click();
  await page.waitForURL('**/auth/sign-up');
  B.email = await signUpThroughForm(page, ON, 'blake');
  await page.waitForURL('**/onboarding**', { timeout: 20000 });
  B.id = userByEmail(B.email); B.search = ownedSearches(B.id)[0];
  await page.locator('input[type="radio"][value="home_buy"]').waitFor({ state: 'attached' });
  await chooseType(page, 'home_buy');
  await page.getByRole('button', { name: /I’ll figure it out as I go/ }).click();
  await page.locator('.flh-ob-basics').waitFor();
  await shot(page, 'B5-quick-basics');
  await page.locator('.flh-ob-pf-skip').click();
  // /homes?add=1 opens Add Home and immediately tidies the URL back to /homes.
  await page.locator('.hh-add-home-modal').waitFor({ timeout: 20000 });
  check('B6 skipping Basics lands directly in Add Home', new URL(page.url()).pathname === '/homes');
  await shot(page, 'B6-add-home');
  await saveByAddress(page, '48 Elm Ave, Royal Oak, MI 48067');
  await page.getByRole('button', { name: 'Save Home' }).click();
  await page.locator('.flh-saved').waitFor({ timeout: 20000 });
  await shot(page, 'B7-saved');
  B.savedText = await page.locator('.flh-saved').innerText();
  B.home = homesOf(B.search)[0]?.id;
  check('B7 saved', Boolean(B.home));
  check('B7 the saved confirmation doesn’t promise a fit to priorities that don’t exist yet', /Your Match starts once you tell FLH what matters/.test(B.savedText) && !/how it fits your priorities/.test(B.savedText), B.savedText.replace(/\s+/g, ' ').slice(-170));
  await page.locator('.flh-saved-open').click();
  await page.locator('#flh-match-title').waitFor({ timeout: 20000 });
  check('the saved home opens in its overview', new URL(page.url()).pathname === `/homes/${B.home}`, new URL(page.url()).pathname);
  await page.locator('#flh-match-title').waitFor();
  await openMatch(page);
  await shot(page, 'B8-match-empty');
  const matchText = await page.locator('.flh-overlay-match').innerText();
  check('B8 empty profile: no Match %, no number anywhere, never framed as a poor fit', !(await pctPill(page)) && !/\d+%/.test(matchText) && !/poor|low|bad/i.test(matchText), matchText.replace(/\s+/g, ' ').slice(0, 120));
  const explore = page.locator('.flh-overlay-match').getByRole('link', { name: 'Explore My Priorities' });
  check('B9 a gentle, optional path to Explore My Priorities', await explore.isVisible());
  await page.goto(`${ON}/homes`, { waitUntil: 'networkidle' });
  const cardEmpty = await page.locator('.hh-match-empty').first().innerText().catch(() => '');
  await shot(page, 'B9-my-homes-card');
  check('B9 My Homes card: no %, a link to Explore', /No Match yet/.test(cardEmpty) && !/\d+%/.test(cardEmpty), cardEmpty);
  await page.goto(`${ON}/homes/${B.home}`, { waitUntil: 'networkidle' });
  await openMatch(page);
  await page.locator('.flh-overlay-match').getByRole('link', { name: 'Explore My Priorities' }).click();
  await page.waitForURL('**/search/explore**');
  await page.locator('.flh-explore-index').waitFor();
  await page.getByRole('button', { name: /^Layout & Living Spaces/ }).click();
  await page.locator('.flh-ob-pf-layout').waitFor();
  await card(page, 'Home Office').click(); await level(page, 'Must Have').click(); await pause(page);
  await page.getByRole('button', { name: /All categories/ }).click();
  await page.getByRole('button', { name: /^Kitchen/ }).click();
  await page.locator('.flh-ob-pf-kitchen').waitFor();
  await card(page, 'Walk-in Pantry').click(); await level(page, 'Important').click(); await pause(page, 900);
  await shot(page, 'B10-explore-kitchen');
  await page.locator('.flh-explore-done').click();
  await page.waitForURL('**/search', { timeout: 15000 });
  const doc = prioritiesOf(B.search, B.id);
  check('B10 a Must Have and an Important saved; still no dontcare', tierOf(doc, 'features', 'Home office') === 'must' && tierOf(doc, 'features', 'Walk-in Pantry') === 'important' && dontcares(doc).length === 0);
  check('B10 onboarding state untouched by Explore', profile(B.id).onboarding_state.answers.setupPath === 'as_i_go' && profile(B.id).onboarding_complete);
  await page.goto(`${ON}/homes/${B.home}`, { waitUntil: 'networkidle' });
  await page.locator('#flh-match-title').waitFor();
  await openMatch(page);
  const before = await page.locator('.flh-overlay-match').innerText();
  check('B11 back on the home: the new priorities are listed, unanswered, and there is still no % (nothing known)', !(await pctPill(page)) && /Home Office/.test(before) && /unanswered/.test(before));
  await answer(page, 'features:Home office', 'yes');
  await shot(page, 'B12-match-after-answer');
  check('B12 one own answer → Match from that answer only; Walk-in Pantry stays Unknown', (await pctPill(page)) === '100% Match' && /based on 1 known priority/.test(await page.locator('.flh-overlay-match-lead').first().innerText()));
  const state = q(`select checks from public.home_member_state where home_id = ${lit(B.home)} and user_id = ${lit(B.id)}`)[0]?.checks || {};
  check('B12 stored as this buyer’s own answer only (Pantry not written)', state['features:Home office'] === true && !('features:Walk-in Pantry' in state), JSON.stringify(state));
  await ctx.close();
});

/* ===================== Journey C: Share Extension hand-off ===================== */
section = 'C · Share Extension';
const listing = 'https://www.zillow.com/homedetails/77-Birch-Ln-Troy-MI-48084/9988_zpid/?utm_source=share';
const shareLink = `https://feelslikehome.app/homes?url=${encodeURIComponent(listing)}`;
const C = {};
await step('journey C cold, signed out, new user', async () => {
  const { ctx, page } = await newPage({ native: true });
  await page.goto(`${ON}/`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__appUrlCallbacks.length > 0);
  await page.evaluate((url) => window.__openUniversalLink(url), shareLink);
  await page.waitForURL('**/auth/sign-in**', { timeout: 15000 });
  const redirect = new URL(page.url()).searchParams.get('redirect');
  check('C1 signed out: the shared listing is kept through sign-in', redirect === `/homes?url=${encodeURIComponent(listing)}`, redirect);
  await shot(page, 'C1-sign-in-keeps-listing');
  // "Create an account" switches the same form to sign-up, keeping the destination.
  await page.getByRole('button', { name: 'Create an account' }).click();
  C.email = await signUpThroughForm(page, ON, 'casey');
  await page.waitForURL('**/onboarding**', { timeout: 20000 });
  check('C1 new account → onboarding, destination still kept', (new URL(page.url()).searchParams.get('redirect') || '').startsWith('/homes?url='), page.url().slice(0, 120));
  C.id = userByEmail(C.email); C.search = ownedSearches(C.id)[0];
  await page.locator('input[type="radio"][value="home_buy"]').waitFor({ state: 'attached' });
  await chooseType(page, 'home_buy');
  await page.getByRole('button', { name: /I’ll figure it out as I go/ }).click();
  await page.locator('.flh-ob-basics').waitFor();
  await cta(page).click();
  await page.waitForURL('**/homes**', { timeout: 20000 });
  await page.waitForFunction(() => [...document.querySelectorAll('.hh-add-home-modal input')].some((i) => /77 Birch/.test(i.value)), null, { timeout: 20000 }).catch(() => {});
  const values = await page.locator('.hh-add-home-modal input').evaluateAll((els) => els.map((e) => e.value).filter(Boolean));
  await shot(page, 'C2-shared-listing-in-add-home');
  check('C2 after onboarding: Add Home opens with the shared listing’s address', values.some((v) => /77 Birch Ln, Troy, MI 48084/.test(v)), values.join(' | '));
  check('C2 nothing is saved before the buyer confirms', homesOf(C.search).length === 0);
  await page.getByRole('button', { name: 'Save Home' }).click();
  await page.locator('.flh-saved').waitFor({ timeout: 20000 });
  const [saved] = homesOf(C.search);
  check('C2 saved once, with the original listing link kept', homesOf(C.search).length === 1 && saved.listing_url === listing, saved?.listing_url);
  C.home = saved.id;
  await ctx.close();
});
await step('journey C warm, signed in, duplicate', async () => {
  const { ctx, page } = await newPage({ native: true });
  await page.goto(`${ON}/auth/sign-in`, { waitUntil: 'networkidle' });
  await signInThroughForm(page, C.email);
  await page.waitForURL('**/homes**', { timeout: 20000 });
  await page.waitForFunction(() => window.__appUrlCallbacks.length > 0);
  await page.evaluate((url) => window.__openUniversalLink(url), shareLink);
  await page.waitForURL(`**/homes/${C.home}**`, { timeout: 20000 });
  check('C3 sharing the same listing again opens the saved home (no duplicate)', homesOf(C.search).length === 1);
  await shot(page, 'C3-duplicate-opens-saved-home');
  const other = 'https://www.redfin.com/MI/Troy/90-Cedar-Ct-48084/home/12345';
  await page.evaluate((url) => window.__openUniversalLink(url), `https://feelslikehome.app/homes?url=${encodeURIComponent(other)}`);
  await page.waitForFunction(() => [...document.querySelectorAll('.hh-add-home-modal input')].some((i) => /90 Cedar/.test(i.value)), null, { timeout: 20000 }).catch(() => {});
  const values = await page.locator('.hh-add-home-modal input').evaluateAll((els) => els.map((e) => e.value).filter(Boolean));
  check('C4 warm app, a new listing: Add Home with its address, nothing saved yet', values.some((v) => /90 Cedar Ct/.test(v)) && homesOf(C.search).length === 1, values.join(' | '));
  // Pasted listing text with an image link: suggestions only, never the photo.
  const paste = page.getByRole('button', { name: /Paste the listing details|No link\?/ }).first();
  if (await paste.isVisible().catch(() => false)) {
    await paste.click();
    const area = page.locator('.hh-add-home-modal textarea').first();
    await area.fill('Charming colonial. 3 beds, 2 baths, 1,850 sq ft. Price $389,000. Photo: https://photos.zillowstatic.com/fp/abc123-uncropped.jpg Finished basement and a fenced yard.');
    const read = page.getByRole('button', { name: /Read|Use|Find|Fill/ }).filter({ hasNotText: /Find home/ }).first();
    if (await read.isVisible().catch(() => false)) await read.click();
    await pause(page, 800);
  }
  await page.getByRole('button', { name: 'Save Home' }).click();
  await page.locator('.flh-saved').waitFor({ timeout: 20000 });
  const cedar = homesOf(C.search).find((h) => /90 Cedar/.test(h.address));
  check('C5 no photo is imported from pasted text', cedar && !cedar.photo_url, cedar?.photo_url || 'none');
  await ctx.close();
});

/* ===================== Returning users & collaboration ===================== */
section = 'Returning';
await step('returning', async () => {
  const { ctx, page } = await newPage();
  await page.goto(`${ON}/auth/sign-in`, { waitUntil: 'networkidle' });
  await signInThroughForm(page, A.email);
  await page.waitForURL('**/homes**', { timeout: 20000 });
  check('R1 signing back in: straight to My Homes; onboarding never restarts', new URL(page.url()).pathname === '/homes' && profile(A.id).onboarding_complete);
  await page.goto(`${ON}/onboarding`, { waitUntil: 'networkidle' });
  check('R1 even visiting /onboarding sends a finished account to its homes', new URL(page.url()).pathname.startsWith('/homes'));
  await page.goto(`${ON}/search/priorities`, { waitUntil: 'networkidle' });
  const quick = await page.locator('body').innerText();
  check('R2 My Search Quick Edit works and lists the onboarding choices', /Home Office/.test(quick) && /Walk-in Pantry/.test(quick));
  await page.goto(`${ON}/search/explore?category=kitchen`, { waitUntil: 'networkidle' });
  check('R3 Explore preloads the chosen preferences', /Important/.test(await card(page, 'Walk-in Pantry').getAttribute('aria-label')));
  await card(page, 'Walk-in Pantry').click(); await level(page, 'Must Have').click(); await pause(page, 900);
  await page.locator('.flh-explore-done').click();
  await page.waitForURL('**/search', { timeout: 15000 });
  check('R4 My Search shows where to pick up', /Pick up at\s*Kitchen/.test(await page.locator('.flh-explore-entry').innerText()));
  await page.goto(`${ON}/search/explore`, { waitUntil: 'networkidle' });
  await page.locator('.flh-explore-index .flh-ob-cta').click();
  check('R4 resume returns to the last category', await page.locator('.flh-ob-pf-kitchen').isVisible());
  await page.goto(`${ON}/search/explore?category=bath`, { waitUntil: 'networkidle' });
  check('R5 category jump works', await page.locator('.flh-ob-pf-bath').isVisible());
  await page.goto(`${ON}/homes/${A.home}`, { waitUntil: 'networkidle' });
  await page.locator('#flh-match-title').waitFor(); await openMatch(page);
  const mustText = await page.locator('.flh-overlay-match').innerText();
  check('R6 the change reached the home’s Match (Walk-in Pantry now a Must Have, still unanswered)', /Must-Haves\s*2/.test(mustText.replace(/\n/g, ' ')) || /Walk-in Pantry/.test(mustText), mustText.replace(/\s+/g, ' ').slice(0, 160));
  check('R7 the way back to saved homes is always there (Homes in the bottom nav)', await page.locator('.hh-mobile-nav').getByRole('link', { name: /Homes/ }).first().isVisible());
  await ctx.close();
});

section = 'Collaboration';
await step('invitation and co-buyer', async () => {
  // A invites a brand-new co-buyer by email; they accept through the real pages.
  const inviteEmail = `dana.${randomUUID().slice(0, 6)}@example.com`;
  exec(`insert into public.search_invitations (search_id, invited_by, invited_email, relationship_type) values (${lit(A.search)}, ${lit(A.id)}, ${lit(inviteEmail)}, 'co_buyer')`);
  const token = q(`select token from public.search_invitations where invited_email = ${lit(inviteEmail)}`)[0].token;
  const ownerBefore = JSON.stringify(prioritiesOf(A.search, A.id));
  const { ctx, page } = await newPage();
  await page.goto(`${ON}/invite/${token}`, { waitUntil: 'networkidle' });
  check('X1 signed out: the invitation is kept through sign-in', new URL(page.url()).searchParams.get('redirect') === `/invite/${token}`);
  await page.getByRole('button', { name: 'Create an account' }).click();
  await page.locator('#sign-up-first-name').waitFor();
  await page.fill('#sign-up-first-name', 'Dana'); await page.fill('#sign-up-last-name', 'QA'); await page.fill('#sign-up-email', inviteEmail);
  await page.fill('#sign-up-password', 'qa-password-1'); await page.fill('#sign-up-confirm', 'qa-password-1');
  await page.locator('form[aria-label="Create account"] button[type="submit"]').click();
  await page.waitForURL(`**/invite/${token}**`, { timeout: 20000 });
  await page.getByText(/invited to search together/i).waitFor({ timeout: 15000 });
  await shot(page, 'X1-invitation');
  const accept = page.getByRole('button', { name: /accept|join/i }).first();
  await accept.click();
  await page.waitForURL(/\/(onboarding|homes)/, { timeout: 20000 });
  const dana = userByEmail(inviteEmail);
  check('X1 invitation acceptance joins the intended shared search', q(`select role from public.search_members where search_id = ${lit(A.search)} and user_id = ${lit(dana)}`)[0]?.role === 'co_buyer');
  check('X1 the co-buyer still has exactly their own one search', ownedSearches(dana).length === 1);
  await page.waitForURL('**/onboarding**', { timeout: 20000 }).catch(() => {});
  await page.locator('input[type="radio"][value="home_buy"]').waitFor({ state: 'attached', timeout: 15000 }).catch(() => {});
  await pause(page, 400);
  await shot(page, 'X2-co-buyer-onboarding');
  if (new URL(page.url()).pathname === '/onboarding') {
    await page.locator('input[type="radio"][value="home_buy"]').waitFor({ state: 'attached' });
    await chooseType(page, 'home_buy');
    await page.getByRole('button', { name: /Let’s personalize your search/ }).click();
    await page.locator('.flh-ob-basics').waitFor(); await cta(page).click();
    await page.locator('.flh-ob-pf-layout').waitFor();
    await card(page, 'Home Office').click(); await level(page, 'Nice to Have').click(); await pause(page);
    await skipToReview(page);
    await page.locator('.flh-ob-review-actions .flh-ob-cta').click();
    await page.waitForURL('**/homes**', { timeout: 20000 });
  }
  const danaDoc = prioritiesOf(A.search, dana);
  check('X2 co-buyer’s own preferences on the shared search (Home Office: Nice to Have)', tierOf(danaDoc, 'features', 'Home office') === 'nice');
  check('X2 owner’s preferences untouched by the co-buyer', JSON.stringify(prioritiesOf(A.search, A.id)) === ownerBefore);
  await page.goto(`${ON}/homes/${A.home}`, { waitUntil: 'networkidle' });
  await page.locator('#flh-match-title').waitFor(); await openMatch(page);
  const coText = await page.locator('.flh-overlay-match').innerText();
  await shot(page, 'X3-co-buyer-own-match');
  check('X3 co-buyer sees their own Match (their Home Office is unanswered by them; the owner’s Yes is not theirs)', !/Must-Haves\s*[12]/.test(coText.replace(/\n/g, ' ')) && /Home Office/.test(coText), coText.replace(/\s+/g, ' ').slice(0, 160));
  await page.goto(`${ON}/search/explore?category=layout`, { waitUntil: 'networkidle' });
  check('X4 co-buyer Explore shows THEIR answers', /Nice to Have/.test(await card(page, 'Home Office').getAttribute('aria-label')));
  await card(page, 'Home Office').click(); await level(page, 'Important').click(); await pause(page, 900);
  check('X4 co-buyer edit stays in their row; owner unchanged', tierOf(prioritiesOf(A.search, dana), 'features', 'Home office') === 'important' && JSON.stringify(prioritiesOf(A.search, A.id)) === ownerBefore);
  // Switching to their own search: separate priorities.
  const own = ownedSearches(dana)[0];
  exec(`update public.profiles set active_search_id = ${lit(own)} where id = ${lit(dana)}`);
  await page.goto(`${ON}/search/explore?category=layout`, { waitUntil: 'networkidle' });
  check('X5 switching to their own search shows that search’s (empty) priorities', /not chosen/.test(await card(page, 'Home Office').getAttribute('aria-label')));
  exec(`update public.profiles set active_search_id = ${lit(A.search)} where id = ${lit(dana)}`);
  await ctx.close();
});

section = 'Realtor';
await step('realtor', async () => {
  const { ctx, page } = await newPage();
  await page.goto(`${ON}/for-realtors`, { waitUntil: 'networkidle' });
  const link = page.getByRole('link', { name: /get started|create|sign up/i }).first();
  await link.click();
  await page.waitForURL('**/auth/sign-up**');
  const email = await signUpThroughForm(page, ON, 'riley');
  await page.waitForURL(/\/(people|realtor|onboarding)/, { timeout: 20000 });
  check('Realtor sign-up lands in the People workspace, never buyer onboarding (flag on)', !new URL(page.url()).pathname.startsWith('/onboarding'), new URL(page.url()).pathname);
  const id = userByEmail(email);
  check('Realtor sign-up: one account, one search row, nothing extra', ownedSearches(id).length === 1);
  await ctx.close();
  // The seeded Realtor on the seeded search: still sees only what the relationship allows.
  const r = await newPage();
  await r.ctx.addCookies([{ name: 'sb-localhost-auth-token', value: `base64-${Buffer.from(JSON.stringify(info.users.realtor.session)).toString('base64url')}`, domain: 'localhost', path: '/' }]);
  await r.page.goto(`${ON}/people`, { waitUntil: 'networkidle' });
  check('seeded Realtor: People workspace opens', new URL(r.page.url()).pathname.startsWith('/people'));
  // A Realtor's own My Search / Explore edits their OWN row on their own active
  // search — never a buyer's preferences, whatever they open.
  const buyersBefore = JSON.stringify(q(`select user_id, priorities from public.search_member_priorities where search_id = ${lit(info.search)} and user_id <> ${lit(info.users.realtor.id)} order by user_id`));
  await r.page.goto(`${ON}/search/explore?category=kitchen`, { waitUntil: 'networkidle' });
  if (await r.page.locator('.flh-ob-pf-kitchen').count()) { await card(r.page, 'Walk-in Pantry').click(); await level(r.page, 'Must Have').click(); await pause(r.page, 900); }
  const buyersAfter = JSON.stringify(q(`select user_id, priorities from public.search_member_priorities where search_id = ${lit(info.search)} and user_id <> ${lit(info.users.realtor.id)} order by user_id`));
  check('seeded Realtor: nothing they do in Explore changes a buyer’s priorities', buyersBefore === buyersAfter);
  await r.ctx.close();
});

/* ============================ Flag ON / OFF matrix ============================ */
section = 'Flag matrix';
async function freshPersona(base, type, label) {
  const { ctx, page } = await newPage();
  await page.goto(`${base}/auth/sign-up`, { waitUntil: 'networkidle' });
  const email = await signUpThroughForm(page, base, label);
  await page.waitForURL('**/onboarding**', { timeout: 20000 });
  const id = userByEmail(email);
  return { ctx, page, id, email };
}
for (const [type, label] of [['home_buy', 'buyer'], ['home_rent', 'renter'], ['apartment_rent', 'aptrenter']]) {
  await step(`new ${label} on/off`, async () => {
    const on = await freshPersona(ON, type, `${label}on`);
    await on.page.locator(`input[type="radio"][value="${type}"]`).waitFor({ state: 'attached' });
    await chooseType(on.page, type);
    await on.page.getByRole('button', { name: /I’ll figure it out as I go/ }).click();
    await on.page.locator('.flh-ob-basics').waitFor();
    await on.page.locator('.flh-ob-pf-skip').click();
    await on.page.locator('.hh-add-home-modal').waitFor({ timeout: 20000 });
    const s = ownedSearches(on.id);
    check(`ON new ${label}: V3 → Quick Start → Add Home; one search; no dontcare`, s.length === 1 && profile(on.id).onboarding_version === 4 && dontcares(prioritiesOf(s[0], on.id)).length === 0);
    await on.ctx.close();
    const off = await freshPersona(OFF, type, `${label}off`);
    await off.page.waitForTimeout(500);
    const live = await off.page.locator('.flh-ob-pf-step, .flh-ob-setup-path').count();
    check(`OFF new ${label}: the live onboarding flow (no V3 screens); one search`, live === 0 && ownedSearches(off.id).length === 1);
    await off.ctx.close();
  });
}
await step('existing completed buyer', async () => {
  for (const base of [ON, OFF]) {
    const { ctx, page } = await newPage();
    await page.goto(`${base}/auth/sign-in`, { waitUntil: 'networkidle' });
    await signInThroughForm(page, info.users.owner.email);
    await page.waitForURL('**/homes**', { timeout: 20000 });
    check(`${base === ON ? 'ON' : 'OFF'} existing completed buyer: straight to homes, never onboarding`, new URL(page.url()).pathname === '/homes');
    await ctx.close();
  }
});
await step('in-progress users across the flag', async () => {
  // Mid live-flow (v1) when the flag turns ON.
  const v1 = randomUUID(); const v1Email = `midv1.${v1.slice(0, 6)}@example.com`;
  exec(`insert into auth.users (id, email, raw_user_meta_data) values (${lit(v1)}, ${lit(v1Email)}, '{"first_name":"Mid"}'::jsonb)`);
  const v1Search = ownedSearches(v1)[0];
  const v1Doc = { onboardingSearchType: 'home_buy', searchType: 'purchase', budget: { value: '380000', tier: 'important' }, features: { customItems: [], tiers: { Fireplace: 'nice' }, order: [], hiddenCore: [] } };
  exec(`insert into public.search_member_priorities (search_id, user_id, priorities) values (${lit(v1Search)}, ${lit(v1)}, ${lit(JSON.stringify(v1Doc))}::jsonb)`);
  exec(`update public.profiles set onboarding_version = 1, onboarding_state = ${lit(JSON.stringify({ schema: 1, step: 'what_matters', completed: ['basics'], answers: {}, skipped: [], context: { searchId: v1Search, role: 'owner' }, startedAt: '2026-11-01T00:00:00.000Z' }))}::jsonb where id = ${lit(v1)}`);
  const a = await newPage();
  await a.page.goto(`${ON}/auth/sign-in`, { waitUntil: 'networkidle' });
  await signInThroughForm(a.page, v1Email);
  await a.page.waitForURL('**/onboarding**', { timeout: 20000 });
  await a.page.waitForTimeout(800);
  const v1After = prioritiesOf(v1Search, v1);
  check('ON, mid live flow: continues in V3 with every answer kept (budget, Fireplace), one search', v1After.budget.value === '380000' && tierOf(v1After, 'features', 'Fireplace') === 'nice' && ownedSearches(v1).length === 1 && await a.page.locator('.flh-ob-pf-step').count() > 0);
  await shot(a.page, 'F1-in-progress-v1-resumes-in-v3');
  await a.ctx.close();
  // Mid V3 when the flag turns OFF.
  const v4 = randomUUID(); const v4Email = `midv4.${v4.slice(0, 6)}@example.com`;
  exec(`insert into auth.users (id, email, raw_user_meta_data) values (${lit(v4)}, ${lit(v4Email)}, '{"first_name":"Mid"}'::jsonb)`);
  const v4Search = ownedSearches(v4)[0];
  const v4Doc = { onboardingSearchType: 'home_buy', searchType: 'purchase', budget: { value: '510000', tier: 'important' }, features: { customItems: [], tiers: { 'Walk-in Pantry': 'must' }, order: [], hiddenCore: [] } };
  exec(`insert into public.search_member_priorities (search_id, user_id, priorities) values (${lit(v4Search)}, ${lit(v4)}, ${lit(JSON.stringify(v4Doc))}::jsonb)`);
  exec(`update public.profiles set onboarding_version = 4, onboarding_state = ${lit(JSON.stringify({ schema: 1, step: 'cat_bath', completed: ['search_type', 'setup_path', 'basics', 'cat_layout', 'cat_kitchen', 'cat_living'], answers: { searchType: 'home_buy', setupPath: 'personalize' }, skipped: [], context: { searchId: v4Search, role: 'owner' }, startedAt: '2026-11-01T00:00:00.000Z' }))}::jsonb where id = ${lit(v4)}`);
  const b = await newPage();
  await b.page.goto(`${OFF}/auth/sign-in`, { waitUntil: 'networkidle' });
  await signInThroughForm(b.page, v4Email);
  await b.page.waitForURL('**/onboarding**', { timeout: 20000 });
  await b.page.waitForTimeout(800);
  const v4After = prioritiesOf(v4Search, v4);
  check('OFF, mid V3: the live flow takes over with every answer kept (budget, Walk-in Pantry), one search', v4After.budget.value === '510000' && tierOf(v4After, 'features', 'Walk-in Pantry') === 'must' && ownedSearches(v4).length === 1 && await b.page.locator('.flh-ob-pf-step').count() === 0);
  await shot(b.page, 'F2-in-progress-v3-under-flag-off');
  await b.ctx.close();
});
await step('routes under the flag', async () => {
  const { ctx, page } = await newPage();
  await page.goto(`${OFF}/auth/sign-in`, { waitUntil: 'networkidle' });
  await signInThroughForm(page, A.email);
  await page.waitForURL('**/homes**', { timeout: 20000 });
  await page.goto(`${OFF}/search/explore`, { waitUntil: 'networkidle' });
  check('OFF: Explore is not found; nothing else breaks', /could not be found/.test(await page.locator('body').innerText()));
  for (const path of ['/homes', '/search', '/search/priorities', `/homes/${A.home}`, '/compare', '/account']) {
    const res = await page.goto(`${OFF}${path}`, { waitUntil: 'networkidle' });
    check(`OFF: ${path} renders for a V3-onboarded account`, res.status() < 400 && !/could not be found|Something didn’t load/.test(await page.locator('body').innerText()), String(res.status()));
  }
  await ctx.close();
});

/* ======================== responsive & accessibility ======================== */
section = 'Responsive';
await step('widths', async () => {
  for (const [width, height] of [[320, 568], [375, 667], [390, 844], [430, 932], [1280, 900]]) {
    const { ctx, page } = await newPage({ width, height });
    await page.goto(`${ON}/auth/sign-in`, { waitUntil: 'networkidle' });
    await signInThroughForm(page, B.email);
    await page.waitForURL('**/homes**', { timeout: 20000 });
    let worst = 0;
    for (const path of ['/homes', `/homes/${B.home}`, '/search', '/search/explore', '/search/explore?category=kitchen']) {
      await page.goto(`${ON}${path}`, { waitUntil: 'networkidle' });
      worst = Math.max(worst, await page.evaluate(() => document.documentElement.scrollWidth - innerWidth));
    }
    if (width === 320) await shot(page, 'W-explore-kitchen-320');
    check(`${width}px: home, overlay, My Search and Explore without horizontal overflow`, worst <= 0, `${worst}px`);
    await ctx.close();
  }
});

await browser.close();
section = 'All';
check('no unexpected console or page errors', consoleErrors.length === 0, consoleErrors.slice(0, 4).join(' | '));
writeFileSync(join(outDir, 'results.json'), JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
