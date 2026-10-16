#!/usr/bin/env node
// Full-stack QA for Add Home → Home Facts → Match Criteria. DEVELOPMENT ONLY.
//
//   1. FLH_TEST_PGHOST=… FLH_TEST_PGPORT=… node scripts/qa/supabase-standin.mjs 54321 > standin.json
//   2. NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=qa RENTCAST_API_KEY=qa \
//        NODE_OPTIONS="--import ./scripts/qa/rentcast-fixture.mjs" npx next dev -p 3200
//   3. node scripts/qa/home-flow-e2e.mjs standin.json <outDir> [baseUrl] [width…]
//
// Drives the real app in Chromium as real signed-in users against real
// Postgres (RLS, grants and triggers included) and checks the database's
// ground truth after each step. Screenshots land in <outDir>; any failed step,
// horizontal overflow or console error fails the run.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';

const [infoPath, outArg, base = 'http://localhost:3200', ...widthArgs] = process.argv.slice(2);
if (!infoPath || !outArg) throw new Error('Usage: home-flow-e2e.mjs <standin.json> <outDir> [baseUrl] [width…]');
const info = JSON.parse(readFileSync(infoPath, 'utf8'));
const outDir = resolve(outArg);
mkdirSync(outDir, { recursive: true });
const WIDTHS = (widthArgs.length ? widthArgs.map(Number) : [1440, 1024, 768, 390]);
const LISTING = 'https://www.zillow.com/homedetails/51613-Sass-Rd-New-Baltimore-MI-48047/12345_zpid/';
// The interrupted-save step aborts one request on purpose; its logged failure is expected.
const IGNORED_CONSOLE = /ERR_CONNECTION_RESET|saveHome failed|Save home failed|Download the React DevTools|favicon|maps\.googleapis|Google Maps|places|Failed to load resource: the server responded with a status of 40[34]|bad HTTP response code \(500\) was received when fetching the script/i;

