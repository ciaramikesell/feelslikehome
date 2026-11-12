#!/usr/bin/env node
// Browser QA for Add Home V3 phase 1, the simple save
// (docs/add-home-v3-simple-save.md). DEVELOPMENT ONLY. Same setup as
// rentcast-import-e2e.mjs: the Supabase stand-in on real Postgres, plus a dev
// server with the RentCast fixture, which answers by house number on Sass Rd
// (51619 is rate-limited; any other number is a complete, matching lookup; a
// different street comes back as a different address, so nothing is used).
//
//   FLH_TEST_PGHOST=… FLH_TEST_PGPORT=… node scripts/qa/add-home-simple-save-e2e.mjs standin.json <outDir> [baseUrl]
//
// On desktop (1440) and iPhone (390) it covers: a successful lookup saved with
// one Save Home; optional pasted text left unreviewed; the missing-data
// fallback; a failed lookup; a duplicate listing; a photo added on the card; a
// failed photo upload; the co-buyer; and the Share Extension's universal-link
// entry (/homes?url=). The saved rows are checked in real Postgres. Any failed
// step, horizontal overflow or unexpected console error fails the run.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { chromium, devices } from 'playwright';

const [infoPath, outArg, base = 'http://localhost:3200'] = process.argv.slice(2);
if (!infoPath || !outArg) throw new Error('Usage: add-home-simple-save-e2e.mjs <standin.json> <outDir> [baseUrl]');
const info = JSON.parse(readFileSync(infoPath, 'utf8').split('\n')[0]);
const outDir = resolve(outArg);
mkdirSync(outDir, { recursive: true });
const IGNORED_CONSOLE = /Download the React DevTools|favicon|maps\.googleapis|Google Maps|places|Failed to load resource/i;
const VIEWPORTS = [
  ['desktop-1440', { viewport: { width: 1440, height: 900 } }, 0],
  ['iphone-390', devices['iPhone 13'], 50],
];
const listingUrl = (number) => `https://www.zillow.com/homedetails/${number}-Sass-Rd-New-Baltimore-MI-48047/${number}_zpid/`;
// Listing text that carries an image link: it must never become the home's photo.
const IMAGE_URL = 'https://photos.zillowstatic.com/fp/qa-front-uncropped_scaled_within_1536_1152.jpg';
const PASTE_WITH_IMAGE = `Charming colonial. ${IMAGE_URL} Finished basement. Laundry on the main level.`;
const PASTE = 'Finished walkout basement with rec room. Laundry on the main level. Primary suite on the first floor. Gas fireplace in the family room. HOA $85/month.';
// A 1×1 PNG, as a buyer's own photo.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

function psql(sql) {
  const result = spawnSync('psql', ['-X', '-q', '-A', '-t', '-h', process.env.FLH_TEST_PGHOST, '-p', process.env.FLH_TEST_PGPORT || '5432', '-U', 'postgres', '-d', info.database, '-c', sql], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
}
const q = (sql) => JSON.parse(psql(`select coalesce(json_agg(t), '[]'::json) from (${sql}) t`));
const lit = (value) => `'${String(value).replace(/'/g, "''")}'`;
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const rowsWhere = (where) => q(`select h.id, h.user_id, h.address, h.listing_url, h.price, h.beds, h.garage_type, h.hoa_fee_monthly, h.property_tax_annual, h.basement_condition, h.laundry_location,
  h.photo_url, h.notes, h.coordinate_source, h.listing_import, (select coalesce(json_agg(s.checks), '[]'::json) from public.home_member_state s where s.home_id = h.id) as checks
  from public.homes h where h.search_id = ${lit(info.search)} and ${where}`);

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

async function openAddHome(page) {
  await page.goto(`${base}/homes`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /Add a Home/ }).first().click();
}
async function find(page, value) {
  await openAddHome(page);
  await page.getByLabel('Listing link or address').fill(value);
  await page.getByRole('button', { name: /^Find home$/ }).click();
  await page.locator('.flh-found').waitFor({ timeout: 30000 });
}
const saveButton = (page) => page.getByRole('button', { name: /^Save Home$/ });
// Save Home is on screen without scrolling (the found home and its one action come first).
async function saveIsVisibleWithoutScrolling(page) {
  const box = await saveButton(page).boundingBox();
  const height = page.viewportSize().height;
  assert(box && box.y >= 0 && box.y + box.height <= height, `Save Home is off screen (top ${box && Math.round(box.y)} of ${height})`);
}
async function save(page) {
  await saveButton(page).click();
  await page.locator('.flh-saved').waitFor({ timeout: 60000 });
  assert(await page.getByRole('heading', { name: 'Saved to My Homes' }).isVisible(), 'no saved state');
}

