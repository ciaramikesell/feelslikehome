#!/usr/bin/env node
// Browser QA for Smart Listing Details Paste. DEVELOPMENT ONLY.
// Same setup as home-overlay-e2e.mjs (stand-in on real Postgres + dev server
// with the RentCast fixture), then:
//
//   FLH_TEST_PGHOST=… FLH_TEST_PGPORT=… node scripts/qa/smart-listing-paste-e2e.mjs standin.json <outDir> [baseUrl]
//
// On desktop, iPad and iPhone the owner:
//   1. finds a home whose lookup SUCCEEDS, sees the optional paste area, pastes
//      a description, uses / undoes / skips Home Facts suggestions and adds it;
//   2. finds a home whose lookup FAILS (rate limited), pastes, uses all and adds;
//   3. pastes only hedged text, gets no suggestions, and still adds the home.
// The database is checked after each save: only used facts are written, only
// into empty fields; RentCast values and the buyer's own answers are untouched;
// the snapshot keeps the lookup and the pasted evidence. Any failed step,
// horizontal overflow or console error fails the run.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { chromium, devices } from 'playwright';

const [infoPath, outArg, base = 'http://localhost:3200'] = process.argv.slice(2);
if (!infoPath || !outArg) throw new Error('Usage: smart-listing-paste-e2e.mjs <standin.json> <outDir> [baseUrl]');
const info = JSON.parse(readFileSync(infoPath, 'utf8').split('\n')[0]);
const outDir = resolve(outArg);
mkdirSync(outDir, { recursive: true });
const OWNER = info.users.owner.id;
const IGNORED_CONSOLE = /Download the React DevTools|favicon|maps\.googleapis|Google Maps|places|Failed to load resource/i;
const VIEWPORTS = [
  ['desktop-1440', { viewport: { width: 1440, height: 900 } }],
  ['ipad-820', { ...devices['iPad (gen 11)'], viewport: { width: 820, height: 1180 } }],
  ['iphone-390', devices['iPhone 13']],
];
// House numbers the RentCast fixture answers: complete record, or both lookups rate-limited.
const listingUrl = (number, label, n) => `https://www.zillow.com/homedetails/${number}-Sass-Rd-New-Baltimore-MI-48047/${label.length}${n}${number}_zpid/`;
const DESCRIPTION = `Welcome home! This updated colonial sits in the award-winning Rochester Community Schools. Gas fireplace in the family room. Primary suite on the first floor with a walk-in closet. Laundry on the main level. The finished walkout basement adds a rec room and full bath. Attached 3-car garage. HOA $85/month covers snow removal.`;
const HEDGED = `Bring your vision! Basement could be finished. Space for a future 3-car garage. Laundry hookups on the second floor. Top-rated schools nearby. Buyer to verify HOA.`;

function psql(sql) {
  const result = spawnSync('psql', ['-X', '-q', '-A', '-t', '-h', process.env.FLH_TEST_PGHOST, '-p', process.env.FLH_TEST_PGPORT || '5432', '-U', 'postgres', '-d', info.database, '-c', sql], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
}
const q = (sql) => JSON.parse(psql(`select coalesce(json_agg(t), '[]'::json) from (${sql}) t`));
const lit = (value) => `'${String(value).replace(/'/g, "''")}'`;
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const savedRow = (url) => q(`select id, price, garage_type, garage_spaces, hoa_fee_monthly, basement_condition, basement_style, laundry_location,
  primary_bedroom_location, school_district_name, notes, pros, cons, listing_import from public.homes where listing_url = ${lit(url)}`);
const ownChecks = (homeId) => q(`select checks from public.home_member_state where home_id = ${lit(homeId)} and user_id = ${lit(OWNER)}`)[0]?.checks || {};

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
// Viewport shots with the target scrolled into view: on phones Add Home scrolls
// inside its own sheet, which element screenshots don't capture faithfully.
const view = async (page, name, selector) => { await page.locator(selector).first().scrollIntoViewIfNeeded(); await page.waitForTimeout(150); await page.screenshot({ path: join(outDir, `${name}.png`) }); };
const shot = (page, name, element = null) => (element ? page.locator(element).screenshot({ path: join(outDir, `${name}.png`) }) : page.screenshot({ path: join(outDir, `${name}.png`), fullPage: true }));
const expandAll = async (page) => {
  for (let i = 0; i < 8; i += 1) {
    const toggle = page.locator('.flh-phone-collapse-toggle[aria-expanded="false"]:visible').first();
    if (!(await toggle.count())) return;
    await toggle.click();
  }
};

async function find(page, url) {
  await page.goto(`${base}/homes`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /Add a Home/ }).first().click();
  await page.getByLabel('Listing link or address').fill(url);
  await page.getByRole('button', { name: /^Find home$/ }).click();
  await page.locator('.flh-found').waitFor({ timeout: 30000 });
}
async function paste(page, text) {
  // Add Home V3: the paste area sits folded under "Add more from the listing".
  const more = page.locator('details.flh-found-more:not([open]) > summary');
  if (await more.count()) await more.click();
  const area = page.locator('.flh-listing-paste');
  await area.waitFor();
  await area.getByLabel('Listing description or features').fill(text);
  await area.getByRole('button', { name: 'Fill in details' }).click();
  await area.locator('.flh-listing-paste-status').waitFor();
}
async function add(page, url) {
  await page.getByRole('button', { name: 'Save Home' }).click();
  // Add Home V3: Save Home shows the saved state; View home opens the overlay.
  await page.locator('.flh-saved').waitFor({ timeout: 60000 });
  await page.getByRole('button', { name: /^View home/ }).click();
  await page.waitForURL(/\/homes\/[0-9a-f-]{36}$/, { timeout: 60000 });
  await page.locator('.flh-overlay[role="dialog"]:not(.is-loading)').waitFor({ timeout: 30000 });
  const rows = savedRow(url);
  assert(rows.length === 1, `expected one saved home, found ${rows.length}`);
  return rows[0];
}
const review = (page) => page.locator('.flh-fact-review');
const reviewFields = async (page) => (await review(page).count()) ? review(page).locator('li .flh-answer-review-head b').allInnerTexts() : [];

