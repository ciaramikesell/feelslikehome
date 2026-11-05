#!/usr/bin/env node
// Browser QA for the Home Facts layout refinement and inline Notes / Pros /
// Cons. DEVELOPMENT ONLY — runs against the local stand-in.
//
//   1. FLH_TEST_PGHOST=… FLH_TEST_PGPORT=… node scripts/qa/supabase-standin.mjs 54321 > standin.json
//   2. NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=qa npx next dev -p 3200
//   3. FLH_TEST_PGHOST=… FLH_TEST_PGPORT=… node scripts/qa/home-facts-notes-qa.mjs standin.json <outDir> [baseUrl] [--capture-only]
//
// --capture-only seeds and screenshots the Home Facts section at each width
// (used for the "before" shots on main) and checks nothing.
//
// Otherwise, at desktop 1440, iPad portrait 768 / landscape 1024 and iPhone:
// Garage / Basement pairs side by side (desktop, landscape) or stacked rows
// (narrow), equal widths, no option text clipped (every option measured), no
// horizontal overflow; Notes / Pros / Cons below Basement; dropdown edits and
// Unknown; notes editing → saved → Home Card counts; keyboard order; a
// co-buyer sees the text; simultaneous edits (conflict → Keep mine / Use
// theirs, unrelated facts kept); a failed save → Retry; Tour Feedback's editor
// still in step; no console errors.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { chromium, devices } from 'playwright';

