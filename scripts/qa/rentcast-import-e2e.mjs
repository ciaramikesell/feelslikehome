#!/usr/bin/env node
// Browser QA for RentCast import accuracy (PR #161). DEVELOPMENT ONLY.
// Same setup as home-overlay-e2e.mjs (stand-in + dev server with the RentCast
// fixture, which answers by house number — see scripts/qa/rentcast-fixture.mjs),
// then:
//
//   FLH_TEST_PGHOST=… FLH_TEST_PGPORT=… node scripts/qa/rentcast-import-e2e.mjs standin.json <outDir> [baseUrl]
//
// On desktop, iPad and iPhone viewports (Chromium device emulation) the owner
// finds a home from a listing link and adds it, for a complete, a partial
// (listing lookup down), an inactive and a rate-limited lookup. Checks the saved
// row in real Postgres: imported values, Unknown kept Unknown, the listing_import
// snapshot, and the imported map point. Then reloads Home Facts. Any failed
// step, horizontal overflow or console error fails the run.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { chromium, devices } from 'playwright';

const [infoPath, outArg, base = 'http://localhost:3200'] = process.argv.slice(2);
if (!infoPath || !outArg) throw new Error('Usage: rentcast-import-e2e.mjs <standin.json> <outDir> [baseUrl]');
const info = JSON.parse(readFileSync(infoPath, 'utf8').split('\n')[0]);
const outDir = resolve(outArg);
mkdirSync(outDir, { recursive: true });
// A failed lookup logs its HTTP status in the browser console; that is expected.
const IGNORED_CONSOLE = /Download the React DevTools|favicon|maps\.googleapis|Google Maps|places|Failed to load resource/i;
const VIEWPORTS = [
  ['desktop-1440', { viewport: { width: 1440, height: 900 } }],
  ['ipad-820', { ...devices['iPad (gen 11)'], viewport: { width: 820, height: 1180 } }],
  ['iphone-390', devices['iPhone 13']],
];
// House numbers the fixture answers differently (scripts/qa/rentcast-fixture.mjs).
const SCENARIOS = { complete: 51613, partial: 51615, inactive: 51617, limited: 51619 };
const listingUrl = (number, label) => `https://www.zillow.com/homedetails/${number}-Sass-Rd-New-Baltimore-MI-48047/${label.length}${number}_zpid/`;

function psql(sql) {
  const result = spawnSync('psql', ['-X', '-q', '-A', '-t', '-h', process.env.FLH_TEST_PGHOST, '-p', process.env.FLH_TEST_PGPORT || '5432', '-U', 'postgres', '-d', info.database, '-c', sql], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
}
const q = (sql) => JSON.parse(psql(`select coalesce(json_agg(t), '[]'::json) from (${sql}) t`));
const lit = (value) => `'${String(value).replace(/'/g, "''")}'`;
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const savedRow = (url) => q(`select id, price, days_on_market, heating, cooling, garage_type, garage_spaces, hoa_fee_monthly, property_tax_annual, property_tax_year,
  laundry_location, basement_condition, latitude, longitude, coordinate_status, coordinate_source, coordinate_address_fingerprint, listing_import
  from public.homes where listing_url = ${lit(url)}`);

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
const shot = (page, name, element = null) => (element ? page.locator(element).screenshot({ path: join(outDir, `${name}.png`) }) : page.screenshot({ path: join(outDir, `${name}.png`), fullPage: true }));

// Phones collapse some Home Facts groups: open them.
const expandAll = async (page) => {
  for (let i = 0; i < 8; i += 1) {
    const toggle = page.locator('.flh-phone-collapse-toggle[aria-expanded="false"]:visible').first();
    if (!(await toggle.count())) return;
    await toggle.click();
  }
};

async function find(page, url) {
  await page.goto(`${base}/homes`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /Add a Home/ }).first().click();
  await page.getByLabel('Listing link or address').fill(url);
  await page.getByRole('button', { name: /^Find home$/ }).click();
  await page.locator('.flh-found').waitFor({ timeout: 30000 });
}
async function add(page, url) {
  await page.getByRole('button', { name: 'Add to My Homes' }).click();
  await page.waitForURL(/\/homes\/[0-9a-f-]{36}$/, { timeout: 60000 });
  await page.locator('.flh-overlay[role="dialog"]:not(.is-loading)').waitFor({ timeout: 30000 });
  const rows = savedRow(url);
  assert(rows.length === 1, `expected one saved home, found ${rows.length}`);
  return rows[0];
}

