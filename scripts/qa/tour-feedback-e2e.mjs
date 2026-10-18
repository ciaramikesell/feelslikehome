#!/usr/bin/env node
// Full-stack QA for Tour Feedback on the Home Facts → Match Criteria → Tour
// Feedback workspace. DEVELOPMENT ONLY. Same harness as home-overlay-e2e.mjs:
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
// Run it after (not alongside) home-overlay-e2e.mjs: each uses its own homes.
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
  // The buyer's home overlay titles it "Tour Feedback · <address>"; the Realtor's workspace "Tour Feedback".
  await page.getByRole('heading', { level: 1, name: /^Tour Feedback/ }).waitFor();
};
// The buyer's overlay shows Important / Nice to Have collapsed on phones.
const showAllTiers = async (page) => {
  for (let i = 0; i < 4; i += 1) {
    const toggle = page.locator('.flh-mc2-toggle[aria-expanded="false"]:visible').first();
    if (!(await toggle.count())) return;
    await toggle.click();
  }
};
const waitFor = async (check, message, timeout = 8000) => {
  const until = Date.now() + timeout;
  while (Date.now() < until) { if (check()) return; await new Promise((r) => setTimeout(r, 250)); }
  throw new Error(message);
};

// In-person Match criteria are rental priorities, or custom priorities in an
// older purchase search (the purchase built-ins are retired). Give both buyers
// custom ones for this run; their originals are restored at the end.
const IN_PERSON = { owner: { 'Noise Level': 'important', 'Curb Appeal': 'nice' }, coBuyer: { 'Noise Level': 'must' } };
const originalPriorities = {};
function withInPersonPriorities() {
  for (const [who, tiers] of Object.entries(IN_PERSON)) {
    const [row] = q(`select priorities from public.search_member_priorities where search_id = '${info.search}' and user_id = '${info.users[who].id}'`);
    originalPriorities[who] = row.priorities;
    const next = structuredClone(row.priorities);
    next.exterior = next.exterior || {};
    next.exterior.tiers = { ...(next.exterior.tiers || {}), ...tiers };
    next.exterior.customItems = [...(next.exterior.customItems || []).filter((item) => !tiers[item.label]), ...Object.keys(tiers).map((label) => ({ label, kind: 'rating', source: 'custom' }))];
    exec(`update public.search_member_priorities set priorities = ${lit(next)}::jsonb where search_id = '${info.search}' and user_id = '${info.users[who].id}'`);
  }
}
function restorePriorities() {
  for (const [who, priorities] of Object.entries(originalPriorities)) exec(`update public.search_member_priorities set priorities = ${lit(priorities)}::jsonb where search_id = '${info.search}' and user_id = '${info.users[who].id}'`);
}
const answerInPerson = async (page, name, option) => {
  await page.locator('.flh-tour-checks').getByRole('group', { name }).getByRole('radio', { name: option, exact: true }).check();
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

  await step(`[${width}] in person before a tour: answer Curb Appeal → saved to ratings only, still not toured, no take`, async () => {
    const before = personal(preTour, 'owner');
    const notesBefore = JSON.stringify(shared(preTour));
    await owner.getByRole('heading', { name: 'Things to check in person' }).waitFor();
    await answerInPerson(owner, 'Curb Appeal', 'Love it');
    await waitFor(() => personal(preTour, 'owner').ratings['exterior:Curb Appeal'] === 'positive', 'in-person answer not saved');
    const after = personal(preTour, 'owner');
    assert(after.toured_at === null && after.status === before.status && after.reaction === before.reaction, `answering changed tour state: ${JSON.stringify(after)}`);
    assert(JSON.stringify(shared(preTour)) === notesBefore, 'answering changed notes');
    await owner.getByRole('heading', { name: 'Your impressions will live here' }).waitFor();
    await shot(owner, tag('t10-in-person-before-tour'));
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
    assert(state.ratings['exterior:Curb Appeal'] === 'positive', 'recording a take overwrote the in-person answer');
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
    // Pros and cons are shown exactly as written — "Bright, open living room" stays one phrase.
    await owner.getByText('Bright, open living room, Huge backyard', { exact: true }).waitFor();
    await shot(owner, tag('t04-legacy-toured'));
    assert(snapshot(legacyToured) === before, 'viewing older tour data changed it');
  });

  await step(`[${width}] in person after a tour: answer, change, clear — take, survey and notes untouched; Match Criteria reflects it`, async () => {
    const before = personal(legacyToured, 'owner');
    const notesBefore = JSON.stringify(shared(legacyToured));
    const coBefore = JSON.stringify(personal(legacyToured, 'coBuyer'));
    const { 'exterior:Noise Level': _ignored, ...beforeRest } = before.ratings;
    await answerInPerson(owner, 'Noise Level', 'Too noisy');
    await waitFor(() => personal(legacyToured, 'owner').ratings['exterior:Noise Level'] === 'negative', 'answer not saved');
    let after = personal(legacyToured, 'owner');
    const { 'exterior:Noise Level': _answer, ...afterRest } = after.ratings;
    assert(JSON.stringify(afterRest) === JSON.stringify(beforeRest), `survey/overall changed: ${JSON.stringify(after.ratings)}`);
    assert(after.reaction === 'considering' && after.toured_at === before.toured_at && after.status === before.status, 'take or tour state changed');
    assert(JSON.stringify(shared(legacyToured)) === notesBefore, 'notes changed');
    assert(JSON.stringify(personal(legacyToured, 'coBuyer')) === coBefore, 'co-buyer state changed');
    await shot(owner, tag('t11-in-person-answered'));
    // Reflected at once in Your Match on the same overlay (same session state, no reload).
    await owner.getByRole('button', { name: 'Home details' }).click();
    await owner.getByRole('heading', { level: 2, name: 'Your Match' }).waitFor();
    await showAllTiers(owner);
    const row = owner.locator('.flh-mc2-row', { hasText: 'Noise Level' });
    await row.locator('.flh-mc2-state.is-missed').waitFor();
    await row.getByText('After tour', { exact: false }).waitFor();
    await row.scrollIntoViewIfNeeded();
    await shot(owner, tag('t12-match-reflects-in-person'), { full: false });
    // Return and change, then clear to Unknown.
    await owner.getByRole('button', { name: /Tour feedback & notes/ }).click();
    await owner.getByRole('heading', { level: 1, name: /^Tour Feedback/ }).waitFor();
    await answerInPerson(owner, 'Noise Level', 'Comfortable');
    await waitFor(() => personal(legacyToured, 'owner').ratings['exterior:Noise Level'] === 'positive', 'change not saved');
    await answerInPerson(owner, 'Noise Level', 'Unknown');
    await waitFor(() => !('exterior:Noise Level' in personal(legacyToured, 'owner').ratings), 'Unknown did not clear the answer');
    after = personal(legacyToured, 'owner');
    assert(JSON.stringify(after.ratings) === JSON.stringify(beforeRest) && after.reaction === 'considering', 'clearing changed other answers');
    await answerInPerson(owner, 'Noise Level', 'Noticeable');
    await waitFor(() => personal(legacyToured, 'owner').ratings['exterior:Noise Level'] === 'neutral', 'neutral not saved');
  });

  await step(`[${width}] Match Criteria is unchanged around it: tiers and Yes / No / Unknown radios`, async () => {
    await owner.goto(`${base}/homes/${legacyToured}?section=match`, { waitUntil: 'networkidle' });
    await owner.getByRole('heading', { level: 2, name: 'Your Match' }).waitFor();
    await showAllTiers(owner);
    for (const tier of ['Must-Haves', 'Important', 'Nice to Have']) await owner.getByRole('heading', { level: 3, name: new RegExp(`^${tier}`) }).waitFor();
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

  await step(`[${width}] My Homes card and Compare show pros / cons as written (no comma splitting)`, async () => {
    const before = snapshot(legacyToured);
    await owner.goto(`${base}/homes`, { waitUntil: 'networkidle' });
    const card = owner.locator('article.hh-home-card', { hasText: '40 Elm St' });
    // pros + cons + notes = 3 written fields (comma splitting used to count 5).
    // The compact phone card has no notes line at all (unchanged); elsewhere it
    // may sit inside the card's collapsed "More details".
    const more = card.getByRole('button', { name: /More details/ }).first();
    if (!(await card.getByText('Notes (3)').isVisible().catch(() => false)) && await more.isVisible().catch(() => false)) await more.click();
    if (width >= 500 || await card.locator('.hh-notes-indicator').isVisible().catch(() => false)) await card.getByText('Notes (3)').waitFor();
    assert(!(await card.getByText(/Notes \((4|5)\)/).count()), 'notes counted per comma');
    if (await card.locator('.hh-notes-indicator').isVisible().catch(() => false)) await card.locator('.hh-notes-indicator').scrollIntoViewIfNeeded();
    await shot(owner, tag('t14-my-homes-card'), { full: false });
    await owner.goto(`${base}/compare`, { waitUntil: 'networkidle' });
    await owner.getByText('What Stood Out').first().click();
    const phrase = owner.locator('.hh-compare-freeform', { hasText: 'Liked: Bright, open living room, Huge backyard' });
    if (!(await phrase.isVisible().catch(() => false))) {
      await owner.locator('button', { hasText: '40 Elm St' }).first().click();
      if (!(await owner.getByText('What Stood Out').first().evaluate((node) => node.closest('details')?.open))) await owner.getByText('What Stood Out').first().click();
    }
    await phrase.waitFor();
    await owner.locator('.hh-compare-freeform', { hasText: 'Didn\'t like: Busy road two blocks over' }).waitFor();
    assert((await phrase.innerText()).trim() === 'Liked: Bright, open living room, Huge backyard', 'Compare changed the written text');
    await phrase.scrollIntoViewIfNeeded();
    await shot(owner, tag('t15-compare-what-stood-out'), { full: false });
    assert(snapshot(legacyToured) === before, 'viewing My Homes / Compare changed stored data');
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

  await step(`[${width}] co-buyer’s in-person answer is their own; the owner’s answer is untouched`, async () => {
    const ownerBefore = JSON.stringify(personal(legacyToured, 'owner'));
    const group = coBuyer.locator('.flh-tour-checks').getByRole('group', { name: 'Noise Level' });
    assert(await group.getByRole('radio', { name: 'Unknown', exact: true }).isChecked(), 'co-buyer sees the owner’s answer as theirs');
    await answerInPerson(coBuyer, 'Noise Level', 'Comfortable');
    await waitFor(() => personal(legacyToured, 'coBuyer').ratings['exterior:Noise Level'] === 'positive', 'co-buyer answer not saved');
    assert(JSON.stringify(personal(legacyToured, 'owner')) === ownerBefore, 'co-buyer answer changed the owner');
    assert(personal(legacyToured, 'coBuyer').reaction === 'love', 'co-buyer reaction changed');
    await shot(coBuyer, tag('t13-cobuyer-in-person'), { full: false });
  });

  const realtor = await signedIn(browser, 'realtor', width);
  await step(`[${width}] Realtor: read-only Tour Feedback, each buyer’s take attributed by name`, async () => {
    const before = snapshot(legacyToured);
    await openTour(realtor, `/people/${info.search}/homes/${legacyToured}`);
    await realtor.getByText('Ciara M’s take', { exact: false }).first().waitFor();
    await realtor.getByRole('heading', { name: 'Andrew M’s take' }).waitFor();
    await realtor.getByRole('heading', { name: 'Still considering' }).waitFor();
    // The page eyebrow names the buyers; "Your take" never appears for a Realtor.
    await realtor.locator('.flh-workspace-head .flh-eyebrow', { hasText: 'Ciara M & Andrew M' }).waitFor();
    assert(!(await realtor.getByText('Your take', { exact: true }).count()), 'Realtor sees “Your take”');
    // Their in-person answers are shown as text, never as controls.
    await realtor.getByRole('heading', { name: 'Things to check in person' }).waitFor();
    await realtor.locator('.flh-tour-checks .flh-mc-readonly', { hasText: 'Noticeable' }).waitFor();
    assert(!(await realtor.locator('.flh-tour-checks input').count()), 'Realtor sees in-person answer controls');
    await realtor.getByText('Your private client notes stay in My Clients.').waitFor();
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
withInPersonPriorities();
try { for (const width of WIDTHS) await journey(browser, width); } finally { restorePriorities(); }
await browser.close();
writeFileSync(join(outDir, 'tour-e2e-results.json'), JSON.stringify(log, null, 2));
const failed = log.filter((entry) => !entry.ok);
console.log(`${log.length - failed.length}/${log.length} steps passed`);
if (failed.length) { console.error(JSON.stringify(failed, null, 2)); process.exitCode = 1; }