async function run() {
  const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {});
  psql(`delete from public.homes where search_id = ${lit(info.search)} and (address ~ '^51(6[2-9]|7[0-9])[0-9] (Sass Rd|Elm St)' or address like '51619 Sass Rd%')`);
  for (const [label, device, offset] of VIEWPORTS) {
    let owner; let coBuyer;
    const open = () => [owner, coBuyer].filter(Boolean);
    const n = (k) => 51620 + offset + k;

    await step(`[${label}] successful lookup: a recognizable home, one Save Home, a clear saved state, back to My Homes`, async () => {
      owner = await signedIn(browser, 'owner', device);
      const url = listingUrl(n(1));
      await find(owner, url);
      const card = await owner.locator('.flh-found').innerText();
      assert(/We found your home/.test(card) && card.includes(`${n(1)} Sass Rd`) && card.includes('New Baltimore, MI 48047'), 'address/location missing');
      assert(card.includes('$335,000') && /5 bd/.test(card) && /2 ba/.test(card) && /2,080 sq ft/.test(card) && /Built 1993/.test(card), `essentials: ${card.slice(0, 300)}`);
      // What FLH found, not what is saved (nothing is saved yet).
      assert(/We found 18 details about this home\./.test(card) && !/saved with it|marked From listing/.test(card), `detail count copy: ${card.slice(0, 400)}`);
      assert(await owner.locator('.flh-found-photo.is-placeholder').isVisible(), 'no neutral placeholder');
      assert(await owner.getByRole('button', { name: 'Add photo' }).isVisible(), 'no Add photo on the card');
      assert(!(await owner.locator('.flh-found-more').getAttribute('open')), 'optional paste is open by default');
      assert(!(await owner.locator('.flh-found-notes').getAttribute('open')), 'notes are open by default');
      await saveIsVisibleWithoutScrolling(owner);
      await shot(owner, `after-${label}-1-found`);
      await save(owner);
      await shot(owner, `after-${label}-2-saved`);
      const rows = rowsWhere(`listing_url = ${lit(url)}`);
      assert(rows.length === 1, `expected one home, found ${rows.length}`);
      const row = rows[0];
      // Everything the lookup returned is kept, even what the card doesn't show.
      assert(row.price === '335000' && row.garage_type === 'attached' && Number(row.hoa_fee_monthly) === 0 && Number(row.property_tax_annual) === 4210 && row.coordinate_source === 'rentcast', `lookup data: ${JSON.stringify(row).slice(0, 300)}`);
      assert(row.listing_import?.source === 'rentcast' && row.listing_import.listing?.status === 'active' && row.listing_import.listingFacts.length > 0, 'snapshot not kept');
      assert(row.checks.every((checks) => !checks || !Object.keys(checks).length), 'a Match answer was written');
      await owner.getByRole('button', { name: 'Back to My Homes' }).click();
      await owner.locator('.flh-saved').waitFor({ state: 'detached' });
      assert(/\/homes$/.test(new URL(owner.url()).pathname), `not on My Homes: ${owner.url()}`);
      await owner.getByText(`${n(1)} Sass Rd`).first().waitFor();
      await shot(owner, `after-${label}-3-back-on-my-homes`);
      await owner.reload({ waitUntil: 'networkidle' });
      await owner.getByText(`${n(1)} Sass Rd`).first().waitFor({ timeout: 15000 });
    }, open);

    await step(`[${label}] optional paste never blocks Save Home: text pasted, nothing reviewed, nothing auto-accepted; View home opens the overview`, async () => {
      const url = listingUrl(n(2));
      await find(owner, url);
      await owner.locator('.flh-found-more > summary').click();
      await owner.locator('#flh-listing-paste-text').fill(PASTE);
      await owner.getByRole('button', { name: 'Fill in details' }).click();
      await owner.locator('.flh-fact-review').waitFor();
      assert(/to review/.test(await owner.locator('.flh-found-more > summary').innerText()), 'pending reviews not counted on the disclosure');
      // The reviews sit below Save Home, never above it.
      const saveTop = (await saveButton(owner).boundingBox()).y;
      const reviewTop = (await owner.locator('.flh-fact-review').boundingBox()).y;
      assert(saveTop < reviewTop, 'a review sits above Save Home');
      await owner.locator('.hh-modal').evaluate((el) => el.scrollTo(0, 0));
      await shot(owner, `after-${label}-4-paste-open`);
      await saveButton(owner).scrollIntoViewIfNeeded();
      await save(owner);
      const row = rowsWhere(`listing_url = ${lit(url)}`)[0];
      assert(row && row.basement_condition === null && row.laundry_location === null, 'an unreviewed Home Fact was written');
      assert(row.checks.every((checks) => !checks || !Object.keys(checks).length), 'a personal answer was accepted');
      await owner.getByRole('button', { name: /^View home/ }).click();
      await owner.waitForURL(new RegExp(`/homes/${row.id}$`), { timeout: 30000 });
      await owner.locator('.flh-overlay[role="dialog"]:not(.is-loading)').waitFor({ timeout: 30000 });
      // Provenance is kept: the saved snapshot still proves which values came from the listing.
      const { fieldProvenance } = await import('../../src/lib/homeProvenance.js');
      assert(fieldProvenance(row.price, row.listing_import, 'price') === 'listing' && row.listing_import.fields.price === row.price, 'listing provenance lost');
      await shot(owner, `after-${label}-5-view-home`);
    }, open);

    await step(`[${label}] missing data: no matching record → address only → Save Home`, async () => {
      const address = `${n(3)} Elm St, Royal Oak, MI 48067`;
      await find(owner, address);
      const card = await owner.locator('.flh-found').innerText();
      assert(/Where is this home\?/.test(card), 'no address fallback');
      assert(await owner.locator('#found-home-address').inputValue() === address, 'address not kept');
      await saveIsVisibleWithoutScrolling(owner);
      await shot(owner, `after-${label}-6-missing-data`);
      await save(owner);
      const rows = rowsWhere(`address = ${lit(address)}`);
      assert(rows.length === 1 && rows[0].listing_import === null && rows[0].price === '', `missing-data row: ${JSON.stringify(rows).slice(0, 200)}`);
      await owner.getByRole('button', { name: 'Back to My Homes' }).click();
    }, open);

    await step(`[${label}] failed lookup (rate-limited): calm note, still saved with one Save Home`, async () => {
      const url = listingUrl(51619);
      psql(`delete from public.homes where listing_url = ${lit(url)}`);
      await find(owner, url);
      const card = await owner.locator('.flh-found').innerText();
      assert(/Property lookups are busy right now/.test(card) && !/429|RentCast/i.test(card), 'failure note');
      await shot(owner, `after-${label}-7-failed-lookup`);
      await save(owner);
      const rows = rowsWhere(`listing_url = ${lit(url)}`);
      assert(rows.length === 1 && rows[0].listing_import === null, 'failed lookup row');
      await owner.getByRole('button', { name: 'Back to My Homes' }).click();
    }, open);

    await step(`[${label}] duplicate: the same listing is opened, never saved twice`, async () => {
      const url = listingUrl(n(1));
      await openAddHome(owner);
      await owner.getByLabel('Listing link or address').fill(url);
      await owner.getByRole('button', { name: /^Find home$/ }).click();
      await owner.getByRole('heading', { name: /already here/ }).waitFor({ timeout: 15000 });
      await shot(owner, `after-${label}-8-duplicate`);
      assert(rowsWhere(`listing_url = ${lit(url)}`).length === 1, 'duplicate saved');
    }, open);

    await step(`[${label}] photo: Add photo on the card, saved with the home`, async () => {
      const url = listingUrl(n(4));
      await find(owner, url);
      await owner.locator('.flh-found-photo input[type=file]').setInputFiles({ name: 'front.png', mimeType: 'image/png', buffer: PNG });
      await owner.locator('.flh-found-photo.has-photo img').waitFor();
      assert(await owner.getByRole('button', { name: 'Change photo' }).isVisible(), 'no Change photo');
      await shot(owner, `after-${label}-9-photo-staged`);
      await save(owner);
      assert(await owner.locator('.flh-saved-photo img').count() === 1, 'saved state has no photo');
      assert(!(await owner.locator('.flh-saved-photo-note').count()), 'photo reported as failed');
      const row = rowsWhere(`listing_url = ${lit(url)}`)[0];
      assert(/\/storage\/v1\/object\/public\/home-photos\//.test(row.photo_url), `photo_url: ${row.photo_url}`);
      await owner.getByRole('button', { name: 'Back to My Homes' }).click();
    }, open);

    await step(`[${label}] pasted image URL: never sets the photo; a photo the buyer added is kept through a re-paste`, async () => {
      const paste = async (text) => {
        const more = owner.locator('details.flh-found-more:not([open]) > summary');
        if (await more.count()) await more.click();
        await owner.locator('#flh-listing-paste-text').fill(text);
        await owner.getByRole('button', { name: 'Fill in details' }).click();
        await owner.locator('.flh-listing-paste-status').waitFor();
      };
      // No photo: pasting text with an image link leaves the placeholder.
      const bare = listingUrl(n(8));
      await find(owner, bare);
      await paste(PASTE_WITH_IMAGE);
      assert(await owner.locator('.flh-found-photo.is-placeholder').isVisible(), 'a pasted image link became the photo');
      assert(!(await owner.locator(`img[src="${IMAGE_URL}"]`).count()), 'the listing image is shown');
      await owner.locator('.hh-modal').evaluate((el) => el.scrollTo(0, 0));
      await shot(owner, `after-${label}-13-pasted-image-ignored`);
      await saveButton(owner).scrollIntoViewIfNeeded();
      await save(owner);
      assert(rowsWhere(`listing_url = ${lit(bare)}`)[0]?.photo_url === '', 'saved with the pasted image');
      await owner.getByRole('button', { name: 'Back to My Homes' }).click();
      // A photo the buyer added survives pasting (and re-pasting) text with an image link.
      const kept = listingUrl(n(9));
      await find(owner, kept);
      await owner.locator('.flh-found-photo input[type=file]').setInputFiles({ name: 'mine.png', mimeType: 'image/png', buffer: PNG });
      await owner.locator('.flh-found-photo.has-photo img').waitFor();
      await paste(PASTE_WITH_IMAGE);
      await paste(`${PASTE_WITH_IMAGE} Two-car attached garage.`);
      assert(/^blob:/.test(await owner.locator('.flh-found-photo.has-photo img').getAttribute('src')), 'the buyer\'s photo was replaced');
      await saveButton(owner).scrollIntoViewIfNeeded();
      await save(owner);
      const row = rowsWhere(`listing_url = ${lit(kept)}`)[0];
      assert(/\/storage\/v1\/object\/public\/home-photos\//.test(row.photo_url) && !row.photo_url.includes('zillowstatic'), `photo_url: ${row.photo_url}`);
      await owner.getByRole('button', { name: 'Back to My Homes' }).click();
    }, open);

    await step(`[${label}] failed photo upload: the home and everything typed are saved; the buyer is told about the photo`, async () => {
      const url = listingUrl(n(5));
      await find(owner, url);
      await owner.locator('.flh-found-notes > summary').click();
      await owner.locator('#add-home-notes').fill('Ask about the roof');
      await owner.locator('.flh-found-photo input[type=file]').setInputFiles({ name: 'front.png', mimeType: 'image/png', buffer: PNG });
      await owner.route('**/storage/v1/object/home-photos/**', (route) => (route.request().method() === 'POST' ? route.fulfill({ status: 500, body: '{"message":"QA: upload failed"}' }) : route.continue()));
      owner.errors.length = 0;
      await saveButton(owner).scrollIntoViewIfNeeded();
      await save(owner);
      await owner.unroute('**/storage/v1/object/home-photos/**');
      owner.errors.splice(0); // the failed upload's own 500 is expected
      assert(/photo didn.t upload/.test(await owner.locator('.flh-saved-photo-note').innerText()), 'no photo note');
      await shot(owner, `after-${label}-10-photo-failed`);
      const rows = rowsWhere(`listing_url = ${lit(url)}`);
      assert(rows.length === 1 && rows[0].photo_url === '' && rows[0].notes === 'Ask about the roof' && rows[0].price === '335000', `row: ${JSON.stringify(rows).slice(0, 300)}`);
      await owner.getByRole('button', { name: 'Back to My Homes' }).click();
    }, open);

    await step(`[${label}] co-buyer: saves with the same one action; the owner sees the home`, async () => {
      coBuyer = await signedIn(browser, 'coBuyer', device);
      const url = listingUrl(n(6));
      await find(coBuyer, url);
      await save(coBuyer);
      assert(/shared with everyone in this search/.test(await coBuyer.locator('.flh-saved').innerText()), 'collaborative saved copy');
      await shot(coBuyer, `after-${label}-11-cobuyer-saved`);
      const rows = rowsWhere(`listing_url = ${lit(url)}`);
      assert(rows.length === 1 && rows[0].user_id === info.users.coBuyer.id, 'co-buyer row');
      await owner.goto(`${base}/homes`, { waitUntil: 'networkidle' });
      await owner.getByText(`${n(6)} Sass Rd`).first().waitFor({ timeout: 15000 });
      await coBuyer.context().close(); coBuyer = null;
    }, open);

    await step(`[${label}] Share Extension entry (/homes?url=): finds automatically, one Save Home; a shared duplicate opens the saved home`, async () => {
      const url = listingUrl(n(7));
      await owner.goto(`${base}/homes?url=${encodeURIComponent(url)}`, { waitUntil: 'networkidle' });
      await owner.locator('.flh-found-card').waitFor({ timeout: 30000 });
      await saveIsVisibleWithoutScrolling(owner);
      await shot(owner, `after-${label}-12-share-entry`);
      await save(owner);
      assert(rowsWhere(`listing_url = ${lit(url)}`).length === 1, 'shared link not saved');
      await owner.getByRole('button', { name: 'Back to My Homes' }).click();
      await owner.goto(`${base}/homes?url=${encodeURIComponent(url)}`, { waitUntil: 'networkidle' });
      const id = rowsWhere(`listing_url = ${lit(url)}`)[0].id;
      await owner.waitForURL(new RegExp(`/homes/${id}$`), { timeout: 30000 });
      assert(rowsWhere(`listing_url = ${lit(url)}`).length === 1, 'shared duplicate saved');
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
