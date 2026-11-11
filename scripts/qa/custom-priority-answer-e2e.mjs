#!/usr/bin/env node
// Full-stack QA: a buyer's own typed priority can be answered. DEVELOPMENT ONLY.
//
//   1. FLH_TEST_PGHOST=… FLH_TEST_PGPORT=… node scripts/qa/supabase-standin.mjs 54321 > standin.json
//   2. NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=qa npx next dev -p 3200
//   3. FLH_TEST_PGHOST=… FLH_TEST_PGPORT=… node scripts/qa/custom-priority-answer-e2e.mjs standin.json <outDir> [baseUrl]
//
// Puts "Desirable Street" on the owner's board exactly as production stored it
// before the fix (Location customItems, kind 'rating', no source flag, Must-Have),
// then, at 1440 and 390 wide, answers it Yes / No / Unknown in the real home
// overlay and checks home_member_state after each click: only the owner's own
// checks change, the co-buyer's answer is untouched, and the Realtor's view
// has no controls. Screenshots and results.json land in <outDir>.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';

const [infoPath, outArg, base = 'http://localhost:3200'] = process.argv.slice(2);
if (!infoPath || !outArg) throw new Error('Usage: custom-priority-answer-e2e.mjs <standin.json> <outDir> [baseUrl]');
const info = JSON.parse(readFileSync(infoPath, 'utf8').split('\n')[0]);
const outDir = resolve(outArg);
mkdirSync(outDir, { recursive: true });
const IGNORED_CONSOLE = /Download the React DevTools|favicon|maps\.googleapis|Google Maps|places|Failed to load resource/i;
const OWNER = info.users.owner.id;
const CO = info.users.coBuyer.id;
const HOME = info.legacyHomeId;
const KEY = 'location:Desirable Street';

