#!/usr/bin/env node
// Browser QA for the Match Reveal (docs/match-reveal.md). DEVELOPMENT ONLY —
// runs against the local Supabase stand-in (which applies the new migration).
//
//   1. FLH_TEST_PGHOST=… FLH_TEST_PGPORT=… node scripts/qa/supabase-standin.mjs 54321 > standin.json
//   2. NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=qa npx next dev -p 3200
//   3. FLH_TEST_PGHOST=… FLH_TEST_PGPORT=… node scripts/qa/match-reveal-qa.mjs standin.json <outDir> [baseUrl]
//
// One buyer with ten pre-tour criteria (+ one tour-only). Each seeded home is at
// 8 of 10 (80%); answering "Home office" takes it to 90%. Checks the reveal
// appears once, with the real Match % and the matching copy, only after the
// save persists; never on open, for a home already above 90%, on a later edit,
// after a reload, in a second tab, when the claim fails, or for a Realtor; the
// co-buyer earns their own; dialog keyboard / Escape / outside click / focus
// return / reduced motion; fits at 1440, 390, 375×667 and 320×568.
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
const { computeMatch } = await import('../../src/lib/matching.js');
const { matchCompleteness, revealCopy } = await import('../../src/lib/matchReveal.js');

const [infoPath, outArg, base = 'http://localhost:3200'] = process.argv.slice(2);
if (!infoPath || !outArg) throw new Error('Usage: match-reveal-qa.mjs <standin.json> <outDir> [baseUrl]');
const info = JSON.parse(readFileSync(infoPath, 'utf8').split('\n')[0]);
const outDir = resolve(outArg);
mkdirSync(outDir, { recursive: true });
const IGNORED_CONSOLE = /Download the React DevTools|favicon|maps\.googleapis|Google Maps|places|Failed to load resource|claim_match_reveal/i;
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
const { owner, coBuyer, realtor } = info.users;

function buyer() {
  let p = normalizePriorities({ searchType: 'purchase' });
  p.budget = { value: '450000', tier: 'must' };
  p.bedsMin = { value: '4', tier: 'important' };
  p.bathsMin = { value: '2', tier: 'important' };
  p.sqftTarget = { value: '2000', tier: 'nice' };
  for (const [categoryKey, label, tier, kind = 'check'] of [
    ['features', 'Finished basement', 'must'], ['features', 'Home office', 'must'], ['exterior', 'Garage', 'important'], ['exterior', 'Fenced yard', 'important'],
    ['features', 'First-floor laundry', 'nice'], ['features', 'Fireplace', 'nice'], ['homeFeel', 'Natural Light', 'important', 'rating'],
  ]) p = addCriterion(p, { categoryKey, label, kind }, tier);
  return prioritiesForExplicitSave(p);
}
const PRIORITIES = buyer();
const FACTS = {
  high: { price: '420000', beds: '4', baths: '3', sqft: '2400', garage_spaces: '2', basement_condition: 'finished', laundry_location: 'first_floor', fenced: true, answer: 'Yes' },
  medium: { price: '468000', beds: '3', baths: '2', sqft: '1500', garage_spaces: '0', basement_condition: 'finished', laundry_location: 'first_floor', fenced: 'no', answer: 'Yes' },
  low: { price: '560000', beds: '2', baths: '1', sqft: '1200', garage_spaces: '0', basement_condition: 'unfinished', laundry_location: 'first_floor', fenced: 'no', answer: 'No' },
};
const homes = {};
function addHome(key, kind, extraChecks = {}) {
  const f = FACTS[kind];
  const id = randomUUID();
  exec(`insert into public.homes (id, user_id, search_id, address, price, beds, baths, sqft, garage_spaces, basement_condition, laundry_location)
    values ('${id}', '${owner.id}', '${info.search}', ${lit(`${100 + Object.keys(homes).length} ${key} Way, Troy, MI 48084`)}, ${lit(f.price)}, ${lit(f.beds)}, ${lit(f.baths)}, ${lit(f.sqft)}, ${lit(f.garage_spaces)}, ${lit(f.basement_condition)}, ${lit(f.laundry_location)})`);
  const checks = { 'exterior:Fenced yard': f.fenced, ...extraChecks };
  exec(`insert into public.home_member_state (home_id, user_id, status, checks) values ('${id}', '${owner.id}', 'Saved', ${lit(JSON.stringify(checks))}::jsonb)
    on conflict (home_id, user_id) do update set checks = excluded.checks`);
  homes[key] = { id, kind, checks, facts: f };
  return homes[key];
}
function seed() {
  exec(`delete from public.homes where search_id = '${info.search}'`);
  exec(`delete from public.match_reveals`);
  for (const userId of [owner.id, coBuyer.id]) {
    exec(`update public.search_member_priorities set priorities = ${lit(JSON.stringify(PRIORITIES))}::jsonb where search_id = '${info.search}' and user_id = '${userId}'`);
  }
  exec(`update public.searches set priorities = ${lit(JSON.stringify(PRIORITIES))}::jsonb where id = '${info.search}'`);
  exec(`insert into public.search_members (search_id, user_id, role) values ('${info.search}', '${realtor.id}', 'realtor') on conflict (search_id, user_id) do nothing`);
  for (const device of ['desktop', 'iphone', 'small', 'smallest']) for (const kind of ['high', 'medium', 'low']) addHome(`${device}-${kind}`, kind);
  addHome('already', 'high', { 'features:Home office': true, 'features:Fireplace': true }); // 100% on arrival
  addHome('shared', 'high');
  addHome('tabs', 'high');
  addHome('failing', 'high');
}

