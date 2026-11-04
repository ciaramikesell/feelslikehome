#!/usr/bin/env node
// Browser QA for Home Facts → Match parity. DEVELOPMENT ONLY.
// Same setup as home-overlay-e2e.mjs (stand-in on real Postgres + dev server,
// with 2026-11-02-home-facts-match-parity.sql applied by the stand-in):
//
//   FLH_TEST_PGHOST=… FLH_TEST_PGPORT=… node scripts/qa/home-fact-match-parity-e2e.mjs standin.json <outDir> [baseUrl]
//
// On desktop, iPad and iPhone as the owner, then as the co-buyer and the
// Realtor: Match rows answered by Home Facts say so; Yes / No overrides only the
// viewer's own answer; "Home Facts" removes the override; a corrected Home Fact
// updates the answer with no write to anyone's checks; the co-buyer's Match the
// owner sees equals the co-buyer's own. The database is checked after each step.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { register } from 'node:module';
import { chromium, devices } from 'playwright';

register('../../test/support/aliasHooks.mjs', import.meta.url);
const { normalizePriorities } = await import('../../src/lib/constants.js');
const { addCriterion } = await import('../../src/lib/searchProfile.js');

const [infoPath, outArg, base = 'http://localhost:3200'] = process.argv.slice(2);
if (!infoPath || !outArg) throw new Error('Usage: home-fact-match-parity-e2e.mjs <standin.json> <outDir> [baseUrl]');
const info = JSON.parse(readFileSync(infoPath, 'utf8').split('\n')[0]);
const outDir = resolve(outArg);
mkdirSync(outDir, { recursive: true });
const OWNER = info.users.owner.id;
const CO = info.users.coBuyer.id;
const IGNORED_CONSOLE = /Download the React DevTools|favicon|maps\.googleapis|Google Maps|places|Failed to load resource/i;
const VIEWPORTS = [
  ['desktop-1440', { viewport: { width: 1440, height: 900 } }],
  ['ipad-820', { ...devices['iPad (gen 11)'], viewport: { width: 820, height: 1180 } }],
  ['iphone-390', devices['iPhone 13']],
];

