#!/usr/bin/env node
// Full-stack QA for Tour Feedback on the Home Facts → Match Criteria → Tour
// Feedback workspace. DEVELOPMENT ONLY. Same harness as home-flow-e2e.mjs:
//
//   1. FLH_TEST_PGHOST=… FLH_TEST_PGPORT=… node scripts/qa/supabase-standin.mjs 54321 > standin.json
//   2. NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=qa npx next dev -p 3200
//   3. node scripts/qa/tour-feedback-e2e.mjs standin.json <outDir> [baseUrl] [width…]
//
// Seeds homes that look like real pre-existing data (older pros / cons / notes,
// an older overall-feeling rating, a recorded reaction and survey) straight
// into Postgres, then drives the app as the owner, the co-buyer and the Realtor.
// After each step it checks the database's ground truth: viewing changes
// nothing, notes edits touch only the shared notes, a take is recorded only
// through PostTourModal, and Realtors get no controls. Screenshots land in
// <outDir>; a failed step, horizontal overflow or console error fails the run.
// Run it after (not alongside) home-flow-e2e.mjs: each uses its own homes.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';

const [infoPath, outArg, base = 'http://localhost:3200', ...widthArgs] = process.argv.slice(2);
if (!infoPath || !outArg) throw new Error('Usage: tour-feedback-e2e.mjs <standin.json> <outDir> [baseUrl] [width…]');
const info = JSON.parse(readFileSync(infoPath, 'utf8'));
const outDir = resolve(outArg);
mkdirSync(outDir, { recursive: true });
const WIDTHS = (widthArgs.length ? widthArgs.map(Number) : [1440, 1024, 768, 390]);
const IGNORED_CONSOLE = /Download the React DevTools|favicon|maps\.googleapis|Google Maps|places|Failed to load resource: the server responded with a status of 40[34]/i;
const PREFIX = 'QA Tour';

const psqlArgs = ['-X', '-q', '-h', process.env.FLH_TEST_PGHOST, '-p', process.env.FLH_TEST_PGPORT || '5432', '-U', 'postgres', '-d', info.database];
function q(sql) {
  const result = spawnSync('psql', [...psqlArgs, '-A', '-t', '-c', `select coalesce(json_agg(t), '[]'::json) from (${sql}) t`], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr);
  return JSON.parse(result.stdout.trim());
}
function exec(sql) {
  const result = spawnSync('psql', [...psqlArgs, '-v', 'ON_ERROR_STOP=1', '-c', sql], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr);
}
const lit = (value) => (value === null || value === undefined ? 'null' : `'${String(typeof value === 'object' ? JSON.stringify(value) : value).replace(/'/g, "''")}'`);
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const log = [];

// Everything a buyer could have written before this redesign, per home.
const shared = (id) => q(`select pros, cons, notes from public.homes where id = '${id}'`)[0];
const personal = (id, who) => q(`select status, toured_at, reaction, ratings, checks, is_favorite from public.home_member_state where home_id = '${id}' and user_id = '${info.users[who].id}'`)[0] || null;
const snapshot = (id) => JSON.stringify({ shared: shared(id), owner: personal(id, 'owner'), coBuyer: personal(id, 'coBuyer') });

function seedHome({ address, pros = '', cons = '', notes = '', owner = null, coBuyer = null }) {
  const id = randomUUID();
  exec(`insert into public.homes (id, user_id, search_id, address, price, beds, baths, garage_spaces, pros, cons, notes, created_at)
    values ('${id}', '${info.users.owner.id}', '${info.search}', ${lit(address)}, '352000', '4', '2', '2', ${lit(pros)}, ${lit(cons)}, ${lit(notes)}, now() - interval '9 days')`);
  for (const [who, state] of [['owner', owner], ['coBuyer', coBuyer]]) {
    if (!state) continue;
    exec(`insert into public.home_member_state (home_id, user_id, status, toured_at, reaction, ratings, checks)
      values ('${id}', '${info.users[who].id}', ${lit(state.status || 'Saved')}, ${lit(state.touredAt)}, ${lit(state.reaction)}, ${lit(state.ratings || {})}::jsonb, ${lit(state.checks || {})}::jsonb)`);
  }
  return id;
}