const args = process.argv.slice(2);
const captureOnly = args.includes('--capture-only');
const [infoPath, outArg, base = 'http://localhost:3200'] = args.filter((arg) => !arg.startsWith('--'));
if (!infoPath || !outArg) throw new Error('Usage: home-facts-notes-qa.mjs <standin.json> <outDir> [baseUrl] [--capture-only]');
const info = JSON.parse(readFileSync(infoPath, 'utf8').split('\n')[0]);
const outDir = resolve(outArg);
mkdirSync(outDir, { recursive: true });
const IGNORED_CONSOLE = /Download the React DevTools|favicon|maps\.googleapis|Google Maps|places|Failed to load resource/i;
const pg = ['-X', '-q', '-A', '-t', '-h', process.env.FLH_TEST_PGHOST, '-p', process.env.FLH_TEST_PGPORT || '5432', '-U', 'postgres', '-d', info.database];
function sql(statement) {
  const result = spawnSync('psql', [...pg, '-v', 'ON_ERROR_STOP=1', '-c', statement], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
}
const lit = (value) => (value === null || value === undefined ? 'null' : `'${String(value).replace(/'/g, "''")}'`);
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const owner = info.users.owner.id;
const coBuyer = info.users.coBuyer.id;
const dbRow = (id) => JSON.parse(sql(`select row_to_json(t) from (select notes, pros, cons, garage_type, garage_spaces, basement_style, basement_condition from public.homes where id = '${id}') t`));

const HOMES = [
  { key: 'full', street: '210 Maple Ave', price: '439000', beds: '4', baths: '2.5', sqft: '2140', garageType: 'attached', garageSpaces: '2', basementStyle: 'walkout', basementCondition: 'partially_finished',
    notes: 'Seller offering $5k toward closing costs\nTaxes seem high', pros: 'Great backyard\nUpdated kitchen\nQuiet street', cons: 'Only one full bath' },
  { key: 'unknown', street: '9 Unknown Ct', price: '', beds: '', baths: '', sqft: '', garageType: null, garageSpaces: '', basementStyle: null, basementCondition: null, notes: '', pros: '', cons: '' },
];
function seed() {
  sql(`delete from public.homes where search_id = '${info.search}'`);
  HOMES.forEach((home, index) => {
    home.id = randomUUID();
    sql(`insert into public.homes (id, user_id, search_id, address, price, beds, baths, sqft, garage_type, garage_spaces, basement_style, basement_condition, notes, pros, cons, created_at)
      values ('${home.id}', '${owner}', '${info.search}', ${lit(`${home.street}, Royal Oak, MI 48073`)}, ${lit(home.price)}, ${lit(home.beds)}, ${lit(home.baths)}, ${lit(home.sqft)},
        ${lit(home.garageType)}, ${lit(home.garageSpaces)}, ${lit(home.basementStyle)}, ${lit(home.basementCondition)}, ${lit(home.notes)}, ${lit(home.pros)}, ${lit(home.cons)}, now() - interval '${index} minutes')`);
    for (const user of [owner, coBuyer]) sql(`insert into public.home_member_state (home_id, user_id, status, checks) values ('${home.id}', '${user}', 'Saved', '{}'::jsonb) on conflict (home_id, user_id) do nothing`);
  });
}

const log = [];
async function step(name, fn) {
  const started = Date.now();
  try { await fn(); log.push({ step: name, ok: true, ms: Date.now() - started }); console.log('ok  ', name); }
  catch (error) { log.push({ step: name, ok: false, error: error.message }); console.error('FAIL', name, '—', error.message.split('\n')[0]); }
}
const VIEWPORTS = {
  desktop: { viewport: { width: 1440, height: 1000 } },
  'ipad-landscape': devices['iPad Mini landscape'],
  'ipad-portrait': devices['iPad Mini'],
  iphone: devices['iPhone 13'],
};
async function signedIn(browser, device, who = 'owner') {
  const context = await browser.newContext(VIEWPORTS[device]);
  await context.addCookies([{ name: 'sb-localhost-auth-token', value: `base64-${Buffer.from(JSON.stringify(info.users[who].session)).toString('base64url')}`, domain: 'localhost', path: '/' }]);
  await context.addInitScript(() => { try { localStorage.setItem('flh-mobile-tour-dismissed', '1'); localStorage.setItem('flh-name-prompt-dismissed', '1'); localStorage.setItem('flh-install-dismissed', '1'); } catch { /* ignore */ } });
  await context.route('**/api/commute', (route) => route.fulfill({ json: { results: {} } }));
  const page = await context.newPage();
  page.errors = [];
  page.on('pageerror', (error) => page.errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error' && !IGNORED_CONSOLE.test(message.text())) page.errors.push(message.text()); });
  return page;
}
const hideChrome = '.beta-feedback-tab, nextjs-portal { visibility: hidden !important; }';
const homeOf = (key) => HOMES.find((home) => home.key === key);
async function openOverlay(page, key) {
  await page.goto(`${base}/homes/${homeOf(key).id}`, { waitUntil: 'networkidle' });
  await page.locator('.flh-hf2-facts').waitFor();
  await page.evaluate(() => document.fonts.ready);
}
// "Saved" also shows while idle, so a save is confirmed against the database.
async function until(check, message, timeout = 15000) {
  const end = Date.now() + timeout;
  for (;;) {
    if (check()) return;
    if (Date.now() > end) throw new Error(`timed out: ${message}`);
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
}
const saved = async (page, check = () => true, message = 'save') => {
  await until(check, message);
  await page.locator('.flh-overlay-save.is-saved').waitFor({ timeout: 15000 });
};
async function closeOverlay(page) {
  await page.locator('.flh-overlay-close').click();
  await page.locator('.flh-overlay').waitFor({ state: 'detached', timeout: 15000 });
}
const cardLabels = async (page, street) => (await page.locator('article.hh-home-card').filter({ has: page.getByRole('heading', { name: street }) }).locator('.hh-note-preview-trigger').allTextContents()).map((text) => text.replace(', preview', '').trim());

// Every option of every select in the side column fits its control (measured
// with the control's own font and padding), and nothing overflows sideways.
async function layoutReport(page) {
  return page.evaluate(() => {
    const canvas = document.createElement('canvas').getContext('2d');
    const rect = (el) => el.getBoundingClientRect();
    const side = document.querySelector('.flh-hf2-column-side');
    const clipped = [];
    for (const select of side.querySelectorAll('select')) {
      const style = getComputedStyle(select);
      canvas.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      const room = select.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      for (const option of select.options) if (canvas.measureText(option.text).width > room + 0.5) clipped.push(`${select.id}: "${option.text}" ${Math.round(canvas.measureText(option.text).width)}>${Math.round(room)}`);
    }
    const pair = (a, b) => { const x = rect(document.getElementById(a)); const y = rect(document.getElementById(b)); return { sameRow: Math.abs(x.top - y.top) < 2, widths: [Math.round(x.width), Math.round(y.width)] }; };
    const labelBeside = (id) => { const field = document.getElementById(id).closest('.flh-hf-pair-field'); const label = rect(field.querySelector('label')); return rect(document.getElementById(id)).left > label.right - 1; };
    const scroll = document.querySelector('.flh-overlay-scroll');
    // Content height (the grid stretches both columns to the taller one).
    const columns = [...document.querySelectorAll('.flh-hf2-columns > .flh-hf2-column')].map((column) => Math.round(rect(column.lastElementChild).bottom - rect(column).top));
    const order = ['hf-garage-title', 'hf-basement-title', 'hf-notes-title'].map((id) => rect(document.getElementById(id)).top);
    const sideBox = rect(side);
    const spill = [...side.querySelectorAll('select, textarea, label')].filter((el) => rect(el).right > sideBox.right + 0.5).map((el) => el.id || el.textContent.slice(0, 20));
    return {
      clipped, garage: pair('hf-garageType', 'hf-garageSpaces'), basement: pair('hf-basementStyle', 'hf-basementCondition'),
      labelBeside: labelBeside('hf-garageType'), columns, sideWidth: Math.round(sideBox.width),
      notesAfterBasement: order[0] < order[1] && order[1] < order[2], spill,
      overflow: scroll.scrollWidth - scroll.clientWidth, pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
}

async function main() {
  seed();
  const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {});
  const report = {};

  for (const device of Object.keys(VIEWPORTS)) {
    const page = await signedIn(browser, device);
    await step(`[${device}] Home Facts layout`, async () => {
      await openOverlay(page, 'full');
      // A phone's Home Facts is taller than the screen inside the overlay's own
      // scroller, which element screenshots can't stitch: capture the column
      // with Garage, Basement (and Notes) there instead.
      const shot = device === 'iphone' ? page.locator('.flh-hf2-columns > .flh-hf2-column').last() : page.locator('.flh-hf2-facts');
      await shot.scrollIntoViewIfNeeded();
      await shot.screenshot({ path: join(outDir, `${device}-home-facts.png`), style: hideChrome });
      if (captureOnly) return;
      const layout = await layoutReport(page);
      report[device] = layout;
      console.log(`     ${device}: side column ${layout.sideWidth}px, garage ${JSON.stringify(layout.garage)}, columns ${layout.columns}`);
      assert(!layout.clipped.length, `clipped: ${layout.clipped.join(' | ')}`);
      assert(!layout.spill.length, `spills: ${layout.spill.join(' | ')}`);
      assert(layout.overflow <= 0 && layout.pageOverflow <= 0, `overflow ${layout.overflow}/${layout.pageOverflow}`);
      assert(layout.notesAfterBasement, 'Notes, Pros & Cons should follow Basement');
      const wide = layout.sideWidth >= 360;
      for (const [name, pair] of [['garage', layout.garage], ['basement', layout.basement]]) {
        assert(pair.sameRow === wide, `${name}: side by side ${pair.sameRow} at ${layout.sideWidth}px`);
        if (wide) assert(Math.abs(pair.widths[0] - pair.widths[1]) <= 1, `${name}: unequal ${pair.widths}`);
      }
      if (!wide) assert(layout.labelBeside, 'narrow: label beside its control');
      // Desktop: Notes / Pros / Cons fill the old whitespace. With this sample
      // (Pros at three lines) the right column ends ~44px below the left, so
      // the section grows by at most a couple of lines, never a new block.
      if (device === 'desktop') assert(layout.columns[1] <= layout.columns[0] + 48, `right column ${layout.columns[1]}px vs left ${layout.columns[0]}px`);
      assert((await page.locator('#hf-pros').inputValue()) === homeOf('full').pros, 'Pros text shown');
      assert(!page.errors.length, page.errors.join(' | '));
    });
    if (!captureOnly && device === 'desktop') {
      await step('[desktop] Unknown values and long options fit; dropdown edits save as before', async () => {
        await openOverlay(page, 'unknown');
        const layout = await layoutReport(page);
        assert(!layout.clipped.length, `clipped: ${layout.clipped.join(' | ')}`);
        for (const id of ['hf-garageType', 'hf-garageSpaces', 'hf-basementStyle', 'hf-basementCondition']) {
          assert((await page.locator(`#${id} option:checked`).textContent()) === 'Unknown', `${id} Unknown`);
        }
        await page.locator('.flh-hf2-facts').screenshot({ path: join(outDir, 'desktop-home-facts-unknown.png'), style: hideChrome });
        await page.locator('#hf-garageSpaces').selectOption('3+');
        await page.locator('#hf-basementCondition').selectOption('partially_finished');
        await saved(page, () => dbRow(homeOf('unknown').id).basement_condition === 'partially_finished', 'condition');
        let row = dbRow(homeOf('unknown').id);
        assert(row.garage_spaces === '3+' && row.basement_condition === 'partially_finished' && row.garage_type === null && row.basement_style === null, `saved ${JSON.stringify(row)}`);
        // None keeps its existing derivation (Spaces / Condition follow).
        await page.locator('#hf-garageType').selectOption('none');
        await page.locator('#hf-basementStyle').selectOption('none');
        await saved(page, () => dbRow(homeOf('unknown').id).basement_style === 'none', 'style none');
        row = dbRow(homeOf('unknown').id);
        assert(row.garage_type === 'none' && row.garage_spaces === '0' && row.basement_style === 'none' && row.basement_condition === 'none', `None derivations ${JSON.stringify(row)}`);
        assert((await page.locator('#hf-garageSpaces option:checked').textContent()) === 'None', 'Spaces follows None');
        assert(!page.errors.length, page.errors.join(' | '));
      });

      await step('[desktop] keyboard: Type → Spaces → Style → Condition → Notes → Pros → Cons, visible focus', async () => {
        await openOverlay(page, 'full');
        await page.locator('#hf-garageType').focus();
        const order = [];
        for (let i = 0; i < 6; i += 1) { await page.keyboard.press('Tab'); order.push(await page.evaluate(() => document.activeElement.id)); }
        assert(JSON.stringify(order) === JSON.stringify(['hf-garageSpaces', 'hf-basementStyle', 'hf-basementCondition', 'hf-notes', 'hf-pros', 'hf-cons']), `tab order ${order}`);
        const ring = await page.evaluate(() => { const s = getComputedStyle(document.activeElement); return `${s.outlineStyle} ${parseFloat(s.outlineWidth)}`; });
        assert(ring.startsWith('solid') && parseFloat(ring.split(' ')[1]) >= 2, `focus ring ${ring}`);
        await page.locator('.flh-hf2-column-side').screenshot({ path: join(outDir, 'desktop-keyboard-cons.png'), style: hideChrome });
      });

      await step('[desktop] edit Pros inline: saved as typed, and the Home Card shows the new count at once', async () => {
        const pros = page.locator('#hf-pros');
        await pros.click();
        await page.keyboard.press('ControlOrMeta+End');
        await page.keyboard.type('\nWalk to the park');
        assert((await page.locator('#hf-pros-hint').textContent()).startsWith('4'), 'live count');
        await page.locator('#hf-cons').click();
        await saved(page, () => dbRow(homeOf('full').id).pros.endsWith('Walk to the park'), 'pros');
        assert(dbRow(homeOf('full').id).pros === `${homeOf('full').pros}\nWalk to the park`, `db ${dbRow(homeOf('full').id).pros}`);
        // Editing the same note again in this session is not a conflict with oneself.
        await page.waitForTimeout(400);
        await pros.click();
        await page.keyboard.press('ControlOrMeta+End');
        await page.keyboard.type('!');
        await page.locator('#hf-cons').click();
        await saved(page, () => dbRow(homeOf('full').id).pros.endsWith('park!'), 'second pros edit');
        assert(!(await page.locator('.flh-notes-conflict').count()), 'conflict with own earlier save');
        await pros.click();
        await page.keyboard.press('ControlOrMeta+End');
        await page.keyboard.press('Backspace');
        await page.locator('#hf-cons').click();
        await saved(page, () => dbRow(homeOf('full').id).pros.endsWith('park'), 'third pros edit');
        await closeOverlay(page);
        const labels = await cardLabels(page, homeOf('full').street);
        assert(JSON.stringify(labels) === JSON.stringify(['Notes (2)', 'Pros (4)', 'Cons (1)']), `card ${labels}`);
        homeOf('full').pros = `${homeOf('full').pros}\nWalk to the park`;
        assert(!page.errors.length, page.errors.join(' | '));
      });

      await step('[desktop] a co-buyer sees the same text in Home Facts and on their card', async () => {
        const theirs = await signedIn(browser, 'desktop', 'coBuyer');
        await theirs.goto(`${base}/homes`, { waitUntil: 'networkidle' });
        const labels = await cardLabels(theirs, homeOf('full').street);
        assert(JSON.stringify(labels) === JSON.stringify(['Notes (2)', 'Pros (4)', 'Cons (1)']), `co-buyer card ${labels}`);
        await openOverlay(theirs, 'full');
        assert((await theirs.locator('#hf-pros').inputValue()) === homeOf('full').pros, 'co-buyer Home Facts text');
        await theirs.context().close();
      });

      await step('[desktop] simultaneous edits: conflict shown, nothing overwritten; unrelated facts kept; Keep mine / Use theirs', async () => {
        const id = homeOf('full').id;
        await openOverlay(page, 'full'); // the owner has seen the current text
        const theirs = await signedIn(browser, 'desktop', 'coBuyer');
        await openOverlay(theirs, 'full');
        // The co-buyer adds a Con and changes a garage fact, and saves.
        await theirs.locator('#hf-cons').click();
        await theirs.keyboard.press('ControlOrMeta+End');
        await theirs.keyboard.type('\nBusy road nearby');
        await theirs.locator('#hf-garageType').selectOption('detached');
        await saved(theirs, () => { const r = dbRow(id); return r.garage_type === 'detached' && r.cons.endsWith('Busy road nearby'); }, 'co-buyer');
        assert(dbRow(id).cons === 'Only one full bath\nBusy road nearby', 'co-buyer saved');
        // The owner, still on the older text, edits Cons and an unrelated fact.
        await page.locator('#hf-cons').click();
        await page.keyboard.press('ControlOrMeta+End');
        await page.keyboard.type('\nSmall primary bedroom');
        await page.locator('#hf-basementStyle').selectOption('traditional');
        const banner = page.locator('.flh-notes-conflict');
        await banner.waitFor({ timeout: 15000 });
        assert((await banner.textContent()).includes('Busy road nearby'), 'banner shows their text');
        assert((await page.locator('.flh-overlay-save').textContent()).includes('choose a version'), 'header asks for a choice, not a retry');
        let row = dbRow(id);
        assert(row.cons === 'Only one full bath\nBusy road nearby', `overwritten! ${row.cons}`);
        assert(row.garage_type === 'detached' && row.basement_style === 'traditional', `unrelated facts ${JSON.stringify(row)}`);
        await page.locator('.flh-overlay').screenshot({ path: join(outDir, 'desktop-conflict.png'), style: hideChrome });
        await banner.getByRole('button', { name: 'Keep mine' }).click();
        await saved(page, () => dbRow(id).cons.endsWith('Small primary bedroom'), 'keep mine');
        assert(dbRow(id).cons === 'Only one full bath\nSmall primary bedroom', `Keep mine ${dbRow(id).cons}`);
        // Now the co-buyer is the stale one: Use theirs takes the owner's text.
        await theirs.locator('#hf-cons').click();
        await theirs.keyboard.press('ControlOrMeta+End');
        await theirs.keyboard.type('\nNo garage storage');
        await theirs.locator('#hf-notes').click();
        const theirBanner = theirs.locator('.flh-notes-conflict');
        await theirBanner.waitFor({ timeout: 15000 });
        await theirBanner.getByRole('button', { name: 'Use theirs' }).click();
        await saved(theirs);
        await theirBanner.waitFor({ state: 'detached' });
        assert((await theirs.locator('#hf-cons').inputValue()) === 'Only one full bath\nSmall primary bedroom', 'Use theirs shows their text');
        row = dbRow(id);
        assert(row.cons === 'Only one full bath\nSmall primary bedroom' && row.garage_type === 'detached', `after Use theirs ${JSON.stringify(row)}`);
        homeOf('full').cons = row.cons;
        assert(!page.errors.length && !theirs.errors.length, [...page.errors, ...theirs.errors].join(' | '));
        await theirs.context().close();
      });

      await step('[desktop] a failed save keeps the text, marks the field and Retry saves it', async () => {
        await openOverlay(page, 'full');
        await page.route('**/rest/v1/homes**', (route) => (route.request().method() === 'PATCH' ? route.fulfill({ status: 500, json: { message: 'offline' } }) : route.continue()));
        await page.locator('#hf-notes').click();
        await page.keyboard.press('ControlOrMeta+End');
        await page.keyboard.type('\nAsk about the roof');
        await page.locator('#hf-pros').click();
        await page.locator('.flh-overlay-save.is-error').waitFor({ timeout: 15000 });
        assert((await page.locator('#hf-notes').getAttribute('aria-invalid')) === 'true', 'field marked');
        assert((await page.locator('#hf-notes').inputValue()).endsWith('Ask about the roof'), 'text kept');
        await page.unroute('**/rest/v1/homes**');
        await page.locator('.flh-overlay-save.is-error button').click();
        await saved(page, () => dbRow(homeOf('full').id).notes.endsWith('Ask about the roof'), 'retry');
        assert(dbRow(homeOf('full').id).notes.endsWith('Ask about the roof'), 'retried save');
        homeOf('full').notes = dbRow(homeOf('full').id).notes;
        page.errors = page.errors.filter((text) => !/500|offline/.test(text));
        assert(!page.errors.length, page.errors.join(' | '));
      });

      await step('[desktop] Tour Feedback\'s notes editor and Home Facts stay in step', async () => {
        await page.getByRole('button', { name: /Tour feedback & notes/ }).click();
        await page.getByRole('button', { name: /Edit\s*notes/ }).first().click();
        await page.getByLabel(/What you loved/).fill('Great backyard');
        await page.getByRole('button', { name: 'Save notes' }).click();
        await page.getByRole('button', { name: 'Save notes' }).waitFor({ state: 'detached' });
        await page.getByRole('button', { name: 'Home details' }).click();
        assert((await page.locator('#hf-pros').inputValue()) === 'Great backyard', 'Home Facts shows the Tour Feedback edit');
        await until(() => dbRow(homeOf('full').id).pros === 'Great backyard', `saved once, same field (db ${JSON.stringify(dbRow(homeOf('full').id).pros)}, conflict banner ${await page.locator('.flh-notes-conflict').count()}, save state ${await page.locator('.flh-overlay-save').textContent()})`, 5000);
        homeOf('full').pros = 'Great backyard';
        assert(!page.errors.length, page.errors.join(' | '));
      });
    }
    if (!captureOnly && device === 'iphone') {
      await step('[iphone] edit Cons inline (16px, no zoom), saved, card updated; close commits typed text', async () => {
        await openOverlay(page, 'full');
        const cons = page.locator('#hf-cons');
        await cons.scrollIntoViewIfNeeded();
        assert((await cons.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))) >= 16, 'textarea font ≥16px');
        await cons.tap();
        await page.keyboard.press('ControlOrMeta+End');
        await page.keyboard.type('\nNo dishwasher');
        await page.locator('.flh-hf2-column-side').screenshot({ path: join(outDir, 'iphone-notes-editing.png'), style: hideChrome });
        await closeOverlay(page); // Close commits the typed text and waits for it
        assert(dbRow(homeOf('full').id).cons.endsWith('No dishwasher'), 'saved on close');
        const labels = await cardLabels(page, homeOf('full').street);
        assert(labels.includes(`Cons (${dbRow(homeOf('full').id).cons.split('\n').length})`), `card ${labels}`);
        assert(!page.errors.length, page.errors.join(' | '));
      });
    }
    await page.context().close();
  }
  await browser.close();
  writeFileSync(join(outDir, 'results.json'), JSON.stringify({ captureOnly, layout: report, log }, null, 2));
  const failed = log.filter((entry) => !entry.ok);
  console.log(`${log.length - failed.length}/${log.length} steps passed`);
  if (failed.length) process.exitCode = 1;
}

await main();