async function run() {
  const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {});
  psql(`delete from public.homes where search_id = ${lit(info.search)} and address like '5161_ Sass Rd%'`);
  let n = 0;
  for (const [label, device] of VIEWPORTS) {
    let owner;
    const open = () => [owner].filter(Boolean);

    await step(`[${label}] lookup succeeds → optional paste offered; Home Facts suggested only for empty fields; Use / Undo / Skip; saved with evidence`, async () => {
      owner = await signedIn(browser, 'owner', device);
      n += 1;
      const url = listingUrl(51613, label, n);
      await find(owner, url);
      await owner.getByText('We found your home').waitFor();
      const area = owner.locator('.flh-listing-paste');
      assert(await area.isVisible(), 'paste area not offered after a successful lookup');
      assert((await area.innerText()).includes('Copy the listing description or property features and paste them here. We’ll fill in what we can.'), 'paste copy');
      assert(await area.getByText('Optional').isVisible(), 'not marked optional');
      assert(!(await owner.locator('.hh-manual-fallback').count()), 'a second paste box is shown');
      const countBefore = (await owner.locator('.flh-found-note strong').innerText()).trim();
      await view(owner, `${label}-1-success-paste-offered`, '.flh-listing-paste');
      // #171's optional Notes / Pros / Cons beside the paste area: typed first, never touched by pasting.
      await owner.locator('.flh-found-notes summary').click();
      await owner.locator('#add-home-pros').fill('Great backyard\nQuiet street');
      await owner.locator('#add-home-notes').fill('Ask about the sewer line');
      await paste(owner, DESCRIPTION);
      assert(await owner.locator('#add-home-pros').inputValue() === 'Great backyard\nQuiet street', 'pasting changed Pros');
      assert(await owner.locator('#add-home-notes').inputValue() === 'Ask about the sewer line', 'pasting changed Notes');
      assert(await owner.locator('#add-home-cons').inputValue() === '', 'pasting wrote Cons');
      // Still the found card for the RentCast home (the lookup is kept).
      assert(await owner.getByText('We found your home').isVisible(), 'the found card was replaced by pasting');
      assert((await owner.locator('.flh-found-note').innerText()).startsWith(countBefore), 'the lookup\'s detail count changed after pasting');
      const fields = await reviewFields(owner);
      // RentCast already filled garage type/spaces and a $0/mo HOA: never offered.
      assert(JSON.stringify(fields) === JSON.stringify(['Basement condition', 'Basement style', 'Laundry', 'Primary bedroom', 'School district']), `suggested: ${fields}`);
      const reviewText = await review(owner).innerText();
      assert(reviewText.includes('The finished walkout basement adds a rec room and full bath.'), 'evidence sentence missing');
      assert(reviewText.includes('FLH hasn’t verified it or checked school boundaries'), 'school caveat missing');
      // One prompt per criterion: the pending Basement condition row names the personal
      // criterion it would answer; that personal question is held, Fireplace is still asked.
      const conditionRow = review(owner).locator('li').filter({ has: owner.locator('b', { hasText: /^Basement condition$/ }) });
      assert(/Also answers your Match: Finished basement/i.test(await conditionRow.innerText()), 'shared row does not name the personal criterion');
      const personal = owner.locator('.flh-answer-review');
      const personalText = (await personal.count()) ? await personal.innerText() : '';
      assert(personalText.includes('Fireplace') && !personalText.includes('Finished basement'), `personal suggestions: ${personalText.slice(0, 200)}`);
      await view(owner, `${label}-2-success-suggestions`, '.flh-fact-review');
      await review(owner).getByRole('button', { name: /^Use all 5$/ }).click();
      await review(owner).getByRole('button', { name: 'Undo Laundry' }).click();
      await review(owner).getByRole('button', { name: 'Skip Laundry' }).click();
      assert(!(await review(owner).getByText('Laundry', { exact: true }).count()), 'skipped laundry still shown');
      await view(owner, `${label}-3-success-used`, '.flh-fact-review li.is-confirmed');
      const row = await add(owner, url);
      assert(row.basement_condition === 'finished' && row.basement_style === 'walkout', `basement: ${row.basement_condition}/${row.basement_style}`);
      assert(row.primary_bedroom_location === 'Main Floor', `primary: ${row.primary_bedroom_location}`);
      assert(row.school_district_name === 'Rochester Community Schools', `district: ${row.school_district_name}`);
      assert(row.laundry_location === null, `laundry was undone and skipped, saved ${row.laundry_location}`);
      assert(row.pros === 'Great backyard\nQuiet street' && row.notes === 'Ask about the sewer line' && !row.cons, `notes/pros/cons: ${JSON.stringify([row.notes, row.pros, row.cons])}`);
      assert(row.garage_type === 'attached' && row.garage_spaces === '2', `RentCast garage changed: ${row.garage_type}/${row.garage_spaces}`);
      assert(Number(row.hoa_fee_monthly) === 0 && row.hoa_fee_monthly !== null, `RentCast $0 HOA changed: ${row.hoa_fee_monthly}`);
      const snap = row.listing_import;
      assert(snap.source === 'rentcast' && snap.listing?.status === 'active', 'the RentCast snapshot was lost');
      assert(snap.fields.basementCondition === 'finished' && snap.fields.garageSpaces === '2', `snapshot fields: ${JSON.stringify(snap.fields).slice(0, 200)}`);
      const evidence = Object.fromEntries((snap.pastedFacts || []).map((item) => [item.field, item.evidence]));
      assert(Object.keys(evidence).sort().join() === 'basementCondition,basementStyle,primaryBedroomLocation,schoolDistrict', `pastedFacts: ${Object.keys(evidence)}`);
      assert(/finished walkout basement/i.test(evidence.basementCondition), 'evidence not kept');
      const checks = ownChecks(row.id);
      assert(!('features:Finished basement' in checks) && !('features:Fireplace' in checks), `pasting wrote answers: ${JSON.stringify(checks)}`);
      await owner.reload({ waitUntil: 'networkidle' });
      await owner.locator('.flh-overlay[role="dialog"]:not(.is-loading)').waitFor({ timeout: 30000 });
      await expandAll(owner);
      assert(await owner.locator('#hf-basementCondition').inputValue() === 'finished', 'Home Facts basement after reload');
      assert(await owner.locator('#hf-schoolDistrict').inputValue() === 'Rochester Community Schools', 'Home Facts district after reload');
      // Match reads the shared fact (#167) for this buyer: "From Home Facts".
      for (let i = 0; i < 4; i += 1) {
        const toggle = owner.locator('.flh-mc2-toggle[aria-expanded="false"]:visible').first();
        if (!(await toggle.count())) break;
        await toggle.click();
        await owner.waitForTimeout(100);
      }
      const basementRow = owner.locator('.flh-mc2-row').filter({ has: owner.locator('.flh-mc2-name', { hasText: /^Finished basement/i }) });
      const from = await basementRow.locator('.flh-mc2-from').textContent();
      assert(from?.startsWith('From Home Facts: Yes'), `Finished basement Match row reads "${from}"`);
      await shot(owner, `${label}-4-success-home-facts`);
    }, open);

    await step(`[${label}] Skip a shared fact → it stays Unknown and the personal question comes back for this buyer only`, async () => {
      n += 1;
      const url = listingUrl(51613, label, n);
      await find(owner, url);
      await paste(owner, DESCRIPTION);
      const personal = owner.locator('.flh-answer-review');
      assert(!/Finished basement/i.test((await personal.count()) ? await personal.innerText() : ''), 'personal basement shown while the shared fact is pending');
      await review(owner).getByRole('button', { name: 'Skip Basement condition' }).click();
      const question = personal.locator('li').filter({ has: owner.locator('b', { hasText: /^Finished basement$/i }) });
      await question.waitFor();
      assert((await question.innerText()).includes('Listing suggests Yes'), 'returned personal suggestion');
      await view(owner, `${label}-8-skip-returns-personal`, '.flh-answer-review');
      await question.getByRole('button', { name: /^Confirm Finished basement: Yes$/i }).click();
      const row = await add(owner, url);
      assert(row.basement_condition === null, `Skip wrote basement condition: ${row.basement_condition}`);
      assert(JSON.stringify(ownChecks(row.id)) === JSON.stringify({ 'features:Finished basement': true }), `owner checks: ${JSON.stringify(ownChecks(row.id))}`);
      const others = q(`select user_id, checks from public.home_member_state where home_id = ${lit(row.id)} and user_id <> ${lit(OWNER)}`);
      assert(others.every((state) => !('features:Finished basement' in (state.checks || {}))), 'another participant got the owner\'s answer');
      for (let i = 0; i < 4; i += 1) {
        const toggle = owner.locator('.flh-mc2-toggle[aria-expanded="false"]:visible').first();
        if (!(await toggle.count())) break;
        await toggle.click();
        await owner.waitForTimeout(100);
      }
      const matchRow = owner.locator('.flh-mc2-row').filter({ has: owner.locator('.flh-mc2-name', { hasText: /^Finished basement/i }) });
      assert(!(await matchRow.locator('.flh-mc2-from').count()) || !(await matchRow.locator('.flh-mc2-from').textContent()).startsWith('From Home Facts'), 'Match reads a Home Fact that was skipped');
    }, open);

    await step(`[${label}] lookup fails → same optional paste; Use all fills empty fields; saved as pasted text`, async () => {
      n += 1;
      const url = listingUrl(51619, label, n);
      await find(owner, url);
      const card = await owner.locator('.flh-found').innerText();
      assert(/busy right now/.test(card), 'rate-limit note missing');
      assert(await owner.locator('.flh-listing-paste').isVisible(), 'paste area not offered after a failed lookup');
      await view(owner, `${label}-5-failed-paste-offered`, '.flh-listing-paste');
      await paste(owner, DESCRIPTION);
      const fields = await reviewFields(owner);
      assert(JSON.stringify(fields) === JSON.stringify(['Basement condition', 'Basement style', 'Laundry', 'Primary bedroom', 'Garage type', 'Garage spaces', 'HOA fee', 'School district']), `suggested: ${fields}`);
      await view(owner, `${label}-6-failed-suggestions`, '.flh-fact-review');
      await review(owner).getByRole('button', { name: /^Use all 8$/ }).click();
      // The address is still the buyer's to confirm; it was looked up from the link.
      const row = await add(owner, url);
      assert(row.garage_type === 'attached' && row.garage_spaces === '3', `garage: ${row.garage_type}/${row.garage_spaces}`);
      assert(Number(row.hoa_fee_monthly) === 85, `HOA: ${row.hoa_fee_monthly}`);
      assert(row.laundry_location === 'first_floor' && row.basement_condition === 'finished', 'facts not saved');
      assert(row.listing_import?.source === 'pasted_text' && row.listing_import.pastedFacts.length === 8, `snapshot: ${JSON.stringify(row.listing_import).slice(0, 200)}`);
      assert(row.price === '' || row.price === null, `price was invented: ${row.price}`);
    }, open);

    await step(`[${label}] hedged text → nothing suggested, Unknown stays Unknown, home still adds`, async () => {
      n += 1;
      const url = listingUrl(51613, label, n);
      await find(owner, url);
      await paste(owner, HEDGED);
      assert(!(await review(owner).count()), 'hedged text produced Home Facts suggestions');
      assert((await owner.locator('.flh-listing-paste-status').innerText()).includes('Anything not stated stays Unknown'), 'nothing-found message');
      await view(owner, `${label}-7-hedged-nothing`, '.flh-listing-paste');
      const row = await add(owner, url);
      assert(row.basement_condition === null && row.laundry_location === null && row.school_district_name === null, 'hedged text wrote a fact');
      assert(!row.listing_import.pastedFacts, 'pastedFacts without any used fact');
    }, open);
    await owner?.context().close();
  }
  await browser.close();
  writeFileSync(join(outDir, 'results.json'), JSON.stringify(log, null, 2));
  const failed = log.filter((entry) => !entry.ok).length;
  console.log(`${log.length - failed} / ${log.length} passed`);
  process.exit(failed ? 1 : 0);
}

run().catch((error) => { console.error(error); process.exit(1); });
