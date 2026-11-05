#!/usr/bin/env node
// Browser QA for Safe Pasted Listing Suggestions. DEVELOPMENT ONLY.
// Same setup as home-overlay-e2e.mjs (stand-in on real Postgres + dev server;
// no RentCast lookup is made — the paste path never calls it):
//
//   FLH_TEST_PGHOST=… FLH_TEST_PGPORT=… node scripts/qa/pasted-listing-answers-e2e.mjs standin.json <outDir> [baseUrl]
//
// Drives Add Home → "Paste listing details instead" on desktop, iPad and iPhone
// as the owner, then once as the co-buyer and the Realtor, and checks the
// database after each save: pasting writes no Match answer; only a confirmed
// suggestion lands in that buyer's own home_member_state.checks; the shared
// snapshot keeps the text evidence as pasted listing text. Any failed step,
// horizontal overflow or console error fails the run.
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
const shot = (page, name, element = null) => (element ? page.locator(element).screenshot({ path: join(outDir, `${name}.png`) }) : page.screenshot({ path: join(outDir, `${name}.png`), fullPage: true }));

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
const reviewItem = (page, label) => review(page).locator('li').filter({ has: page.locator('b', { hasText: new RegExp(`^${label}$`) }) });
async function addToMyHomes(page) {
  await page.getByRole('button', { name: 'Add to My Homes' }).click();
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

    await step(`[${label}] owner: pasted text shows suggestions with their sentences; nothing is answered yet`, async () => {
      owner = await signedIn(browser, 'owner', device);
      await paste(owner, address);
      await review(owner).waitFor();
      const items = await review(owner).locator('li b').allTextContents();
      // The owner selected Finished basement and Fireplace (Garage is read from garage spaces).
      assert(JSON.stringify(items) === JSON.stringify(['Finished Basement', 'Fireplace']), `review items: ${items}`);
      const basement = await reviewItem(owner, 'Finished Basement').innerText();
      assert(basement.includes('Listing suggests No') && basement.includes('Does not have a finished basement.'), `basement item: ${basement}`);
      const fireplace = await reviewItem(owner, 'Fireplace').innerText();
      assert(fireplace.includes('Listing suggests Yes') && fireplace.includes('Gas fireplace in the family room.'), `fireplace item: ${fireplace}`);
      assert(!/pool/i.test(await review(owner).innerText()), 'Pool was suggested from a community pool / "room for a pool"');
      const note = await owner.locator('.flh-listing-paste-status, .hh-manual-fallback .hh-edit-context').first().innerText();
      assert(/2 possible answers to review below/.test(note), `note: ${note}`);
      await shot(owner, `${label}-1-suggestions`, '.flh-found');
    }, open);

    await step(`[${label}] owner: confirm one, leave one Unknown; undo and redo works`, async () => {
      await reviewItem(owner, 'Finished Basement').getByRole('button', { name: /Confirm/ }).click();
      await reviewItem(owner, 'Finished Basement').getByText('Your answer: No').waitFor();
      await reviewItem(owner, 'Finished Basement').getByRole('button', { name: 'Undo' }).click();
      await reviewItem(owner, 'Finished Basement').getByRole('button', { name: /Confirm/ }).waitFor();
      await reviewItem(owner, 'Finished Basement').getByRole('button', { name: /Confirm/ }).click();
      await reviewItem(owner, 'Fireplace').getByRole('button', { name: /Leave .* Unknown/ }).click();
      assert(await reviewItem(owner, 'Fireplace').count() === 0, 'Leave Unknown kept the suggestion on screen');
      assert(homeByAddress(address).length === 0, 'confirming saved the home before Add to My Homes');
      await shot(owner, `${label}-2-confirmed-one-left-one-unknown`, '.flh-found');
    }, open);

    await step(`[${label}] owner: Add saves only the confirmed answer, only for the owner; evidence stays pasted listing text`, async () => {
      await addToMyHomes(owner);
      const [home] = homeByAddress(address);
      assert(home && home.user_id === OWNER, 'home not saved by the owner');
      assert(JSON.stringify(checksOf(home.id, OWNER)) === JSON.stringify({ 'features:Finished basement': 'no' }), `owner checks: ${JSON.stringify(checksOf(home.id, OWNER))}`);
      const others = memberStates(home.id).filter((row) => row.user_id !== OWNER && Object.keys(row.checks || {}).length);
      assert(!others.length, `another participant got answers: ${JSON.stringify(others)}`);
      const snapshot = home.listing_import;
      assert(snapshot.source === 'pasted_text', `snapshot source ${snapshot.source}`);
      assert(!JSON.stringify(snapshot).includes('rentcast'), 'snapshot mentions RentCast');
      const stated = Object.fromEntries(snapshot.descriptionFeatures.map((item) => [item.concept, item.stated]));
      assert(stated.finishedBasement === 'no' && stated.fireplace === 'yes' && stated.fencedYard === 'yes' && !stated.pool, `evidence: ${JSON.stringify(stated)}`);
      assert(snapshot.descriptionFeatures.every((item) => item.sourceType === 'listing_text'), 'evidence not labelled listing text');
      assert(!JSON.stringify(snapshot).includes('features:'), 'the snapshot carries a criterion key');
      assert(home.beds === '4', `beds ${home.beds}`);
      await owner.goto(`${base}/homes/${home.id}?section=match`, { waitUntil: 'networkidle' });
      await owner.locator('.flh-overlay[role="dialog"]:not(.is-loading)').waitFor({ timeout: 30000 });
      await shot(owner, `${label}-3-match-after-save`);
    }, open);

    // Rerunning extraction after confirming: an answer confirmed from earlier text
    // is kept only while the new text still says the same thing.
    await step(`[${label}] owner: rerun after confirming keeps a still-supported answer and clears an outdated one`, async () => {
      const rerunAddress = `${number + 4} Paste Ln, New Baltimore, MI 48047`;
      const rerun = async (text) => {
        await owner.getByPlaceholder('Paste listing details (optional)').fill(text);
        await owner.getByRole('button', { name: 'Fill in details' }).click();
      };
      await paste(owner, rerunAddress);
      await review(owner).waitFor();
      await reviewItem(owner, 'Fireplace').getByRole('button', { name: /Confirm/ }).click();
      await reviewItem(owner, 'Finished Basement').getByRole('button', { name: /Leave .* Unknown/ }).click();
      // Identical text: Fireplace stays confirmed and undoable; Finished basement is offered again.
      await rerun(listingText(rerunAddress));
      await reviewItem(owner, 'Fireplace').getByText('Your answer: Yes').waitFor();
      assert(await reviewItem(owner, 'Fireplace').getByRole('button', { name: 'Undo' }).isVisible(), 'Undo gone after an identical rerun');
      assert(await reviewItem(owner, 'Finished Basement').getByRole('button', { name: /Confirm/ }).isVisible(), 'the Unknown suggestion was not offered again');
      // "No fireplace": the confirmed Yes goes back to Unknown, the buyer is told, and No is only suggested.
      await rerun(`${rerunAddress}\nNo fireplace. Does not have a finished basement.`);
      await reviewItem(owner, 'Fireplace').getByText('Listing suggests No').waitFor();
      assert(await reviewItem(owner, 'Fireplace').getByRole('button', { name: 'Confirm Fireplace: No' }).isVisible() && await reviewItem(owner, 'Fireplace').getByText('Your answer').count() === 0, 'the new No was applied instead of suggested');
      const note = await owner.locator('.flh-listing-paste-status, .hh-manual-fallback .hh-edit-context').first().innerText();
      assert(/Fireplace is back to Unknown/.test(note), `note: ${note}`);
      await shot(owner, `${label}-6-rerun-conflicting-text`, '.flh-found');
      // Confirm the basement No, then text that never mentions a fireplace and still says the basement isn't finished.
      await reviewItem(owner, 'Finished Basement').getByRole('button', { name: /Confirm/ }).click();
      await reviewItem(owner, 'Fireplace').getByRole('button', { name: /Confirm/ }).click();
      await rerun(`${rerunAddress}\nBright kitchen. Does not have a finished basement.`);
      await reviewItem(owner, 'Finished Basement').getByText('Your answer: No').waitFor();
      assert(await reviewItem(owner, 'Fireplace').count() === 0, 'Fireplace still shown with no evidence');
      assert(/Fireplace is back to Unknown/.test(await owner.locator('.flh-listing-paste-status, .hh-manual-fallback .hh-edit-context').first().innerText()), 'silent clear');
      assert(homeByAddress(rerunAddress).length === 0, 'rerunning saved the home');
      await addToMyHomes(owner);
      const [home] = homeByAddress(rerunAddress);
      assert(JSON.stringify(checksOf(home.id, OWNER)) === JSON.stringify({ 'features:Finished basement': 'no' }), `owner checks: ${JSON.stringify(checksOf(home.id, OWNER))}`);
      const others = memberStates(home.id).filter((row) => row.user_id !== OWNER && Object.keys(row.checks || {}).length);
      assert(!others.length, `another participant got answers: ${JSON.stringify(others)}`);
    }, open);

    if (label === 'desktop-1440') {
      await step(`[${label}] owner: pasting and adding without confirming writes no answer at all`, async () => {
        const untouched = '14 Paste Ln, New Baltimore, MI 48047';
        await paste(owner, untouched);
        await review(owner).waitFor();
        await addToMyHomes(owner);
        const [home] = homeByAddress(untouched);
        assert(home, 'home not saved');
        const states = memberStates(home.id);
        assert(states.every((row) => Object.keys(row.checks || {}).length === 0), `answers written without confirmation: ${JSON.stringify(states)}`);
      }, open);
    }
    await owner.context().close();
    owner = null;
  }

  let coBuyer;
  await step('[desktop-1440] co-buyer: suggestions follow their own priorities; confirming writes only their checks', async () => {
    coBuyer = await signedIn(browser, 'coBuyer', VIEWPORTS[0][1]);
    const address = '21 Paste Ln, New Baltimore, MI 48047';
    await paste(coBuyer, address);
    await review(coBuyer).waitFor();
    const items = await review(coBuyer).locator('li b').allTextContents();
    assert(JSON.stringify(items) === JSON.stringify(['Fireplace']), `co-buyer items: ${items}`);
    assert((await review(coBuyer).innerText()).includes('Your answers stay your own.'), 'collaborative note missing');
    await reviewItem(coBuyer, 'Fireplace').getByRole('button', { name: /Confirm/ }).click();
    await shot(coBuyer, 'desktop-1440-4-cobuyer-confirmed', '.flh-found');
    await addToMyHomes(coBuyer);
    const [home] = homeByAddress(address);
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
