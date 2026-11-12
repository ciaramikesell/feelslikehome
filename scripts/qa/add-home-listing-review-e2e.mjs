#!/usr/bin/env node
// Browser QA for Add Home V3 phase 2, one simple listing review
// (docs/add-home-v3-listing-review.md). DEVELOPMENT ONLY. Same setup as
// add-home-simple-save-e2e.mjs: the Supabase stand-in on real Postgres and a
// dev server with the RentCast fixture (complete, matching lookups on Sass Rd).
//
//   FLH_TEST_PGHOST=… FLH_TEST_PGPORT=… node scripts/qa/add-home-listing-review-e2e.mjs standin.json <outDir> [baseUrl]
//
// On desktop (1440) and iPhone (390): the shared-fact checklist after a paste
// (defaults, Why?, deselect, Add N facts, Undo), Save Home still on screen, the
// personal answers deferred and then shown in each buyer's own Match view after
// saving (owner and co-buyer independently, nothing answered for anyone), the
// "Not changed" note when the text disagrees with a looked-up fact, a repeated
// paste, and an empty paste. Rows are checked in real Postgres. Any failed step,
// horizontal overflow or unexpected console error fails the run.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { chromium, devices } from 'playwright';

const [infoPath, outArg, base = 'http://localhost:3200'] = process.argv.slice(2);
if (!infoPath || !outArg) throw new Error('Usage: add-home-listing-review-e2e.mjs <standin.json> <outDir> [baseUrl]');
const info = JSON.parse(readFileSync(infoPath, 'utf8').split('\n')[0]);
const outDir = resolve(outArg);
mkdirSync(outDir, { recursive: true });
const IGNORED_CONSOLE = /Download the React DevTools|favicon|maps\.googleapis|Google Maps|places|Failed to load resource/i;
const VIEWPORTS = [
  ['desktop-1440', { viewport: { width: 1440, height: 900 } }, 0],
  ['iphone-390', devices['iPhone 13'], 20],
];
const listingUrl = (number) => `https://www.zillow.com/homedetails/${number}-Sass-Rd-New-Baltimore-MI-48047/${number}_zpid/`;
// The fixture's lookup already fills garage (attached, 2) and HOA ($0), so the
// text's own garage and HOA are "Not changed" notes, never suggestions.
const TEXT = 'Finished walkout basement with rec room. Laundry on the main level. Primary suite on the first floor. Detached 2-car garage. HOA dues of $1,200 per year. Rochester Community Schools. Gas fireplace in the family room.';

