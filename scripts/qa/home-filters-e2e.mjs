#!/usr/bin/env node
// Browser QA for Filter My Homes. DEVELOPMENT ONLY.
//
//   1. FLH_TEST_PGHOST=… FLH_TEST_PGPORT=… node scripts/qa/supabase-standin.mjs 54321 > standin.json
//   2. NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=qa npx next dev -p 3200
//   3. node scripts/qa/home-filters-e2e.mjs standin.json <outDir> [baseUrl]
//
// Seeds 30 saved homes (plus one archived) with mixed, partly unknown and
// malformed facts, gives the owner and the co-buyer different answers, then
// drives My Homes at desktop, iPad and iPhone sizes. Every count the UI shows is
// cross-checked against src/lib/homeFilters.js on the same data, and the
// database is fingerprinted to prove filtering writes nothing.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { register } from 'node:module';
import { chromium } from 'playwright';

register('../../test/support/aliasHooks.mjs', import.meta.url);
const { normalizePriorities } = await import('../../src/lib/constants.js');
const { applySearchChoice } = await import('../../src/lib/onboarding.js');
const { addCriterion } = await import('../../src/lib/searchProfile.js');
const { prioritiesForExplicitSave } = await import('../../src/lib/searchIntent.js');
const { computeMatch } = await import('../../src/lib/matching.js');
const { applyHomeFilters, filterableCriteria } = await import('../../src/lib/homeFilters.js');

const [infoPath, outArg, base = 'http://localhost:3200'] = process.argv.slice(2);
if (!infoPath || !outArg) throw new Error('Usage: home-filters-e2e.mjs <standin.json> <outDir> [baseUrl]');
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
const lit = (value) => (value === null || value === undefined ? 'null' : `'${String(value).replace(/'/g, "''")}'`);
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const log = [];
const owner = info.users.owner.id;
const coBuyer = info.users.coBuyer.id;

const FENCED = 'exterior:Fenced yard';
const SUITE = 'features:First-floor guest suite';

function buyerPriorities() {
  let p = applySearchChoice(normalizePriorities({}), 'home_buy');
  p.budget = { ...p.budget, value: '400000', tier: 'must' };
  p.sqftTarget = { value: '1800', tier: 'must' }; // My Search wants 1,800; the filter will use 1,200
  p = addCriterion(p, { categoryKey: 'exterior', label: 'Fenced yard', kind: 'check' }, 'important');
  p = addCriterion(p, { categoryKey: 'features', label: 'First-floor guest suite', kind: 'check', source: 'custom' }, 'nice');
  p = addCriterion(p, { categoryKey: 'features', label: 'Finished basement', kind: 'check' }, 'nice');
  return p;
}
const ownerPriorities = buyerPriorities();
const coBuyerPriorities = buyerPriorities();

const STREETS = ['Oak', 'Maple', 'Birch', 'Cedar', 'Elm', 'Willow', 'Aspen', 'Linden', 'Hawthorn', 'Juniper'];
const LOTS = ['0.25 acres', '8850 sq ft', '8712', '0.15 acres', '1 acre', '', '6,000 sq ft', '0.2 acres', 'about a quarter acre', '0 acres'];
const ANSWER = [true, 'no', undefined, true, false];
// 30 saved homes, deterministic but varied (confirmed, possible and excluded).
const HOMES = Array.from({ length: 30 }, (_, i) => {
  const checks = {};
  // Every sixth home is a "dream" home the buyer has fully answered.
  const dream = i % 6 === 0;
  const fence = dream ? true : ANSWER[i % 5];
  const suite = dream ? true : ANSWER[(i * 2 + 1) % 5];
  if (fence !== undefined) checks[FENCED] = fence;
  if (suite !== undefined) checks[SUITE] = suite;
  return {
    key: `h${i}`,
    address: `${100 + i * 7} ${STREETS[i % 10]} ${i % 3 ? 'Ct' : 'Ln'}, ${i % 2 ? 'Troy' : 'Novi'}, MI 4808${i % 10}`,
    price: i % 11 === 7 ? 'Call for price' : i % 13 === 12 ? '' : String(285000 + i * 6500),
    sqft: dream ? String(1500 + i * 10) : i % 9 === 8 ? '' : String(1050 + ((i * 97) % 1100)),
    lot: dream ? (i % 12 ? '9,500 sq ft' : '0.31 acres') : LOTS[i % 10],
    beds: i % 7 === 6 ? '' : String(2 + (i % 4)),
    baths: String([1, 1.5, 2, 2.5, 3][i % 5]),
    type: i % 8 === 5 ? 'condo' : i % 8 === 6 ? 'townhome' : i % 10 === 9 ? null : 'house',
    checks,
    // The co-buyer said Yes to the fence everywhere: it must never confirm the owner's Unknown.
    coChecks: { [FENCED]: true, [SUITE]: true },
    status: i === 3 ? 'Want to Tour' : 'Saved',
    ageDays: 31 - i,
  };
});
HOMES.push({ key: 'archived', address: '9 Archive Way, Troy, MI 48084', price: '300000', sqft: '1600', lot: '0.5 acres', beds: '4', baths: '2', type: 'house', checks: { [FENCED]: true, [SUITE]: true }, coChecks: {}, status: 'Archived', ageDays: 40 });

