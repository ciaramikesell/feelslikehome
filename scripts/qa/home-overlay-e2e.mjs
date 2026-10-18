#!/usr/bin/env node
// Full-stack QA for the home overlay (Phase 2). DEVELOPMENT ONLY.
//
//   1. FLH_TEST_PGHOST=… FLH_TEST_PGPORT=… node scripts/qa/supabase-standin.mjs 54321 > standin.json
//   2. NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=qa RENTCAST_API_KEY=qa \
//        NODE_OPTIONS="--import ./scripts/qa/rentcast-fixture.mjs" npx next dev -p 3200
//   3. FLH_TEST_PGHOST=… FLH_TEST_PGPORT=… node scripts/qa/home-overlay-e2e.mjs standin.json <outDir> [baseUrl]
//
// Drives the real app in Chromium as the owner, the co-buyer and the Realtor
// against real Postgres (RLS, column grants, triggers) and checks the
// database's ground truth after each step. Every failed step, horizontal
// overflow or unexpected console error fails the run. Screenshots land in
// <outDir> (widths in the file names) with a results.json log.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { register } from 'node:module';
import { chromium } from 'playwright';

register('../../test/support/aliasHooks.mjs', import.meta.url);
const { normalizePriorities } = await import('../../src/lib/constants.js');
const { applySearchChoice } = await import('../../src/lib/onboarding.js');
const { addCriterion } = await import('../../src/lib/searchProfile.js');

const [infoPath, outArg, base = 'http://localhost:3200'] = process.argv.slice(2);
if (!infoPath || !outArg) throw new Error('Usage: home-overlay-e2e.mjs <standin.json> <outDir> [baseUrl]');
const info = JSON.parse(readFileSync(infoPath, 'utf8').split('\n')[0]);
const outDir = resolve(outArg);
mkdirSync(outDir, { recursive: true });
const LISTING = 'https://www.zillow.com/homedetails/51613-Sass-Rd-New-Baltimore-MI-48047/12345_zpid/';
// Steps that abort a request on purpose log the failure; those lines are expected.
const IGNORED_CONSOLE = /ERR_CONNECTION_RESET|ERR_FAILED|Failed to fetch|saveHome failed|Save home failed|Autosave of|Download the React DevTools|favicon|maps\.googleapis|Google Maps|places|Failed to load resource/i;
const OWNER = info.users.owner.id;
const CO = info.users.coBuyer.id;

