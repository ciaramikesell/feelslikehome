#!/usr/bin/env node
// Browser QA for the Home Card Match panel: every Must Have listed (no "+N more"),
// and Matches / Doesn't match / Unknown covering every selected criterion.
// DEVELOPMENT ONLY — runs against the local Supabase stand-in.
//
//   1. FLH_TEST_PGHOST=… FLH_TEST_PGPORT=… node scripts/qa/supabase-standin.mjs 54321 > standin.json
//   2. NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=qa npx next dev -p 3200
//   3. FLH_TEST_PGHOST=… FLH_TEST_PGPORT=… node scripts/qa/home-card-must-haves-qa.mjs standin.json <outDir> [baseUrl]
//
// Seeds one representative home in each lifecycle place (My Homes, Want to Tour,
// Favorites, Archive), then on desktop and iPhone checks each card against
// computeMatch + selectHomeCardCriteria on the same data: every Must Have row
// with its state, each disclosure's count equal to its list, no duplicates, no
// overflow control, no horizontal overflow, no console errors.
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
const { computeMatch, selectHomeCardCriteria, criterionLabel } = await import('../../src/lib/matching.js');

const [infoPath, outArg, base = 'http://localhost:3200'] = process.argv.slice(2);
if (!infoPath || !outArg) throw new Error('Usage: home-card-must-haves-qa.mjs <standin.json> <outDir> [baseUrl]');
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
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const owner = info.users.owner.id;

// Seven Must Haves (one failed by Home Facts, one unknown), plus Important / Nice.
function buyer() {
  let p = normalizePriorities({ searchType: 'purchase' });
  p.budget = { value: '450000', tier: 'must' };
  p.bedsMin = { value: '4', tier: 'important' };
  for (const [categoryKey, label, tier] of [
    ['features', 'Finished basement', 'must'], ['exterior', 'Garage', 'must'], ['exterior', 'Fenced yard', 'must'], ['features', 'Home office', 'must'],
    ['features', 'First-floor laundry', 'must'], ['features', 'Fireplace', 'must'], ['features', 'Central air', 'important'], ['features', 'Mudroom', 'important'],
    ['exterior', 'Pool', 'important'], ['features', 'Walk-in pantry', 'nice'], ['exterior', 'Patio / deck', 'nice'], ['features', 'Primary ensuite', 'nice'],
  ]) p = addCriterion(p, { categoryKey, label, kind: 'check' }, tier);
  return prioritiesForExplicitSave(p);
}
const PRIORITIES = buyer();
const CHECKS = { 'exterior:Fenced yard': true, 'features:Home office': true, 'features:Central air': 'no', 'features:Mudroom': 'no', 'exterior:Pool': 'no', 'features:Walk-in pantry': 'no', 'exterior:Patio / deck': true };
const FACTS = { price: '439000', beds: '3', garage_spaces: '2', basement_condition: 'unfinished', laundry_location: 'first_floor' };
const PLACES = [
  { path: '/homes', street: '101 Card Ln', status: 'Saved', favorite: false },
  { path: '/tour', street: '102 Card Ln', status: 'Want to Tour', favorite: false },
  { path: '/favorites', street: '103 Card Ln', status: 'Saved', favorite: true },
  { path: '/archive', street: '104 Card Ln', status: 'Archived', favorite: false },
];

function seed() {
  exec(`delete from public.homes where search_id = '${info.search}'`);
  exec(`update public.search_member_priorities set priorities = ${lit(JSON.stringify(PRIORITIES))}::jsonb where search_id = '${info.search}' and user_id = '${owner}'`);
  exec(`update public.searches set priorities = ${lit(JSON.stringify(PRIORITIES))}::jsonb where id = '${info.search}'`);
  for (const place of PLACES) {
    place.id = randomUUID();
    exec(`insert into public.homes (id, user_id, search_id, address, price, beds, garage_spaces, basement_condition, laundry_location)
      values ('${place.id}', '${owner}', '${info.search}', ${lit(`${place.street}, Troy, MI 48084`)}, ${lit(FACTS.price)}, ${lit(FACTS.beds)}, ${lit(FACTS.garage_spaces)}, ${lit(FACTS.basement_condition)}, ${lit(FACTS.laundry_location)})`);
    exec(`insert into public.home_member_state (home_id, user_id, status, is_favorite, checks, rejection_reason) values ('${place.id}', '${owner}', ${lit(place.status)}, ${place.favorite}, ${lit(JSON.stringify(CHECKS))}::jsonb, ${place.status === 'Archived' ? "'Too small'" : "''"})
      on conflict (home_id, user_id) do update set status = excluded.status, is_favorite = excluded.is_favorite, checks = excluded.checks, rejection_reason = excluded.rejection_reason`);
  }
}

