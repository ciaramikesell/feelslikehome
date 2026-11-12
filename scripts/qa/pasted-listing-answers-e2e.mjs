#!/usr/bin/env node
// Browser QA for Safe Pasted Listing Suggestions. DEVELOPMENT ONLY.
// Same setup as home-overlay-e2e.mjs (stand-in on real Postgres + dev server;
// no RentCast lookup is made — the paste path never calls it):
//
//   FLH_TEST_PGHOST=… FLH_TEST_PGPORT=… node scripts/qa/pasted-listing-answers-e2e.mjs standin.json <outDir> [baseUrl]
//
// Drives Add Home → "Paste listing details instead" on desktop, iPad and iPhone
// as the owner, then once as the co-buyer and the Realtor, and checks the
// database after each save: pasting writes no Match answer; the found card only
// names the possible answers (Add Home V3 phase 2) and each buyer answers in
// their own Match view, where "Listing suggests …" is rebuilt from the saved
// snapshot; only the buyer's own Yes / No lands in their home_member_state.checks;
// the shared snapshot keeps the text evidence as pasted listing text. Any failed
// step, horizontal overflow or console error fails the run.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { chromium, devices } from 'playwright';

const [infoPath, outArg, base = 'http://localhost:3200'] = process.argv.slice(2);
if (!infoPath || !outArg) throw new Error('Usage: pasted-listing-answers-e2e.mjs <standin.json> <outDir> [baseUrl]');
const info = JSON.parse(readFileSync(infoPath, 'utf8').split('\n')[0]);
const outDir = resolve(outArg);
mkdirSync(outDir, { recursive: true });
const OWNER = info.users.owner.id;
const CO = info.users.coBuyer.id;
const REALTOR = info.users.realtor.id;
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
const homeByAddress = (address) => q(`select id, user_id, beds, listing_import from public.homes where search_id = ${lit(info.search)} and address = ${lit(address)}`);
const memberStates = (homeId) => q(`select user_id, checks from public.home_member_state where home_id = ${lit(homeId)} order by user_id`);
const checksOf = (homeId, userId) => memberStates(homeId).find((row) => row.user_id === userId)?.checks || {};

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
const shot = (page, name, element = null) => (element ? page.locator(element).screenshot({ path: join(outDir, `${name}.png`) }) : page.screenshot({ path: join(outDir, `${name}.png`) }));

const listingText = (address) => [
  address,
  'List price $349,900. 4 beds, 2.5 baths, 2,150 sq ft.',
  'Does not have a finished basement.',
  'Gas fireplace in the family room.',
  'Community pool. Fully fenced backyard. Room for a pool.',
].join('\n');

async function paste(page, address, path = '/homes', openLabel = /Add a Home/) {
  await page.goto(`${base}${path}`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: openLabel }).first().click();
  await page.locator('.hh-add-home-discovery[role="dialog"]').waitFor();
  await page.locator('.hh-manual-fallback summary').click();
  await page.getByPlaceholder('Paste listing details (optional)').fill(listingText(address));
  await page.getByRole('button', { name: 'Fill in details' }).click();
}
const review = (page) => page.locator('.flh-answer-review');
const deferred = (page) => page.locator('.flh-deferred-answers');
const matchRow = (page, label) => page.locator('.flh-mc2-row').filter({ has: page.locator('.flh-mc2-name', { hasText: new RegExp(`^${label}`, 'i') }) });
const pointer = (page, label) => matchRow(page, label).locator('.flh-mc2-listing');
async function openMatch(page) {
  for (let i = 0; i < 4; i += 1) {
    const toggle = page.locator('.flh-mc2-toggle[aria-expanded="false"]:visible').first();
    if (!(await toggle.count())) break;
    await toggle.click();
    await page.waitForTimeout(100);
  }
}
async function addToMyHomes(page) {
  await page.getByRole('button', { name: 'Save Home' }).click();
  // Add Home V3: Save Home shows the saved state; View home opens the overlay.
  await page.locator('.flh-saved').waitFor({ timeout: 60000 });
  await page.getByRole('button', { name: /^View home/ }).click();
  await page.waitForURL(/\/homes\/[0-9a-f-]{36}$/, { timeout: 60000 });
  await page.locator('.flh-overlay[role="dialog"]:not(.is-loading)').waitFor({ timeout: 30000 });
}