function seed() {
  exec(`delete from public.homes where search_id = '${info.search}'`);
  exec(`delete from public.commute_destinations where search_id = '${info.search}'`);
  for (const [userId, priorities] of [[owner, ownerPriorities], [coBuyer, coBuyerPriorities]]) {
    exec(`update public.search_member_priorities set priorities = ${lit(JSON.stringify(prioritiesForExplicitSave(priorities)))}::jsonb where search_id = '${info.search}' and user_id = '${userId}'`);
  }
  for (const home of HOMES) {
    home.id = randomUUID();
    exec(`insert into public.homes (id, user_id, search_id, address, price, beds, baths, sqft, lot_size, property_type, created_at)
      values ('${home.id}', '${owner}', '${info.search}', ${lit(home.address)}, ${lit(home.price)}, ${lit(home.beds)}, ${lit(home.baths)}, ${lit(home.sqft)}, ${lit(home.lot)}, ${lit(home.type)}, now() - interval '${home.ageDays} days')`);
    exec(`insert into public.home_member_state (home_id, user_id, status, checks) values ('${home.id}', '${owner}', ${lit(home.status)}, ${lit(JSON.stringify(home.checks))}::jsonb)`);
    exec(`insert into public.home_member_state (home_id, user_id, status, checks) values ('${home.id}', '${coBuyer}', 'Saved', ${lit(JSON.stringify(home.coChecks))}::jsonb)`);
  }
}

// What the pure module says for this participant (the same shapes getHomesForUser returns).
function expected(filters, { who = 'owner' } = {}) {
  const priorities = normalizePriorities(prioritiesForExplicitSave(who === 'owner' ? ownerPriorities : coBuyerPriorities));
  const homes = HOMES.filter((home) => home.status !== 'Archived').map((home) => ({
    id: home.id, price: home.price, sqft: home.sqft, lotSize: home.lot, beds: home.beds, baths: home.baths, propertyType: home.type,
    checks: who === 'owner' ? home.checks : home.coChecks, ratings: {},
  }));
  return applyHomeFilters(homes, filters, (home) => computeMatch(home, priorities), { criteria: filterableCriteria(priorities) });
}

const fingerprint = () => q(`select
  (select md5(coalesce(string_agg(t::text, '|' order by t.id), '')) from public.homes t where t.search_id = '${info.search}') as homes,
  (select md5(coalesce(string_agg(t::text, '|' order by t.home_id, t.user_id), '')) from public.home_member_state t) as states,
  (select md5(coalesce(string_agg(t::text, '|' order by t.user_id), '')) from public.search_member_priorities t where t.search_id = '${info.search}') as priorities`)[0];

