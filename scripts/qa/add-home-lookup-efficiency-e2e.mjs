#!/usr/bin/env node
// Browser QA for Add Home V3 phase 4, cost-conscious property lookups
// (docs/add-home-v3-lookup-efficiency.md). DEVELOPMENT ONLY. Same setup as the
// other Add Home QA (stand-in on real Postgres + dev server with the RentCast
// fixture); start the dev server with IMPORT_LOOKUP_USER_LIMIT=1000 so scripted
// runs never trip the per-user limit, and QA_RENTCAST_DELAY_MS=400 so a
// double-click lands while a lookup is in flight.
//
//   FLH_TEST_PGHOST=… FLH_TEST_PGPORT=… node scripts/qa/add-home-lookup-efficiency-e2e.mjs standin.json <outDir> [baseUrl]
//
// On desktop (1440) and iPhone (390), counting every POST to /api/import-listing:
// switching from an active listing (A) to an inactive one (B) clears A's price
// and says so, and the saved row holds only B; A→B→A→B is served from this
// session's cache; a saved address opens the duplicate view with no request; a
// double-click makes one request; "busy" (429) waits out a cooldown with no
// request and the address still saves by hand, with nothing from the earlier
// property; the per-user limit reads as such and manual save still works.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { chromium, devices } from 'playwright';

const [infoPath, outArg, base = 'http://localhost:3200'] = process.argv.slice(2);
if (!infoPath || !outArg) throw new Error('Usage: add-home-lookup-efficiency-e2e.mjs <standin.json> <outDir> [baseUrl]');
const info = JSON.parse(readFileSync(infoPath, 'utf8').split('\n')[0]);
const outDir = resolve(outArg);
mkdirSync(outDir, { recursive: true });
const IGNORED_CONSOLE = /Download the React DevTools|favicon|maps\.googleapis|Google Maps|places|Failed to load resource/i;
// [label, device, A (active), B (inactive), double-click, manual-after-busy, user-limit]
const VIEWPORTS = [
  ['desktop-1440', { viewport: { width: 1440, height: 900 } }, 51692, 51691, 51690, 51680, 51682],
  ['iphone-390', devices['iPhone 13'], 51694, 51695, 51693, 51681, 51683],
];
const addr = (number, street = 'Sass Rd') => `${number} ${street}, New Baltimore, MI 48047`;