async function run() {
  const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {});
  psql(`delete from public.homes where search_id = ${lit(info.search)} and address like '5161_ Sass Rd%'`);
  for (const [label, device] of VIEWPORTS) {
    let owner;
    const open = () => [owner].filter(Boolean);

    await step(`[${label}] complete: listing + property record → asking price, documented facts, $0/mo HOA, taxes with year, trusted map point`, async () => {
      owner = await signedIn(browser, 'owner', device);
      const url = listingUrl(SCENARIOS.complete, label);
      await find(owner, url);
      await owner.getByText('We found your home').waitFor();
      const card = await owner.locator('.flh-found').innerText();
      assert(card.includes('$335,000'), 'asking price not shown');
      assert(!/weren.t available|No current asking price/.test(card), 'complete import shows a partial/inactive note');
      await shot(owner, `${label}-1-complete-found`, '.flh-found');
      const row = await add(owner, url);
      assert(row.price === '335000' && row.days_on_market === '23', `price/DOM: ${row.price}/${row.days_on_market}`);
      assert(row.heating === 'Forced Air' && row.cooling === null, `heating/cooling: ${row.heating}/${row.cooling}`);
      assert(row.garage_type === 'attached' && row.garage_spaces === '2', 'garage');
      assert(Number(row.hoa_fee_monthly) === 0 && row.hoa_fee_monthly !== null, `HOA: ${row.hoa_fee_monthly}`);
      assert(Number(row.property_tax_annual) === 4210 && Number(row.property_tax_year) === 2025, 'taxes');
      assert(row.laundry_location === null && row.basement_condition === null, 'laundry/basement were guessed');
      assert(row.coordinate_status === 'resolved' && row.coordinate_source === 'rentcast' && Number(row.latitude) === 42.68 && !!row.coordinate_address_fingerprint, `coordinates: ${JSON.stringify([row.coordinate_status, row.coordinate_source, row.latitude])}`);
      const snap = row.listing_import;
      assert(snap?.source === 'rentcast' && snap.listing?.status === 'active' && snap.sources?.property === 'ok' && snap.sources?.listing === 'ok' && snap.importedAt, `snapshot: ${JSON.stringify(snap).slice(0, 300)}`);
      await owner.reload({ waitUntil: 'networkidle' });
      await owner.locator('.flh-overlay[role="dialog"]:not(.is-loading)').waitFor({ timeout: 30000 });
      await expandAll(owner);
      const hoa = await owner.locator('#hf-hoaFeeMonthly').inputValue();
      assert(hoa === '$0/mo', `Home Facts HOA after reload reads "${hoa}"`);
      assert(!/no hoa/i.test(await owner.locator('.flh-overlay').innerText()), 'a $0 fee read as "No HOA"');
      assert(await owner.locator('#hf-heating').inputValue() === 'Forced Air' && await owner.locator('#hf-cooling').inputValue() === '', 'heating/cooling after reload');
      await shot(owner, `${label}-2-complete-home-facts`);
    }, open);

    await step(`[${label}] partial: listing lookup down → property facts kept, calm note, price left for the buyer`, async () => {
      const url = listingUrl(SCENARIOS.partial, label);
      await find(owner, url);
      await owner.getByText('We found your home').waitFor();
      const card = await owner.locator('.flh-found').innerText();
      assert(/Current listing details weren.t available right now/.test(card), 'no partial note');
      assert(card.includes('Price unknown'), 'a price appeared without a listing');
      await shot(owner, `${label}-3-partial-found`, '.flh-found');
      const row = await add(owner, url);
      assert(row.price === '' && row.heating === 'Forced Air' && Number(row.property_tax_annual) === 4210, `partial row: ${JSON.stringify([row.price, row.heating])}`);
      assert(row.listing_import?.sources?.listing === 'error' && !row.listing_import?.listing, 'partial snapshot');
    }, open);

    await step(`[${label}] inactive: last listed price is never the asking price`, async () => {
      const url = listingUrl(SCENARIOS.inactive, label);
      await find(owner, url);
      await owner.getByText('We found your home').waitFor();
      const card = await owner.locator('.flh-found').innerText();
      assert(card.includes('No current asking price') && !card.includes('$335,000'), 'inactive price shown as asking price');
      await shot(owner, `${label}-4-inactive-found`, '.flh-found');
      const row = await add(owner, url);
      assert(row.price === '' && row.days_on_market === '', `inactive price/DOM saved: ${row.price}/${row.days_on_market}`);
      assert(row.listing_import?.listing?.status === 'inactive' && row.listing_import.listing.lastKnownPrice === 335000, 'inactive snapshot');
      assert(row.listing_import.listingFacts.some((f) => f.key === 'lastKnownPrice' && /not a current asking price/.test(f.value)), 'last known price fact');
    }, open);

    await step(`[${label}] rate-limited: specific, non-technical note; the buyer can still add the home`, async () => {
      const url = listingUrl(SCENARIOS.limited, label);
      await find(owner, url);
      const card = await owner.locator('.flh-found').innerText();
      assert(/Property lookups are busy right now/.test(card), `rate-limit note: ${card.slice(0, 200)}`);
      assert(!/429|RentCast|rate limit/i.test(card), 'technical detail shown');
      await shot(owner, `${label}-5-rate-limited`, '.flh-found');
      const row = await add(owner, url);
      assert(row.listing_import === null && row.coordinate_status === 'unresolved', 'a failed lookup left import data');
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