function psql(sql) {
  const result = spawnSync('psql', ['-X', '-q', '-A', '-t', '-h', process.env.FLH_TEST_PGHOST, '-p', process.env.FLH_TEST_PGPORT || '5432', '-U', 'postgres', '-d', info.database, '-c', sql], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
}
const q = (sql) => JSON.parse(psql(`select coalesce(json_agg(t), '[]'::json) from (${sql}) t`));
const lit = (value) => `'${String(value).replace(/'/g, "''")}'`;
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const checksOf = (homeId, userId) => q(`select checks from public.home_member_state where home_id = ${lit(homeId)} and user_id = ${lit(userId)}`)[0]?.checks || {};
const until = async (fn, message, timeout = 15000) => {
  const end = Date.now() + timeout;
  for (;;) { if (await fn()) return; if (Date.now() > end) throw new Error(message); await new Promise((r) => setTimeout(r, 150)); }
};

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

const shot = (page, name, element = null) => (element ? page.locator(element).first().screenshot({ path: join(outDir, `${name}.png`) }) : page.screenshot({ path: join(outDir, `${name}.png`), fullPage: true }));
const showTiers = async (page) => {
  for (let i = 0; i < 4; i += 1) {
    const toggle = page.locator('.flh-mc2-toggle[aria-expanded="false"]:visible').first();
    if (!(await toggle.count())) return;
    await toggle.click();
    await page.waitForTimeout(100);
  }
};
const expandFacts = async (page) => {
  for (let i = 0; i < 8; i += 1) {
    const toggle = page.locator('.flh-phone-collapse-toggle[aria-expanded="false"]:visible').first();
    if (!(await toggle.count())) return;
    await toggle.click();
  }
};
const matchRow = (page, name) => page.locator('.flh-mc2-row').filter({ has: page.locator('.flh-mc2-name', { hasText: new RegExp(`^${name}`) }) });
const choose = (page, name, choice) => matchRow(page, name).locator('label', { hasText: new RegExp(`^${choice}$`) }).click();
const checkedOption = async (page, name) => (await matchRow(page, name).locator('label.is-checked').textContent())?.trim();
const pct = async (page) => Number((await page.locator('.flh-match-pill').first().textContent()).match(/\d+/)[0]);

async function openMatch(page, path) {
  await page.goto(`${base}${path}`, { waitUntil: 'networkidle' });
  await page.locator('.flh-mc2').first().waitFor({ timeout: 30000 });
  await showTiers(page);
}

function setPriorities(userId, priorities) {
  const json = `${lit(JSON.stringify(priorities))}::jsonb`;
  const updated = psql(`update public.search_member_priorities set priorities = ${json} where search_id = ${lit(info.search)} and user_id = ${lit(userId)} returning 1`);
  if (!updated) psql(`update public.searches set priorities = ${json} where id = ${lit(info.search)} and user_id = ${lit(userId)}`);
}
function buyerPriorities(entries) {
  let priorities = normalizePriorities({ searchType: 'purchase' });
  priorities.budget = { value: '400000', tier: 'important' };
  for (const [categoryKey, label, tier] of entries) priorities = addCriterion(priorities, { categoryKey, label, kind: 'check' }, tier);
  return priorities;
}

async function run() {
  const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {});
  setPriorities(OWNER, buyerPriorities([['exterior', 'Garage', 'must'], ['features', 'Finished basement', 'important'], ['features', 'Walkout basement', 'nice'], ['location', 'No HOA', 'important'], ['features', 'Fireplace', 'nice']]));
  setPriorities(CO, buyerPriorities([['features', 'Finished basement', 'important'], ['features', 'Fireplace', 'must']]));

  for (const [label, device] of VIEWPORTS) {
    const homeId = randomUUID();
    psql(`insert into public.homes (id, user_id, search_id, address, price, garage_spaces, basement_condition, basement_style, hoa_fee_monthly)
      values (${lit(homeId)}, ${lit(OWNER)}, ${lit(info.search)}, ${lit(`${label.length} Parity Ct ${label}, Royal Oak, MI 48073`)}, '350000', '0', 'finished', 'traditional', 300)`);
    let owner;
    const open = () => [owner].filter(Boolean);

    await step(`[${label}] owner: Home Facts answer Garage, Finished basement and No HOA; Walkout stays Unknown; nothing is written`, async () => {
      owner = await signedIn(browser, 'owner', device);
      await openMatch(owner, `/homes/${homeId}?section=match`);
      for (const [name, state, text] of [['Garage', 'is-missed', 'No'], ['Finished Basement', 'is-met', 'Yes'], ['No HOA', 'is-missed', 'No']]) {
        const row = matchRow(owner, name);
        assert((await row.getAttribute('class')).includes(state), `${name} row is not ${state}`);
        assert((await row.locator('.flh-mc2-from').textContent()).startsWith(`From Home Facts: ${text}`), `${name}: the note does not show the answer (${text})`);
        assert(await checkedOption(owner, name) === 'Home Facts', `${name}: the Home Facts option is not selected`);
      }
      assert(await matchRow(owner, 'Walkout Basement').locator('.flh-mc2-from').count() === 0, 'Walkout shows a Home Facts note for a Traditional basement');
      assert(await checkedOption(owner, 'Walkout Basement') === 'Unknown', 'Walkout is not Unknown');
      // budget 1×2 + Garage 0×4 + Finished basement 1×2 + No HOA 0×2 over 10; Walkout and Fireplace Unknown.
      assert(await pct(owner) === 40, `Match ${await pct(owner)}%, expected 40%`);
      assert(Object.keys(checksOf(homeId, OWNER)).length === 0, 'a derived answer was written into the owner\'s checks');
      await shot(owner, `${label}-1-from-home-facts`, '.flh-mc2');
    }, open);

    await step(`[${label}] owner: Yes overrides the fact for the owner only; "Home Facts" removes the override`, async () => {
      await choose(owner, 'Garage', 'Yes');
      await until(() => checksOf(homeId, OWNER)['exterior:Garage'] === true, 'override not saved');
      await until(async () => (await matchRow(owner, 'Garage').locator('.flh-mc2-from').textContent())?.startsWith('Your answer · Home Facts: No'), 'override note not shown');
      assert(Object.keys(checksOf(homeId, CO)).length === 0, 'the co-buyer received an answer');
      await shot(owner, `${label}-2-override`, '.flh-mc2');
      await choose(owner, 'Garage', 'Home Facts');
      await until(() => checksOf(homeId, OWNER)['exterior:Garage'] === undefined, 'override not removed');
      await until(async () => (await matchRow(owner, 'Garage').locator('.flh-mc2-from').textContent())?.startsWith('From Home Facts:'), 'did not return to Home Facts');
    }, open);

    await step(`[${label}] owner: correcting a Home Fact updates the derived answer with no write to checks`, async () => {
      await owner.goto(`${base}/homes/${homeId}`, { waitUntil: 'networkidle' });
      await owner.locator('.flh-overlay[role="dialog"]:not(.is-loading)').waitFor({ timeout: 30000 });
      await expandFacts(owner);
      await owner.locator('#hf-basementCondition').selectOption('unfinished');
      await until(() => q(`select basement_condition from public.homes where id = ${lit(homeId)}`)[0].basement_condition === 'unfinished', 'fact not saved');
      await openMatch(owner, `/homes/${homeId}?section=match`);
      assert((await matchRow(owner, 'Finished Basement').getAttribute('class')).includes('is-missed'), 'Finished basement did not follow the corrected fact');
      assert(Object.keys(checksOf(homeId, OWNER)).length === 0, 'checks were written');
      await shot(owner, `${label}-3-fact-corrected`, '.flh-mc2');
    }, open);
    await owner.context().close();

    if (label === 'desktop-1440') {
      let coBuyer; let viewer;
      await step(`[${label}] co-buyer: their own Match follows the fact, the owner's override never reaches it, and Compare agrees`, async () => {
        // The owner overrides Finished basement Yes; the co-buyer has no answer.
        viewer = await signedIn(browser, 'owner', device);
        await openMatch(viewer, `/homes/${homeId}?section=match`);
        await choose(viewer, 'Finished Basement', 'Yes');
        await until(() => checksOf(homeId, OWNER)['features:Finished basement'] === true, 'owner override not saved');
        coBuyer = await signedIn(browser, 'coBuyer', device);
        await openMatch(coBuyer, `/homes/${homeId}?section=match`);
        assert((await matchRow(coBuyer, 'Finished Basement').getAttribute('class')).includes('is-missed'), 'co-buyer did not get the fact (Unfinished)');
        assert((await matchRow(coBuyer, 'Finished Basement').locator('.flh-mc2-from').textContent()).startsWith('From Home Facts:'), 'co-buyer row not labelled');
        const own = await pct(coBuyer);
        await shot(coBuyer, `${label}-4-cobuyer-own`, '.flh-mc2');
        // The owner's view of the co-buyer's Match (the SQL Compare scorer) is the same number.
        await viewer.reload({ waitUntil: 'networkidle' });
        const context = (await viewer.locator('.flh-overlay-match-context', { hasText: /co-buyer/ }).textContent()).match(/(\d+)%/)?.[1];
        assert(Number(context) === own, `owner sees co-buyer at ${context}%, co-buyer sees ${own}%`);
        assert(Object.keys(checksOf(homeId, CO)).length === 0, 'the co-buyer got an answer written');
      }, () => [coBuyer, viewer].filter(Boolean));
      await coBuyer?.context().close(); await viewer?.context().close();

      let realtor;
      await step(`[${label}] Realtor: sees the answers and where they came from, with no controls`, async () => {
        realtor = await signedIn(browser, 'realtor', device);
        await realtor.goto(`${base}/people/${info.search}/homes/${homeId}?section=match`, { waitUntil: 'networkidle' });
        await realtor.locator('.flh-mc2').first().waitFor({ timeout: 30000 });
        assert(await realtor.locator('.flh-mc2 input').count() === 0, 'Realtor has Match controls');
        await shot(realtor, `${label}-5-realtor-read-only`, '.flh-mc2');
      }, () => [realtor].filter(Boolean));
      await realtor?.context().close();
    }
  }

  await browser.close();
  writeFileSync(join(outDir, 'results.json'), JSON.stringify(log, null, 2));
  const failed = log.filter((entry) => !entry.ok);
  console.log(`\n${log.length - failed.length}/${log.length} steps passed`);
  if (failed.length) process.exitCode = 1;
}

await run();