function psql(sql) {
  const result = spawnSync('psql', ['-X', '-q', '-A', '-t', '-h', process.env.FLH_TEST_PGHOST, '-p', process.env.FLH_TEST_PGPORT || '5432', '-U', 'postgres', '-d', info.database, '-c', sql], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
}
const q = (sql) => JSON.parse(psql(`select coalesce(json_agg(t), '[]'::json) from (${sql}) t`));
const lit = (value) => `'${String(value).replace(/'/g, "''")}'`;
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const rowsAt = (number) => q(`select id, address, price, days_on_market, listing_url, listing_import from public.homes where search_id = ${lit(info.search)} and address like ${lit(`${number} Sass%`)}`);

async function signedIn(browser, who, device) {
  const context = await browser.newContext({ ...device });
  await context.addCookies([{ name: 'sb-localhost-auth-token', value: `base64-${Buffer.from(JSON.stringify(info.users[who].session)).toString('base64url')}`, domain: 'localhost', path: '/' }]);
  await context.addInitScript(() => { try { localStorage.setItem('flh-mobile-tour-dismissed', '1'); localStorage.setItem('flh-what-flh-found-dismissed', '1'); localStorage.setItem('flh-install-dismissed', '1'); } catch { /* ignore */ } });
  const page = await context.newPage();
  page.errors = [];
  page.lookups = 0;
  page.on('pageerror', (error) => page.errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error' && !IGNORED_CONSOLE.test(message.text())) page.errors.push(message.text().slice(0, 400)); });
  page.on('request', (request) => { if (request.method() === 'POST' && request.url().includes('/api/import-listing')) page.lookups += 1; });
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

async function openAdd(page) {
  await page.goto(`${base}/homes`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /Add a Home/ }).first().click();
  await page.getByLabel('Listing link or address').waitFor();
}
async function search(page, text) {
  const change = page.getByRole('button', { name: 'Change the listing link or address' });
  if (await change.count()) await change.click();
  await page.getByLabel('Listing link or address').fill(text);
  await page.getByRole('button', { name: /^Find home$/ }).click();
}
async function waitFound(page, number) {
  await page.locator('#found-home-title', { hasText: String(number) }).waitFor({ timeout: 30000 });
}
async function waitAddressCard(page) {
  await page.locator('.flh-found-address').waitFor({ timeout: 30000 });
}
const priceLine = (page) => page.locator('.flh-found-price').innerText();
async function save(page) {
  await page.getByRole('button', { name: /^Save Home$/ }).click();
  await page.locator('.flh-saved').waitFor({ timeout: 60000 });
}

async function run() {
  const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {});
  psql(`delete from public.homes where search_id = ${lit(info.search)} and address ~ '^516(19|8[0-9]|9[0-9]) Sass'`);
  for (const [label, device, A, B, dbl, manual, limited] of VIEWPORTS) {
    let owner;
    const open = () => [owner].filter(Boolean);

    await step(`[${label}] A→B: the second address clears the first one's price and says so; one request each`, async () => {
      owner = await signedIn(browser, 'owner', device);
      await openAdd(owner);
      await search(owner, addr(A));
      await waitFound(owner, A);
      assert(/335,000/.test(await priceLine(owner)), `A shows its asking price (${await priceLine(owner)})`);
      assert(owner.lookups === 1, `A: ${owner.lookups} requests`);
      await shot(owner, `after-${label}-1-found-A`);
      await search(owner, addr(B));
      await waitFound(owner, B);
      const card = await owner.locator('.flh-found').innerText();
      assert(!/335,000/.test(card), 'A’s price must not appear on B');
      const note = await owner.locator('.flh-switch-note').innerText();
      assert(/^We cleared \d+ details? from the previous address\. Anything you typed is kept\.$/.test(note), `switch note: ${note}`);
      assert(owner.lookups === 2, `B: ${owner.lookups} requests`);
      await shot(owner, `after-${label}-2-switched-to-B`);
    }, open);

    await step(`[${label}] A→B→A→B is served from this session's cache: no further requests`, async () => {
      await search(owner, addr(A).replace('Sass Rd', 'Sass Road'));
      await waitFound(owner, A);
      assert(/335,000/.test(await priceLine(owner)), 'A again, with its own price');
      await search(owner, addr(B));
      await waitFound(owner, B);
      assert(!/335,000/.test(await owner.locator('.flh-found').innerText()), 'still no A data on B');
      assert(owner.lookups === 2, `cache: ${owner.lookups} requests (expected 2)`);
    }, open);

    await step(`[${label}] saving after the switch: the row holds only B (inactive, no price, no A in the snapshot)`, async () => {
      await save(owner);
      const rows = rowsAt(B);
      assert(rows.length === 1, `${rows.length} B rows`);
      const [row] = rows;
      assert(!row.price && !row.days_on_market, `B price/DOM: ${row.price}/${row.days_on_market}`);
      assert(row.listing_import?.listing?.status === 'inactive', 'B snapshot status');
      assert(!JSON.stringify(row.listing_import).includes(String(A)), 'A in B’s snapshot');
      assert(rowsAt(A).length === 0, 'A was not saved');
      await shot(owner, `after-${label}-3-saved-B`);
    }, open);

    await step(`[${label}] a saved address (typed another way) opens that home with no request`, async () => {
      await openAdd(owner);
      const before = owner.lookups;
      await search(owner, addr(B, 'Sass Road').replace(', MI 48047', ', Michigan 48047'));
      await owner.locator('.flh-duplicate-home').waitFor({ timeout: 15000 });
      assert(/already added a home at this address/.test(await owner.locator('.flh-duplicate-home').innerText()), 'address copy');
      assert(owner.lookups === before, `${owner.lookups - before} requests for a duplicate`);
      await shot(owner, `after-${label}-4-address-duplicate`);
    }, open);

    await step(`[${label}] double-clicking Find (and Enter on top) makes one request`, async () => {
      await openAdd(owner);
      const before = owner.lookups;
      await owner.getByLabel('Listing link or address').fill(addr(dbl));
      await owner.getByRole('button', { name: /^Find home$/ }).dblclick();
      await owner.getByLabel('Listing link or address').press('Enter').catch(() => {});
      await waitFound(owner, dbl);
      await owner.waitForTimeout(800);
      assert(owner.lookups - before === 1, `${owner.lookups - before} requests for a double-click`);
    }, open);

    await step(`[${label}] busy (429): a cooldown with no request, then manual save works with nothing from the earlier property`, async () => {
      // Continues in the same Add Home: dbl is shown (active, priced).
      let before = owner.lookups;
      await search(owner, addr(51619));
      await waitAddressCard(owner);
      assert(/busy right now/.test(await owner.locator('.flh-found-address').innerText()), 'busy note');
      assert(owner.lookups - before === 1, 'one request for the busy lookup');
      before = owner.lookups;
      await search(owner, addr(manual));
      await waitAddressCard(owner);
      const note = await owner.locator('.flh-found-address').innerText();
      assert(/Property lookups are busy right now\. Add the address and fill in the rest on Home Facts, or try again in a minute\./.test(note), `cooldown note: ${note}`);
      assert(owner.lookups === before, `${owner.lookups - before} requests during the cooldown`);
      assert(await owner.locator('#found-home-address').inputValue() === addr(manual), 'address kept for manual save');
      await shot(owner, `after-${label}-5-cooldown-manual`);
      await save(owner);
      const [row] = rowsAt(manual);
      assert(row && !row.price && !row.listing_import, `manual row: ${JSON.stringify(row)}`);
      assert(rowsAt(dbl).length === 0 && rowsAt(51619).length === 0, 'nothing else saved');
    }, open);

    await step(`[${label}] per-user limit: its own message, and the address still saves by hand`, async () => {
      await openAdd(owner);
      await owner.route('**/api/import-listing', (route) => route.fulfill({ status: 429, headers: { 'Retry-After': '300', 'content-type': 'application/json' }, body: JSON.stringify({ error: 'You’ve looked up a lot of addresses in a short time.', reason: 'user_limit' }) }));
      await search(owner, addr(limited));
      await waitAddressCard(owner);
      assert(/You’ve looked up a lot of addresses in a short time\. Add this home by its address now, and try a lookup again in a few minutes\./.test(await owner.locator('.flh-found-address').innerText()), 'limit note');
      await shot(owner, `after-${label}-6-user-limit`);
      await save(owner);
      await owner.unroute('**/api/import-listing');
      assert(rowsAt(limited).length === 1, 'saved by hand');
    }, open);
    await owner?.context().close();
  }
  await browser.close();
  writeFileSync(join(outDir, 'add-home-lookup-efficiency-e2e.json'), JSON.stringify(log, null, 2));
  const failed = log.filter((entry) => !entry.ok);
  console.log(`${log.length - failed.length}/${log.length} steps passed`);
  psql(`delete from public.homes where search_id = ${lit(info.search)} and address ~ '^516(19|8[0-9]|9[0-9]) Sass'`);
  if (failed.length) process.exit(1);
}
run().catch((error) => { console.error(error); process.exit(1); });