function psql(sql) {
  const result = spawnSync('psql', ['-X', '-q', '-A', '-t', '-h', process.env.FLH_TEST_PGHOST, '-p', process.env.FLH_TEST_PGPORT || '5432', '-U', 'postgres', '-d', info.database, '-c', sql], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
}
const q = (sql) => JSON.parse(psql(`select coalesce(json_agg(t), '[]'::json) from (${sql}) t`));
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const log = [];
const waitFor = async (fn, message, timeout = 10000) => {
  const until = Date.now() + timeout;
  for (;;) { if (await fn()) return; if (Date.now() > until) throw new Error(message); await new Promise((r) => setTimeout(r, 150)); }
};
const checksOf = (user) => q(`select checks from public.home_member_state where home_id = '${HOME}' and user_id = '${user}'`)[0]?.checks ?? null;

async function signedIn(browser, who, width) {
  const context = await browser.newContext({ viewport: { width, height: width < 500 ? 844 : 900 }, deviceScaleFactor: 2, ...(width < 500 ? { isMobile: true, hasTouch: true } : {}) });
  await context.addCookies([{ name: 'sb-localhost-auth-token', value: `base64-${Buffer.from(JSON.stringify(info.users[who].session)).toString('base64url')}`, domain: 'localhost', path: '/' }]);
  await context.addInitScript(() => { try { localStorage.setItem('flh-mobile-tour-dismissed', '1'); } catch { /* ignore */ } });
  const page = await context.newPage();
  page.errors = [];
  page.on('pageerror', (error) => page.errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error' && !IGNORED_CONSOLE.test(message.text())) page.errors.push(message.text().slice(0, 400)); });
  return page;
}
async function step(name, fn, pages = []) {
  const started = Date.now();
  try {
    await fn();
    const errors = pages.flatMap((page) => page.errors.splice(0));
    if (errors.length) throw new Error(`console errors: ${errors.join(' | ')}`);
    log.push({ step: name, ok: true, ms: Date.now() - started }); console.log('ok  ', name);
  } catch (error) { log.push({ step: name, ok: false, error: error.message }); console.error('FAIL', name, '—', error.message); }
}
async function overflow(page) {
  return page.evaluate(() => Math.max(document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ...[...document.querySelectorAll('.flh-overlay-scroll')].map((node) => node.scrollWidth - node.clientWidth)));
}
// The overlay keeps a second (hidden) copy of the Match list mounted: use the visible one.
const streetRow = (page) => page.locator('li.flh-mc2-row', { hasText: 'Desirable Street' }).filter({ visible: true });
const fieldset = (page) => page.locator('fieldset.flh-mc2-answer', { has: page.locator('legend', { hasText: /^Desirable Street$/ }) }).filter({ visible: true });
async function rowShot(page, name) {
  await streetRow(page).scrollIntoViewIfNeeded();
  await page.waitForTimeout(250);
  assert(await overflow(page) <= 0, `${name}: horizontal overflow`);
  await page.screenshot({ path: join(outDir, `${name}.png`) });
}

async function run() {
  // The founder's production shape, written directly (as the old UI stored it).
  const priorities = JSON.parse(psql(`select priorities::text from public.search_member_priorities where search_id = '${info.search}' and user_id = '${OWNER}'`));
  priorities.location = { ...(priorities.location || {}), customItems: [...(priorities.location?.customItems || []), { label: 'Desirable Street', kind: 'rating' }], tiers: { ...(priorities.location?.tiers || {}), 'Desirable Street': 'must' } };
  psql(`update public.search_member_priorities set priorities = '${JSON.stringify(priorities).replace(/'/g, "''")}'::jsonb where search_id = '${info.search}' and user_id = '${OWNER}'`);
  // The co-buyer has the same priority and their own answer on this home.
  const coPriorities = JSON.parse(psql(`select priorities::text from public.search_member_priorities where search_id = '${info.search}' and user_id = '${CO}'`));
  coPriorities.location = { ...(coPriorities.location || {}), customItems: [{ label: 'Desirable Street', kind: 'rating' }], tiers: { 'Desirable Street': 'important' } };
  psql(`update public.search_member_priorities set priorities = '${JSON.stringify(coPriorities).replace(/'/g, "''")}'::jsonb where search_id = '${info.search}' and user_id = '${CO}'`);
  psql(`insert into public.home_member_state (home_id, user_id, status, checks) values ('${HOME}', '${CO}', 'Saved', '{"${KEY}": "no"}') on conflict (home_id, user_id) do update set checks = excluded.checks`);
  const stored = () => JSON.stringify(q(`select priorities -> 'location' as l from public.search_member_priorities where search_id = '${info.search}' and user_id = '${OWNER}'`)[0].l);
  const storedBefore = stored();

  // The repository pins its own Playwright; FLH_CHROMIUM points at a matching browser if needed.
  const browser = await chromium.launch(process.env.FLH_CHROMIUM ? { executablePath: process.env.FLH_CHROMIUM } : {});
  for (const width of [1440, 390]) {
    const tag = (name) => `${name}-${width}`;
    psql(`update public.home_member_state set checks = '{"features:Finished basement": true}' where home_id = '${HOME}' and user_id = '${OWNER}'`);
    const owner = await signedIn(browser, 'owner', width);

    await step(`[${width}] Desirable Street (stored kind rating, Must-Have) shows Yes / No / Unknown, Unknown selected`, async () => {
      await owner.goto(`${base}/homes/${HOME}?section=match`, { waitUntil: 'networkidle' });
      await owner.locator('.flh-overlay[role="dialog"]:not(.is-loading)').waitFor({ timeout: 60000 });
      await streetRow(owner).waitFor({ timeout: 20000 });
      assert(await owner.locator('section.flh-mc2-tier.is-must li.flh-mc2-row', { hasText: 'Desirable Street' }).filter({ visible: true }).count() === 1, 'not in Must-Haves');
      const radios = fieldset(owner).getByRole('radio');
      assert(await radios.count() === 3, `expected 3 radios, found ${await radios.count()}`);
      assert(await fieldset(owner).locator('label.is-unknown input').isChecked(), 'Unknown not selected');
      // Tap targets: every option at least 40px tall on phones (the existing control).
      for (const box of await fieldset(owner).locator('label').evaluateAll((nodes) => nodes.map((n) => n.getBoundingClientRect().toJSON()))) {
        assert(box.height >= (width < 500 ? 40 : 30), `option ${Math.round(box.height)}px tall`);
      }
      await rowShot(owner, tag('01-unknown'));
    }, [owner]);

    for (const [choice, expected, name] of [['Yes', true, '02-yes'], ['No', 'no', '03-no'], ['Unknown', undefined, '04-unknown-again']]) {
      await step(`[${width}] ${choice} persists to the owner's own checks only`, async () => {
        const pctBefore = await owner.locator('.flh-match-pill').first().textContent().catch(() => '');
        await fieldset(owner).locator('label', { hasText: new RegExp(`^${choice}$`) }).click();
        await waitFor(() => (checksOf(OWNER)?.[KEY]) === expected, `${choice} not saved (got ${JSON.stringify(checksOf(OWNER))})`);
        assert(checksOf(OWNER)['features:Finished basement'] === true, 'other answer changed');
        assert(checksOf(CO)?.[KEY] === 'no', 'co-buyer answer changed');
        assert(await fieldset(owner).locator(`label.is-${choice.toLowerCase()} input`).isChecked(), `${choice} not shown as selected`);
        const pctAfter = await owner.locator('.flh-match-pill').first().textContent().catch(() => '');
        log.push({ width, choice, matchBefore: pctBefore?.trim(), matchAfter: pctAfter?.trim() });
        await rowShot(owner, tag(name));
      }, [owner]);
    }

    await step(`[${width}] keyboard: arrow keys move between options`, async () => {
      await fieldset(owner).locator('label.is-unknown input').focus();
      await owner.keyboard.press(width < 500 ? 'ArrowLeft' : 'ArrowLeft');
      await waitFor(() => checksOf(OWNER)?.[KEY] === 'no', 'arrow key did not answer No');
      await fieldset(owner).locator('label', { hasText: /^Unknown$/ }).click();
      await waitFor(() => checksOf(OWNER)?.[KEY] === undefined, 'Unknown not restored');
    }, [owner]);
    await owner.context().close();

    await step(`[${width}] Realtor sees the buyer's row read-only, no controls`, async () => {
      const realtor = await signedIn(browser, 'realtor', width);
      await realtor.goto(`${base}/people/${info.search}/homes/${HOME}?section=match`, { waitUntil: 'networkidle' });
      await streetRow(realtor).waitFor({ timeout: 30000 });
      assert(await realtor.locator('.flh-mc2 input').count() === 0, 'Realtor has Match controls (visible or hidden)');
      await rowShot(realtor, tag('05-realtor-read-only'));
      await realtor.context().close();
    });
  }
  await browser.close();
  assert(stored() === storedBefore, 'stored priority changed');
  log.push({ step: 'stored priority (label, category, kind, tier) unchanged', ok: stored() === storedBefore });
  writeFileSync(join(outDir, 'results.json'), JSON.stringify(log, null, 2));
  const failed = log.filter((entry) => entry.ok === false);
  console.log(`${log.filter((entry) => entry.ok).length} ok, ${failed.length} failed`);
  if (failed.length) process.exit(1);
}

run().catch((error) => { console.error(error); process.exit(1); });