// What the dialog must say, from the pure functions on the post-answer data.
function expectedFor(home, answer) {
  const f = home.facts;
  const shaped = { price: f.price, beds: f.beds, baths: f.baths, sqft: f.sqft, garageSpaces: f.garage_spaces, basementCondition: f.basement_condition, laundryLocation: f.laundry_location,
    checks: { ...home.checks, 'features:Home office': answer === 'Yes' ? true : 'no' }, ratings: {} };
  const match = computeMatch(shaped, normalizePriorities(PRIORITIES));
  const completeness = matchCompleteness(match);
  return { match, completeness, copy: revealCopy(match, completeness) };
}
const before = (home) => matchCompleteness(computeMatch({ price: home.facts.price, beds: home.facts.beds, baths: home.facts.baths, sqft: home.facts.sqft, garageSpaces: home.facts.garage_spaces, basementCondition: home.facts.basement_condition, laundryLocation: home.facts.laundry_location, checks: home.checks, ratings: {} }, normalizePriorities(PRIORITIES)));

const log = [];
async function step(name, fn) {
  const started = Date.now();
  try { await fn(); log.push({ step: name, ok: true, ms: Date.now() - started }); console.log('ok  ', name); }
  catch (error) { log.push({ step: name, ok: false, error: error.message }); console.error('FAIL', name, '—', error.message); }
}
const VIEWPORTS = {
  desktop: { viewport: { width: 1440, height: 900 } },
  iphone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  small: { viewport: { width: 375, height: 667 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  smallest: { viewport: { width: 320, height: 568 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};
async function signedIn(browser, who, device = 'desktop', extra = {}) {
  const context = await browser.newContext({ ...VIEWPORTS[device], ...extra });
  await context.addCookies([{ name: 'sb-localhost-auth-token', value: `base64-${Buffer.from(JSON.stringify(who.session)).toString('base64url')}`, domain: 'localhost', path: '/' }]);
  await context.addInitScript(() => { try { localStorage.setItem('flh-mobile-tour-dismissed', '1'); localStorage.setItem('flh-name-prompt-dismissed', '1'); localStorage.setItem('flh-install-dismissed', '1'); } catch { /* ignore */ } });
  await context.route('**/api/commute', (route) => route.fulfill({ json: { results: {} } }));
  const page = await context.newPage();
  page.errors = [];
  page.on('pageerror', (error) => page.errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error' && !IGNORED_CONSOLE.test(message.text())) page.errors.push(message.text()); });
  return page;
}
const reveal = (page) => page.locator('.flh-reveal[role="dialog"]');
async function openHome(page, home) {
  await page.goto(`${base}/homes/${home.id}`, { waitUntil: 'networkidle' });
  await page.locator('.flh-overlay[role="dialog"]').waitFor({ timeout: 60000 });
  await page.locator('#flh-match-title').waitFor();
}
async function answer(page, label, value) {
  for (const toggle of await page.locator('.flh-mc2-toggle[aria-expanded="false"]').all()) if (await toggle.isVisible()) await toggle.click();
  const field = page.locator('fieldset.flh-mc2-answer').filter({ has: page.locator('legend', { hasText: new RegExp(`^${label}$`) }) });
  await field.scrollIntoViewIfNeeded();
  await field.getByRole('radio', { name: value, exact: true }).check();
  await page.locator('.flh-overlay-save.is-saved').first().waitFor({ timeout: 15000 });
}
const reveals = (homeId, userId) => q(`select user_id from public.match_reveals where home_id = '${homeId}'${userId ? ` and user_id = '${userId}'` : ''}`).length;
async function noRevealFor(page, ms = 2500) {
  await page.waitForTimeout(ms);
  assert(await reveal(page).count() === 0, 'an unexpected reveal appeared');
}

async function main() {
  seed();
  for (const [key, home] of Object.entries(homes)) {
    if (key === 'already') assert(before(home).unlocked, 'already should start unlocked');
    else assert(before(home).pct === 80 && !before(home).unlocked, `${key} should start at 80%: ${JSON.stringify(before(home))}`);
  }
  const bands = Object.fromEntries(['high', 'medium', 'low'].map((kind) => [kind, expectedFor(homes[`desktop-${kind}`], FACTS[kind].answer)]));
  console.log('expected', JSON.stringify(Object.fromEntries(Object.entries(bands).map(([k, v]) => [k, { pct: v.match.pct, completeness: v.completeness.pct, headline: v.copy.headline }]))));
  const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {});

  for (const device of ['desktop', 'iphone', 'small', 'smallest']) {
    const page = await signedIn(browser, owner, device);
    for (const kind of ['high', 'medium', 'low']) {
      const home = homes[`${device}-${kind}`];
      const expected = expectedFor(home, FACTS[kind].answer);
      await step(`[${device}] ${kind}: opening shows nothing; the persisted answer that reaches 90% reveals ${expected.match.pct}% once`, async () => {
        await openHome(page, home);
        await noRevealFor(page, 1500);
        await answer(page, 'Home Office', FACTS[kind].answer);
        await reveal(page).waitFor({ timeout: 10000 });
        const text = (await reveal(page).innerText()).replace(/\s+/g, ' ');
        assert(text.includes(`${expected.match.pct}% Match`), `score: ${text}`);
        assert(text.includes(expected.copy.headline) && text.includes(expected.copy.body), `copy: ${text}`);
        assert(text.includes(`You’ve gathered ${expected.completeness.pct}% of the details that matter to you.`), `progress: ${text}`);
        assert(await page.evaluate(() => document.activeElement?.textContent) === 'See the breakdown', 'focus not on the main action');
        assert(reveals(home.id, owner.id) === 1, 'not recorded');
        // Fits the viewport without clipping.
        const fit = await reveal(page).evaluate((el) => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, vw: innerWidth, vh: innerHeight, scroll: el.scrollHeight - el.clientHeight }; });
        assert(fit.top >= 0 && fit.left >= 0 && fit.right <= fit.vw && fit.bottom <= fit.vh, `clipped: ${JSON.stringify(fit)}`);
        await page.waitForTimeout(device === 'desktop' && kind === 'high' ? 450 : 400);
        await page.screenshot({ path: join(outDir, `${device}-${kind}-${expected.match.pct}.png`) });
        if (device === 'desktop' && kind === 'high') {
          // Keyboard: Tab stays inside, Escape closes and focus returns to the answer.
          for (let i = 0; i < 5; i += 1) { await page.keyboard.press('Tab'); assert(await reveal(page).evaluate((el) => el.contains(document.activeElement)), `Tab ${i} left the reveal`); }
          await page.keyboard.press('Escape');
          await reveal(page).waitFor({ state: 'detached' });
          assert(await page.locator('.flh-overlay[role="dialog"]').count() === 1, 'Escape also closed the home');
          assert(await page.evaluate(() => document.activeElement?.closest('fieldset.flh-mc2-answer') !== null), 'focus did not return to the answer');
        } else if (device === 'desktop' && kind === 'medium') {
          // Outside click dismisses.
          await page.mouse.click(10, 10);
          await reveal(page).waitFor({ state: 'detached' });
          assert(await page.locator('.flh-overlay[role="dialog"]').count() === 1, 'outside click also closed the home');
        } else {
          // "See the breakdown" lands on Your Match.
          await reveal(page).getByRole('button', { name: 'See the breakdown' }).click();
          await reveal(page).waitFor({ state: 'detached' });
          await page.waitForFunction(() => document.activeElement?.id === '' && document.activeElement?.classList.contains('flh-overlay-match'), null, { timeout: 5000 });
        }
        // Later edits, and a reload, never reveal it again.
        await answer(page, 'Home Office', FACTS[kind].answer === 'Yes' ? 'No' : 'Yes');
        await noRevealFor(page, 1500);
        await openHome(page, home);
        await answer(page, 'Home Office', 'Unknown');
        await answer(page, 'Home Office', FACTS[kind].answer);
        await noRevealFor(page);
        assert(reveals(home.id, owner.id) === 1, 'recorded twice');
        assert(!page.errors.length, page.errors.join(' | '));
      });
    }
    await page.context().close();
  }

  await step('[desktop] a home already above 90% when opened never reveals, even after edits', async () => {
    const page = await signedIn(browser, owner);
    await openHome(page, homes.already);
    await noRevealFor(page);
    await answer(page, 'Home Office', 'No');
    await noRevealFor(page);
    assert(reveals(homes.already.id) === 0, 'recorded');
    await page.context().close();
  });

  await step('[desktop] two tabs on the same home: only one ever reveals', async () => {
    const a = await signedIn(browser, owner);
    const b = await signedIn(browser, owner);
    await openHome(a, homes.tabs);
    await openHome(b, homes.tabs);
    await answer(a, 'Home Office', 'Yes');
    await reveal(a).waitFor({ timeout: 10000 });
    // Tab B still thinks the home is at 80%: its own crossing is refused by the server.
    await answer(b, 'Home Office', 'Yes');
    await noRevealFor(b);
    assert(reveals(homes.tabs.id, owner.id) === 1, 'two records');
    await a.context().close(); await b.context().close();
  });

  await step('[desktop] a failed claim shows nothing and never breaks the save', async () => {
    const page = await signedIn(browser, owner);
    await page.route('**/rpc/claim_match_reveal', (route) => route.abort('failed'));
    await openHome(page, homes.failing);
    await answer(page, 'Home Office', 'Yes');
    await noRevealFor(page);
    assert(await page.locator('.flh-overlay-save.is-error').count() === 0, 'the save shows an error');
    assert(q(`select checks from public.home_member_state where home_id = '${homes.failing.id}' and user_id = '${owner.id}'`)[0].checks['features:Home office'] === true, 'the answer was not saved');
    assert(reveals(homes.failing.id) === 0, 'recorded despite the failure');
    await page.context().close();
  });

  await step('[co-buyer] earns their own reveal on the same home, from their own answers', async () => {
    const page = await signedIn(browser, owner);
    await openHome(page, homes.shared);
    await answer(page, 'Home Office', 'Yes');
    await reveal(page).waitFor({ timeout: 10000 });
    await page.context().close();
    const co = await signedIn(browser, coBuyer, 'iphone');
    await openHome(co, homes.shared);
    await noRevealFor(co, 1500);
    // The co-buyer has no answers of their own: 7 of 10. One answer is 80%, the second 90%.
    await answer(co, 'Fenced Yard', 'Yes');
    await noRevealFor(co, 1500);
    await answer(co, 'Home Office', 'Yes');
    await reveal(co).waitFor({ timeout: 10000 });
    await co.screenshot({ path: join(outDir, 'iphone-cobuyer-reveal.png') });
    assert(reveals(homes.shared.id, owner.id) === 1 && reveals(homes.shared.id, coBuyer.id) === 1, 'each buyer once');
    assert(!co.errors.length, co.errors.join(' | '));
    await co.context().close();
  });

  await step('[Realtor] the client home view never reveals and records nothing', async () => {
    const page = await signedIn(browser, realtor);
    await page.goto(`${base}/people/${info.search}/homes/${homes['desktop-high'].id}`, { waitUntil: 'networkidle' });
    await noRevealFor(page);
    assert(await page.locator('fieldset.flh-mc2-answer input').count() === 0, 'the Realtor can answer');
    assert(q(`select 1 from public.match_reveals where user_id = '${realtor.id}'`).length === 0, 'Realtor recorded');
    await page.context().close();
  });

  await step('[reduced motion] no confetti and no animation', async () => {
    exec(`delete from public.match_reveals where home_id = '${homes['desktop-high'].id}'`);
    exec(`update public.home_member_state set checks = '{"exterior:Fenced yard": true}'::jsonb where home_id = '${homes['desktop-high'].id}' and user_id = '${owner.id}'`);
    const page = await signedIn(browser, owner, 'desktop', { reducedMotion: 'reduce' });
    await openHome(page, homes['desktop-high']);
    await answer(page, 'Home Office', 'Yes');
    await reveal(page).waitFor({ timeout: 10000 });
    const motion = await page.evaluate(() => ({ dialog: getComputedStyle(document.querySelector('.flh-reveal')).animationName, confetti: getComputedStyle(document.querySelector('.flh-reveal-confetti')).display }));
    assert(motion.dialog === 'none' && motion.confetti === 'none', JSON.stringify(motion));
    await page.context().close();
  });

  await browser.close();
  writeFileSync(join(outDir, 'results.json'), JSON.stringify({ log }, null, 2));
  const failed = log.filter((entry) => !entry.ok);
  console.log(`${log.length - failed.length}/${log.length} steps passed`);
  if (failed.length) process.exitCode = 1;
}

await main();
