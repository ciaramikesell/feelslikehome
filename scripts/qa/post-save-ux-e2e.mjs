#!/usr/bin/env node
// Browser QA for Add Home V3, phase 6 (docs/add-home-v3-phase6-ux-audit.md):
// the journey after Save Home. DEVELOPMENT ONLY. Same setup as the other Add
// Home QA (stand-in on real Postgres + dev server with the RentCast fixture):
//
//   FLH_TEST_PGHOST=… FLH_TEST_PGPORT=… node scripts/qa/post-save-ux-e2e.mjs standin.json <outDir> [baseUrl]
//
// On desktop (1440) and iPhone (390): the saved state's single next step; the
// Your Match shortcut on the first screen; the Unknown legend; the listing
// context as one dated row whose Details sheet holds every line (no inline
// fold-out, nothing written); the open-priority line and tier counts; "Fill in
// next" landing on the Home Fact; "Answer next" opening a collapsed tier and
// focusing the row; answers written only by the buyer's own tap, only to that
// buyer's row, and kept on reload; the co-buyer's own progress and answer.
// Rows are checked in real Postgres. Any failed step, overflow or console
// error fails the run. 51619 is the fixture's failed (rate-limited) lookup.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { chromium, devices } from 'playwright';

const [infoPath, outArg, base = 'http://localhost:3200'] = process.argv.slice(2);
if (!infoPath || !outArg) throw new Error('Usage: post-save-ux-e2e.mjs <standin.json> <outDir> [baseUrl]');
const info = JSON.parse(readFileSync(infoPath, 'utf8').split('\n')[0]);
const outDir = resolve(outArg);
mkdirSync(outDir, { recursive: true });
const IGNORED_CONSOLE = /Download the React DevTools|favicon|maps\.googleapis|Google Maps|places|Failed to load resource/i;
const VIEWPORTS = [
  ['desktop-1440', { viewport: { width: 1440, height: 900 } }, 51693, 51619],
  ['iphone-390', devices['iPhone 13'], 51690, 51619],
];
const listingUrl = (number) => `https://www.zillow.com/homedetails/${number}-Sass-Rd-New-Baltimore-MI-48047/${number}_zpid/`;

function psql(sql) {
  const result = spawnSync('psql', ['-X', '-q', '-A', '-t', '-h', process.env.FLH_TEST_PGHOST, '-p', process.env.FLH_TEST_PGPORT || '5432', '-U', 'postgres', '-d', info.database, '-c', sql], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
}
const q = (sql) => JSON.parse(psql(`select coalesce(json_agg(t), '[]'::json) from (${sql}) t`));
const lit = (value) => `'${String(value).replace(/'/g, "''")}'`;
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const homeRow = (url) => q(`select id, home_condition, listing_import from public.homes where search_id = ${lit(info.search)} and listing_url = ${lit(url)}`)[0];
const checksOf = (homeId, userId) => q(`select checks from public.home_member_state where home_id = ${lit(homeId)} and user_id = ${lit(userId)}`)[0]?.checks || {};
const waitFor = async (page, fn, message) => { for (let i = 0; i < 40; i += 1) { if (fn()) return; await page.waitForTimeout(250); } throw new Error(message); };

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
const inViewport = (page, selector) => page.locator(selector).first().evaluate((el) => { const box = el.getBoundingClientRect(); return box.top >= 0 && box.bottom <= window.innerHeight; });
// Match Reveal (#170) may fire when a save crosses 75%: expected; keep going.
async function dismissReveal(page) {
  const reveal = page.locator('.flh-reveal-backdrop');
  await reveal.waitFor({ timeout: 2500 }).catch(() => {});
  if (await reveal.count()) { await page.getByRole('button', { name: 'Keep going' }).click(); await reveal.waitFor({ state: 'detached' }); }
}

async function findAndSave(page, url) {
  await page.goto(`${base}/homes`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /Add a Home/ }).first().click();
  await page.getByLabel('Listing link or address').fill(url);
  await page.getByRole('button', { name: /^Find home$/ }).click();
  await page.locator('.flh-found-card, .flh-found').first().waitFor({ timeout: 30000 });
  await page.getByRole('button', { name: /^Save Home$/ }).click();
  await page.locator('.flh-saved').waitFor({ timeout: 60000 });
}
async function openOverlay(page) {
  await page.locator('.flh-overlay[role="dialog"]:not(.is-loading)').waitFor({ timeout: 30000 });
  await page.waitForTimeout(400);
}