async function run() {
  const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {});
  psql(`delete from public.homes where search_id = ${lit(info.search)} and address like '% Paste Ln,%'`);

  for (const [label, device] of VIEWPORTS) {
    let owner;
    const open = () => [owner].filter(Boolean);
    const number = label === 'desktop-1440' ? 11 : label === 'ipad-820' ? 12 : 13;
    const address = `${number} Paste Ln, New Baltimore, MI 48047`;

    // Add Home V3 phase 2: on the found card personal answers are only named
    // (they wait for the buyer's own Match view); after saving, each buyer's
    // unanswered criteria show "Listing suggests …" there, rebuilt from the saved
    // snapshot, and only the buyer's own Yes / No writes anything.
    await step(`[${label}] owner: the card names the possible answers but answers nothing; Save Home writes no answer`, async () => {
      owner = await signedIn(browser, 'owner', device);
      await paste(owner, address);
      await deferred(owner).waitFor();
      assert(!(await owner.locator('.flh-found .flh-answer-review').count()), 'personal answers reviewed on the card');
      const named = await deferred(owner).innerText();
      // The owner selected Finished basement and Fireplace (Garage is read from garage spaces).
      assert(/Finished Basement/.test(named) && /Fireplace/.test(named) && !/pool/i.test(named), `deferred: ${named}`);
      const note = await owner.locator('.flh-listing-paste-status, .hh-manual-fallback .hh-edit-context').first().innerText();
      assert(!/possible answer/.test(note), `note still asks for a review: ${note}`);
      assert(homeByAddress(address).length === 0, 'pasting saved the home');
      await owner.locator('.flh-deferred-answers').scrollIntoViewIfNeeded();
      await shot(owner, `${label}-1-deferred-on-card`);
      await addToMyHomes(owner);
      const [home] = homeByAddress(address);
      assert(home && home.user_id === OWNER, 'home not saved by the owner');
      const states = memberStates(home.id);
      assert(states.every((row) => Object.keys(row.checks || {}).length === 0), `answers written without the buyer: ${JSON.stringify(states)}`);
      const snapshot = home.listing_import;
      assert(snapshot.source === 'pasted_text', `snapshot source ${snapshot.source}`);
      assert(!JSON.stringify(snapshot).includes('rentcast'), 'snapshot mentions RentCast');
      const stated = Object.fromEntries(snapshot.descriptionFeatures.map((item) => [item.concept, item.stated]));
      assert(stated.finishedBasement === 'no' && stated.fireplace === 'yes' && stated.fencedYard === 'yes' && !stated.pool, `evidence: ${JSON.stringify(stated)}`);
      assert(snapshot.descriptionFeatures.every((item) => item.sourceType === 'listing_text'), 'evidence not labelled listing text');
      assert(!JSON.stringify(snapshot).includes('features:'), 'the snapshot carries a criterion key');
      assert(home.beds === '4', `beds ${home.beds}`);
    }, open);

    await step(`[${label}] owner: Match view shows each pointer with its sentence; answering one writes only that answer, for the owner`, async () => {
      await openMatch(owner);
      const basement = pointer(owner, 'Finished basement');
      const fireplace = pointer(owner, 'Fireplace');
      assert(/Listing suggests\s*No/.test(await basement.innerText()), 'basement pointer');
      assert(/Listing suggests\s*Yes/.test(await fireplace.innerText()), 'fireplace pointer');
      await basement.locator('.flh-mc2-why > summary').click();
      assert(/Does not have a finished basement\./.test(await basement.innerText()), 'basement sentence');
      await matchRow(owner, 'Finished basement').scrollIntoViewIfNeeded();
      await shot(owner, `${label}-2-match-pointers`);
      const [home] = homeByAddress(address);
      await matchRow(owner, 'Finished basement').locator('label.is-no').click();
      for (let i = 0; i < 20 && checksOf(home.id, OWNER)['features:Finished basement'] !== 'no'; i += 1) await owner.waitForTimeout(250);
      assert(JSON.stringify(checksOf(home.id, OWNER)) === JSON.stringify({ 'features:Finished basement': 'no' }), `owner checks: ${JSON.stringify(checksOf(home.id, OWNER))}`);
      assert(!(await pointer(owner, 'Finished basement').count()), 'pointer still shown after the owner answered');
      assert(await pointer(owner, 'Fireplace').count(), 'the unanswered pointer disappeared');
      const others = memberStates(home.id).filter((row) => row.user_id !== OWNER && Object.keys(row.checks || {}).length);
      assert(!others.length, `another participant got answers: ${JSON.stringify(others)}`);
    }, open);

    await step(`[${label}] owner: pasting again follows the latest text; still nothing is answered`, async () => {
      const rerunAddress = `${number + 4} Paste Ln, New Baltimore, MI 48047`;
      await paste(owner, rerunAddress);
      await deferred(owner).waitFor();
      await owner.getByPlaceholder('Paste listing details (optional)').fill(`${rerunAddress}\nNo fireplace. Does not have a finished basement.`);
      await owner.getByRole('button', { name: 'Fill in details' }).click();
      assert(/Fireplace/.test(await deferred(owner).innerText()), 'deferred note after rerun');
      await addToMyHomes(owner);
      const [home] = homeByAddress(rerunAddress);
      assert(memberStates(home.id).every((row) => Object.keys(row.checks || {}).length === 0), 'rerun wrote answers');
      await openMatch(owner);
      assert(/Listing suggests\s*No/.test(await pointer(owner, 'Fireplace').innerText()), 'the latest text should say No fireplace');
    }, open);
    await owner.context().close();
    owner = null;
  }

  let coBuyer;
  await step('[desktop-1440] co-buyer: names follow their own priorities; their Match-view Yes writes only their checks', async () => {
    coBuyer = await signedIn(browser, 'coBuyer', VIEWPORTS[0][1]);
    const address = '21 Paste Ln, New Baltimore, MI 48047';
    await paste(coBuyer, address);
    await deferred(coBuyer).waitFor();
    const named = await deferred(coBuyer).innerText();
    assert(/Fireplace/.test(named) && !/Finished Basement/i.test(named), `co-buyer deferred: ${named}`);
    await addToMyHomes(coBuyer);
    await openMatch(coBuyer);
    const [home] = homeByAddress(address);
    assert(/Listing suggests\s*Yes/.test(await pointer(coBuyer, 'Fireplace').innerText()), 'co-buyer pointer');
    await matchRow(coBuyer, 'Fireplace').locator('label.is-yes').click();
    for (let i = 0; i < 20 && checksOf(home.id, CO)['features:Fireplace'] !== true; i += 1) await coBuyer.waitForTimeout(250);
    await matchRow(coBuyer, 'Fireplace').scrollIntoViewIfNeeded();
    await shot(coBuyer, 'desktop-1440-4-cobuyer-answered');
    assert(JSON.stringify(checksOf(home.id, CO)) === JSON.stringify({ 'features:Fireplace': true }), `co-buyer checks: ${JSON.stringify(checksOf(home.id, CO))}`);
    assert(Object.keys(checksOf(home.id, OWNER)).length === 0, 'the owner got the co-buyer\'s answer');
  }, () => [coBuyer].filter(Boolean));
  await coBuyer?.context().close();

  let realtor;
  await step('[desktop-1440] Realtor: pasting into Suggest a Home offers no Match answers and writes none', async () => {
    realtor = await signedIn(browser, 'realtor', VIEWPORTS[0][1]);
    const before = q(`select count(*)::int as n from public.home_member_state where user_id = ${lit(REALTOR)}`)[0].n;
    await paste(realtor, '31 Paste Ln, New Baltimore, MI 48047', `/people/${info.search}`, /Suggest a Home/);
    await realtor.locator('.hh-edit-home-modal').waitFor();
    assert(await realtor.locator('.flh-answer-review').count() === 0, 'Realtor saw answer suggestions (review step)');
    // On wide screens both steps show at once and "Review Match" is hidden.
    const next = realtor.getByRole('button', { name: /Review Match/ });
    if (await next.isVisible()) await next.click();
    assert(await realtor.locator('#personalized-matches-heading').isVisible(), 'match step not shown');
    assert(await realtor.locator('.flh-answer-review').count() === 0, 'Realtor saw answer suggestions (match step)');
    await shot(realtor, 'desktop-1440-5-realtor-no-suggestions');
    const after = q(`select count(*)::int as n from public.home_member_state where user_id = ${lit(REALTOR)}`)[0].n;
    assert(before === after, 'a Realtor answer row was written');
  }, () => [realtor].filter(Boolean));
  await realtor?.context().close();

  await browser.close();
  writeFileSync(join(outDir, 'results.json'), JSON.stringify(log, null, 2));
  const failed = log.filter((entry) => !entry.ok);
  console.log(`\n${log.length - failed.length}/${log.length} steps passed`);
  if (failed.length) process.exitCode = 1;
}

await run();