function psql(sql) {
  const result = spawnSync('psql', ['-X', '-q', '-A', '-t', '-h', process.env.FLH_TEST_PGHOST, '-p', process.env.FLH_TEST_PGPORT || '5432', '-U', 'postgres', '-d', info.database, '-c', sql], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
}
const q = (sql) => JSON.parse(psql(`select coalesce(json_agg(t), '[]'::json) from (${sql}) t`));
const lit = (value) => `'${String(value).replace(/'/g, "''")}'`;
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const homeRow = (url) => q(`select h.id, h.basement_condition, h.basement_style, h.laundry_location, h.primary_bedroom_location, h.garage_type, h.hoa_fee_monthly, h.school_district, h.listing_import
  from public.homes h where h.search_id = ${lit(info.search)} and h.listing_url = ${lit(url)}`)[0];
const checksOf = (homeId, userId) => q(`select checks from public.home_member_state where home_id = ${lit(homeId)} and user_id = ${lit(userId)}`)[0]?.checks || {};

async function signedIn(browser, who, device) {
  const context = await browser.newContext({ ...device });
  await context.addCookies([{ name: 'sb-localhost-auth-token', value: `base64-${Buffer.from(JSON.stringify(info.users[who].session)).toString('base64url')}`, domain: 'localhost', path: '/' }]);
  await context.addInitScript(() => { try { localStorage.setItem('flh-mobile-tour-dismissed', '1'); localStorage.setItem('flh-what-flh-found-dismissed', '1'); localStorage.setItem('flh-install-dismissed', '1'); } catch { /* ignore */ } });
  const page = await context.newPage();
  page.errors = [];
  page.on('pageerror', (error) => page.errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error' && !IGNORED_CONSOLE.test(message.text())) page.errors.push(message.text().slice(0, 400)); });
  return page;
}

const log = [];
async function step(name, fn, pages) {
  const started = Date.now();
  try {
    await fn();
    for (const page of pages()) {
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (overflow > 1) throw new Error(`horizontal overflow ${overflow}px`);
    }
    const errors = pages().flatMap((page) => page.errors.splice(0));
    if (errors.length) throw new Error(`console errors: ${errors.join(' | ')}`);
    log.push({ step: name, ok: true, ms: Date.now() - started }); console.log('ok  ', name);
  } catch (error) { log.push({ step: name, ok: false, error: error.message }); console.error('FAIL', name, '—', error.message); }
}
const shot = (page, name) => page.screenshot({ path: join(outDir, `${name}.png`) });
const shotOf = (page, selector, name) => page.locator(selector).screenshot({ path: join(outDir, `${name}.png`) });

async function find(page, url) {
  await page.goto(`${base}/homes`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /Add a Home/ }).first().click();
  await page.getByLabel('Listing link or address').fill(url);
  await page.getByRole('button', { name: /^Find home$/ }).click();
  await page.locator('.flh-found-card').waitFor({ timeout: 30000 });
}
async function paste(page, text) {
  const more = page.locator('details.flh-found-more:not([open]) > summary');
  if (await more.count()) await more.click();
  await page.locator('#flh-listing-paste-text').fill(text);
  await page.getByRole('button', { name: 'Fill in details' }).click();
  await page.locator('.flh-listing-paste-status').waitFor();
}
const checklist = (page) => page.locator('.flh-fact-checklist');
const row = (page, label) => checklist(page).locator('.flh-fact-checklist-rows > li').filter({ has: page.locator('.flh-fact-check-text b', { hasText: new RegExp(`^${label}$`) }) });
const checked = async (page, label) => row(page, label).locator('input[type=checkbox]').isChecked();
const saveButton = (page) => page.getByRole('button', { name: /^Save Home$/ });
// Save Home sits above the review: scrolled to the top of the dialog, it is on screen.
async function saveOnScreenAtTop(page) {
  await page.evaluate(() => { document.querySelectorAll('.hh-modal, .hh-modal-backdrop').forEach((el) => { el.scrollTop = 0; }); window.scrollTo(0, 0); });
  const box = await saveButton(page).boundingBox();
  const height = page.viewportSize().height;
  assert(box && box.y >= 0 && box.y + box.height <= height, `Save Home is off screen (top ${box && Math.round(box.y)} of ${height})`);
}
async function openMatchTiers(page) {
  for (let i = 0; i < 4; i += 1) {
    const toggle = page.locator('.flh-mc2-toggle[aria-expanded="false"]:visible').first();
    if (!(await toggle.count())) return;
    await toggle.click();
  }
}

async function run() {
  const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {});
  psql(`delete from public.homes where search_id = ${lit(info.search)} and address ~ '^518[0-9][0-9] Sass Rd'`);
  for (const [label, device, offset] of VIEWPORTS) {
    let owner; let coBuyer;
    const open = () => [owner, coBuyer].filter(Boolean);
    const n = (k) => 51800 + offset + k;
    const url = listingUrl(n(1));

    await step(`[${label}] one checklist: explicit facts checked, school and converted HOA unchecked, sentence on demand, Save Home still first`, async () => {
      owner = await signedIn(browser, 'owner', device);
      await find(owner, url);
      await paste(owner, TEXT);
      await checklist(owner).waitFor();
      for (const field of ['Basement condition', 'Basement style', 'Laundry', 'Primary bedroom']) assert(await checked(owner, field), `${field} not preselected`);
      assert(!(await checked(owner, 'School district')), 'school district preselected');
      assert(/FLH hasn.t verified it or checked school boundaries/.test(await row(owner, 'School district').innerText()), 'school attribution missing');
      // The lookup already filled garage and HOA: no row, a "Not changed" note instead.
      assert(!(await row(owner, 'Garage type').count()) && !(await row(owner, 'HOA fee').count()), 'a looked-up fact was offered');
      const notChanged = await checklist(owner).locator('.flh-fact-disagree').innerText();
      assert(/Garage type: the listing says Detached; this home has Attached\. Kept as is\./.test(notChanged), `not-changed note: ${notChanged}`);
      assert(/Add 4 facts/.test(await checklist(owner).locator('.flh-fact-add').innerText()), 'Add count');
      assert(/4 of 5 selected/.test(await checklist(owner).locator('.flh-fact-count').innerText()), 'selected count');
      // Why? shows the listing's own sentence.
      await row(owner, 'Laundry').locator('.flh-fact-why > summary').click();
      assert(/“Laundry on the main level\.”/.test(await row(owner, 'Laundry').innerText()), 'evidence sentence');
      // Personal answers are deferred, not reviewed here.
      assert(!(await owner.locator('.flh-found .flh-answer-review').count()), 'personal review on the card');
      assert(/Fireplace/.test(await owner.locator('.flh-deferred-answers').innerText()), 'deferred note');
      await saveOnScreenAtTop(owner);
      await shot(owner, `after-${label}-1-checklist-top`);
      await checklist(owner).scrollIntoViewIfNeeded();
      await shotOf(owner, '.flh-found-more', `after-${label}-2-checklist`);
    }, open);

    await step(`[${label}] deselect, then one Add N facts; Undo takes back only that fact; nothing is saved yet`, async () => {
      await row(owner, 'Primary bedroom').locator('input[type=checkbox]').uncheck();
      await row(owner, 'School district').locator('input[type=checkbox]').check();
      assert(/Add 4 facts/.test(await checklist(owner).locator('.flh-fact-add').innerText()), 'count after toggles');
      await checklist(owner).locator('.flh-fact-add').click();
      const added = await checklist(owner).locator('.flh-fact-added').innerText();
      assert(/4 added to Home Facts/.test(added), `added: ${added}`);
      // The unchecked fact is still offered, unchecked.
      assert(await row(owner, 'Primary bedroom').count() && !(await checked(owner, 'Primary bedroom')), 'unchecked fact disappeared');
      await checklist(owner).locator('.flh-fact-added li').filter({ hasText: 'School district' }).getByRole('button', { name: /Undo/ }).click();
      assert(/3 added to Home Facts/.test(await checklist(owner).locator('.flh-fact-added').innerText()), 'undo');
      assert(!homeRow(url), 'saved before Save Home');
      await checklist(owner).scrollIntoViewIfNeeded();
      await shotOf(owner, '.flh-found-more', `after-${label}-3-added`);
    }, open);

    await step(`[${label}] repeated paste keeps what the new text still states and clears the rest; an empty paste suggests nothing`, async () => {
      await paste(owner, 'Finished walkout basement with rec room. Gas fireplace.');
      const status = await owner.locator('.flh-listing-paste-status').innerText();
      assert(/Laundry is back to Unknown/.test(status), `rerun status: ${status}`);
      assert(/2 added to Home Facts/.test(await checklist(owner).locator('.flh-fact-added').innerText()), 'kept facts');
      // A new paste is a new review (as Skip was before): choose again.
      await paste(owner, TEXT);
      assert(await checked(owner, 'Primary bedroom'), 'a new review starts from the defaults');
      await row(owner, 'Primary bedroom').locator('input[type=checkbox]').uncheck();
      await checklist(owner).locator('.flh-fact-add').click();
      assert(/added to Home Facts/.test(await checklist(owner).locator('.flh-fact-added').innerText()), 'added again');
    }, open);

    await step(`[${label}] Save Home: checked facts shared with provenance; no Match answer written for anyone`, async () => {
      await saveOnScreenAtTop(owner);
      await saveButton(owner).click();
      await owner.locator('.flh-saved').waitFor({ timeout: 60000 });
      const saved = homeRow(url);
      assert(saved.basement_condition === 'finished' && saved.basement_style === 'walkout' && saved.laundry_location === 'first_floor', `facts: ${JSON.stringify(saved).slice(0, 200)}`);
      assert(saved.primary_bedroom_location === '' || saved.primary_bedroom_location === null, 'an unchecked fact was saved');
      assert(saved.garage_type === 'attached' && Number(saved.hoa_fee_monthly) === 0, 'a looked-up fact was overwritten');
      assert(saved.school_district === null, 'the unchecked district was saved');
      assert(saved.listing_import.source === 'rentcast' && saved.listing_import.pastedFacts.some((item) => item.field === 'laundryLocation' && /main level/.test(item.evidence)), 'provenance');
      assert(saved.listing_import.descriptionFeatures.some((item) => item.concept === 'fireplace'), 'deferred evidence not kept');
      assert(!Object.keys(checksOf(saved.id, info.users.owner.id)).length, 'owner checks written');
      await owner.getByRole('button', { name: /^View home/ }).click();
      await owner.locator('.flh-overlay[role="dialog"]:not(.is-loading)').waitFor({ timeout: 30000 });
    }, open);

    await step(`[${label}] owner's Match view: Fireplace shows "Listing suggests Yes" (unanswered); answering it is the owner's own and hides the pointer`, async () => {
      await openMatchTiers(owner);
      const fireRow = owner.locator('.flh-mc2-row').filter({ hasText: 'Fireplace' });
      await fireRow.locator('.flh-mc2-listing').waitFor({ timeout: 15000 });
      await fireRow.locator('.flh-mc2-why > summary').click();
      assert(/Gas fireplace in the family room\./.test(await fireRow.innerText()), 'hint sentence');
      // Finished basement is answered by the Home Fact now, so it gets no pointer.
      assert(!(await owner.locator('.flh-mc2-row').filter({ hasText: 'Finished basement' }).locator('.flh-mc2-listing').count()), 'a fact-backed criterion got a pointer');
      await fireRow.scrollIntoViewIfNeeded();
      await shot(owner, `after-${label}-4-match-hint`);
      const id = homeRow(url).id;
      assert(checksOf(id, info.users.owner.id)['features:Fireplace'] === undefined, 'answered before the buyer chose');
      await fireRow.locator('label.is-no').click();
      for (let i = 0; i < 20 && checksOf(id, info.users.owner.id)['features:Fireplace'] !== 'no'; i += 1) await owner.waitForTimeout(250);
      assert(checksOf(id, info.users.owner.id)['features:Fireplace'] === 'no', 'owner answer not saved');
      assert(!(await fireRow.locator('.flh-mc2-listing').count()), 'pointer still shown after the buyer answered');
    }, open);

    await step(`[${label}] co-buyer: the same home, their own pointer from the saved snapshot; the owner's No doesn't touch it`, async () => {
      coBuyer = await signedIn(browser, 'coBuyer', device);
      const id = homeRow(url).id;
      await coBuyer.goto(`${base}/homes/${id}`, { waitUntil: 'networkidle' });
      await coBuyer.locator('.flh-overlay[role="dialog"]:not(.is-loading)').waitFor({ timeout: 30000 });
      await openMatchTiers(coBuyer);
      const fireRow = coBuyer.locator('.flh-mc2-row').filter({ hasText: 'Fireplace' });
      await fireRow.locator('.flh-mc2-listing').waitFor({ timeout: 15000 });
      assert(/Listing suggests\s*Yes/.test(await fireRow.innerText()), 'co-buyer pointer');
      await fireRow.scrollIntoViewIfNeeded();
      await shot(coBuyer, `after-${label}-5-cobuyer-hint`);
      await fireRow.locator('label.is-yes').click();
      for (let i = 0; i < 20 && checksOf(id, info.users.coBuyer.id)['features:Fireplace'] !== true; i += 1) await coBuyer.waitForTimeout(250);
      assert(checksOf(id, info.users.coBuyer.id)['features:Fireplace'] === true, 'co-buyer answer');
      assert(checksOf(id, info.users.owner.id)['features:Fireplace'] === 'no', 'the owner’s answer changed');
      await coBuyer.context().close(); coBuyer = null;
    }, open);

    await step(`[${label}] an empty paste suggests nothing and says so; Save Home still works`, async () => {
      const bare = listingUrl(n(2));
      await find(owner, bare);
      await paste(owner, 'Lovely home on a quiet street.');
      assert(/didn.t find details we could use/.test(await owner.locator('.flh-listing-paste-status').innerText()), 'empty message');
      assert(!(await checklist(owner).count()) && !(await owner.locator('.flh-deferred-answers').count()), 'something was suggested');
      await saveOnScreenAtTop(owner);
      await saveButton(owner).click();
      await owner.locator('.flh-saved').waitFor({ timeout: 60000 });
      await owner.getByRole('button', { name: 'Back to My Homes' }).click();
    }, open);

    await owner?.context().close();
  }
  await browser.close();
  writeFileSync(join(outDir, 'results.json'), JSON.stringify(log, null, 2));
  const failed = log.filter((entry) => !entry.ok);
  console.log(`\n${log.length - failed.length}/${log.length} steps passed`);
  if (failed.length) process.exitCode = 1;
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