async function signedIn(browser, who, width) {
  const context = await browser.newContext({ viewport: { width, height: width < 500 ? 844 : 900 } });
  const session = info.users[who].session;
  await context.addCookies([{ name: 'sb-localhost-auth-token', value: `base64-${Buffer.from(JSON.stringify(session)).toString('base64url')}`, domain: 'localhost', path: '/' }]);
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
  await page.screenshot({ path: join(outDir, `${name}.png`), fullPage: full });
  assert(overflow <= 0, `${name}: horizontal overflow ${overflow}px`);
}

async function step(name, fn) {
  const started = Date.now();
  try { await fn(); log.push({ step: name, ok: true, ms: Date.now() - started }); console.log('ok  ', name); }
  catch (error) { log.push({ step: name, ok: false, error: error.message }); console.error('FAIL', name, '—', error.message); }
}

const openTour = async (page, path) => {
  await page.goto(`${base}${path}?section=tour`, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { level: 1, name: 'Tour Feedback' }).waitFor();
};
const waitFor = async (check, message, timeout = 8000) => {
  const until = Date.now() + timeout;
  while (Date.now() < until) { if (check()) return; await new Promise((r) => setTimeout(r, 250)); }
  throw new Error(message);
};

async function journey(browser, width) {
  const tag = (name) => `${name}-${width}`;
  exec(`delete from public.homes where search_id = '${info.search}' and address like '${PREFIX}%'`);
  const LEGACY_NOTES = { pros: 'Big backyard, Quiet street', cons: 'Dated kitchen', notes: 'Saw it from the street on Sunday. Ask about the roof age and whether the basement ever takes on water.' };
  const preTour = seedHome({ address: `${PREFIX} 12 Maple Ct, Royal Oak, MI 48067`, ...LEGACY_NOTES, owner: { status: 'Want to Tour' } });
  const legacyToured = seedHome({
    address: `${PREFIX} 40 Elm St, Ferndale, MI 48220`,
    pros: 'Bright, open living room, Huge backyard', cons: 'Busy road two blocks over', notes: 'Loved the light in the living room.\n\nSecond look: the backyard is even bigger than the photos.',
    owner: { status: 'Toured', touredAt: '2026-10-04T15:00:00Z', reaction: 'considering', ratings: { 'tour:overall': 4, 'tour-v2:curb_appeal': 'positive', 'tour-v2:layout': 'positive', 'tour-v2:privacy': 'neutral', 'tour-v2:neighborhood': 'negative' }, checks: { 'features:Fireplace': true } },
    coBuyer: { status: 'Toured', touredAt: '2026-10-04T15:00:00Z', reaction: 'love', ratings: { 'tour:overall': 5 }, checks: { 'features:Fireplace': true } },
  });
  const fresh = seedHome({ address: `${PREFIX} 9 Birch Ct, Berkley, MI 48072` });

  const owner = await signedIn(browser, 'owner', width);
  await step(`[${width}] pre-tour notes: older pros / cons / notes shown as notes, nothing written by viewing`, async () => {
    const before = snapshot(preTour);
    await openTour(owner, `/homes/${preTour}`);
    await owner.getByRole('heading', { name: 'Your impressions will live here' }).waitFor();
    await owner.getByRole('heading', { name: 'Notes so far' }).waitFor();
    for (const text of ['Big backyard', 'Quiet street', 'Dated kitchen', 'Ask about the roof age']) await owner.getByText(text, { exact: false }).first().waitFor();
    await owner.getByRole('button', { name: 'On your Want to Tour list' }).waitFor();
    assert(!(await owner.locator('.flh-detail-action-bar').isVisible().catch(() => false)), 'phone action bar repeats Tour Feedback actions');
    await shot(owner, tag('t01-pre-tour-notes'));
    assert(snapshot(preTour) === before, 'viewing Tour Feedback changed stored data');
  });

  await step(`[${width}] opening and closing the take writes nothing; the home is not marked toured`, async () => {
    const before = snapshot(preTour);
    await owner.getByRole('button', { name: /I’ve toured it — record my take/ }).click();
    await owner.getByRole('dialog').waitFor();
    await owner.getByRole('dialog').getByRole('button', { name: 'Close' }).first().click();
    await owner.waitForTimeout(500);
    assert(snapshot(preTour) === before, 'closing the take wrote data');
    assert(personal(preTour, 'owner').toured_at === null, 'home was marked toured without a take');
  });

  await step(`[${width}] editing notes saves only the shared notes; older text is preserved`, async () => {
    const personalBefore = JSON.stringify(personal(preTour, 'owner'));
    await owner.getByRole('button', { name: /^Edit notes$/ }).click();
    await owner.getByLabel(/What you loved/).fill(`${LEGACY_NOTES.pros}, Mature trees`);
    await shot(owner, tag('t02-editing-notes'), { full: false });
    await owner.getByRole('button', { name: 'Save notes' }).click();
    await owner.getByText('Mature trees').waitFor();
    await waitFor(() => shared(preTour).pros === 'Big backyard, Quiet street, Mature trees', 'pros not saved');
    const after = shared(preTour);
    assert(after.cons === LEGACY_NOTES.cons && after.notes === LEGACY_NOTES.notes, `cons/notes changed: ${JSON.stringify(after)}`);
    assert(JSON.stringify(personal(preTour, 'owner')) === personalBefore, 'notes edit touched personal state');
  });

  await step(`[${width}] recording a take saves reaction, survey and an appended note; Tour Feedback shows it`, async () => {
    await owner.getByRole('button', { name: /I’ve toured it — record my take/ }).click();
    const dialog = owner.getByRole('dialog');
    await dialog.getByRole('button', { name: /Love it/ }).click();
    await dialog.getByRole('radiogroup', { name: 'Layout in-person evaluation' }).getByRole('radio', { name: 'Loved it' }).check();
    await dialog.getByRole('radiogroup', { name: 'Privacy in-person evaluation' }).getByRole('radio', { name: 'Neutral' }).check();
    const note = dialog.getByRole('textbox').last();
    await note.fill('The light in the kitchen is lovely.');
    await dialog.getByRole('button', { name: /Save my take|Save/ }).last().click();
    await owner.getByText('Your tour take is saved.').waitFor();
    await owner.getByRole('button', { name: 'Done' }).click();
    await waitFor(() => personal(preTour, 'owner').reaction === 'love', 'reaction not saved');
    const state = personal(preTour, 'owner');
    assert(state.toured_at && state.ratings['tour-v2:layout'] === 'positive' && state.ratings['tour-v2:privacy'] === 'neutral', `take not saved: ${JSON.stringify(state)}`);
    assert(shared(preTour).notes === `${LEGACY_NOTES.notes}\n\nThe light in the kitchen is lovely.`, 'note was not appended to the older notes');
    assert(personal(preTour, 'coBuyer') === null || personal(preTour, 'coBuyer').reaction === null, 'co-buyer state changed');
    await owner.getByRole('heading', { name: 'Love it' }).waitFor();
    await owner.getByRole('heading', { name: 'How it felt in person' }).waitFor();
    await owner.getByRole('heading', { name: 'What stood out' }).waitFor();
    await shot(owner, tag('t03-after-take'));
  });

  await step(`[${width}] older tour data (reaction, overall stars, survey, comma pros) displays and is untouched by viewing`, async () => {
    const before = snapshot(legacyToured);
    await openTour(owner, `/homes/${legacyToured}`);
    await owner.getByRole('heading', { name: 'Still considering' }).waitFor();
    await owner.getByLabel('4 out of 5 stars').first().waitFor();
    for (const text of ['Curb Appeal', 'Neighborhood', 'Didn’t like it', 'Huge backyard', 'Busy road two blocks over', 'Second look']) await owner.getByText(text, { exact: false }).first().waitFor();
    await owner.getByRole('heading', { name: /co-buyer’s take/ }).waitFor();
    await shot(owner, tag('t04-legacy-toured'));
    assert(snapshot(legacyToured) === before, 'viewing older tour data changed it');
  });

  await step(`[${width}] Match Criteria is unchanged around it: tiers and Yes / No / Unknown radios`, async () => {
    await owner.goto(`${base}/homes/${legacyToured}?section=match`, { waitUntil: 'networkidle' });
    await owner.getByRole('heading', { level: 1, name: 'Match Criteria' }).waitFor();
    for (const tier of ['Must-Haves', 'Important', 'Nice to Have']) await owner.getByRole('heading', { level: 2, name: tier }).waitFor();
    assert(!(await owner.getByText('Check the Match').count()), 'old Check the Match naming is back');
    const fireplace = owner.getByRole('group', { name: 'Fireplace' });
    assert(await fireplace.getByLabel('Yes', { exact: true }).isChecked(), 'saved Yes not shown');
    await fireplace.getByLabel('Unknown', { exact: true }).check();
    await waitFor(() => personal(legacyToured, 'owner').checks['features:Fireplace'] === undefined, 'Unknown did not clear the answer');
    assert(personal(legacyToured, 'owner').reaction === 'considering', 'answering touched the take');
    assert(personal(legacyToured, 'coBuyer').checks['features:Fireplace'] === true, 'owner answer changed the co-buyer');
    await fireplace.getByLabel('Yes', { exact: true }).check();
    await waitFor(() => personal(legacyToured, 'owner').checks['features:Fireplace'] === true, 'Yes not saved');
    await shot(owner, tag('t05-match-criteria'), { full: false });
  });

  await step(`[${width}] brand-new home: inviting empty state, no notes, no take`, async () => {
    await openTour(owner, `/homes/${fresh}`);
    await owner.getByRole('heading', { name: 'Your impressions will live here' }).waitFor();
    await owner.getByText('Nothing written yet.', { exact: false }).waitFor();
    await shot(owner, tag('t06-new-home'), { full: false });
  });

  const coBuyer = await signedIn(browser, 'coBuyer', width);
  await step(`[${width}] co-buyer sees their own take and the owner’s as a separate perspective`, async () => {
    const before = snapshot(legacyToured);
    await openTour(coBuyer, `/homes/${legacyToured}`);
    await coBuyer.getByRole('heading', { name: 'Love it' }).waitFor();
    await coBuyer.getByLabel('5 out of 5 stars').first().waitFor();
    await coBuyer.getByRole('heading', { name: /co-buyer’s take/ }).waitFor();
    await shot(coBuyer, tag('t07-cobuyer'));
    assert(snapshot(legacyToured) === before, 'co-buyer viewing changed data');
  });

  const realtor = await signedIn(browser, 'realtor', width);
  await step(`[${width}] Realtor: read-only Tour Feedback, each buyer’s take attributed by name`, async () => {
    const before = snapshot(legacyToured);
    await openTour(realtor, `/people/${info.search}/homes/${legacyToured}`);
    await realtor.getByText('Ciara M’s take', { exact: false }).first().waitFor();
    await realtor.getByRole('heading', { name: 'Andrew M’s take' }).waitFor();
    await realtor.getByRole('heading', { name: 'Still considering' }).waitFor();
    for (const name of [/record my take/i, /Edit your take/, /Record your take/, /^Edit notes$/, /^Add notes$/, /Want to tour/, /^Favorite/, /^Archive$/]) {
      assert(!(await realtor.getByRole('button', { name }).count()), `Realtor sees ${name}`);
    }
    // The Realtor's own professional note composer (RealtorContributions) is theirs and stays;
    // nothing that writes a buyer's take or the shared notes may appear.
    assert(!(await realtor.locator('.flh-tour textarea, .flh-tour input').evaluateAll((nodes) => nodes.filter((node) => !node.closest('.hh-realtor-contributions')).length)), 'Realtor sees a buyer input in Tour Feedback');
    await shot(realtor, tag('t08-realtor-tour'));
    await realtor.goto(`${base}/people/${info.search}/homes/${legacyToured}?section=match`, { waitUntil: 'networkidle' });
    await realtor.getByRole('heading', { level: 1, name: 'Match Criteria' }).waitFor();
    assert(!(await realtor.getByRole('radio').count()), 'Realtor sees Match answer controls');
    await realtor.getByRole('heading', { name: 'Andrew M’s Match' }).waitFor();
    await shot(realtor, tag('t09-realtor-match'), { full: false });
    assert(snapshot(legacyToured) === before, 'Realtor viewing changed data');
  });

  for (const page of [owner, coBuyer, realtor]) {
    if (page.errors.length) log.push({ step: `[${width}] console errors`, ok: false, error: [...new Set(page.errors)].slice(0, 5).join(' | ') });
    await page.context().close();
  }
}

const browser = await chromium.launch();
for (const width of WIDTHS) await journey(browser, width);
await browser.close();
writeFileSync(join(outDir, 'tour-e2e-results.json'), JSON.stringify(log, null, 2));
const failed = log.filter((entry) => !entry.ok);
console.log(`${log.length - failed.length}/${log.length} steps passed`);
if (failed.length) { console.error(JSON.stringify(failed, null, 2)); process.exitCode = 1; }
