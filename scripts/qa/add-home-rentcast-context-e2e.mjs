#!/usr/bin/env node
// Browser QA for Add Home V3 phase 3, more from the existing RentCast responses
// (docs/add-home-v3-rentcast-context.md). DEVELOPMENT ONLY. Same setup as the
// other Add Home QA (stand-in on real Postgres + dev server with the RentCast
// fixture). Fixture house numbers 51690–51695 carry the extra documented fields
// (51691 / 51695 are Inactive).
//
//   FLH_TEST_PGHOST=… FLH_TEST_PGPORT=… node scripts/qa/add-home-rentcast-context-e2e.mjs standin.json <outDir> [baseUrl]
//
// On desktop (1440) and iPhone (390): the found card's listing-type chip (active
// listing only); after saving, Home Facts' dated listing context, county-record
// line and hints (Unknown fields only); the per-buyer "County records suggest"
// Match pointer for owner and co-buyer, with nothing answered and each answer
// staying that buyer's own; an inactive listing's context. Rows are checked in
// real Postgres. Any failed step, overflow or console error fails the run.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { chromium, devices } from 'playwright';

const [infoPath, outArg, base = 'http://localhost:3200'] = process.argv.slice(2);
if (!infoPath || !outArg) throw new Error('Usage: add-home-rentcast-context-e2e.mjs <standin.json> <outDir> [baseUrl]');
const info = JSON.parse(readFileSync(infoPath, 'utf8').split('\n')[0]);
const outDir = resolve(outArg);
mkdirSync(outDir, { recursive: true });
const IGNORED_CONSOLE = /Download the React DevTools|favicon|maps\.googleapis|Google Maps|places|Failed to load resource/i;
const VIEWPORTS = [
  ['desktop-1440', { viewport: { width: 1440, height: 900 } }, 51690],
  ['iphone-390', devices['iPhone 13'], 51694],
];
const listingUrl = (number) => `https://www.zillow.com/homedetails/${number}-Sass-Rd-New-Baltimore-MI-48047/${number}_zpid/`;

function psql(sql) {
  const result = spawnSync('psql', ['-X', '-q', '-A', '-t', '-h', process.env.FLH_TEST_PGHOST, '-p', process.env.FLH_TEST_PGPORT || '5432', '-U', 'postgres', '-d', info.database, '-c', sql], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
}
const q = (sql) => JSON.parse(psql(`select coalesce(json_agg(t), '[]'::json) from (${sql}) t`));
const lit = (value) => `'${String(value).replace(/'/g, "''")}'`;
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const homeRow = (url) => q(`select id, home_condition, home_layout, basement_condition, basement_style, listing_import from public.homes where search_id = ${lit(info.search)} and listing_url = ${lit(url)}`)[0];
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

async function find(page, url) {
  await page.goto(`${base}/homes`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /Add a Home/ }).first().click();
  await page.getByLabel('Listing link or address').fill(url);
  await page.getByRole('button', { name: /^Find home$/ }).click();
  await page.locator('.flh-found-card').waitFor({ timeout: 30000 });
}
async function saveAndOpen(page) {
  await page.getByRole('button', { name: /^Save Home$/ }).click();
  await page.locator('.flh-saved').waitFor({ timeout: 60000 });
  await page.getByRole('button', { name: /^View home/ }).click();
  await page.locator('.flh-overlay[role="dialog"]:not(.is-loading)').waitFor({ timeout: 30000 });
}
async function openMatchTiers(page) {
  for (let i = 0; i < 4; i += 1) {
    const toggle = page.locator('.flh-mc2-toggle[aria-expanded="false"]:visible').first();
    if (!(await toggle.count())) return;
    await toggle.click();
  }
}
async function expandHomeFacts(page) {
  for (let i = 0; i < 8; i += 1) {
    const toggle = page.locator('.flh-phone-collapse-toggle[aria-expanded="false"]:visible').first();
    if (!(await toggle.count())) return;
    await toggle.click();
  }
}