function q(sql) {
  const args = ['-X', '-q', '-A', '-t', '-h', process.env.FLH_TEST_PGHOST, '-p', process.env.FLH_TEST_PGPORT || '5432', '-U', 'postgres', '-d', info.database, '-c', `select coalesce(json_agg(t), '[]'::json) from (${sql}) t`];
  const result = spawnSync('psql', args, { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr);
  return JSON.parse(result.stdout.trim());
}
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const log = [];

async function signedIn(browser, who, width) {
  const context = await browser.newContext({ viewport: { width, height: width < 500 ? 844 : 900 } });
  const session = info.users[who].session;
  await context.addCookies([{ name: 'sb-localhost-auth-token', value: `base64-${Buffer.from(JSON.stringify(session)).toString('base64url')}`, domain: 'localhost', path: '/' }]);
  // A returning buyer: the one-time phone tour was already dismissed.
  await context.addInitScript(() => { try { localStorage.setItem('flh-mobile-tour-dismissed', '1'); } catch { /* ignore */ } });
  const page = await context.newPage();
  page.errors = [];
  page.on('pageerror', (error) => page.errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error' && !IGNORED_CONSOLE.test(message.text())) page.errors.push(message.text()); });
  return page;
}

async function shot(page, name, { full = true } = {}) {
  await page.waitForTimeout(250);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  const file = `${name}.png`;
  await page.screenshot({ path: join(outDir, file), fullPage: full });
  assert(overflow <= 0, `${name}: horizontal overflow ${overflow}px`);
  return file;
}

async function openAddHome(page) {
  await page.goto(`${base}/homes`, { waitUntil: 'networkidle' });
  const add = page.getByRole('button', { name: 'Add home', exact: true }).first();
  if (await add.isVisible().catch(() => false)) await add.click();
  else await page.goto(`${base}/homes?add=1`, { waitUntil: 'networkidle' });
  await page.getByLabel('Listing link or address').waitFor();
}

async function step(name, fn) {
  const started = Date.now();
  try { await fn(); log.push({ step: name, ok: true, ms: Date.now() - started }); console.log('ok  ', name); }
  catch (error) { log.push({ step: name, ok: false, error: error.message }); console.error('FAIL', name, '—', error.message); }
}

const homesWithUrl = (url) => q(`select id from public.homes where search_id = '${info.search}' and listing_url = '${url}'`);

async function journey(browser, width) {
  const tag = (name) => `${name}-${width}`;
  const owner = await signedIn(browser, 'owner', width);
  // Each width starts clean: no home for this listing yet.
  q(`select 1 from (select 1) x`);
  spawnSync('psql', ['-X', '-q', '-h', process.env.FLH_TEST_PGHOST, '-p', process.env.FLH_TEST_PGPORT, '-U', 'postgres', '-d', info.database, '-c', `delete from public.homes where search_id = '${info.search}' and address not like '208 Linden%'`]);

  let homeId = null;
  await step(`[${width}] import → one obvious action (double-click) → saved once → Home Facts`, async () => {
    await openAddHome(owner);
    await owner.getByLabel('Listing link or address').fill(LISTING);
    await owner.getByRole('button', { name: /^Find home$/ }).click();
    await owner.getByText('We found your home', { exact: false }).first().waitFor();
    assert(!(await owner.getByRole('button', { name: /Review details first/ }).count()), 'a competing Review button is still shown');
    await shot(owner, tag('01-found'), { full: false });
    assert(homesWithUrl(LISTING).length === 0, 'saved before the buyer chose to add');
    await owner.getByRole('button', { name: 'Add to My Homes' }).dblclick();
    await owner.waitForURL(/\/homes\/[0-9a-f-]{36}/, { timeout: 60000 });
    await owner.getByRole('heading', { level: 1, name: 'Home Facts' }).waitFor();
    await owner.getByText('We found your home.').waitFor();
    homeId = owner.url().match(/homes\/([0-9a-f-]{36})/)[1];
    const rows = homesWithUrl(LISTING);
    assert(rows.length === 1 && rows[0].id === homeId, `expected exactly one saved home, found ${rows.length}`);
    const [saved] = q(`select price, beds, garage_spaces, heating, garage_type, basement_condition, listing_id, lot_size, listing_import is not null as snapshot from public.homes where id = '${homeId}'`);
    assert(saved.price === '335000' && saved.heating === 'Forced Air' && saved.garage_type === 'attached' && saved.listing_id === '20261076983' && saved.snapshot, `imported values not persisted: ${JSON.stringify(saved)}`);
    assert(q(`select 1 from public.home_member_state where home_id = '${homeId}' and user_id = '${info.users.owner.id}'`).length === 1, 'personal state row missing');
    // Approved shape: the requested groups, no imported-facts panel, no school disclaimer.
    for (const title of ['Basic details', 'Home details', 'School details', 'Garage', 'Basement']) await owner.getByRole('heading', { level: 3, name: title }).waitFor();
    for (const gone of [/All listing details/, /See imported details/, /doesn.t pull school information/, /Confirm school assignment/]) {
      assert(!(await owner.getByText(gone).count()), `Home Facts still shows ${gone}`);
    }
    await shot(owner, tag('02-home-facts-landing'));
  });

  await step(`[${width}] back to My Homes without editing → the home persists (button, browser back, reload)`, async () => {
    await owner.getByRole('button', { name: /Back to My Homes/ }).click();
    await owner.waitForURL(/\/homes$/);
    await owner.getByText('51613 Sass Rd').first().waitFor({ timeout: 15000 });
    await shot(owner, tag('03-my-homes-after-back'), { full: false });
    await owner.goto(`${base}/homes/${homeId}`, { waitUntil: 'networkidle' });
    await owner.goBack({ waitUntil: 'networkidle' });
    await owner.getByText('51613 Sass Rd').first().waitFor({ timeout: 15000 });
    await owner.reload({ waitUntil: 'networkidle' });
    await owner.getByText('51613 Sass Rd').first().waitFor();
  });

  await step(`[${width}] duplicate URL opens the saved home instead of importing again`, async () => {
    await openAddHome(owner);
    await owner.getByLabel('Listing link or address').fill(LISTING);
    await owner.getByRole('button', { name: /^Find home$/ }).click();
    await owner.getByText('This home is already here').waitFor();
    await shot(owner, tag('04-duplicate'), { full: false });
    assert(homesWithUrl(LISTING).length === 1, 'duplicate created');
    await owner.getByRole('button', { name: 'Close add home' }).click();
  });

  await step(`[${width}] iOS share intake (/homes?url=) of a new listing: auto-find → one Add → Home Facts → persists`, async () => {
    const shared = `https://www.redfin.com/MI/New-Baltimore/42-Shared-Ct-${width}-48047/home/42`;
    await owner.goto(`${base}/homes?url=${encodeURIComponent(shared)}`, { waitUntil: 'networkidle' });
    await owner.getByRole('button', { name: 'Add to My Homes' }).waitFor({ timeout: 30000 });
    assert(!(await owner.getByRole('button', { name: /Review details first/ }).count()), 'competing Review button');
    assert(homesWithUrl(shared).length === 0, 'share intake saved before Add');
    await owner.getByRole('button', { name: 'Add to My Homes' }).click();
    await owner.waitForURL(/\/homes\/[0-9a-f-]{36}/, { timeout: 60000 });
    await owner.getByRole('heading', { level: 1, name: 'Home Facts' }).waitFor();
    assert(homesWithUrl(shared).length === 1, 'share intake did not save exactly once');
    await owner.goBack({ waitUntil: 'networkidle' });
    await owner.getByText(`42 Shared Ct ${width}`).first().waitFor({ timeout: 15000 });
  });

  await step(`[${width}] share intake (/homes?url=) of the same listing opens the existing home`, async () => {
    await owner.goto(`${base}/homes?url=${encodeURIComponent(LISTING)}`, { waitUntil: 'networkidle' });
    await owner.waitForURL(new RegExp(`/homes/${homeId}`));
    assert(homesWithUrl(LISTING).length === 1, 'share intake created a duplicate');
  });

  await step(`[${width}] interrupted save: the personal-state write fails, retry finishes the same home`, async () => {
    const url = 'https://www.zillow.com/homedetails/77-Interrupted-Way-New-Baltimore-MI-48047/777_zpid/';
    let failed = false;
    await owner.route('**/rest/v1/home_member_state*', (route) => {
      if (!failed && route.request().method() === 'POST') { failed = true; return route.abort('connectionreset'); }
      return route.continue();
    });
    await openAddHome(owner);
    await owner.getByLabel('Listing link or address').fill(url);
    await owner.getByRole('button', { name: /^Find home$/ }).click();
    await owner.getByRole('button', { name: 'Add to My Homes' }).waitFor();
    await owner.getByRole('button', { name: 'Add to My Homes' }).click();
    await owner.getByRole('alert').filter({ hasText: /couldn.t save/ }).first().waitFor();
    assert(homesWithUrl(url).length === 1, 'the shared row should exist after the interrupted save');
    await shot(owner, tag('05-save-interrupted'), { full: false });
    await owner.getByRole('button', { name: 'Add to My Homes' }).click();
    await owner.waitForURL(/\/homes\/[0-9a-f-]{36}/, { timeout: 60000 });
    await owner.unroute('**/rest/v1/home_member_state*');
    const rows = homesWithUrl(url);
    assert(rows.length === 1, `retry created ${rows.length} homes`);
    assert(owner.url().includes(rows[0].id), 'retry landed on a different home');
  });

  await step(`[${width}] manual entry: address only → saved → Home Facts → back, still there`, async () => {
    await openAddHome(owner);
    await owner.getByText(/Can.t find the home/).click();
    await owner.getByRole('button', { name: 'Enter manually' }).click();
    await owner.getByRole('heading', { name: /Where is this home\?/ }).waitFor();
    const address = owner.locator('#found-home-address');
    await address.fill(`14 Orchard Ln ${width}, Grosse Pointe, MI 48236`);
    await address.press('Escape').catch(() => {});
    await shot(owner, tag('06-manual-entry'), { full: false });
    await owner.getByRole('button', { name: 'Add to My Homes' }).click();
    await owner.waitForURL(/\/homes\/[0-9a-f-]{36}/, { timeout: 60000 });
    await owner.getByText('Your home is saved.').waitFor();
    await owner.getByRole('button', { name: /Back to My Homes/ }).click();
    await owner.getByText(`14 Orchard Ln ${width}`).first().waitFor({ timeout: 15000 });
  });

  await step(`[${width}] Home Facts edits: garage None, schools, lot size in sq ft → acres, Unknown kept`, async () => {
    await owner.goto(`${base}/homes/${homeId}`, { waitUntil: 'networkidle' });
    await owner.getByRole('button', { name: 'Edit garage' }).click();
    await owner.getByRole('group', { name: 'Type' }).getByRole('button', { name: 'None' }).click();
    await shot(owner, tag('07-editing-garage'), { full: false });
    await owner.getByRole('button', { name: 'Save garage' }).click();
    await owner.getByRole('button', { name: 'Edit garage' }).waitFor();
    await owner.getByRole('button', { name: 'Edit school details' }).click();
    await owner.getByLabel('District').fill('Anchor Bay School District');
    await owner.getByLabel('High').fill('Anchor Bay High');
    await owner.getByRole('button', { name: 'Save school details' }).click();
    await owner.getByRole('button', { name: 'Edit school details' }).waitFor();
    await owner.getByRole('button', { name: 'Edit property' }).click();
    await owner.getByLabel('Lot size (acres)').fill('10,890 sq ft');
    await owner.getByText('Saves as 0.25 acres').waitFor();
    await owner.getByRole('button', { name: 'Save property' }).click();
    await owner.getByRole('button', { name: 'Edit property' }).waitFor();
    const [row] = q(`select garage_type, garage_spaces, school_district_name, high_school, middle_school, lot_size, heating from public.homes where id = '${homeId}'`);
    assert(row.garage_type === 'none' && row.garage_spaces === '0', `garage not saved as None: ${JSON.stringify(row)}`);
    assert(row.school_district_name === 'Anchor Bay School District' && row.high_school === 'Anchor Bay High' && row.middle_school === null, `schools: ${JSON.stringify(row)}`);
    assert(row.lot_size === '0.25 acres', `lot: ${row.lot_size}`);
    assert(row.heating === 'Forced Air', 'an untouched imported value changed');
    await owner.reload({ waitUntil: 'networkidle' });
    await owner.getByText('Anchor Bay School District').waitFor();
    await shot(owner, tag('08-home-facts-saved'));
  });

  await step(`[${width}] save an edit, then Next: Match Criteria right away (no reload)`, async () => {
    await owner.goto(`${base}/homes/${homeId}`, { waitUntil: 'networkidle' });
    await owner.getByRole('button', { name: 'Edit basic details' }).click();
    await owner.getByLabel('Est. monthly payment').fill('2450');
    await owner.getByRole('button', { name: 'Save basic details' }).click();
    await owner.getByRole('button', { name: 'Edit basic details' }).waitFor();
    await owner.getByText('$2,450/mo').waitFor();
    await owner.getByRole('button', { name: /Next: Match Criteria/ }).click();
    await owner.getByRole('heading', { level: 1, name: 'Match Criteria' }).waitFor();
    assert(owner.url().includes('section=match'), 'Next did not set ?section=match');
    await owner.waitForTimeout(1500);
    assert(owner.url().includes('section=match'), 'the post-save refresh dropped ?section=match');
    assert(q(`select est_monthly from public.homes where id = '${homeId}'`)[0].est_monthly === '2450', 'estimate not saved');
    await owner.getByRole('button', { name: /Home Facts/ }).first().click();
    await owner.getByRole('heading', { level: 1, name: 'Home Facts' }).waitFor();
  });

  await step(`[${width}] Next: Match Criteria → three tiers → Yes / No / Unknown saves the buyer's own answer`, async () => {
    await owner.getByRole('button', { name: /Next: Match Criteria/ }).click();
    await owner.getByRole('heading', { level: 1, name: 'Match Criteria' }).waitFor();
    for (const tier of ['Must-Haves', 'Important', 'Nice to Have']) await owner.getByRole('heading', { level: 2, name: tier }).waitFor();
    assert(owner.url().includes('section=match'), 'section not in the URL');
    const basement = owner.getByRole('group', { name: 'Finished Basement' });
    await basement.getByLabel('Yes', { exact: true }).check();
    await owner.waitForTimeout(800);
    let [state] = q(`select checks from public.home_member_state where home_id = '${homeId}' and user_id = '${info.users.owner.id}'`);
    assert(state.checks['features:Finished basement'] === true, `Yes not saved: ${JSON.stringify(state.checks)}`);
    await shot(owner, tag('09-match-criteria'));
    await basement.getByLabel('No', { exact: true }).check();
    await owner.waitForTimeout(800);
    [state] = q(`select checks from public.home_member_state where home_id = '${homeId}' and user_id = '${info.users.owner.id}'`);
    assert(state.checks['features:Finished basement'] === 'no', 'No not saved');
    await basement.getByLabel('Unknown', { exact: true }).check();
    await owner.waitForTimeout(800);
    [state] = q(`select checks from public.home_member_state where home_id = '${homeId}' and user_id = '${info.users.owner.id}'`);
    assert(!('features:Finished basement' in state.checks), 'Unknown should clear the answer');
    // Garage is scored from Home Facts (now None) and is read-only here.
    assert(!(await owner.getByRole('group', { name: 'Garage' }).count()), 'Garage should not be answerable');
    await owner.reload({ waitUntil: 'networkidle' });
    await owner.getByRole('heading', { level: 1, name: 'Match Criteria' }).waitFor();
  });

  await step(`[${width}] existing saved home (legacy data) reads correctly and viewing it changes nothing`, async () => {
    const before = q(`select * from public.homes where id = '${info.legacyHomeId}'`)[0];
    await owner.goto(`${base}/homes/${info.legacyHomeId}`, { waitUntil: 'networkidle' });
    await owner.getByText('Listing says: Forced air').waitFor();
    await owner.getByText('Noted: Finished, walkout').waitFor();
    await owner.getByText('4 spaces').waitFor();
    await owner.getByText('0.20 acres lot').waitFor();
    await owner.getByText('Royal Oak Schools').waitFor();
    await shot(owner, tag('10-legacy-home'));
    const after = q(`select * from public.homes where id = '${info.legacyHomeId}'`)[0];
    assert(JSON.stringify(after) === JSON.stringify(before), 'viewing a legacy home changed it');
  });

  const coBuyer = await signedIn(browser, 'coBuyer', width);
  await step(`[${width}] co-buyer edits a shared fact; the owner sees it; answers stay personal`, async () => {
    await coBuyer.goto(`${base}/homes/${homeId}`, { waitUntil: 'networkidle' });
    await coBuyer.getByRole('button', { name: 'Edit home details' }).click();
    await coBuyer.getByLabel('Roof').fill('Architectural shingle');
    await coBuyer.getByRole('button', { name: 'Save home details' }).click();
    await coBuyer.getByRole('button', { name: 'Edit home details' }).waitFor();
    assert(q(`select roof from public.homes where id = '${homeId}'`)[0].roof === 'Architectural shingle', 'co-buyer edit not saved');
    await coBuyer.getByRole('button', { name: /Next: Match Criteria/ }).click();
    await coBuyer.getByRole('group', { name: 'Fireplace' }).getByLabel('Yes', { exact: true }).check();
    await coBuyer.waitForTimeout(800);
    const answers = q(`select user_id, checks from public.home_member_state where home_id = '${homeId}'`);
    assert(answers.find((row) => row.user_id === info.users.coBuyer.id)?.checks['features:Fireplace'] === true, 'co-buyer answer not saved');
    assert(!('features:Fireplace' in (answers.find((row) => row.user_id === info.users.owner.id)?.checks || {})), 'co-buyer answer leaked into the owner');
    await shot(coBuyer, tag('11-cobuyer-match'), { full: false });
    await owner.goto(`${base}/homes/${homeId}`, { waitUntil: 'networkidle' });
    await owner.getByText('Architectural shingle').waitFor();
  });

  const realtor = await signedIn(browser, 'realtor', width);
  await step(`[${width}] Realtor read-only: Home Facts and Match Criteria have no edit controls`, async () => {
    await realtor.goto(`${base}/people/${info.search}/homes/${homeId}`, { waitUntil: 'networkidle' });
    await realtor.getByRole('heading', { level: 1, name: 'Home Facts' }).waitFor();
    assert(!(await realtor.getByRole('button', { name: /^Edit/ }).count()), 'Realtor sees an Edit control');
    await shot(realtor, tag('12-realtor-facts'), { full: false });
    await realtor.getByRole('button', { name: /Next: Match Criteria/ }).click();
    await realtor.getByRole('heading', { level: 1, name: 'Match Criteria' }).waitFor();
    assert(!(await realtor.getByRole('radio').count()), 'Realtor sees answer controls');
    await shot(realtor, tag('13-realtor-match'), { full: false });
  });

  for (const page of [owner, coBuyer, realtor]) {
    if (page.errors.length) log.push({ step: `[${width}] console errors`, ok: false, error: [...new Set(page.errors)].slice(0, 5).join(' | ') });
    await page.context().close();
  }
}

const browser = await chromium.launch();
for (const width of WIDTHS) await journey(browser, width);
await browser.close();
writeFileSync(join(outDir, 'e2e-results.json'), JSON.stringify(log, null, 2));
const failed = log.filter((entry) => !entry.ok);
console.log(`${log.length - failed.length}/${log.length} steps passed`);
if (failed.length) { console.error(JSON.stringify(failed, null, 2)); process.exitCode = 1; }