async function run() {
  const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {});
  for (const [label, device, number, sparseNumber] of VIEWPORTS) {
    psql(`delete from public.homes where search_id = ${lit(info.search)} and (address ~ ${lit(`^(${number}|${sparseNumber}) `)} or listing_url ~ ${lit(`/(${number}|${sparseNumber})-Sass`)})`);
    let owner; let coBuyer;
    const open = () => [owner, coBuyer].filter(Boolean);
    const url = listingUrl(number);
    let snapshotBefore;

    await step(`[${label}] saved state: one clear next step, the same two actions, nothing answered`, async () => {
      owner = await signedIn(browser, 'owner', device);
      await findAndSave(owner, url);
      const saved = await owner.locator('.flh-saved').innerText();
      assert(/Next, when you’re ready: View home shows what FLH found and how it fits your priorities\. Nothing else is required\./.test(saved), 'next-step hint');
      const actions = await owner.locator('.flh-saved-actions button').allInnerTexts();
      assert(actions.length === 2 && /Back to My Homes/.test(actions[0]) && /View home/.test(actions[1]), `actions ${actions}`);
      const row = homeRow(url);
      assert(Object.keys(checksOf(row.id, info.users.owner.id)).length === 0, 'answers written at save');
      snapshotBefore = JSON.stringify(row.listing_import);
      await shot(owner, `${label}-1-saved`);
    }, open);

    await step(`[${label}] first screen: Your Match shortcut visible with the open count; Unknown legend; listing context is one dated row`, async () => {
      await owner.getByRole('button', { name: /^View home/ }).click();
      await openOverlay(owner);
      assert(await inViewport(owner, '.flh-match-jump:visible'), 'shortcut not on the first screen');
      assert(/Your Match · 100% on 5 known priorities\s*3 unanswered/.test(await owner.locator('.flh-match-jump:visible').innerText()), `shortcut: ${await owner.locator('.flh-match-jump:visible').innerText()}`);
      assert((await owner.locator('.flh-hf2-legend').innerText()) === 'Unknown means FLH hasn’t found it yet. It never counts as No in your Match.', 'legend');
      assert(/When added \([A-Z][a-z]{2} \d{1,2}, \d{4}\): Active · listed as New Construction · 23 days on market/.test(await owner.locator('.flh-hf2-context-row:visible').innerText()), 'summary row');
      assert(!(await owner.locator('.flh-hf2 .flh-hf2-context').count()), 'full context still inline');
      assert(!(await owner.locator('.flh-overlay .flh-hf2 details').count()), 'Home Facts has an inline fold-out');
      await shot(owner, `${label}-2-first-screen`);
    }, open);

    await step(`[${label}] Details sheet: every dated line, county records and provenance; Escape closes it; nothing written`, async () => {
      await owner.locator('.flh-hf2-context-row:visible .flh-offered-review').click();
      const sheet = owner.locator('.flh-context-sheet');
      await sheet.waitFor();
      const text = await sheet.innerText();
      for (const expected of ['Found when this home was added', 'It isn’t refreshed after that and can be out of date. None of it changes Home Facts or your Match.', 'The listing called it New Construction', 'Listed before: Mar 2, 2025 – Apr 30, 2025 (59 days)', 'County records: fireplace (Masonry) · pool (Concrete) · City view', 'Home Facts list the year built as 1993. Records and listings can disagree, and FLH doesn’t decide which is right. The listing agent can confirm.'])
        assert(text.includes(expected), `sheet missing: ${expected}`);
      assert(/When added \([^)]*\): Active · listed Sep 26, 2026 · 23 days on market/.test(text), 'dated line');
      await shot(owner, `${label}-3-context-sheet`);
      await owner.keyboard.press('Escape');
      await sheet.waitFor({ state: 'detached' });
      assert(await owner.locator('.flh-overlay[role="dialog"]').count(), 'Escape closed the overlay too');
      assert(JSON.stringify(homeRow(url).listing_import) === snapshotBefore, 'snapshot changed');
    }, open);

    await step(`[${label}] shortcut lands on Your Match: open line, tier counts, county pointer stays a pointer`, async () => {
      await owner.locator('.flh-match-jump:visible').click();
      await owner.waitForTimeout(700);
      assert(await inViewport(owner, '#flh-match-title'), 'Your Match not in view');
      const lead = await owner.locator('.flh-overlay-match-lead').first().innerText();
      assert(lead === 'Your 100% is based on 5 known priorities. 3 are still unanswered.', `lead: ${lead}`);
      assert((await owner.locator('.flh-mc2-tier.is-important .flh-mc2-open').innerText()) === '2 unanswered', 'important open count');
      assert((await owner.locator('.flh-mc2-tier.is-nice .flh-mc2-open').innerText()) === '1 unanswered', 'nice open count');
      assert(!(await owner.locator('.flh-mc2-tier.is-must .flh-mc2-open').count()), 'must-have open count');
      assert(/Your answers here are yours alone\. Home Facts are shared with everyone in this search\./.test(await owner.locator('.flh-overlay-match').innerText()), 'personal answers note');
      assert(/Fill in next:\s*Home Condition/.test(await owner.locator('.flh-match-next').innerText()), 'fact next step first (Important before Nice)');
      await shot(owner, `${label}-4-your-match`);
    }, open);

    await step(`[${label}] "Fill in next" goes to the Home Condition fact; the buyer sets it; the next step becomes their own answer`, async () => {
      await owner.locator('.flh-match-next').click();
      await owner.waitForTimeout(700);
      assert(await owner.evaluate(() => document.activeElement?.id === 'hf-homeCondition'), 'focus not on Home Condition');
      await owner.locator('#hf-homeCondition').click();
      await owner.locator('.flh-multi-menu label').filter({ hasText: /Move-?in Ready/i }).click();
      await waitFor(owner, () => (homeRow(url).home_condition || []).length === 1, 'home condition not saved');
      await owner.keyboard.press('Escape');
      await dismissReveal(owner);
      await owner.locator('.flh-match-jump:visible').click();
      await owner.waitForTimeout(600);
      assert(/Answer next:\s*Finished Basement/i.test(await owner.locator('.flh-match-next').innerText()), `next: ${await owner.locator('.flh-match-next').innerText()}`);
      assert(Object.keys(checksOf(homeRow(url).id, info.users.owner.id)).length === 0, 'answered for the buyer');
    }, open);

    await step(`[${label}] "Answer next" opens the tier (collapsed on phones) and focuses the row; only the buyer's tap answers`, async () => {
      if (label.startsWith('iphone')) assert((await owner.locator('#mc-important-rows').getAttribute('data-open')) === 'false', 'Important should start collapsed on a phone');
      await owner.locator('.flh-match-next').click();
      await owner.waitForTimeout(800);
      assert((await owner.locator('#mc-important-rows').getAttribute('data-open')) === 'true', 'tier not opened');
      const focusedRow = await owner.evaluate(() => document.activeElement?.closest('[data-criterion]')?.getAttribute('data-criterion'));
      assert(focusedRow === 'features:Finished basement', `focused ${focusedRow}`);
      assert(Object.keys(checksOf(homeRow(url).id, info.users.owner.id)).length === 0, 'focus answered something');
      await shot(owner, `${label}-5-answer-next`);
      await owner.locator('[data-criterion="features:Finished basement"] label.is-no').click();
      await waitFor(owner, () => checksOf(homeRow(url).id, info.users.owner.id)['features:Finished basement'] === 'no', 'answer not saved');
      await dismissReveal(owner);
      assert(/Answer next:\s*Fireplace/.test(await owner.locator('.flh-match-next').innerText()), 'next after answering');
    }, open);

    await step(`[${label}] reload: the answer and the fact persist; progress reflects them`, async () => {
      await owner.reload({ waitUntil: 'networkidle' });
      await openOverlay(owner);
      assert(/1 unanswered/.test(await owner.locator('.flh-match-jump:visible').innerText()), 'shortcut count after reload');
      assert(await owner.locator('[data-criterion="features:Finished basement"] label.is-no.is-checked').count(), 'answer lost');
      assert(checksOf(homeRow(url).id, info.users.owner.id)['features:Fireplace'] === undefined, 'Fireplace answered from county records');
    }, open);

    await step(`[${label}] co-buyer: same shared facts and context; their own progress; their own answer only`, async () => {
      coBuyer = await signedIn(browser, 'coBuyer', device);
      const id = homeRow(url).id;
      await coBuyer.goto(`${base}/homes/${id}`, { waitUntil: 'networkidle' });
      await openOverlay(coBuyer);
      assert(/Your Match · 100% on 1 known priority\s*1 unanswered/.test(await coBuyer.locator('.flh-match-jump:visible').innerText()), `co-buyer shortcut: ${await coBuyer.locator('.flh-match-jump:visible').innerText()}`);
      assert(/When added/.test(await coBuyer.locator('.flh-hf2-context-row:visible').innerText()), 'co-buyer context row');
      await coBuyer.locator('.flh-match-jump:visible').click();
      await coBuyer.waitForTimeout(600);
      assert(/^Your 100% is based on 1 known priority\. 1 is still unanswered\.$/.test(await coBuyer.locator('.flh-overlay-match-lead').first().innerText()), 'co-buyer lead');
      await coBuyer.locator('.flh-match-next').click();
      await coBuyer.waitForTimeout(600);
      assert(await coBuyer.evaluate(() => document.activeElement?.closest('[data-criterion]')?.getAttribute('data-criterion') === 'features:Fireplace'), 'co-buyer focus');
      await coBuyer.locator('[data-criterion="features:Fireplace"] label.is-yes').click();
      await waitFor(coBuyer, () => checksOf(id, info.users.coBuyer.id)['features:Fireplace'] === true, 'co-buyer answer not saved');
      await dismissReveal(coBuyer);
      assert(/^Your 100% is based on 2 known priorities\. Everything you can check before a tour is answered\.$/.test(await coBuyer.locator('.flh-overlay-match-lead').first().innerText()), 'co-buyer settled line');
      assert(!(await coBuyer.locator('.flh-match-next').count()), 'next step shown when nothing is open');
      assert(/See breakdown/.test(await coBuyer.locator('.flh-match-jump:visible').innerText()), 'shortcut when settled');
      const ownerChecks = checksOf(id, info.users.owner.id);
      assert(ownerChecks['features:Fireplace'] === undefined && ownerChecks['features:Finished basement'] === 'no', `owner answers changed: ${JSON.stringify(ownerChecks)}`);
      await shot(coBuyer, `${label}-6-cobuyer-settled`);
      await coBuyer.context().close(); coBuyer = null;
    }, open);

    await step(`[${label}] sparse home (failed lookup, address only): legend, no context row, Unknown everywhere, nothing answered`, async () => {
      await findAndSave(owner, listingUrl(sparseNumber));
      await owner.getByRole('button', { name: /^View home/ }).click();
      await openOverlay(owner);
      assert(!(await owner.locator('.flh-hf2-context-row:visible').count()), 'context row without context');
      assert(await owner.locator('.flh-hf2-legend').count(), 'legend');
      assert(await inViewport(owner, '.flh-match-jump:visible'), 'shortcut on first screen');
      const id = q(`select id from public.homes where search_id = ${lit(info.search)} and address ~ ${lit(`^${sparseNumber} `)}`)[0]?.id;
      assert(id && Object.keys(checksOf(id, info.users.owner.id)).length === 0, 'answers on a sparse home');
      await shot(owner, `${label}-7-sparse-first-screen`);
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