function psql(sql) {
  const result = spawnSync('psql', ['-X', '-q', '-A', '-t', '-h', process.env.FLH_TEST_PGHOST, '-p', process.env.FLH_TEST_PGPORT || '5432', '-U', 'postgres', '-d', info.database, '-c', sql], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
}
const q = (sql) => JSON.parse(psql(`select coalesce(json_agg(t), '[]'::json) from (${sql}) t`));
const lit = (value) => `'${String(value).replace(/'/g, "''")}'`;
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const log = [];
const waitFor = async (fn, message, timeout = 10000) => {
  const until = Date.now() + timeout;
  for (;;) { if (await fn()) return; if (Date.now() > until) throw new Error(message); await new Promise((r) => setTimeout(r, 150)); }
};

async function signedIn(browser, who, width) {
  const context = await browser.newContext({ viewport: { width, height: width < 500 ? 844 : 900 } });
  await context.addCookies([{ name: 'sb-localhost-auth-token', value: `base64-${Buffer.from(JSON.stringify(info.users[who].session)).toString('base64url')}`, domain: 'localhost', path: '/' }]);
  await context.addInitScript(() => { try { localStorage.setItem('flh-mobile-tour-dismissed', '1'); } catch { /* ignore */ } });
  const page = await context.newPage();
  page.errors = [];
  page.on('pageerror', (error) => page.errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error' && !IGNORED_CONSOLE.test(message.text())) page.errors.push(message.text().slice(0, 400)); });
  return page;
}

async function shot(page, name, { full = false, tall = 0 } = {}) {
  if (tall) await page.setViewportSize({ width: page.viewportSize().width, height: tall });
  await page.waitForTimeout(300);
  const overflow = await page.evaluate(() => Math.max(document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ...[...document.querySelectorAll('.flh-overlay-scroll')].map((node) => node.scrollWidth - node.clientWidth)));
  await page.screenshot({ path: join(outDir, `${name}.png`), fullPage: full });
  if (tall) await page.setViewportSize({ width: page.viewportSize().width, height: page.viewportSize().width < 500 ? 844 : 900 });
  assert(overflow <= 0, `${name}: horizontal overflow ${overflow}px`);
}

async function step(name, fn, pages = []) {
  const started = Date.now();
  try {
    await fn();
    const errors = pages.flatMap((page) => page.errors.splice(0));
    if (errors.length) throw new Error(`console errors: ${errors.join(' | ')}`);
    log.push({ step: name, ok: true, ms: Date.now() - started }); console.log('ok  ', name);
  } catch (error) { log.push({ step: name, ok: false, error: error.message }); console.error('FAIL', name, '—', error.message); }
}

const dialog = (page) => page.locator('.flh-overlay[role="dialog"]:not(.is-loading)');
const overlayOpen = async (page) => { await dialog(page).waitFor({ timeout: 30000 }); await page.getByRole('status').filter({ hasText: /Saved/ }).first().waitFor(); await expandAll(page); };
const saved = (page) => page.locator('.flh-overlay-save').filter({ hasText: /^\s*Saved\s*$/ }).waitFor({ timeout: 15000 });
// Phones collapse the photo options, year/taxes/utilities and schools: open them.
const expandAll = async (page) => {
  for (let i = 0; i < 8; i += 1) {
    const toggle = page.locator('.flh-phone-collapse-toggle[aria-expanded="false"]:visible').first();
    if (!(await toggle.count())) return;
    await toggle.click();
  }
};
// Phones collapse Important and Nice to Have: open whichever are still closed.
const showTiers = async (page) => {
  for (let i = 0; i < 4; i += 1) {
    const toggle = page.locator('.flh-mc2-toggle[aria-expanded="false"]:visible').first();
    if (!(await toggle.count())) return;
    await toggle.click();
    await page.waitForTimeout(100);
  }
};
const closeOverlay = async (page) => { await page.getByRole('button', { name: 'Close', exact: true }).click(); await dialog(page).waitFor({ state: 'detached', timeout: 20000 }); };
const answer = (page, criterion, choice) => page.locator('fieldset.flh-mc2-answer', { has: page.locator('legend', { hasText: new RegExp(`^${criterion}$`, 'i') }) }).locator('label', { hasText: new RegExp(`^${choice}$`) }).click();
const pct = async (page) => Number((await page.locator('.flh-match-pill').textContent()).match(/\d+/)[0]);
const home = (id, columns = '*') => q(`select ${columns} from public.homes where id = '${id}'`)[0];
const state = (id, user) => q(`select status, checks, ratings, reaction, rejection_reason from public.home_member_state where home_id = '${id}' and user_id = '${user}'`)[0];

async function addFromListing(page, url) {
  await page.goto(`${base}/homes`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /Add a Home/ }).first().click();
  await page.getByLabel('Listing link or address').fill(url);
  await page.getByRole('button', { name: /^Find home$/ }).click();
}

async function run() {
  const browser = await chromium.launch();
  const legacyId = info.legacyHomeId;
  // Existing Tour Feedback on the older home: shared notes / pros / cons and
  // the owner's own reaction, survey answers and in-person criterion.
  psql(`update public.homes set notes = 'Loved the light in the den.', pros = 'Big yard, quiet street', cons = 'Small kitchen' where id = '${legacyId}'`);
  psql(`update public.home_member_state set status = 'Toured', toured_at = now() - interval '1 day', reaction = 'love', ratings = '{"tour-v2:light": "positive", "homeFeel:Natural Light": "positive"}'::jsonb where home_id = '${legacyId}' and user_id = '${OWNER}'`);
  const tourBefore = JSON.stringify([home(legacyId, 'notes, pros, cons'), state(legacyId, OWNER)]);
  psql(`delete from public.homes where search_id = '${info.search}' and id <> '${legacyId}'`);

  for (const width of [1440, 390]) {
    const tag = (name) => `${name}-${width}`;
    const owner = await signedIn(browser, 'owner', width);
    psql(`delete from public.homes where search_id = '${info.search}' and id <> '${legacyId}'`);
    let homeId = null;

    await step(`[${width}] 1. Find home → one Add (double-click) → persisted once → overlay opens over My Homes`, async () => {
      await addFromListing(owner, LISTING);
      await owner.getByText('We found your home', { exact: false }).first().waitFor();
      assert(q(`select id from public.homes where listing_url = ${lit(LISTING)}`).length === 0, 'saved before Add');
      await owner.getByRole('button', { name: 'Add to My Homes' }).dblclick();
      await owner.waitForURL(/\/homes\/[0-9a-f-]{36}$/, { timeout: 60000 });
      await overlayOpen(owner);
      homeId = owner.url().match(/homes\/([0-9a-f-]{36})/)[1];
      const rows = q(`select id from public.homes where listing_url = ${lit(LISTING)}`);
      assert(rows.length === 1 && rows[0].id === homeId, `expected one saved home, found ${rows.length}`);
      assert(q(`select 1 from public.home_member_state where home_id = '${homeId}' and user_id = '${OWNER}'`).length === 1, 'personal state row missing');
      const row = home(homeId, 'price, heating, garage_type, laundry_location, listing_id');
      assert(row.price === '335000' && row.heating === 'Forced Air' && row.garage_type === 'attached' && row.laundry_location === 'first_floor', `imported values: ${JSON.stringify(row)}`);
      // My Homes stays mounted underneath (filters and scroll survive).
      assert(await owner.locator('.hh-homes-grid').count() === 1, 'My Homes is not under the overlay');
      assert(await owner.getByText('Home Facts', { exact: true }).count() && await owner.getByText('Your Match', { exact: true }).count(), 'not one continuous overlay');
      assert(!(await owner.getByRole('tab').count()), 'overlay has tabs');
      assert(await owner.locator('#hf-laundryLocation').inputValue() === 'first_floor', 'imported laundry location not shown');
      await shot(owner, tag('01-overlay-imported'));
      await shot(owner, tag('01b-overlay-imported-full'), { tall: width < 500 ? 2600 : 2300 });
    }, [owner]);

    await step(`[${width}] 2. Close without edits → home stays in My Homes (Back, Forward, reload)`, async () => {
      await closeOverlay(owner);
      await owner.waitForURL(/\/homes$/);
      await owner.locator('.hh-home-card', { hasText: '51613 Sass Rd' }).waitFor({ timeout: 15000 });
      await owner.goForward();
      await overlayOpen(owner);
      await owner.goBack();
      await dialog(owner).waitFor({ state: 'detached' });
      await owner.locator('.hh-home-card', { hasText: '51613 Sass Rd' }).waitFor();
      await owner.reload({ waitUntil: 'networkidle' });
      await owner.locator('.hh-home-card', { hasText: '51613 Sass Rd' }).waitFor();
      await shot(owner, tag('02-my-homes-after-close'));
    }, [owner]);

    await step(`[${width}] 3. Open from the card → edit facts → close → reopen → persisted; filters and scroll kept`, async () => {
      await owner.getByRole('button', { name: /Want to Tour \(/ }).click();
      await owner.getByRole('button', { name: /^All \(/ }).click();
      await owner.evaluate(() => window.scrollTo(0, 220));
      const scrollBefore = await owner.evaluate(() => window.scrollY);
      await owner.locator('.hh-home-card', { hasText: '51613 Sass Rd' }).getByRole('button', { name: 'Edit' }).click();
      await overlayOpen(owner);
      await owner.locator('#hf-yearBuilt').fill('1994');
      await owner.locator('#hf-yearBuilt').press('Tab');
      await owner.locator('#hf-propertyType').selectOption('condo');
      await owner.locator('#hf-elementarySchool').fill('Green Elementary');
      await saved(owner);
      await closeOverlay(owner);
      assert(Math.abs((await owner.evaluate(() => window.scrollY)) - scrollBefore) < 5, 'scroll position lost');
      const row = home(homeId, 'year_built, property_type, elementary_school');
      assert(row.year_built === '1994' && row.property_type === 'condo' && row.elementary_school === 'Green Elementary', `not persisted: ${JSON.stringify(row)}`);
      await owner.locator('.hh-home-card', { hasText: '51613 Sass Rd' }).getByRole('link').first().click();
      await overlayOpen(owner);
      assert(await owner.locator('#hf-yearBuilt').inputValue() === '1994', 'reopened without the saved year');
      assert(await owner.locator('#hf-propertyType').inputValue() === 'condo', 'reopened without the saved type');
    }, [owner]);

    await step(`[${width}] 4. Personal Match answers update the score without a reload`, async () => {
      const before = await pct(owner);
      await showTiers(owner);
      await answer(owner, 'Finished basement', 'No');
      await saved(owner);
      const after = await pct(owner);
      assert(after < before, `Match did not drop (${before} → ${after})`);
      assert(state(homeId, OWNER).checks['features:Finished basement'] === 'no', 'personal answer not saved');
      await answer(owner, 'Finished basement', 'Yes');
      await saved(owner);
      assert(await pct(owner) > after, 'Match did not rise');
      await answer(owner, 'Finished basement', 'Unknown');
      await saved(owner);
      assert(!('features:Finished basement' in state(homeId, OWNER).checks), 'Unknown did not clear the answer');
      await shot(owner, tag('04-match-answers'), { tall: width < 500 ? 2600 : 2300 });
    }, [owner]);

    await step(`[${width}] 7/8. Laundry Location and garage/basement: Unknown and None stay distinct`, async () => {
      await owner.locator('#hf-laundryLocation').selectOption('basement');
      await owner.locator('#hf-garageType').selectOption('none');
      await saved(owner);
      let row = home(homeId, 'laundry_location, garage_type, garage_spaces, in_unit_laundry');
      assert(row.laundry_location === 'basement' && row.garage_type === 'none' && row.garage_spaces === '0' && row.in_unit_laundry === null, `None/laundry: ${JSON.stringify(row)}`);
      assert(await owner.locator('#hf-garageSpaces').inputValue() === '0', 'spaces did not follow None');
      await owner.locator('#hf-garageType').selectOption('');
      await owner.locator('#hf-laundryLocation').selectOption('');
      await saved(owner);
      row = home(homeId, 'laundry_location, garage_type, garage_spaces');
      assert(row.laundry_location === null && row.garage_type === null && row.garage_spaces === '0', `Unknown: ${JSON.stringify(row)}`);
      await owner.locator('#hf-laundryLocation').selectOption('basement');
      await saved(owner);
      await owner.reload({ waitUntil: 'networkidle' });
      await overlayOpen(owner);
      assert(await owner.locator('#hf-laundryLocation').inputValue() === 'basement', 'laundry did not survive reload');
    }, [owner]);

    await step(`[${width}] 9. Rapid changes keep the last value; a failed save shows Retry and close waits`, async () => {
      for (const value of ['house', 'multifamily', 'condo', 'house']) await owner.locator('#hf-propertyType').selectOption(value);
      const est = owner.locator('#hf-estMonthly');
      await est.click();
      for (const text of ['2', '25', '257', '2574']) { await est.fill(text); await owner.waitForTimeout(120); }
      await est.press('Tab');
      await saved(owner);
      let row = home(homeId, 'property_type, est_monthly');
      assert(row.property_type === 'house' && row.est_monthly === '2574', `rapid changes lost: ${JSON.stringify(row)}`);
      // The next shared write fails at the network.
      let failNext = true;
      await owner.route('**/rest/v1/homes**', (route) => { if (failNext && route.request().method() === 'PATCH') { failNext = false; return route.abort('connectionreset'); } return route.continue(); });
      await owner.locator('#hf-highSchool').fill('Anchor Bay High');
      await owner.locator('#hf-highSchool').press('Tab');
      await owner.getByText('Couldn’t save').first().waitFor({ timeout: 15000 });
      assert(await owner.locator('#hf-highSchool').inputValue() === 'Anchor Bay High', 'the failed edit vanished from the field');
      await shot(owner, tag('09-save-failed'));
      // Close is held while something is unsaved; Retry saves it.
      await owner.getByRole('button', { name: 'Close', exact: true }).click();
      await owner.getByText('Some changes couldn’t be saved.').waitFor();
      await shot(owner, tag('09b-close-blocked'));
      await owner.getByRole('button', { name: 'Retry', exact: true }).first().click();
      await saved(owner);
      row = home(homeId, 'high_school');
      assert(row.high_school === 'Anchor Bay High', 'retry did not save');
      await owner.unroute('**/rest/v1/homes**');
      // Closing straight after typing (no blur, no pause) still saves.
      await owner.locator('#hf-middleSchool').fill('Anchor Bay Middle');
      await closeOverlay(owner);
      assert(home(homeId, 'middle_school').middle_school === 'Anchor Bay Middle', 'close dropped a pending edit');
    }, [owner]);

    await step(`[${width}] 10. Direct links, reload, legacy ?section= and ?home= links`, async () => {
      await owner.goto(`${base}/homes/${homeId}`, { waitUntil: 'networkidle' });
      await overlayOpen(owner);
      await owner.reload({ waitUntil: 'networkidle' });
      await overlayOpen(owner);
      await owner.goto(`${base}/homes/${homeId}?section=match`, { waitUntil: 'networkidle' });
      await overlayOpen(owner);
      await waitFor(() => owner.evaluate(() => !location.search.includes('section')), 'section=match not settled');
      await owner.goto(`${base}/homes/${homeId}?section=tour`, { waitUntil: 'networkidle' });
      await owner.getByRole('heading', { name: /Tour Feedback ·/ }).waitFor();
      await owner.goto(`${base}/homes?home=${homeId}`, { waitUntil: 'networkidle' });
      await owner.waitForURL(new RegExp(`/homes/${homeId}$`));
      await overlayOpen(owner);
      await owner.keyboard.press('Escape');
      await dialog(owner).waitFor({ state: 'detached' });
    }, [owner]);

    await step(`[${width}] 11. Duplicate URL, manual entry, interrupted save and iOS share intake`, async () => {
      await addFromListing(owner, LISTING);
      await owner.getByText('This home is already here').waitFor();
      await owner.getByRole('button', { name: 'Close add home' }).click();
      assert(q(`select id from public.homes where listing_url = ${lit(LISTING)}`).length === 1, 'duplicate created');
      // Manual entry, with the first personal-state write interrupted.
      await owner.goto(`${base}/homes`, { waitUntil: 'networkidle' });
      await owner.getByRole('button', { name: /Add a Home/ }).first().click();
      await owner.getByText(/Can.t find the home\?/).click();
      await owner.getByRole('button', { name: 'Enter manually' }).click();
      const address = `9 Manual Way ${width}, Chesterfield, MI 48051`;
      await owner.locator('#found-home-address').fill(address);
      let interrupt = true;
      await owner.route('**/rest/v1/home_member_state**', (route) => { if (interrupt && route.request().method() === 'POST') { interrupt = false; return route.abort('connectionreset'); } return route.continue(); });
      await owner.getByRole('button', { name: 'Add to My Homes' }).click();
      await owner.getByText(/We couldn.t save this home/).waitFor({ timeout: 20000 });
      await owner.getByRole('button', { name: 'Add to My Homes' }).click();
      await owner.waitForURL(/\/homes\/[0-9a-f-]{36}$/, { timeout: 60000 });
      await overlayOpen(owner);
      await owner.unroute('**/rest/v1/home_member_state**');
      assert(q(`select id from public.homes where address = ${lit(address)}`).length === 1, 'interrupted save duplicated the home');
      await shot(owner, tag('11-manual-many-unknown'), { tall: width < 500 ? 2400 : 2100 });
      await closeOverlay(owner);
      // iOS share intake of a new listing.
      const shared = `https://www.redfin.com/MI/New-Baltimore/42-Shared-Ct-${width}-48047/home/42`;
      await owner.goto(`${base}/homes?url=${encodeURIComponent(shared)}`, { waitUntil: 'networkidle' });
      await owner.getByRole('button', { name: 'Add to My Homes' }).waitFor({ timeout: 30000 });
      await owner.getByRole('button', { name: 'Add to My Homes' }).click();
      await owner.waitForURL(/\/homes\/[0-9a-f-]{36}$/, { timeout: 60000 });
      await overlayOpen(owner);
      assert(q(`select id from public.homes where listing_url = ${lit(shared)}`).length === 1, 'share intake did not save exactly once');
      // Share intake of a listing already saved opens it.
      await owner.goto(`${base}/homes?url=${encodeURIComponent(LISTING)}`, { waitUntil: 'networkidle' });
      await owner.waitForURL(new RegExp(`/homes/${homeId}$`));
      await overlayOpen(owner);
    }, [owner]);

    await step(`[${width}] 12/13. Older saved home opens; Tour Feedback data intact and still reachable`, async () => {
      await owner.goto(`${base}/homes/${legacyId}`, { waitUntil: 'networkidle' });
      await overlayOpen(owner);
      assert(await owner.locator('#hf-garageSpaces').inputValue() === '3+', 'legacy 4-car garage not shown as 3+');
      assert(await owner.getByText('Listing says: Forced air').count(), 'legacy listing hint missing');
      await owner.locator('#hf-yearBuilt').focus();
      await owner.locator('#hf-lotSize').focus();
      await owner.locator('#hf-lotSize').blur();
      await owner.waitForTimeout(1200);
      assert(home(legacyId, 'lot_size, garage_spaces').lot_size === '8712 sq ft', 'viewing rewrote a legacy value');
      await shot(owner, tag('12-legacy-home'), { tall: width < 500 ? 2400 : 2200 });
      await owner.getByRole('button', { name: /Tour feedback & notes/ }).click();
      await owner.getByText('Big yard, quiet street').first().waitFor();
      await owner.getByText('Loved the light in the den.').first().waitFor();
      await shot(owner, tag('13-tour-feedback'));
      assert(new URL(owner.url()).searchParams.get('section') === 'tour', 'tour view not in the URL');
      await owner.getByRole('button', { name: 'Home details' }).click();
      await overlayOpen(owner);
      await closeOverlay(owner);
      assert(JSON.stringify([home(legacyId, 'notes, pros, cons'), state(legacyId, OWNER)]) === tourBefore, 'Tour Feedback data changed');
    }, [owner]);

    await step(`[${width}] 14. Photo upload (Storage stand-in) and Photo URL`, async () => {
      await owner.goto(`${base}/homes/${homeId}`, { waitUntil: 'networkidle' });
      await overlayOpen(owner);
      const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVR42mN8w8Dwn4GBgYGJgQEKAD4yAf8gKk7NAAAAAElFTkSuQmCC', 'base64');
      await owner.locator('input[type="file"]').setInputFiles({ name: 'home.png', mimeType: 'image/png', buffer: png });
      await waitFor(() => /home-photos/.test(home(homeId, 'photo_url').photo_url || ''), 'upload never saved', 20000);
      await saved(owner);
      const uploaded = home(homeId, 'photo_url').photo_url;
      assert(/\/storage\/v1\/object\/public\/home-photos\//.test(uploaded), `upload not saved: ${uploaded}`);
      await waitFor(() => owner.locator('.flh-hf2-photo img').evaluate((img) => img.complete && img.naturalWidth > 0).catch(() => false), 'uploaded photo did not render');
      await owner.getByRole('button', { name: 'Photo URL' }).click();
      await owner.locator('#hf-photo-url').fill('not a url');
      await owner.locator('#hf-photo-url').press('Tab');
      await owner.waitForTimeout(400);
      assert(home(homeId, 'photo_url').photo_url === uploaded, 'an invalid URL was saved');
      await owner.locator('#hf-photo-url').fill(`${uploaded}?v=2`);
      await owner.locator('#hf-photo-url').press('Tab');
      await saved(owner);
      assert(home(homeId, 'photo_url').photo_url === `${uploaded}?v=2`, 'photo URL not saved');
      await closeOverlay(owner);
    }, [owner]);

    await step(`[${width}] 5. Co-buyer edits a shared fact and answers their own Match without touching the owner's`, async () => {
      const co = await signedIn(browser, 'coBuyer', width);
      psql(`insert into public.home_member_state (home_id, user_id, status, checks) values ('${homeId}', '${OWNER}', 'Saved', '{"features:Fireplace": true}') on conflict (home_id, user_id) do update set checks = excluded.checks`);
      const ownerBefore = JSON.stringify(state(homeId, OWNER));
      await co.goto(`${base}/homes/${homeId}`, { waitUntil: 'networkidle' });
      await overlayOpen(co);
      await answer(co, 'Fireplace', 'No');
      await co.locator('#hf-schoolDistrict').fill('Anchor Bay');
      await co.locator('#hf-schoolDistrict').press('Tab');
      await saved(co);
      assert(state(homeId, CO).checks['features:Fireplace'] === 'no', 'co-buyer answer not saved');
      assert(JSON.stringify(state(homeId, OWNER)) === ownerBefore, 'co-buyer changed the owner\'s answers');
      assert(home(homeId, 'school_district_name').school_district_name === 'Anchor Bay', 'co-buyer shared fact not saved');
      await shot(co, tag('05-cobuyer'), { tall: width < 500 ? 2600 : 2300 });
      await co.context().close();
    }, []);

    await step(`[${width}] 6. Realtor sees everything read-only`, async () => {
      const realtor = await signedIn(browser, 'realtor', width);
      await realtor.goto(`${base}/people/${info.search}/homes/${homeId}`, { waitUntil: 'networkidle' });
      await realtor.getByRole('heading', { name: 'Home Facts' }).first().waitFor();
      assert(await realtor.locator('.flh-hf2 input, .flh-hf2 select').count() === 0, 'Realtor has Home Facts controls');
      await shot(realtor, tag('06-realtor-facts'), { tall: width < 500 ? 2000 : 1600 });
      await realtor.goto(`${base}/people/${info.search}/homes/${homeId}?section=match`, { waitUntil: 'networkidle' });
      assert(await realtor.locator('.flh-mc2 input').count() === 0, 'Realtor has Match controls');
      await shot(realtor, tag('06b-realtor-match'));
      // The overlay route itself is not the Realtor's: it 404s or redirects, never edits.
      const before = JSON.stringify(home(homeId, 'laundry_location, year_built'));
      await realtor.goto(`${base}/homes/${homeId}`, { waitUntil: 'networkidle' });
      assert(await realtor.locator('#hf-laundryLocation').count() === 0, 'Realtor reached an editable overlay');
      assert(JSON.stringify(home(homeId, 'laundry_location, year_built')) === before, 'Realtor changed a fact');
      await realtor.context().close();
    }, []);

    await owner.context().close();
  }

  // Visual matrix: long address, many Unknowns, long Nice to Have list, editing states.
  await step('visual matrix: 1440 / 1024 / 768 / 390 / 375 with 5 / 7 / 16 criteria and a long address', async () => {
    const original = q(`select priorities from public.search_member_priorities where search_id = '${info.search}' and user_id = '${OWNER}'`)[0].priorities;
    let priorities = applySearchChoice(normalizePriorities({}), 'home_buy');
    priorities.budget = { ...priorities.budget, value: '400000', tier: 'must' };
    priorities.bedsMin = { ...priorities.bedsMin, value: '3', tier: 'important' };
    priorities.bathsMin = { ...priorities.bathsMin, value: '2', tier: 'nice' };
    priorities.sqftTarget = { ...priorities.sqftTarget, value: '1800', tier: 'nice' };
    priorities.lotSizeTarget = { ...priorities.lotSizeTarget, value: '0.25', tier: 'important' };
    priorities.homeCondition = { values: ['Move-In Ready'], tier: 'must' };
    const add = (category, label, tier) => { priorities = addCriterion(priorities, { categoryKey: category, label, kind: 'check' }, tier); };
    [['exterior', 'Garage'], ['features', 'Home office'], ['exterior', 'Fenced yard']].forEach(([c, l]) => add(c, l, 'must'));
    [['features', 'Central air'], ['features', 'First-Floor Bedroom'], ['features', 'Walk-in Pantry'], ['exterior', 'Patio / deck']].forEach(([c, l]) => add(c, l, 'important'));
    [['features', 'Primary ensuite'], ['features', 'Fireplace'], ['features', 'Finished basement'], ['features', 'Kitchen Island'], ['features', 'Stainless Steel Appliances'], ['features', 'Formal Dining Room'],
      ['exterior', 'Pool'], ['exterior', 'Front porch'], ['exterior', 'Screened-in Porch'], ['features', 'Eat-in Kitchen'], ['features', 'Double Vanity'], ['exterior', 'Garden Space'], ['features', 'High Ceilings']].forEach(([c, l]) => add(c, l, 'nice'));
    psql(`update public.search_member_priorities set priorities = ${lit(JSON.stringify(priorities))}::jsonb where search_id = '${info.search}' and user_id = '${OWNER}'`);
    const longId = psql(`insert into public.homes (user_id, search_id, address, price, beds, baths) values ('${OWNER}', '${info.search}', '48211 Northwestern Highway Service Drive Unit 1204, Bloomfield Hills Township, MI 48302', '612500', '4', '3.5') returning id`).split('\n')[0].trim();
    psql(`insert into public.home_member_state (home_id, user_id, status) values ('${longId}', '${OWNER}', 'Saved')`);
    const sass = q(`select id from public.homes where listing_url = ${lit(LISTING)}`)[0].id;
    try {
      for (const width of [1440, 1024, 768, 390, 375]) {
        const page = await signedIn(browser, 'owner', width);
        await page.goto(`${base}/homes/${sass}`, { waitUntil: 'networkidle' });
        await overlayOpen(page);
        await shot(page, `v-imported-${width}`);
        await shot(page, `v-imported-full-${width}`, { tall: width < 500 ? 3200 : 2700 });
        await page.goto(`${base}/homes/${longId}`, { waitUntil: 'networkidle' });
        await overlayOpen(page);
        await shot(page, `v-long-address-unknowns-${width}`, { tall: width < 500 ? 3200 : 2700 });
        // Editing states: the layout menu open and a focused text field.
        await page.locator('#hf-layout').click();
        await shot(page, `v-editing-layout-${width}`);
        await page.keyboard.press('Escape');
        assert(await dialog(page).count() === 1, 'Escape in the menu closed the overlay');
        await page.locator('#hf-estMonthly').focus();
        await shot(page, `v-editing-text-${width}`);
        assert(page.errors.length === 0, `console errors: ${page.errors.join(' | ')}`);
        await page.context().close();
      }
    } finally {
      psql(`update public.search_member_priorities set priorities = ${lit(JSON.stringify(original))}::jsonb where search_id = '${info.search}' and user_id = '${OWNER}'`);
    }
  }, []);

  await step('keyboard: focus starts in the overlay, Tab stays inside, Escape closes and focus returns to the card', async () => {
    const page = await signedIn(browser, 'owner', 1440);
    await page.goto(`${base}/homes`, { waitUntil: 'networkidle' });
    const edit = page.locator('.hh-home-card', { hasText: '51613 Sass Rd' }).getByRole('button', { name: 'Edit' });
    await edit.focus();
    await page.keyboard.press('Enter');
    await overlayOpen(page);
    assert(await page.evaluate(() => document.activeElement?.id === 'flh-overlay-title'), 'focus did not move to the overlay title');
    for (let i = 0; i < 80; i += 1) {
      await page.keyboard.press('Tab');
      assert(await page.evaluate(() => !!document.activeElement?.closest('.flh-overlay')), `Tab ${i + 1} left the overlay`);
    }
    assert(await page.evaluate(() => getComputedStyle(document.documentElement).overflow === 'hidden'), 'page scroll not locked');
    await page.keyboard.press('Escape');
    await dialog(page).waitFor({ state: 'detached' });
    assert(await page.evaluate(() => document.activeElement?.textContent === 'Edit'), 'focus did not return to Edit');
    assert(await page.evaluate(() => getComputedStyle(document.documentElement).overflow !== 'hidden'), 'page scroll still locked');
    await page.context().close();
  }, []);

  await step('rentals and apartments: the overlay drops purchase-only fields and keeps the full editor', async () => {
    const original = q(`select priorities from public.search_member_priorities where search_id = '${info.search}' and user_id = '${OWNER}'`)[0].priorities;
    try {
      for (const [choice, name] of [['home_rent', 'rental'], ['apartment_rent', 'apartment']]) {
        const priorities = applySearchChoice(normalizePriorities({}), choice);
        psql(`update public.search_member_priorities set priorities = ${lit(JSON.stringify(priorities))}::jsonb where search_id = '${info.search}' and user_id = '${OWNER}'`);
        const page = await signedIn(browser, 'owner', 1024);
        await page.goto(`${base}/homes/${legacyId}`, { waitUntil: 'networkidle' });
        await overlayOpen(page);
        assert(await page.locator('#hf-estMonthly').count() === 0, `${name}: estimated payment shown`);
        assert(await page.locator('#hf-propertyTaxAnnual').count() === 0, `${name}: annual taxes shown`);
        assert(await page.getByRole('button', { name: /More .* details/ }).count() === 1, `${name}: full editor missing`);
        await shot(page, `v-${name}-1024`, { tall: 1800 });
        await page.context().close();
      }
    } finally {
      psql(`update public.search_member_priorities set priorities = ${lit(JSON.stringify(original))}::jsonb where search_id = '${info.search}' and user_id = '${OWNER}'`);
    }
  }, []);

  await browser.close();
  writeFileSync(join(outDir, 'results.json'), JSON.stringify(log, null, 2));
  const failed = log.filter((entry) => !entry.ok);
  console.log(`\n${log.length - failed.length}/${log.length} steps passed`);
  if (failed.length) process.exit(1);
}

await run();