async function run() {
  const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {});
  psql(`delete from public.homes where search_id = ${lit(info.search)} and address ~ '^5169[0-9] Sass Rd'`);
  for (const [label, device, first] of VIEWPORTS) {
    let owner; let coBuyer;
    const open = () => [owner, coBuyer].filter(Boolean);
    const url = listingUrl(first);
    const inactiveUrl = listingUrl(first + 1);

    await step(`[${label}] found card: a non-standard listing type shows as a quiet chip; Save Home still on screen; nothing is filled from context`, async () => {
      owner = await signedIn(browser, 'owner', device);
      await find(owner, url);
      assert(await owner.locator('.flh-found-type').innerText() === 'New Construction', 'listing type chip');
      const card = await owner.locator('.flh-found').innerText();
      assert(/We found \d+ details about this home\./.test(card), 'detail count');
      const box = await owner.getByRole('button', { name: /^Save Home$/ }).boundingBox();
      assert(box && box.y + box.height <= owner.viewportSize().height, 'Save Home off screen');
      await shot(owner, `after-${label}-1-found-chip`);
    }, open);

    await step(`[${label}] saved Home Facts: dated listing context, county-record line, and hints only for Unknown fields; no value written`, async () => {
      await saveAndOpen(owner);
      const row = homeRow(url);
      assert(JSON.stringify(row.home_condition) === '[]' && JSON.stringify(row.home_layout) === '[]' && row.basement_condition === null && row.basement_style === null, `context was written as a value: ${JSON.stringify(row).slice(0, 200)}`);
      assert(row.listing_import.listing.listingType === 'New Construction' && row.listing_import.listing.history.length === 2, 'snapshot listing context');
      await expandHomeFacts(owner);
      const facts = await owner.locator('.flh-hf2').innerText();
      for (const expected of [
        'Subdivision: SASS HILLS · county records',
        /When added \([A-Z][a-z]{2} \d{1,2}, \d{4}\): Active · listed Sep 26, 2026 · 23 days on market/,
        'Listing type: New Construction',
        'Listed before: Mar 2, 2025 – Apr 30, 2025 (59 days)',
        'County records: fireplace (Masonry) · pool (Concrete) · City view',
        'County records: 2 stories',
        'County records: Poured Concrete foundation. Not proof of a basement’s style or condition.',
      ]) assert(typeof expected === 'string' ? facts.includes(expected) : expected.test(facts), `missing: ${expected}`);
      assert(!/\$349,000|price drop|reduced/i.test(facts), 'a history price or an inferred change is shown');
      assert(!(await owner.locator('.flh-overlay .flh-hf2 details').count()), 'Home Facts has an inline fold-out');
      await owner.locator('.flh-hf2-context').evaluate((el) => el.scrollIntoView({ block: 'center' }));
      await shot(owner, `after-${label}-2-home-facts-context`);
      // A value the buyer sets wins: the hint goes away.
      await owner.locator('#hf-basementCondition').selectOption('finished');
      await owner.getByText('Not proof of a basement’s style or condition.').waitFor({ state: 'detached', timeout: 10000 });
      for (let i = 0; i < 20 && homeRow(url).basement_condition !== 'finished'; i += 1) await owner.waitForTimeout(250);
      assert(homeRow(url).basement_condition === 'finished', 'buyer value not saved');
      // Answering crosses the Match Reveal threshold (#170): that one-time reveal is expected; keep going.
      const reveal = owner.locator('.flh-reveal-backdrop');
      await reveal.waitFor({ timeout: 5000 }).catch(() => {});
      if (await reveal.count()) { await owner.getByRole('button', { name: 'Keep going' }).click(); await reveal.waitFor({ state: 'detached' }); }
    }, open);

    await step(`[${label}] owner's Match view: "County records suggest Yes" on Fireplace (unanswered); the owner's own No wins`, async () => {
      await openMatchTiers(owner);
      const fireRow = owner.locator('.flh-mc2-row').filter({ hasText: 'Fireplace' });
      await fireRow.locator('.flh-mc2-listing').waitFor({ timeout: 15000 });
      assert(/County records suggest\s*Yes/.test(await fireRow.innerText()), 'county pointer');
      await fireRow.locator('.flh-mc2-why > summary').click();
      assert(/County records list a fireplace \(Masonry\)\./.test(await fireRow.innerText()) && /Records can be out of date/.test(await fireRow.innerText()), 'pointer evidence');
      await fireRow.scrollIntoViewIfNeeded();
      await shot(owner, `after-${label}-3-match-county-pointer`);
      const id = homeRow(url).id;
      assert(checksOf(id, info.users.owner.id)['features:Fireplace'] === undefined, 'answered for the buyer');
      await fireRow.locator('label.is-no').click();
      for (let i = 0; i < 20 && checksOf(id, info.users.owner.id)['features:Fireplace'] !== 'no'; i += 1) await owner.waitForTimeout(250);
      assert(checksOf(id, info.users.owner.id)['features:Fireplace'] === 'no', 'owner No not saved');
      assert(!(await fireRow.locator('.flh-mc2-listing').count()), 'pointer still shown after the owner answered');
    }, open);

    await step(`[${label}] co-buyer: the same context and their own pointer; nothing answered for them; the owner's No untouched`, async () => {
      coBuyer = await signedIn(browser, 'coBuyer', device);
      const id = homeRow(url).id;
      await coBuyer.goto(`${base}/homes/${id}`, { waitUntil: 'networkidle' });
      await coBuyer.locator('.flh-overlay[role="dialog"]:not(.is-loading)').waitFor({ timeout: 30000 });
      await expandHomeFacts(coBuyer);
      assert((await coBuyer.locator('.flh-hf2').innerText()).includes('Listing type: New Construction'), 'co-buyer context');
      await openMatchTiers(coBuyer);
      const fireRow = coBuyer.locator('.flh-mc2-row').filter({ hasText: 'Fireplace' });
      await fireRow.locator('.flh-mc2-listing').waitFor({ timeout: 15000 });
      assert(/County records suggest\s*Yes/.test(await fireRow.innerText()), 'co-buyer pointer');
      assert(Object.keys(checksOf(id, info.users.coBuyer.id)).length === 0, 'co-buyer answered automatically');
      assert(checksOf(id, info.users.owner.id)['features:Fireplace'] === 'no', 'owner answer changed');
      await fireRow.scrollIntoViewIfNeeded();
      await shot(coBuyer, `after-${label}-4-cobuyer-pointer`);
      await coBuyer.context().close(); coBuyer = null;
    }, open);

    await step(`[${label}] inactive listing: no type chip on the found card; Home Facts says "No longer listed" with the removed date, never current`, async () => {
      await find(owner, inactiveUrl);
      assert(!(await owner.locator('.flh-found-type').count()), 'a type chip on an inactive listing');
      assert(/No current asking price/.test(await owner.locator('.flh-found').innerText()), 'inactive price note');
      await saveAndOpen(owner);
      await expandHomeFacts(owner);
      const facts = await owner.locator('.flh-hf2').innerText();
      assert(/When added \([^)]*\): No longer listed · listed Sep 26, 2026/.test(facts) && !/days on market/.test(facts.split('Listing type')[0]), `inactive context: ${facts.slice(0, 600)}`);
      await owner.locator('.flh-hf2-context').evaluate((el) => el.scrollIntoView({ block: 'center' }));
      await shot(owner, `after-${label}-5-inactive-context`);
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