async function signedIn(browser, who, viewport, { touch = false } = {}) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: viewport.width < 500 ? 3 : viewport.width < 1100 ? 2 : 1, hasTouch: touch, isMobile: viewport.width < 500 });
  const session = info.users[who].session;
  await context.addCookies([{ name: 'sb-localhost-auth-token', value: `base64-${Buffer.from(JSON.stringify(session)).toString('base64url')}`, domain: 'localhost', path: '/' }]);
  await context.addInitScript(() => { try { localStorage.setItem('flh-mobile-tour-dismissed', '1'); localStorage.setItem('flh-name-prompt-dismissed', '1'); } catch { /* ignore */ } });
  const page = await context.newPage();
  page.errors = [];
  page.on('pageerror', (error) => page.errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error' && !IGNORED_CONSOLE.test(message.text())) page.errors.push(message.text()); });
  return page;
}

async function settle(page) {
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(350);
}
async function shot(page, name, { full = false, locator = null } = {}) {
  await settle(page);
  const extra = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  const file = join(outDir, `${name}.png`);
  if (locator) await locator.screenshot({ path: file });
  else await page.screenshot({ path: file, fullPage: full });
  assert(extra <= 0, `${name}: horizontal overflow ${extra}px`);
}
async function step(name, fn) {
  const started = Date.now();
  try { await fn(); log.push({ step: name, ok: true, ms: Date.now() - started }); console.log('ok  ', name); }
  catch (error) { log.push({ step: name, ok: false, error: error.message }); console.error('FAIL', name, '—', error.message); }
}
const cards = (page) => page.locator('article.hh-home-card');
const sheet = (page) => page.getByRole('dialog', { name: 'Filter my homes' });

async function openFilters(page) {
  await page.getByRole('button', { name: /^Filter/ }).click();
  await sheet(page).waitFor();
}
async function fillVision(page) {
  const dialog = sheet(page);
  await dialog.getByLabel('Min sq ft').fill('1,200');
  await dialog.getByLabel('Min lot size (acres)').fill('0.2');
  await dialog.getByRole('button', { name: 'Fenced Yard' }).click();
  await dialog.getByRole('button', { name: 'First-floor guest suite' }).click();
}

const VISION = { sqftMin: '1,200', lotMinAcres: '0.2', criteria: [FENCED, SUITE] };
const VIEWPORTS = [
  { name: 'desktop', viewport: { width: 1440, height: 900 } },
  { name: 'ipad', viewport: { width: 820, height: 1180 }, touch: true },
  { name: 'ipad-landscape', viewport: { width: 1180, height: 820 }, touch: true },
  { name: 'iphone', viewport: { width: 390, height: 844 }, touch: true },
];

