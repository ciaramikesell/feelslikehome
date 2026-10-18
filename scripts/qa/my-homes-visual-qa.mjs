#!/usr/bin/env node
// Browser QA for the My Homes visual refresh (Phase 1). DEVELOPMENT ONLY.
//
//   1. FLH_TEST_PGHOST=… FLH_TEST_PGPORT=… node scripts/qa/supabase-standin.mjs 54321 > standin.json
//   2. NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=qa npx next dev -p 3200
//   3. (optional) serve listing photos: python3 -m http.server 3301 in a folder with
//      briar-towne.jpg, briar-ct.jpg, vernier-cir.jpg, vernier-rd.jpg
//   4. node scripts/qa/my-homes-visual-qa.mjs standin.json <outDir> [baseUrl] [photoBaseUrl]
//
// Seeds Figma-like homes into the stand-in's real Postgres, then drives the app
// as the signed-in owner, co-buyer and Realtor. Asserts the 4/2/1-column grid,
// no horizontal overflow, the header/toolbar contract, and that Want to Tour,
// Archive and Restore persist (checked against the database). Screenshots land
// in <outDir>; any failed step or unexpected console error fails the run.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';

const [infoPath, outArg, base = 'http://localhost:3200', photoBase = 'http://localhost:3301'] = process.argv.slice(2);
if (!infoPath || !outArg) throw new Error('Usage: my-homes-visual-qa.mjs <standin.json> <outDir> [baseUrl] [photoBaseUrl]');
const info = JSON.parse(readFileSync(infoPath, 'utf8'));
const outDir = resolve(outArg);
mkdirSync(outDir, { recursive: true });
const IGNORED_CONSOLE = /Download the React DevTools|favicon|maps\.googleapis|Google Maps|places|Failed to load resource|bad HTTP response code/i;

const pg = ['-X', '-q', '-A', '-t', '-h', process.env.FLH_TEST_PGHOST, '-p', process.env.FLH_TEST_PGPORT || '5432', '-U', 'postgres', '-d', info.database];
function q(sql) {
  const result = spawnSync('psql', [...pg, '-c', `select coalesce(json_agg(t), '[]'::json) from (${sql}) t`], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr);
  return JSON.parse(result.stdout.trim());
}
function exec(sql) {
  const result = spawnSync('psql', [...pg, '-v', 'ON_ERROR_STOP=1', '-c', sql], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr);
}
const lit = (value) => (value === null ? 'null' : `'${String(value).replace(/'/g, "''")}'`);
const arr = (values) => `array[${values.map(lit).join(',')}]::text[]`;
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const log = [];

const owner = info.users.owner.id;
const coBuyer = info.users.coBuyer.id;
const HOMES = [
  { key: 'briar-towne', address: '25992 Briar Towne Blvd, Chesterfield, MI 48051', price: '319900', est: '2574', beds: '3', baths: '2.5', sqft: '1832', lot: '0.13 acres', garage: '2', garageType: 'attached', bStyle: 'traditional', bCond: 'finished', condition: ['Move-In Ready'], school: "L'anse Creuse", layout: ['Two Story'], status: 'Want to Tour', checks: { 'exterior:Garage': true, 'features:Finished basement': true, 'features:Fireplace': false }, ageDays: 1 },
  { key: 'briar-ct', address: '21223 Briar Ct, Saint Clair Shores, MI 48081', price: '324980', est: '2828', beds: '5', baths: '2.5', sqft: '1794', lot: '0.15 acres', garage: '2', garageType: null, bStyle: null, bCond: 'finished', condition: ['Renovation Potential'], school: 'Lake View', layout: ['Two Story'], status: 'Saved', checks: { 'exterior:Garage': true, 'features:Finished basement': true }, ageDays: 2 },
  { key: 'vernier-cir', address: '20680 Vernier Cir, Grosse Pointe Woods, MI 48236', price: '279000', est: '2474', beds: '3', baths: '1.5', sqft: '1553', lot: '0.16 acres', garage: '2', garageType: null, bStyle: null, bCond: 'unfinished', condition: ['Renovation Potential'], school: 'Grosse Pointe', layout: ['Two Story'], status: 'Saved', checks: { 'exterior:Garage': true, 'features:Finished basement': false }, ageDays: 3 },
  { key: 'vernier-rd', address: '71 Vernier Rd, Grosse Pointe Shores, MI 48236', price: '299900', est: '2661', beds: '3', baths: '2', sqft: '1242', lot: '0.17 acres', garage: '1', garageType: null, bStyle: null, bCond: 'unfinished', condition: ['Renovation Potential'], school: 'Grosse Pointe', layout: ['Two Story'], status: 'Saved', checks: { 'exterior:Garage': true }, ageDays: 4 },
  // Missing data: no photo, no facts, a long address, Unknown Must Haves.
  { key: 'sparse', address: '18400 Northeast Lakeshore Boulevard Extension Unit 2B, Saint Clair Shores, MI 48080', price: '', est: '', beds: '', baths: '', sqft: '', lot: '', garage: '', garageType: null, bStyle: null, bCond: null, condition: [], school: null, layout: [], status: 'Saved', checks: {}, ageDays: 5, noPhoto: true, noListing: true },
  { key: 'archived', address: '1440 Beaconsfield Ave, Grosse Pointe Park, MI 48230', price: '264500', est: '2210', beds: '3', baths: '1', sqft: '1310', lot: '0.11 acres', garage: '1', garageType: 'detached', bStyle: 'traditional', bCond: 'unfinished', condition: ['Needs Work'], school: 'Grosse Pointe', layout: ['Bungalow'], status: 'Archived', reason: 'Only one bathroom and a busy street.', checks: { 'exterior:Garage': true }, ageDays: 6 },
];

