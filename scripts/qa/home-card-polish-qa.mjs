#!/usr/bin/env node
// Browser QA for the Home Card polish (Match score spacing, criteria summary
// links, property facts). DEVELOPMENT ONLY — runs against the local stand-in.
//
//   1. FLH_TEST_PGHOST=… FLH_TEST_PGPORT=… node scripts/qa/supabase-standin.mjs 54321 > standin.json
//   2. NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=qa npx next dev -p 3200
//   3. FLH_TEST_PGHOST=… FLH_TEST_PGPORT=… node scripts/qa/home-card-polish-qa.mjs standin.json <outDir> [baseUrl]
//
// Seeds four homes for one buyer with ten Must Haves: every fact known, very
// long basement / school / style values, no facts at all, and a short one. At
// 1440 (four cards per row) and iPhone 390 it checks: every Must Have row is
// rendered, every known fact is shown (nothing capped), no text overflows its
// card or the page, the three criteria summaries are keyboard-reachable links
// that open and close their lists, and there are no console errors.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { register } from 'node:module';
import { chromium } from 'playwright';

register('../../test/support/aliasHooks.mjs', import.meta.url);
const { normalizePriorities } = await import('../../src/lib/constants.js');
const { addCriterion } = await import('../../src/lib/searchProfile.js');
const { prioritiesForExplicitSave } = await import('../../src/lib/searchIntent.js');
const { computeMatch, selectHomeCardCriteria, homeStyleSummary } = await import('../../src/lib/matching.js');
const { homeCardSnapshot } = await import('../../src/lib/homeCardPresentation.js');

const [infoPath, outArg, base = 'http://localhost:3200'] = process.argv.slice(2);
if (!infoPath || !outArg) throw new Error('Usage: home-card-polish-qa.mjs <standin.json> <outDir> [baseUrl]');
const info = JSON.parse(readFileSync(infoPath, 'utf8').split('\n')[0]);
const outDir = resolve(outArg);
mkdirSync(outDir, { recursive: true });
const IGNORED_CONSOLE = /Download the React DevTools|favicon|maps\.googleapis|Google Maps|places|Failed to load resource/i;
const pg = ['-X', '-q', '-A', '-t', '-h', process.env.FLH_TEST_PGHOST, '-p', process.env.FLH_TEST_PGPORT || '5432', '-U', 'postgres', '-d', info.database];
function exec(sql) {
  const result = spawnSync('psql', [...pg, '-v', 'ON_ERROR_STOP=1', '-c', sql], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr);
}
const lit = (value) => (value === null || value === undefined ? 'null' : `'${String(value).replace(/'/g, "''")}'`);
const arr = (values) => `array[${values.map(lit).join(',')}]::text[]`;
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const owner = info.users.owner.id;

function buyer() {
  let p = normalizePriorities({ searchType: 'purchase' });
  p.budget = { value: '450000', tier: 'must' };
  p.bedsMin = { value: '3', tier: 'important' };
  for (const [categoryKey, label, tier] of [
    ['features', 'Finished basement', 'must'], ['exterior', 'Garage', 'must'], ['exterior', 'Fenced yard', 'must'], ['features', 'Home office', 'must'],
    ['features', 'First-floor laundry', 'must'], ['features', 'Fireplace', 'must'], ['features', 'Central air', 'must'], ['features', 'Mudroom', 'must'],
    ['features', 'Walkout basement', 'must'], ['exterior', 'Pool', 'important'], ['features', 'Walk-in pantry', 'nice'], ['exterior', 'Patio / deck', 'nice'],
  ]) p = addCriterion(p, { categoryKey, label, kind: 'check' }, tier);
  return prioritiesForExplicitSave(p);
}
const PRIORITIES = buyer();
const HOMES = [
  { street: '210 Maple Ave', price: '439000', beds: '4', baths: '2.5', sqft: '2140', garage: '2', condition: 'finished', style: 'traditional', layout: ['Two Story'], homeCondition: ['Move-In Ready'], school: 'Royal Oak',
    checks: { 'exterior:Fenced yard': true, 'features:Home office': true, 'features:Central air': true, 'features:Mudroom': 'no', 'exterior:Pool': 'no' } },
  { street: '4471 Long Description Blvd', price: '612500', beds: '5', baths: '3.5', sqft: '3480', garage: '3+', condition: 'partially_finished', style: 'walkout', layout: ['Split Level', 'Colonial', 'Cape Cod'], homeCondition: ['Needs Cosmetic Updates'],
    school: 'Bloomfield Hills Schools — Lahser High School attendance area (verify boundaries with the district)', checks: { 'features:Fireplace': true, 'features:Home office': 'no' } },
  { street: '9 Unknown Ct', price: '', beds: '', baths: '', sqft: '', garage: '', condition: null, style: null, layout: [], homeCondition: [], school: null, checks: {} },
  { street: '77 Short St', price: '389900', beds: '3', baths: '1', sqft: '1210', garage: '0', condition: 'none', style: 'none', layout: ['Ranch'], homeCondition: [], school: 'Troy',
    checks: { 'features:Central air': 'no', 'exterior:Fenced yard': true } },
];

