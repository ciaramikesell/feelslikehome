#!/usr/bin/env node
// Browser QA for PR #187 (Home Facts UX + automatic Match fulfillment).
// DEVELOPMENT ONLY. Same setup as home-fact-match-parity-e2e.mjs (stand-in on
// real Postgres + dev server; the stand-in applies every migration, including
// 2026-11-16-home-facts-match-fulfillment.sql):
//
//   FLH_TEST_PGHOST=… FLH_TEST_PGPORT=… node scripts/qa/home-facts-match-fulfillment-e2e.mjs standin.json <outDir> [baseUrl] [beforeUrl]
//
// beforeUrl (optional): the same database served by the previous app (main),
// for before / after screenshots of Home Facts.
//
// Checks, as the owner (Garage: Attached) and the co-buyer (Garage: Detached):
//   - Home Facts layout: Laundry is out of the photo summary and follows
//     Basement; one Basement description with "Match reads"; HOA status beside
//     the fee; School Details freeform; no empty Notes box, an existing note kept;
//   - Match: Garage met only by the chosen kind, Central Air from Cooling, No HOA
//     from the HOA status (never from a $0 fee), Main Floor Laundry, with "From
//     Home Facts" notes; the co-buyer's own Match equals the owner's Compare view;
//   - edits: basement wording, HOA status and an own override, each checked in
//     the database (facts only in homes, answers only in the viewer's checks);
//   - no horizontal overflow at 1440, 390, 320 and 200% zoom (640 CSS px).
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { register } from 'node:module';
import { chromium, devices } from 'playwright';

register('../../test/support/aliasHooks.mjs', import.meta.url);
const { normalizePriorities } = await import('../../src/lib/constants.js');
const { addCriterion, setGaragePreference } = await import('../../src/lib/searchProfile.js');