async function main() {
  seed();
  const browser = await chromium.launch({ executablePath: process.env.FLH_CHROMIUM || undefined });
  const vision = expected(VISION);
  const visionConfirmed = expected({ ...VISION, show: 'confirmed' });
  console.log('expected', vision.counts);
  assert(vision.counts.confirmed > 0 && vision.counts.possible > 0 && vision.counts.excluded > 0, 'seed should produce all three groups');

  for (const { name, viewport, touch } of VIEWPORTS) {
    const page = await signedIn(browser, 'owner', viewport, { touch });
    const before = fingerprint();

    await step(`[${name}] Filter action opens the sheet; live count matches the filter module`, async () => {
      await page.goto(`${base}/homes`, { waitUntil: 'networkidle' });
      await cards(page).first().waitFor();
      assert(await cards(page).count() === 30, `expected 30 active homes, saw ${await cards(page).count()}`);
      await shot(page, `${name}-my-homes-toolbar`);
      await openFilters(page);
      await shot(page, `${name}-sheet-empty`);
      await fillVision(page);
      const label = await sheet(page).getByRole('button', { name: /^Show / }).innerText();
      assert(label === `Show ${vision.counts.confirmed + vision.counts.possible} homes`, `apply label "${label}"`);
      const confirmedSegment = await sheet(page).getByRole('radio', { name: /Confirmed only/ }).innerText();
      assert(confirmedSegment.includes(String(vision.counts.confirmed)), `confirmed segment "${confirmedSegment}"`);
      await shot(page, `${name}-sheet-filled`);
      if (name === 'iphone') {
        await sheet(page).locator('.hh-sheet-body').evaluate((el) => { el.scrollTop = el.scrollHeight; });
        await shot(page, `${name}-sheet-filled-bottom`);
      }
      // Touch targets.
      if (touch) {
        const small = await page.evaluate(() => [...document.querySelectorAll('.hh-refine-sheet button, .hh-refine-sheet input')]
          .filter((el) => el.getBoundingClientRect().height < 40).map((el) => el.textContent.trim() || el.getAttribute('aria-label') || el.id));
        assert(!small.length, `targets under 40px: ${small.join(', ')}`);
      }
    });

    await step(`[${name}] Apply: confirmed + possible cards, counts, reasons, pills`, async () => {
      await sheet(page).getByRole('button', { name: /^Show / }).click();
      await sheet(page).waitFor({ state: 'detached' });
      const shown = await cards(page).count();
      assert(shown === vision.counts.confirmed + vision.counts.possible, `cards ${shown}`);
      const summary = await page.locator('.hh-refine-summary-counts').innerText();
      assert(summary.includes(`${vision.counts.confirmed} confirmed`) && summary.includes(`${vision.counts.possible} possible`) && summary.includes(`${vision.counts.excluded} don’t match`) && summary.includes('of 30 homes'), `summary "${summary}"`);
      const notes = await page.locator('.hh-card-filter-note').count();
      assert(notes === vision.counts.possible, `possible notes ${notes}`);
      // Every possible card names what's unknown, and matches the module's reason.
      for (const home of HOMES.filter((h) => vision.byId.get(h.id)?.status === 'possible').slice(0, 3)) {
        const card = cards(page).filter({ has: page.getByRole('heading', { name: home.address.split(',')[0] }) });
        const note = await card.locator('.hh-card-filter-note').innerText();
        assert(note.startsWith('Possible match'), `note "${note}"`);
        assert(note.includes(vision.byId.get(home.id).unknown[0]), `note "${note}" vs ${vision.byId.get(home.id).unknown}`);
      }
      const pills = await page.locator('.hh-refine-pill').allInnerTexts();
      assert(pills.length === 4, `pills ${pills}`);
      await shot(page, `${name}-results-possible`);
      await page.locator('.hh-card-filter-note').first().scrollIntoViewIfNeeded();
      await shot(page, `${name}-possible-card`, { locator: page.locator('article.hh-home-card').filter({ has: page.locator('.hh-card-filter-note') }).first() });
    });

    await step(`[${name}] Confirmed only`, async () => {
      await page.locator('.hh-refine-summary').getByRole('radio', { name: 'Confirmed only' }).click();
      assert(await cards(page).count() === visionConfirmed.visible.length, `confirmed cards ${await cards(page).count()}`);
      assert(await page.locator('.hh-card-filter-note').count() === 0, 'possible note on a confirmed-only list');
      await page.evaluate(() => window.scrollTo(0, 0));
      await shot(page, `${name}-results-confirmed`);
    });

    await step(`[${name}] Open a filtered home and close: filters, mode and cards survive`, async () => {
      const first = cards(page).first();
      const heading = await first.locator('h2').innerText();
      await first.locator('.hh-home-identity-link').click();
      await page.waitForURL(/\/homes\/[0-9a-f-]+/);
      await page.locator('.flh-overlay').waitFor();
      await page.keyboard.press('Escape');
      await page.waitForURL(/\/homes$/);
      await settle(page);
      assert(await cards(page).count() === visionConfirmed.visible.length, 'filters lost after closing a home');
      assert(await cards(page).first().locator('h2').innerText() === heading, 'order changed');
    });

    await step(`[${name}] Switching tabs keeps the session's filters; other tabs are unfiltered`, async () => {
      await page.goto(`${base}/tour`, { waitUntil: 'networkidle' });
      await settle(page);
      assert(!(await page.locator('.hh-refine-summary').count()), 'filter summary on Want to Tour');
      await page.goto(`${base}/homes`, { waitUntil: 'networkidle' });
      await cards(page).first().waitFor();
      await settle(page);
      assert(await cards(page).count() === visionConfirmed.visible.length, `filters not remembered: ${await cards(page).count()}`);
    });

    await step(`[${name}] Filtering wrote nothing (homes, answers, priorities)`, async () => {
      const after = fingerprint();
      assert(JSON.stringify(after) === JSON.stringify(before), 'database changed during filtering');
    });

    await step(`[${name}] Existing card actions still work on a filtered card (Want to Tour)`, async () => {
      await page.locator('.hh-refine-summary').getByRole('radio', { name: 'Confirmed + possible' }).click();
      const card = cards(page).filter({ has: page.getByRole('button', { name: 'Want to Tour', pressed: false }) }).first();
      const street = await card.locator('h2').innerText();
      const home = HOMES.find((h) => h.address.startsWith(street));
      await card.getByRole('button', { name: 'Want to Tour', pressed: false }).click();
      await page.waitForTimeout(800);
      const status = q(`select status from public.home_member_state where home_id = '${home.id}' and user_id = '${owner}'`)[0].status;
      assert(status === 'Want to Tour', `status ${status}`);
      assert(await cards(page).filter({ has: page.getByRole('heading', { name: street }) }).count() === 1, 'card vanished after Want to Tour');
      exec(`update public.home_member_state set status = 'Saved' where home_id = '${home.id}' and user_id = '${owner}'`);
    });

    await step(`[${name}] Zero results: inviting empty state, relax, clear`, async () => {
      await openFilters(page);
      await sheet(page).getByLabel(/Max price/).fill('1000');
      await sheet(page).getByRole('radio', { name: /Confirmed only/ }).click();
      await sheet(page).getByRole('button', { name: /^Show / }).click();
      await page.getByText('No homes meet every filter yet').waitFor();
      await shot(page, `${name}-zero-results`);
      // Adjust reopens the sheet with the current filters.
      await page.getByRole('button', { name: 'Adjust filters' }).click();
      assert(await sheet(page).getByLabel(/Max price/).inputValue() === '1000', 'adjust lost the current filters');
      await page.keyboard.press('Escape');
      await sheet(page).waitFor({ state: 'detached' });
      await page.locator('.hh-homes-empty').getByRole('button', { name: 'Clear filters' }).click();
      await cards(page).first().waitFor();
      assert(await cards(page).count() === 30, `after clear ${await cards(page).count()}`);
      assert(!(await page.locator('.hh-refine-summary').count()), 'summary after clear');
    });

    await step(`[${name}] Keyboard: open with Enter, Escape closes and returns focus`, async () => {
      const button = page.getByRole('button', { name: /^Filter/ });
      await button.focus();
      await page.keyboard.press('Enter');
      await sheet(page).waitFor();
      await page.keyboard.press('Escape');
      await sheet(page).waitFor({ state: 'detached' });
      assert(await button.evaluate((el) => el === document.activeElement), 'focus did not return to Filter');
      assert(!page.errors.length, `console errors: ${page.errors.join(' | ')}`);
    });
    await page.context().close();
  }

  await step('[co-buyer] the same filter reads the co-buyer’s own answers', async () => {
    const page = await signedIn(browser, 'coBuyer', { width: 1024, height: 900 });
    const fenced = expected({ criteria: [FENCED] }, { who: 'coBuyer' });
    const ownerFenced = expected({ criteria: [FENCED] });
    assert(fenced.counts.confirmed !== ownerFenced.counts.confirmed, 'seed should give different answers');
    await page.goto(`${base}/homes`, { waitUntil: 'networkidle' });
    await cards(page).first().waitFor();
    await openFilters(page);
    await sheet(page).getByRole('button', { name: 'Fenced Yard' }).click();
    await sheet(page).getByRole('button', { name: /^Show / }).click();
    const summary = await page.locator('.hh-refine-summary-counts').innerText();
    assert(summary.includes(`${fenced.counts.confirmed} confirmed`), `co-buyer summary "${summary}" expected ${fenced.counts.confirmed}`);
    await shot(page, 'cobuyer-fenced');
    await page.context().close();
  });

  await browser.close();
  writeFileSync(join(outDir, 'home-filters-qa.json'), JSON.stringify({ expected: vision.counts, log }, null, 2));
  const failed = log.filter((entry) => !entry.ok);
  console.log(`${log.length - failed.length}/${log.length} steps passed`);
  if (failed.length) process.exit(1);
}

main().catch((error) => { console.error(error); process.exit(1); });