function seed() {
  exec(`delete from public.homes where search_id = '${info.search}'`);
  exec(`delete from public.commute_destinations where search_id = '${info.search}'`);
  // created_at is stamped on insert, so insert oldest first: Newest then matches Figma's order.
  for (const [i, home] of [...HOMES.entries()].reverse()) {
    home.id = randomUUID();
    const photo = home.noPhoto || home.key === 'archived' ? '' : `${photoBase}/${home.key}.jpg`;
    exec(`insert into public.homes (id, user_id, search_id, address, listing_url, photo_url, price, est_monthly, beds, baths, sqft, lot_size, garage_spaces, garage_type, basement_style, basement_condition, home_condition, school_district, home_layout, created_at)
      values ('${home.id}', '${owner}', '${info.search}', ${lit(home.address)}, ${lit(home.noListing ? '' : `https://www.zillow.com/homedetails/${home.key}/${i}_zpid/`)}, ${lit(photo)}, ${lit(home.price)}, ${lit(home.est)}, ${lit(home.beds)}, ${lit(home.baths)}, ${lit(home.sqft)}, ${lit(home.lot)}, ${lit(home.garage)}, ${lit(home.garageType)}, ${lit(home.bStyle)}, ${lit(home.bCond)}, ${arr(home.condition)}, ${lit(home.school)}, ${arr(home.layout)}, now() - interval '${home.ageDays} days')`);
    exec(`insert into public.home_member_state (home_id, user_id, status, rejection_reason, checks) values ('${home.id}', '${owner}', ${lit(home.status)}, ${lit(home.reason || '')}, ${lit(JSON.stringify(home.checks))}::jsonb)`);
  }
  exec(`insert into public.commute_destinations (search_id, user_id, label, address) values ('${info.search}', '${owner}', 'Mom', '1 Woodward Ave, Detroit, MI'), ('${info.search}', '${owner}', 'Dad''s', '300 Renaissance Center, Detroit, MI')`);
}
const MINUTES = { 'briar-towne': [14, 16], 'briar-ct': [27, 28], 'vernier-cir': [30, 32], 'vernier-rd': [30, 32], sparse: [22, 25] };

async function signedIn(browser, who, width) {
  const context = await browser.newContext({ viewport: { width, height: width < 500 ? 844 : 900 }, deviceScaleFactor: width < 500 ? 2 : 1 });
  const session = info.users[who].session;
  await context.addCookies([{ name: 'sb-localhost-auth-token', value: `base64-${Buffer.from(JSON.stringify(session)).toString('base64url')}`, domain: 'localhost', path: '/' }]);
  await context.addInitScript(() => { try { localStorage.setItem('flh-mobile-tour-dismissed', '1'); localStorage.setItem('flh-name-prompt-dismissed', '1'); } catch { /* ignore */ } });
  // Route times come from Google in production; QA answers /api/commute itself.
  await context.route('**/api/commute', async (route) => {
    const { homeIds = [], destinationIds = [] } = JSON.parse(route.request().postData() || '{}');
    const destinations = q(`select id, label from public.commute_destinations where id in (${destinationIds.map(lit).join(',') || 'null'})`);
    const results = {};
    for (const homeId of homeIds) {
      const home = HOMES.find((candidate) => candidate.id === homeId);
      results[homeId] = Object.fromEntries(destinations.map((d) => [d.id, { status: 'ok', minutes: (MINUTES[home?.key] || [20, 20])[d.label === 'Mom' ? 0 : 1] }]));
    }
    await route.fulfill({ json: { results } });
  });
  const page = await context.newPage();
  page.errors = [];
  page.on('pageerror', (error) => page.errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error' && !IGNORED_CONSOLE.test(message.text())) page.errors.push(message.text()); });
  return page;
}

async function settle(page) {
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
}

async function overflow(page) {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

async function shot(page, name, { full = true, locator = null } = {}) {
  await settle(page);
  const extra = await overflow(page);
  const file = join(outDir, `${name}.png`);
  if (locator) await locator.screenshot({ path: file });
  else await page.screenshot({ path: file, fullPage: full });
  assert(extra <= 0, `${name}: horizontal overflow ${extra}px`);
  return file;
}

async function step(name, fn) {
  const started = Date.now();
  try { await fn(); log.push({ step: name, ok: true, ms: Date.now() - started }); console.log('ok  ', name); }
  catch (error) { log.push({ step: name, ok: false, error: error.message }); console.error('FAIL', name, '—', error.message); }
}

const stateOf = (key, user = owner) => q(`select status, rejection_reason from public.home_member_state where home_id = '${HOMES.find((h) => h.key === key).id}' and user_id = '${user}'`)[0];
const cardFor = (page, street) => page.locator('article.hh-home-card').filter({ has: page.getByRole('heading', { name: street }) });

async function columns(page) {
  return page.evaluate(() => {
    const cards = [...document.querySelectorAll('.hh-homes-grid > article')];
    const top = cards[0]?.getBoundingClientRect().top;
    return cards.filter((card) => Math.abs(card.getBoundingClientRect().top - top) < 2).length;
  });
}

const EXPECTED_COLUMNS = { 375: 1, 390: 1, 768: 2, 1024: 2, 1440: 4 };

async function main() {
  seed();
  const browser = await chromium.launch({ executablePath: process.env.FLH_CHROMIUM || undefined });

  for (const width of [1440, 1024, 768, 390, 375]) {
    const page = await signedIn(browser, 'owner', width);
    await step(`[${width}] My Homes: header, toolbar, ${EXPECTED_COLUMNS[width]}-column grid, no overflow`, async () => {
      await page.goto(`${base}/homes`, { waitUntil: 'networkidle' });
      await page.getByRole('heading', { name: '25992 Briar Towne Blvd' }).waitFor();
      await settle(page);
      // Header contract.
      for (const name of ['My Search', 'How it works', 'Sign out']) assert(await page.getByRole('navigation', { name: 'Account and search' }).getByText(name, { exact: true }).isVisible(), `utility "${name}" not visible`);
      assert(await page.getByRole('link', { name: 'Account & Settings' }).isVisible(), 'Account not visible');
      assert(await page.getByText('THE HOME MATCHMAKER').isVisible(), 'tagline missing');
      const tabs = await page.getByRole('navigation', { name: 'Primary navigation' }).first().locator('a').allInnerTexts();
      assert(JSON.stringify(tabs) === JSON.stringify(['Homes', 'Want to Tour', 'Compare', 'Map', 'Archived']), `tabs: ${tabs}`);
      assert(await page.locator('.hh-tabs a[aria-current="page"]').innerText() === 'Homes', 'Homes is not the current tab');
      // The heading stays for assistive technology only (visually hidden).
      const heading = await page.getByRole('heading', { level: 1, name: 'My Homes' }).boundingBox();
      assert(heading && heading.width <= 1 && heading.height <= 1, 'old My Homes heading still visible');
      assert(!(await page.getByText('All the places you’re considering').count()), 'old subtitle still rendered');
      // Toolbar contract.
      const chips = await page.locator('.hh-filter-chips button').allInnerTexts();
      assert(chips.length === 4 && chips[0] === 'All (5)' && chips[3] === 'Want to Tour (1)', `chips: ${chips}`);
      assert(!chips.some((chip) => /favorite/i.test(chip)), 'Favorites filter reappeared');
      assert(await page.getByRole('button', { name: 'Add a Home' }).isVisible(), 'Add a Home missing');
      const cols = await columns(page);
      assert(cols === EXPECTED_COLUMNS[width], `expected ${EXPECTED_COLUMNS[width]} columns, got ${cols}`);
      // Touch targets on phones.
      if (width < 500) {
        const small = await page.evaluate(() => [...document.querySelectorAll('.hh-filter-chips button, .hh-home-card-actions button, .hh-home-card-actions a, .hh-tabs a, .hh-utility-nav a, .hh-utility-nav button')]
          .filter((el) => el.getBoundingClientRect().height < 40).map((el) => el.textContent.trim()));
        assert(!small.length, `targets under 40px: ${small.join(', ')}`);
      }
      // Search ↔ toolbar alignment (row 1 and row 2 share outer edges).
      const edges = await page.evaluate(() => {
        const rows = [...document.querySelectorAll('.hh-homes-toolbar-row')].map((row) => row.getBoundingClientRect());
        return rows.map((r) => [Math.round(r.left), Math.round(r.right)]);
      });
      assert(edges[0][0] === edges[1][0] && edges[0][1] === edges[1][1], `toolbar rows misaligned ${JSON.stringify(edges)}`);
      await shot(page, `my-homes-${width}`);
      if (width === 1440 || width === 390) await shot(page, `my-homes-${width}-viewport`, { full: false });
      // Action rows align across one grid row (desktop/tablet).
      if (width >= 768) {
        const tops = await page.evaluate(() => {
          const cards = [...document.querySelectorAll('.hh-homes-grid > article')];
          const first = cards[0].getBoundingClientRect().top;
          return cards.filter((c) => Math.abs(c.getBoundingClientRect().top - first) < 2).map((c) => Math.round(c.querySelector('.hh-home-card-actions').getBoundingClientRect().bottom));
        });
        assert(new Set(tops).size === 1, `action rows not aligned: ${tops}`);
      }
    });

    if (width === 1440 || width === 390) {
      await step(`[${width}] card states: Want to Tour selected, missing data`, async () => {
        await shot(page, `card-want-to-tour-${width}`, { locator: cardFor(page, '25992 Briar Towne Blvd') });
        const sparse = cardFor(page, /18400 Northeast Lakeshore/);
        await sparse.scrollIntoViewIfNeeded();
        assert(await sparse.getByText('No photo yet').isVisible(), 'missing-photo placeholder not shown');
        assert(await sparse.getByText('Price not added').isVisible(), 'missing price not labelled');
        assert(!(await sparse.locator('.hh-property-facts').count()), 'invented property facts for a home with none');
        assert(!(await sparse.getByText('Listing').count()), 'Listing link shown without a listing URL');
        await shot(page, `card-missing-data-${width}`, { locator: sparse });
      });
    }

    await step(`[${width}] Archived tab renders the existing archive view`, async () => {
      await page.getByRole('navigation', { name: 'Primary navigation' }).first().getByRole('link', { name: 'Archived' }).click();
      await page.waitForURL(/\/archive$/);
      await page.getByRole('heading', { level: 1, name: 'Archived' }).waitFor();
      await page.getByText('Only one bathroom and a busy street.').waitFor();
      assert(await page.locator('.hh-tabs a[aria-current="page"]').innerText() === 'Archived', 'Archived tab not current');
      assert(!(await page.getByRole('link', { name: 'Favorites' }).count()), 'Favorites navigation reappeared');
      if (width === 1440 || width === 768 || width === 390) await shot(page, `archived-${width}`);
    });
    await page.context().close();
  }

  // Behavior, as the owner at desktop width, checked against the database.
  const page = await signedIn(browser, 'owner', 1440);
  await step('Want to Tour: orange → selected (persists) → removed (persists)', async () => {
    await page.goto(`${base}/homes`, { waitUntil: 'networkidle' });
    const card = cardFor(page, '21223 Briar Ct');
    await card.getByRole('button', { name: 'Want to Tour', exact: true }).click();
    await card.getByRole('button', { name: /on your tour list/ }).waitFor();
    await page.waitForTimeout(800);
    assert(stateOf('briar-ct').status === 'Want to Tour', `status ${stateOf('briar-ct').status}`);
    await page.reload({ waitUntil: 'networkidle' });
    assert(await cardFor(page, '21223 Briar Ct').getByRole('button', { name: /on your tour list/ }).getAttribute('aria-pressed') === 'true', 'selected state lost on reload');
    await cardFor(page, '21223 Briar Ct').getByRole('button', { name: /on your tour list/ }).click();
    await cardFor(page, '21223 Briar Ct').getByRole('button', { name: 'Want to Tour', exact: true }).waitFor();
    await page.waitForTimeout(800);
    assert(stateOf('briar-ct').status === 'Saved', `status ${stateOf('briar-ct').status}`);
  });
  await step('Search, sort and filter narrow and order the list', async () => {
    await page.getByLabel('Search your homes').fill('Vernier');
    assert(await page.locator('.hh-homes-grid > article').count() === 2, 'search did not narrow to 2');
    await page.getByLabel('Search your homes').fill('');
    await page.getByLabel('Sort homes').selectOption('priceAsc');
    const first = await page.locator('.hh-homes-grid > article h2').first().innerText();
    assert(first.startsWith('20680 Vernier Cir'), `price sort first = ${first}`);
    await page.getByRole('button', { name: /^Want to Tour \(1\)$/ }).click();
    assert(await page.locator('.hh-homes-grid > article').count() === 1, 'Want to Tour filter');
    await page.getByRole('button', { name: /^All \(/ }).click();
    assert(await page.locator('.hh-homes-grid > article').count() === 5, 'All restores the list');
    await page.getByLabel('Sort homes').selectOption('newest');
  });
  await step('Edit opens the existing editor; Listing opens the listing in a new tab', async () => {
    const card = cardFor(page, '25992 Briar Towne Blvd');
    const listing = card.getByRole('link', { name: /Listing/ });
    assert(await listing.getAttribute('target') === '_blank', 'Listing does not open a new tab');
    await card.getByRole('button', { name: 'Edit', exact: true }).click();
    await page.locator('.hh-edit-home-modal, .hh-workspace-shell, [role="dialog"]').first().waitFor();
    await page.keyboard.press('Escape');
    await page.goto(`${base}/homes`, { waitUntil: 'networkidle' });
  });
  await step('Archive → Archived tab → Restore (persists both ways)', async () => {
    await cardFor(page, '71 Vernier Rd').getByRole('button', { name: 'Archive', exact: true }).click();
    await page.getByRole('button', { name: 'Archive home' }).click();
    await page.waitForTimeout(900);
    assert(stateOf('vernier-rd').status === 'Archived', `status ${stateOf('vernier-rd').status}`);
    await page.goto(`${base}/archive`, { waitUntil: 'networkidle' });
    await cardFor(page, '71 Vernier Rd').getByRole('button', { name: 'Restore' }).click();
    await page.waitForTimeout(900);
    assert(stateOf('vernier-rd').status === 'Saved', `status after restore ${stateOf('vernier-rd').status}`);
  });
  await step('Keyboard: tabs and toolbar are reachable with visible focus', async () => {
    await page.goto(`${base}/homes`, { waitUntil: 'networkidle' });
    await page.locator('.hh-tabs a').first().focus();
    const outline = await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle);
    assert(outline !== 'none', 'no focus outline on tabs');
    await page.keyboard.press('Tab');
    assert(await page.evaluate(() => document.activeElement.textContent.trim()) === 'Want to Tour', 'Tab order across tabs');
  });
  assert(!page.errors.length, `console errors: ${page.errors.join(' | ')}`);
  await page.context().close();

  // Co-buyer: same homes, their own Match and their own tour state.
  await step('Co-buyer sees the shared homes with their own Match and no owner tour state', async () => {
    const co = await signedIn(browser, 'coBuyer', 1024);
    await co.goto(`${base}/homes`, { waitUntil: 'networkidle' });
    await co.getByRole('heading', { name: '25992 Briar Towne Blvd' }).waitFor();
    // The owner's Want to Tour is not the co-buyer's.
    assert(await cardFor(co, '25992 Briar Towne Blvd').getByRole('button', { name: 'Want to Tour', exact: true }).isVisible(), 'co-buyer inherited owner tour state');
    assert(await co.getByText('Searching together · each of you keeps your own Match').isVisible(), 'collaboration line missing');
    await shot(co, 'cobuyer-my-homes-1024', { full: false });
    await co.context().close();
  });

  // Realtor workspace keeps its own links and has no buyer tabs.
  await step('Realtor workspace shell keeps Realtor Home / My Clients and has no buyer tabs', async () => {
    const realtor = await signedIn(browser, 'realtor', 1440);
    await realtor.goto(`${base}/realtor`, { waitUntil: 'networkidle' });
    const utilities = realtor.getByRole('navigation', { name: 'Account and search' });
    await utilities.getByRole('link', { name: /Realtor Home/ }).waitFor();
    assert(await utilities.getByRole('link', { name: /My Clients/ }).isVisible(), 'My Clients missing');
    assert(!(await utilities.getByRole('link', { name: 'My Search' }).count()), 'buyer My Search on the Realtor workspace');
    assert(!(await realtor.locator('.hh-tabs').count()), 'buyer tabs on the Realtor workspace');
    await shot(realtor, 'realtor-shell-1440', { full: false });
    await realtor.context().close();
  });

  await browser.close();
  writeFileSync(join(outDir, 'qa-log.json'), JSON.stringify(log, null, 2));
  const failed = log.filter((entry) => !entry.ok);
  console.log(`\n${log.length - failed.length}/${log.length} steps passed`);
  if (failed.length) process.exit(1);
}

main().catch((error) => { console.error(error); process.exit(1); });