function seed() {
  exec(`delete from public.homes where search_id = '${info.search}'`);
  exec(`update public.search_member_priorities set priorities = ${lit(JSON.stringify(PRIORITIES))}::jsonb where search_id = '${info.search}' and user_id = '${owner}'`);
  exec(`update public.searches set priorities = ${lit(JSON.stringify(PRIORITIES))}::jsonb where id = '${info.search}'`);
  HOMES.forEach((home, index) => {
    home.id = randomUUID();
    exec(`insert into public.homes (id, user_id, search_id, address, price, beds, baths, sqft, garage_spaces, basement_condition, basement_style, home_layout, home_condition, school_district_name, created_at)
      values ('${home.id}', '${owner}', '${info.search}', ${lit(`${home.street}, Royal Oak, MI 48073`)}, ${lit(home.price)}, ${lit(home.beds)}, ${lit(home.baths)}, ${lit(home.sqft)}, ${lit(home.garage)},
        ${lit(home.condition)}, ${lit(home.style)}, ${arr(home.layout)}, ${arr(home.homeCondition)}, ${lit(home.school)}, now() - interval '${index} minutes')`);
    exec(`insert into public.home_member_state (home_id, user_id, status, checks) values ('${home.id}', '${owner}', 'Saved', ${lit(JSON.stringify(home.checks))}::jsonb)
      on conflict (home_id, user_id) do update set status = excluded.status, checks = excluded.checks`);
  });
}

// What each card must show, from the canonical helpers on the same data.
const priorities = normalizePriorities(PRIORITIES);
for (const home of HOMES) {
  const shaped = { price: home.price, beds: home.beds, garageSpaces: home.garage, basementCondition: home.condition, basementStyle: home.style, homeLayout: home.layout, homeCondition: home.homeCondition, schoolDistrict: home.school, checks: home.checks, ratings: {} };
  const { mustHaves, criteriaSummary } = selectHomeCardCriteria(computeMatch(shaped, priorities));
  home.expected = { must: mustHaves.length, facts: homeCardSnapshot(shaped, homeStyleSummary(shaped)), counts: [criteriaSummary.matches.length, criteriaSummary.mismatches.length, criteriaSummary.unknown.length] };
}