// What the card must show, from the same pure functions on the same data.
const expected = (() => {
  const match = computeMatch({ price: FACTS.price, beds: FACTS.beds, garageSpaces: FACTS.garage_spaces, basementCondition: FACTS.basement_condition, laundryLocation: FACTS.laundry_location, checks: CHECKS, ratings: {} }, normalizePriorities(PRIORITIES));
  const { mustHaves, criteriaSummary } = selectHomeCardCriteria(match);
  const state = (item) => (!item.evaluated ? 'unknown' : item.met === null ? 'neutral' : item.met ? 'met' : 'missing');
  return {
    pct: match.pct,
    must: mustHaves.map((item) => `${criterionLabel(item)} (${state(item)})`),
    matches: criteriaSummary.matches.map((item) => item.label),
    mismatches: criteriaSummary.mismatches.map((item) => item.label),
    unknown: criteriaSummary.unknown.map((item) => item.label),
  };
})();

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

async function checkCard(page, place, device) {
  await page.goto(`${base}${place.path}`, { waitUntil: 'networkidle' });
  const card = page.locator('article.hh-home-card').filter({ has: page.getByRole('heading', { name: place.street }) });
  await card.waitFor({ timeout: 30000 });
  // Every Must Have, with its state, in the list's order; no overflow control.
  const rows = await card.locator('.hh-must-summary li').evaluateAll((items) => items.map((li) => li.textContent.replace(/\s+/g, ' ').trim()));
  const shown = rows.map((text) => text.replace(/^[?✓✕—]\s*/, '').replace(/\s*\((met|missing|unknown|neutral)\)$/, ' ($1)'));
  assert(JSON.stringify(shown) === JSON.stringify(expected.must), `${place.path}: Must Have rows ${JSON.stringify(shown)} vs ${JSON.stringify(expected.must)}`);
  assert(await card.getByText(/more Must Have|Show fewer/).count() === 0, `${place.path}: overflow control still rendered`);
  assert(await card.getByText(`${expected.pct}% Match`, { exact: false }).count() >= 1, `${place.path}: Match % changed`);
  // Each disclosure: count in the label equals the list it opens; no duplicates.
  for (const [heading, symbol, key, word] of [['Matches', '✓', 'matches', 'match'], ['Doesn’t match', '✕', 'mismatches', 'don’t match'], ['Still unknown', '?', 'unknown', 'unknown']]) {
    const list = expected[key];
    const button = card.locator('.hh-match-summary-line button').filter({ hasText: new RegExp(`^${symbol.replace('?', '\\?')}\\s*${list.length} ${word}$`) });
    assert(await button.count() === 1, `${place.path}: no "${list.length} ${word}" label`);
    await button.click();
    const popover = card.locator('.hh-criteria-popover').filter({ hasText: heading });
    await popover.waitFor();
    const items = await popover.locator('li').evaluateAll((lis) => lis.map((li) => li.textContent.replace(/^\s*[?✓✕]\s*/, '').trim()));
    assert(JSON.stringify(items) === JSON.stringify(list), `${place.path} ${heading}: ${JSON.stringify(items)} vs ${JSON.stringify(list)}`);
    assert(new Set(items).size === items.length, `${place.path} ${heading}: duplicate entries`);
    if (key === 'mismatches') await card.screenshot({ path: join(outDir, `${device}-${place.path.slice(1)}-card-mismatches.png`) });
    await button.click();
    await page.keyboard.press('Escape');
  }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert(overflow <= 0, `${place.path}: horizontal overflow ${overflow}px`);
  assert(!page.errors.length, `${place.path}: ${page.errors.join(' | ')}`);
}

async function main() {
  seed();
  console.log('expected', JSON.stringify(expected));
  assert(expected.must.length === 7 && expected.mismatches.length === 6 && expected.mismatches.includes('Finished basement'), 'seed should give 7 Must Haves and 6 misses including the Must Have');
  const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {});
  for (const device of ['desktop', 'iphone']) {
    const page = await signedIn(browser, device);
    for (const place of PLACES) {
      await step(`[${device}] ${place.path}: all ${expected.must.length} Must Haves, and the breakdown counts equal their lists`, () => checkCard(page, place, device));
    }
    await page.context().close();
  }
  await browser.close();
  writeFileSync(join(outDir, 'results.json'), JSON.stringify({ expected, log }, null, 2));
  const failed = log.filter((entry) => !entry.ok);
  console.log(`${log.length - failed.length}/${log.length} steps passed`);
  if (failed.length) process.exitCode = 1;
}

await main();