const [infoPath, outArg, base = 'http://localhost:3200', beforeBase = null] = process.argv.slice(2);
if (!infoPath || !outArg) throw new Error('Usage: home-facts-match-fulfillment-e2e.mjs <standin.json> <outDir> [baseUrl] [beforeUrl]');
const info = JSON.parse(readFileSync(infoPath, 'utf8').split('\n')[0]);
const outDir = resolve(outArg);
mkdirSync(outDir, { recursive: true });
const OWNER = info.users.owner.id;
const CO = info.users.coBuyer.id;
const IGNORED_CONSOLE = /Download the React DevTools|favicon|maps\.googleapis|Google Maps|places|Failed to load resource/i;
const DESKTOP = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 };
const PHONE = devices['iPhone 13'];
const NARROW = { viewport: { width: 320, height: 640 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
// 200% browser zoom on a 1280-wide window: 640 CSS px at twice the density.
const ZOOM = { viewport: { width: 640, height: 400 }, deviceScaleFactor: 2 };

function psql(sql) {
  const result = spawnSync('psql', ['-X', '-q', '-A', '-t', '-h', process.env.FLH_TEST_PGHOST, '-p', process.env.FLH_TEST_PGPORT || '5432', '-U', 'postgres', '-d', info.database, '-c', sql], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
}
const q = (sql) => JSON.parse(psql(`select coalesce(json_agg(t), '[]'::json) from (${sql}) t`));
const lit = (value) => `'${String(value).replace(/'/g, "''")}'`;
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const checksOf = (homeId, userId) => q(`select checks from public.home_member_state where home_id = ${lit(homeId)} and user_id = ${lit(userId)}`)[0]?.checks || {};
const homeRow = (homeId) => q(`select garage_type, garage_spaces, cooling, has_hoa, hoa_fee_monthly, basement_condition, basement_style, basement_notes, laundry_location, notes, pros, cons, schools_notes, school_district_name, elementary_school from public.homes where id = ${lit(homeId)}`)[0];
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
const expandFacts = async (page) => {
  for (let i = 0; i < 8; i += 1) {
    const toggle = page.locator('.flh-hf2 .flh-phone-collapse-toggle[aria-expanded="false"]:visible').first();
    if (!(await toggle.count())) return;
    await toggle.click();
  }
};
const showTiers = async (page) => {
  for (let i = 0; i < 4; i += 1) {
    const toggle = page.locator('.flh-mc2-toggle[aria-expanded="false"]:visible').first();
    if (!(await toggle.count())) return;
    await toggle.click();
    await page.waitForTimeout(100);
  }
};
const matchRow = (page, name) => page.locator('.flh-mc2-row').filter({ has: page.locator('.flh-mc2-name', { hasText: new RegExp(`^${name}`) }) });
const rowState = async (page, name) => (await matchRow(page, name).getAttribute('class')).match(/is-(met|missed|unknown)/)?.[1];
const fromNote = async (page, name) => ((await matchRow(page, name).locator('.flh-mc2-from').first().textContent().catch(() => '')) || '').trim();
const choose = (page, name, choice) => matchRow(page, name).locator('label', { hasText: new RegExp(`^${choice}$`) }).click();
const pct = async (page) => Number((await page.locator('.flh-match-pill').first().textContent()).match(/\d+/)[0]);

async function openFacts(page, url, homeId) {
  await page.goto(`${url}/homes/${homeId}`, { waitUntil: 'networkidle' });
  await page.locator('.flh-overlay[role="dialog"]:not(.is-loading)').waitFor({ timeout: 30000 });
  await page.locator('.flh-hf2').first().waitFor({ timeout: 30000 });
  await expandFacts(page);
}
async function openMatch(page, homeId) {
  await page.goto(`${base}/homes/${homeId}?section=match`, { waitUntil: 'networkidle' });
  await page.locator('.flh-mc2').first().waitFor({ timeout: 30000 });
  await showTiers(page);
}

function setPriorities(userId, priorities) {
  const json = `${lit(JSON.stringify(priorities))}::jsonb`;
  const updated = psql(`update public.search_member_priorities set priorities = ${json} where search_id = ${lit(info.search)} and user_id = ${lit(userId)} returning 1`);
  if (!updated) psql(`update public.searches set priorities = ${json} where id = ${lit(info.search)} and user_id = ${lit(userId)}`);
}
function buyer(garagePreference, entries) {
  let priorities = normalizePriorities({ searchType: 'purchase' });
  priorities.budget = { value: '400000', tier: 'important' };
  priorities = addCriterion(priorities, { categoryKey: 'exterior', label: 'Garage', kind: 'check' }, 'must');
  for (const [categoryKey, label, tier] of entries) priorities = addCriterion(priorities, { categoryKey, label, kind: 'check' }, tier);
  return setGaragePreference(priorities, garagePreference);
}

function insertHome(label, facts) {
  const id = randomUUID();
  const columns = Object.keys(facts);
  psql(`insert into public.homes (id, user_id, search_id, address, price, ${columns.join(', ')})
    values (${lit(id)}, ${lit(OWNER)}, ${lit(info.search)}, ${lit(`${label} Fulfil Way, Royal Oak, MI 48073`)}, '350000', ${columns.map((column) => (facts[column] === null ? 'null' : typeof facts[column] === 'boolean' || typeof facts[column] === 'number' ? String(facts[column]) : lit(facts[column]))).join(', ')})`);
  return id;
}
const FULL = {
  garage_type: 'detached', garage_spaces: '2', cooling: 'Central Air', heating: 'Forced Air', has_hoa: false, hoa_fee_monthly: 0,
  basement_condition: 'finished', basement_style: 'walkout', laundry_location: 'first_floor', beds: '4', baths: '2.5', sqft: '2140', lot_size: '0.31 acres',
  school_district_name: 'Royal Oak Schools', elementary_school: 'Oakland Elementary', schools_notes: 'Bus stop at the corner',
  notes: 'Toured Saturday: roof looks newer than the listing says.', pros: 'Big backyard\nQuiet street', cons: 'Small primary closet',
};

async function run() {
  const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {});
  const ownerPriorities = buyer('attached', [['features', 'Central air', 'important'], ['location', 'No HOA', 'important'], ['features', 'Finished basement', 'nice'], ['features', 'Walkout basement', 'nice'], ['features', 'First-floor laundry', 'nice']]);
  setPriorities(OWNER, ownerPriorities);
  setPriorities(CO, buyer('detached', [['features', 'Central air', 'must']]));
  const homeId = insertHome('12', FULL);
  const emptyNotes = insertHome('14', { ...FULL, notes: '', basement_condition: null, basement_style: null, basement_notes: 'Finished walk-out w/ wet bar' });

  if (beforeBase) {
    await step('before (main): Home Facts on desktop and phone', async () => {
      for (const [name, device] of [['desktop', DESKTOP], ['phone', PHONE]]) {
        const page = await signedIn(browser, 'owner', device);
        await openFacts(page, beforeBase, homeId);
        await shot(page, `before-home-facts-${name}`, '.flh-overlay-body, .flh-overlay');
        await page.context().close();
      }
    }, () => []);
  }

  let owner;
  await step('[desktop] Home Facts layout: Laundry after Basement (not in the photo summary), one Basement field, HOA status, School Details, existing Notes kept', async () => {
    owner = await signedIn(browser, 'owner', DESKTOP);
    await openFacts(owner, base, homeId);
    assert(await owner.locator('.flh-hf2-header #hf-laundryLocation').count() === 0, 'Laundry is still in the photo summary');
    const order = await owner.evaluate(() => ['hf-basement-title', 'hf-laundry-title', 'hf-notes-title'].map((id) => document.getElementById(id)?.getBoundingClientRect().top ?? -1));
    assert(order.every((top) => top > 0) && order[0] < order[1] && order[1] < order[2], `order ${order}`);
    assert(await owner.locator('#hf-basement').inputValue() === 'Finished Walkout', 'basement description');
    assert((await owner.locator('.flh-hf-basement-reading').textContent()).includes('Finished: Yes · Walkout: Yes'), 'Match reads line');
    assert(await owner.locator('#hf-laundryLocation option:checked').textContent() === 'Main Floor', 'laundry label');
    assert(await owner.locator('#hf-hasHoa option:checked').textContent() === 'No HOA', 'HOA status');
    assert((await owner.locator('#hf-schoolsNotes').inputValue()) === 'Bus stop at the corner', 'school details');
    assert(await owner.locator('#hf-elementarySchool').count() === 1, 'a saved school name stays');
    assert((await owner.locator('#hf-notes').inputValue()).startsWith('Toured Saturday'), 'existing note shown');
    assert(await owner.locator('#hf-pros').count() === 1 && await owner.locator('#hf-cons').count() === 1, 'pros / cons');
    await shot(owner, 'after-home-facts-desktop', '.flh-overlay-body, .flh-overlay');
    await shot(owner, 'after-home-facts-desktop-facts', '.flh-hf2-facts');
  }, () => [owner].filter(Boolean));

  await step('[desktop] a home with no notes offers no empty Notes box; an earlier basement note is shown and used only on click', async () => {
    await openFacts(owner, base, emptyNotes);
    assert(await owner.locator('#hf-notes').count() === 0, 'an empty Notes box is offered');
    assert(await owner.locator('#hf-basement').inputValue() === 'Finished walk-out w/ wet bar', 'earlier note shown');
    const use = owner.locator('.flh-hf-basement button', { hasText: 'Use as Finished Walkout' });
    assert(await use.count() === 1, 'no Use button');
    assert(homeRow(emptyNotes).basement_condition === null, 'nothing was written by viewing');
    await shot(owner, 'after-basement-earlier-note', '#hf-basement-title + *, .flh-hf2-column-side');
    await use.click();
    await until(() => homeRow(emptyNotes).basement_condition === 'finished' && homeRow(emptyNotes).basement_style === 'walkout', 'Use did not save the facts');
    assert(homeRow(emptyNotes).basement_notes === 'Finished walk-out w/ wet bar', 'the note was changed');
  }, () => [owner].filter(Boolean));

  await step('[desktop] owner Match (Garage: Attached): detached garage is a miss with its reason; Central Air, No HOA, Main Floor Laundry and the basement from Home Facts', async () => {
    await openMatch(owner, homeId);
    assert(await rowState(owner, 'Garage') === 'missed', `Garage ${await rowState(owner, 'Garage')}`);
    assert((await fromNote(owner, 'Garage')).includes('2-car detached garage — you want attached'), `garage note: ${await fromNote(owner, 'Garage')}`);
    for (const name of ['Central Air', 'No HOA', 'Main Floor Laundry', 'Finished Basement', 'Walkout Basement']) {
      assert(await rowState(owner, name) === 'met', `${name} ${await rowState(owner, name)}`);
      assert((await fromNote(owner, name)).startsWith('From Home Facts: Yes'), `${name} note`);
    }
    // budget 1×2 + Garage 0×4 + Central Air 1×2 + No HOA 1×2 + three Nice 1×1 each, over 13.
    assert(await pct(owner) === Math.round(9 / 13 * 100), `Match ${await pct(owner)}%`);
    assert(Object.keys(checksOf(homeId, OWNER)).length === 0, 'derived answers were written');
    await shot(owner, 'after-match-owner-desktop', '.flh-mc2');
  }, () => [owner].filter(Boolean));

  let coBuyer;
  await step('[desktop] co-buyer (Garage: Detached) on the same home: Garage met; their own Match equals the owner\'s Compare view', async () => {
    coBuyer = await signedIn(browser, 'coBuyer', DESKTOP);
    await openMatch(coBuyer, homeId);
    assert(await rowState(coBuyer, 'Garage') === 'met', 'co-buyer Garage');
    assert(await rowState(coBuyer, 'Central Air') === 'met', 'co-buyer Central Air');
    const own = await pct(coBuyer);
    await shot(coBuyer, 'after-match-cobuyer-desktop', '.flh-mc2');
    await owner.reload({ waitUntil: 'networkidle' });
    const context = (await owner.locator('.flh-overlay-match-context', { hasText: /co-buyer/ }).textContent()).match(/(\d+)%/)?.[1];
    assert(Number(context) === own, `owner sees the co-buyer at ${context}%, the co-buyer sees ${own}%`);
  }, () => [owner, coBuyer].filter(Boolean));
  await coBuyer?.context().close();

  await step('[desktop] edits: "Unfinished" is never finished; ambiguous wording stays Unknown and is kept; "Has an HOA" contradicts No HOA at $0; an own Yes overrides for the owner only', async () => {
    await openFacts(owner, base, homeId);
    await owner.locator('#hf-basement').fill('Unfinished');
    await owner.locator('#hf-basement').blur();
    await until(() => homeRow(homeId).basement_condition === 'unfinished' && homeRow(homeId).basement_style === null, 'Unfinished not saved as unfinished / Unknown style');
    await owner.locator('#hf-basement').fill('Finished, unfinished storage');
    await owner.locator('#hf-basement').blur();
    await until(() => homeRow(homeId).basement_condition === null && homeRow(homeId).basement_notes === 'Finished, unfinished storage', 'ambiguous wording not kept as Unknown');
    await owner.locator('#hf-hasHoa').selectOption('yes');
    await until(() => homeRow(homeId).has_hoa === true, 'HOA status not saved');
    await shot(owner, 'after-edits-home-facts', '.flh-hf2-facts');
    await openMatch(owner, homeId);
    assert(await rowState(owner, 'No HOA') === 'missed', 'a confirmed HOA at $0 did not contradict No HOA');
    assert(await rowState(owner, 'Finished Basement') === 'unknown', 'ambiguous basement wording was guessed');
    await choose(owner, 'Garage', 'Yes');
    await until(() => checksOf(homeId, OWNER)['exterior:Garage'] === true, 'override not saved');
    await until(async () => (await fromNote(owner, 'Garage')).startsWith('Your answer · Home Facts: No'), 'override note');
    assert(Object.keys(checksOf(homeId, CO)).length === 0, 'the co-buyer got an answer');
    assert(homeRow(homeId).garage_type === 'detached', 'the shared fact was changed by an override');
    await shot(owner, 'after-match-override', '.flh-mc2');
  }, () => [owner].filter(Boolean));
  await owner?.context().close();

  for (const [name, device] of [['phone-390', PHONE], ['narrow-320', NARROW], ['zoom-200', ZOOM]]) {
    let page;
    await step(`[${name}] Home Facts and Match fit with no horizontal overflow`, async () => {
      page = await signedIn(browser, 'owner', device);
      await openFacts(page, base, homeId);
      const clipped = await page.evaluate(() => [...document.querySelectorAll('.flh-hf2 input, .flh-hf2 select, .flh-hf2 textarea')]
        .filter((el) => el.offsetParent && el.getBoundingClientRect().right > window.innerWidth + 1).map((el) => el.id));
      assert(!clipped.length, `clipped: ${clipped.join(', ')}`);
      await shot(page, `after-home-facts-${name}`, '.flh-overlay-body, .flh-overlay');
      await openMatch(page, homeId);
      if (name === 'phone-390') await shot(page, `after-match-${name}`, '.flh-mc2');
    }, () => [page].filter(Boolean));
    await page?.context().close();
  }

  // The Add / Edit Home editor (here opened from Home Facts' "More home details",
  // which Home to Rent uses) saves the basement through the same parser and
  // storage as Home Facts: the edit counts in Match with no second step, a
  // legacy note is kept, and the result reads identically in Home Facts.
  let editor;
  await step('[desktop] Add / Edit Home editor: a basement edit counts in Match on save, legacy note preserved, same result as Home Facts', async () => {
    let rental = normalizePriorities({ searchType: 'rental' });
    rental = addCriterion(rental, { categoryKey: 'features', label: 'Finished Basement', kind: 'check', source: 'custom' }, 'must');
    rental = addCriterion(rental, { categoryKey: 'features', label: 'Walkout Basement', kind: 'check', source: 'custom' }, 'important');
    setPriorities(OWNER, rental);
    const rentalHome = insertHome('16', { basement_notes: 'Finished walk-out w/ bar', basement_condition: null, basement_style: null, beds: '3' });
    editor = await signedIn(browser, 'owner', DESKTOP);
    await openFacts(editor, base, rentalHome);
    await editor.locator('.flh-hf2-more').click();
    const field = editor.locator('#edit-home-basement');
    await field.waitFor({ timeout: 30000 });
    assert(await field.inputValue() === 'Finished walk-out w/ bar', `editor shows ${await field.inputValue()}`);
    await field.fill('Unfinished');
    await field.blur();
    assert((await editor.locator('.hh-basement-field small').textContent()).includes('Finished: No'), 'editor Match reads line');
    await shot(editor, 'after-editor-basement', '.hh-basement-field');
    await editor.getByRole('button', { name: 'Save changes' }).click();
    await until(() => homeRow(rentalHome).basement_condition === 'unfinished', 'editor did not save the basement facts');
    const row = homeRow(rentalHome);
    assert(row.basement_style === null && row.basement_notes === 'Finished walk-out w/ bar', `saved ${JSON.stringify(row)}`);
    await openFacts(editor, base, rentalHome);
    assert(await editor.locator('#hf-basement').inputValue() === 'Unfinished', 'Home Facts shows the editor\'s description');
    assert((await editor.locator('.flh-hf2-note', { hasText: 'Earlier note' }).textContent()).includes('Finished walk-out w/ bar'), 'legacy note not shown');
    await openMatch(editor, rentalHome);
    assert(await rowState(editor, 'Finished Basement') === 'missed', 'the editor edit did not reach Match');
    assert((await fromNote(editor, 'Finished Basement')).startsWith('From Home Facts: No'), 'not labelled From Home Facts');
    assert(await rowState(editor, 'Walkout Basement') === 'unknown', '"Unfinished" established a walkout answer');
    assert(Object.keys(checksOf(rentalHome, OWNER)).length === 0, 'answers were written');
    setPriorities(OWNER, ownerPriorities);
  }, () => [editor].filter(Boolean));
  await editor?.context().close();

  await browser.close();
  writeFileSync(join(outDir, 'results.json'), JSON.stringify(log, null, 2));
  const failed = log.filter((entry) => !entry.ok);
  console.log(`\n${log.length - failed.length}/${log.length} steps passed`);
  if (failed.length) process.exitCode = 1;
}

await run();