const log = [];
async function step(name, fn) {
  const started = Date.now();
  try { await fn(); log.push({ step: name, ok: true, ms: Date.now() - started }); console.log('ok  ', name); }
  catch (error) { log.push({ step: name, ok: false, error: error.message }); console.error('FAIL', name, '—', error.message); }
}
const VIEWPORTS = {
  desktop: { viewport: { width: 1440, height: 900 } },
  iphone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
};
async function signedIn(browser, device) {
  const context = await browser.newContext(VIEWPORTS[device]);
  await context.addCookies([{ name: 'sb-localhost-auth-token', value: `base64-${Buffer.from(JSON.stringify(info.users.owner.session)).toString('base64url')}`, domain: 'localhost', path: '/' }]);
  await context.addInitScript(() => { try { localStorage.setItem('flh-mobile-tour-dismissed', '1'); localStorage.setItem('flh-name-prompt-dismissed', '1'); localStorage.setItem('flh-install-dismissed', '1'); } catch { /* ignore */ } });
  await context.route('**/api/commute', (route) => route.fulfill({ json: { results: {} } }));
  const page = await context.newPage();
  page.errors = [];
  page.on('pageerror', (error) => page.errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error' && !IGNORED_CONSOLE.test(message.text())) page.errors.push(message.text()); });
  return page;
}
const cardFor = (page, street) => page.locator('article.hh-home-card').filter({ has: page.getByRole('heading', { name: street }) });
const hideChrome = '.beta-feedback-tab, nextjs-portal { visibility: hidden !important; }';

async function main() {
  seed();
  const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {});
  for (const device of ['desktop', 'iphone']) {
    const page = await signedIn(browser, device);
    await step(`[${device}] every card: all Must Haves, every known fact, nothing overflowing`, async () => {
      await page.goto(`${base}/homes`, { waitUntil: 'networkidle' });
      await cardFor(page, HOMES[0].street).waitFor();
      await page.evaluate(() => document.fonts.ready);
      if (device === 'desktop') {
        const tops = await page.locator('article.hh-home-card').evaluateAll((cards) => cards.map((card) => Math.round(card.getBoundingClientRect().top)));
        assert(new Set(tops).size === 1 && tops.length === 4, `expected one row of four cards at 1440, got tops ${tops}`);
        await page.locator('.hh-homes-grid').screenshot({ path: join(outDir, 'desktop-1440-four-cards.png'), style: hideChrome });
      }
      for (const home of HOMES) {
        const card = cardFor(page, home.street);
        assert(await card.locator('.hh-must-summary li').count() === home.expected.must, `${home.street}: Must Have rows`);
        const facts = await card.locator('.hh-property-fact').evaluateAll((rows) => rows.map((row) => [row.querySelector('dt').textContent.trim(), row.querySelector('dd').textContent.trim()]));
        assert(JSON.stringify(facts) === JSON.stringify(home.expected.facts.map(({ label, value }) => [label, value])), `${home.street}: facts ${JSON.stringify(facts)}`);
        const labels = await card.locator('.hh-match-summary-line button').allTextContents();
        assert(JSON.stringify(labels.map((text) => Number(text.match(/\d+/)[0]))) === JSON.stringify(home.expected.counts), `${home.street}: summary ${labels}`);
        // Nothing inside the card is wider than the card.
        const spill = await card.evaluate((el) => {
          const box = el.getBoundingClientRect();
          return [...el.querySelectorAll('.hh-property-fact, .hh-property-fact dd, .hh-must-summary li, .hh-match-summary-line')].filter((node) => {
            const r = node.getBoundingClientRect();
            return r.right > box.right + 0.5 || node.scrollWidth > node.clientWidth + 1;
          }).map((node) => node.textContent.slice(0, 40));
        });
        assert(!spill.length, `${home.street}: overflowing ${spill.join(' | ')}`);
      }
      if (device === 'iphone') {
        for (const [index, home] of HOMES.entries()) {
          await cardFor(page, home.street).screenshot({ path: join(outDir, `iphone-390-card-${index + 1}.png`), style: hideChrome });
        }
      }
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert(overflow <= 0, `horizontal overflow ${overflow}px`);
      assert(!page.errors.length, page.errors.join(' | '));
    });

    await step(`[${device}] criteria summaries: keyboard focus is visible, Enter opens the list, Escape closes it`, async () => {
      const card = cardFor(page, HOMES[0].street);
      const first = card.locator('.hh-match-summary-line button').first();
      // Reach the first summary by Tab from the element just before it.
      await card.locator('.hh-must-summary').evaluate((el) => { el.setAttribute('tabindex', '-1'); el.focus(); });
      await page.keyboard.press('Tab');
      assert(await first.evaluate((el) => el === document.activeElement), 'Tab did not reach the first criteria summary');
      const outline = await first.evaluate((el) => { const s = getComputedStyle(el); return { style: s.outlineStyle, width: parseFloat(s.outlineWidth) }; });
      assert(outline.style !== 'none' && outline.width >= 2, `focus outline ${JSON.stringify(outline)}`);
      const decoration = await first.evaluate((el) => getComputedStyle(el).textDecorationLine);
      console.log(`     ${device} summary text-decoration: ${decoration}`);
      if (device === 'desktop') await card.locator('.hh-match-panel').screenshot({ path: join(outDir, 'desktop-1440-match-panel-focused.png'), style: hideChrome });
      await page.keyboard.press('Enter');
      const popover = card.locator('.hh-criteria-popover');
      await popover.waitFor();
      assert(await popover.locator('li').count() === HOMES[0].expected.counts[0], 'Matches list length');
      await page.keyboard.press('Escape');
      await popover.waitFor({ state: 'detached' });
      for (const button of await card.locator('.hh-match-summary-line button').all()) assert(await button.getAttribute('aria-expanded') !== null, 'aria-expanded missing');
      assert(!page.errors.length, page.errors.join(' | '));
    });
    await page.context().close();
  }
  await browser.close();
  writeFileSync(join(outDir, 'results.json'), JSON.stringify({ expected: HOMES.map(({ street, expected }) => ({ street, ...expected })), log }, null, 2));
  const failed = log.filter((entry) => !entry.ok);
  console.log(`${log.length - failed.length}/${log.length} steps passed`);
  if (failed.length) process.exitCode = 1;
}

await main();
