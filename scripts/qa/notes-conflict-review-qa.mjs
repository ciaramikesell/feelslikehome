#!/usr/bin/env node
// Focused browser review of the shared Notes / Pros / Cons conflict handling
// (#172). DEVELOPMENT ONLY — runs against the local stand-in, two signed-in
// participants (owner + co-buyer) on the same home.
//
//   1. FLH_TEST_PGHOST=… FLH_TEST_PGPORT=… node scripts/qa/supabase-standin.mjs 54321 > standin.json
//   2. NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=qa npx next dev -p 3200
//   3. FLH_TEST_PGHOST=… FLH_TEST_PGPORT=… node scripts/qa/notes-conflict-review-qa.mjs standin.json <outDir> [baseUrl]
//
// Every PATCH the owner's browser sends to /rest/v1/homes is recorded, so
// "an older write never lands" is checked on the wire, not only on screen.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';

const [infoPath, outArg, base = 'http://localhost:3200'] = process.argv.slice(2);
if (!infoPath || !outArg) throw new Error('Usage: notes-conflict-review-qa.mjs <standin.json> <outDir> [baseUrl]');
const info = JSON.parse(readFileSync(infoPath, 'utf8').split('\n')[0]);
const outDir = resolve(outArg);
mkdirSync(outDir, { recursive: true });
const IGNORED_CONSOLE = /Download the React DevTools|favicon|maps\.googleapis|Google Maps|places|Failed to load resource/i;
const pg = ['-X', '-q', '-A', '-t', '-h', process.env.FLH_TEST_PGHOST, '-p', process.env.FLH_TEST_PGPORT || '5432', '-U', 'postgres', '-d', info.database];
const sql = (statement) => {
  const result = spawnSync('psql', [...pg, '-v', 'ON_ERROR_STOP=1', '-c', statement], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
};
const lit = (value) => `'${String(value).replace(/'/g, "''")}'`;
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const owner = info.users.owner.id;
const coBuyer = info.users.coBuyer.id;
let homeId;
const row = () => JSON.parse(sql(`select row_to_json(t) from (select notes, pros, cons, garage_type, basement_style from public.homes where id = '${homeId}') t`));

function seed(fields = {}) {
  sql(`delete from public.homes where search_id = '${info.search}'`);
  homeId = randomUUID();
  const f = { notes: 'Taxes seem high', pros: 'Great backyard', cons: 'Busy road', ...fields };
  sql(`insert into public.homes (id, user_id, search_id, address, garage_spaces, notes, pros, cons) values ('${homeId}', '${owner}', '${info.search}', '210 Maple Ave, Royal Oak, MI 48073', '2', ${lit(f.notes)}, ${lit(f.pros)}, ${lit(f.cons)})`);
  for (const user of [owner, coBuyer]) sql(`insert into public.home_member_state (home_id, user_id, status, checks) values ('${homeId}', '${user}', 'Saved', '{}'::jsonb) on conflict do nothing`);
}

async function until(check, message, timeout = 15000) {
  const end = Date.now() + timeout;
  for (;;) {
    let ok = false;
    try { ok = await check(); } catch { ok = false; }
    if (ok) return;
    if (Date.now() > end) throw new Error(`timed out: ${message}`);
    await new Promise((r) => setTimeout(r, 120));
  }
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

const log = [];
async function step(name, fn) {
  try { await fn(); log.push({ step: name, ok: true }); console.log('ok  ', name); }
  catch (error) { log.push({ step: name, ok: false, error: error.message }); console.error('FAIL', name, '—', error.message.split('\n')[0]); }
}

let browser;
async function participant(who, { patchDelayMs = 0 } = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addCookies([{ name: 'sb-localhost-auth-token', value: `base64-${Buffer.from(JSON.stringify(info.users[who].session)).toString('base64url')}`, domain: 'localhost', path: '/' }]);
  await context.addInitScript(() => { try { localStorage.setItem('flh-mobile-tour-dismissed', '1'); localStorage.setItem('flh-name-prompt-dismissed', '1'); } catch { /* ignore */ } });
  await context.route('**/api/commute', (route) => route.fulfill({ json: { results: {} } }));
  const page = await context.newPage();
  page.patches = [];
  page.patchDelayMs = patchDelayMs;
  await page.route('**/rest/v1/homes**', async (route) => {
    const request = route.request();
    if (request.method() === 'PATCH') {
      page.patches.push({ at: Date.now(), body: request.postDataJSON() });
      if (page.patchDelayMs) await pause(page.patchDelayMs);
    }
    await route.continue();
  });
  page.errors = [];
  page.on('pageerror', (error) => page.errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error' && !IGNORED_CONSOLE.test(message.text())) page.errors.push(message.text()); });
  return page;
}
async function open(page, section = '') {
  await page.goto(`${base}/homes/${homeId}${section}`, { waitUntil: 'networkidle' });
  await page.locator('.flh-overlay').waitFor();
}
async function typeAtEnd(page, selector, text) {
  await page.locator(selector).click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type(text);
}
const banner = (page) => page.locator('.flh-notes-conflict');
const notesPatchesSince = (page, since, field) => page.patches.filter((p) => p.at >= since && field in p.body);
const noErrors = (page) => assert(!page.errors.length, page.errors.join(' | '));

async function main() {
  browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {});

  await step('1. rapid consecutive edits to one field, with slow overlapping writes: no conflict, the last text wins', async () => {
    seed();
    const me = await participant('owner', { patchDelayMs: 700 });
    await open(me);
    await typeAtEnd(me, '#hf-pros', '\nUpdated kitchen');
    await pause(1000); // debounce commit #1 → write in flight (700ms)
    await me.keyboard.type('\nQuiet street');
    await pause(1000); // commit #2 queued behind #1
    await me.keyboard.type('\nBig trees');
    await me.locator('#hf-cons').click(); // blur commit #3
    const want = 'Great backyard\nUpdated kitchen\nQuiet street\nBig trees';
    await until(() => row().pros === want, `pros = ${JSON.stringify(row().pros)}`);
    await pause(1500);
    assert(row().pros === want, `later edit lost: ${JSON.stringify(row().pros)}`);
    assert(!(await banner(me).count()), 'false conflict on own rapid edits');
    assert((await me.locator('#hf-pros').inputValue()) === want, 'screen text');
    console.log(`     pros writes sent: ${me.patches.filter((p) => 'pros' in p.body).length}`);
    noErrors(me);
    await me.context().close();
  });

  await step('2. a co-buyer editing unrelated facts (in between, and mid-write) causes no Notes conflict', async () => {
    seed();
    const me = await participant('owner', { patchDelayMs: 400 });
    const them = await participant('coBuyer');
    await open(me);
    await open(them);
    await them.locator('#hf-garageType').selectOption('detached');
    await until(() => row().garage_type === 'detached', 'co-buyer garage');
    await typeAtEnd(me, '#hf-notes', '\nAsk about HOA');
    await me.locator('#hf-cons').click();
    // While the owner's write is held (400ms), the co-buyer changes another fact.
    await pause(150);
    await them.locator('#hf-basementStyle').selectOption('walkout');
    await until(() => row().notes === 'Taxes seem high\nAsk about HOA', `notes ${JSON.stringify(row().notes)}`);
    await until(() => row().basement_style === 'walkout', 'co-buyer basement');
    const r = row();
    assert(r.garage_type === 'detached' && r.basement_style === 'walkout', `unrelated facts ${JSON.stringify(r)}`);
    assert(!(await banner(me).count()), 'false conflict from an unrelated fact');
    noErrors(me); noErrors(them);
    await me.context().close(); await them.context().close();
  });

  await step('3 + 4. same field from two buyers: genuine conflict, neither overwritten; Keep mine saves the on-screen text and clears the failure', async () => {
    seed();
    const me = await participant('owner');
    const them = await participant('coBuyer');
    await open(me);
    await open(them);
    await typeAtEnd(them, '#hf-notes', '\nTheir line');
    await them.locator('#hf-pros').click();
    await until(() => row().notes === 'Taxes seem high\nTheir line', 'co-buyer notes');
    await typeAtEnd(me, '#hf-notes', '\nMy line');
    await me.locator('#hf-pros').click();
    await banner(me).waitFor({ timeout: 15000 });
    await pause(800);
    assert(row().notes === 'Taxes seem high\nTheir line', `their text overwritten: ${JSON.stringify(row().notes)}`);
    assert((await me.locator('#hf-notes').inputValue()) === 'Taxes seem high\nMy line', 'my text kept on screen');
    assert((await me.locator('#hf-notes').getAttribute('aria-invalid')) === 'true', 'field marked failed');
    await banner(me).getByRole('button', { name: 'Keep mine' }).click();
    await until(() => row().notes === 'Taxes seem high\nMy line', `Keep mine wrote ${JSON.stringify(row().notes)}`);
    await until(async () => (await me.locator('#hf-notes').getAttribute('aria-invalid')) === null, 'failure cleared on the field');
    await until(async () => (await me.locator('.flh-overlay-save').textContent()).includes('Saved'), 'save state back to Saved');
    assert(!(await banner(me).count()), 'banner gone');
    // Nothing left failed: Close goes straight through.
    await me.locator('.flh-overlay-close').click();
    await me.locator('.flh-overlay').waitFor({ state: 'detached', timeout: 15000 });
    noErrors(me); noErrors(them);
    await me.context().close(); await them.context().close();
  });

  await step('5a. Use theirs (Home Facts) keeps their text; no older local write is sent afterwards', async () => {
    seed();
    const me = await participant('owner');
    const them = await participant('coBuyer');
    await open(me);
    await open(them);
    await typeAtEnd(them, '#hf-cons', '\nTheir con');
    await them.locator('#hf-pros').click();
    await until(() => row().cons === 'Busy road\nTheir con', 'co-buyer cons');
    await typeAtEnd(me, '#hf-cons', '\nMy con');
    await me.locator('#hf-pros').click();
    await banner(me).waitFor({ timeout: 15000 });
    // Keep typing in the field after the conflict, then choose Use theirs.
    await typeAtEnd(me, '#hf-cons', ' (more)');
    const clickedAt = Date.now();
    await banner(me).getByRole('button', { name: 'Use theirs' }).click();
    await until(async () => !(await banner(me).count()), 'banner cleared');
    await pause(2500);
    assert(row().cons === 'Busy road\nTheir con', `their text replaced: ${JSON.stringify(row().cons)}`);
    assert((await me.locator('#hf-cons').inputValue()) === 'Busy road\nTheir con', 'screen shows theirs');
    const stale = notesPatchesSince(me, clickedAt, 'cons').filter((p) => p.body.cons !== 'Busy road\nTheir con');
    assert(!stale.length, `older local write sent after Use theirs: ${JSON.stringify(stale.map((p) => p.body.cons))}`);
    assert(!(await banner(me).count()), 'banner came back');
    noErrors(me); noErrors(them);
    await me.context().close(); await them.context().close();
  });

  await step('5b. Use theirs from Tour Feedback\'s editor: their text kept; the editor holds no stale draft a later Save could push', async () => {
    seed();
    const me = await participant('owner');
    const them = await participant('coBuyer');
    await open(me, '?section=tour');
    await me.getByRole('button', { name: /Edit\s*notes/ }).first().click();
    await me.getByLabel(/What you loved/).fill('Great backyard\nMy tour pro');
    await open(them);
    await typeAtEnd(them, '#hf-pros', '\nTheir pro');
    await them.locator('#hf-cons').click();
    await until(() => row().pros === 'Great backyard\nTheir pro', 'co-buyer pros');
    await me.getByRole('button', { name: 'Save notes' }).click();
    await banner(me).waitFor({ timeout: 15000 });
    assert(row().pros === 'Great backyard\nTheir pro', 'overwritten on Save');
    await me.locator('.flh-overlay').screenshot({ path: join(outDir, 'tour-conflict.png') });
    const clickedAt = Date.now();
    await banner(me).getByRole('button', { name: 'Use theirs' }).click();
    await until(async () => !(await banner(me).count()), 'banner cleared');
    await until(() => row().pros === 'Great backyard\nTheir pro', 'theirs kept');
    // The editor starts over from the saved text (it may close); if a Save is
    // still offered, it must not bring the older text back.
    const save = me.getByRole('button', { name: 'Save notes' });
    if (await save.count()) {
      const shown = await me.getByLabel(/What you loved/).inputValue();
      await save.click();
      await pause(2000);
      assert(row().pros === 'Great backyard\nTheir pro', `stale Tour draft (${JSON.stringify(shown)}) saved over theirs: ${JSON.stringify(row().pros)}`);
    }
    const stale = notesPatchesSince(me, clickedAt, 'pros').filter((p) => p.body.pros !== 'Great backyard\nTheir pro');
    assert(!stale.length, `older local write sent after Use theirs: ${JSON.stringify(stale.map((p) => p.body.pros))}`);
    await me.locator('.flh-overlay').screenshot({ path: join(outDir, 'tour-after-use-theirs.png') });
    noErrors(me); noErrors(them);
    await me.context().close(); await them.context().close();
  });

  await step('6. Home Facts and Tour Feedback in one session: no stale drafts, no self-conflict', async () => {
    seed();
    const me = await participant('owner');
    await open(me);
    // Typed in Home Facts, not yet saved; switching views commits it.
    await typeAtEnd(me, '#hf-notes', '\nFrom Home Facts');
    await me.getByRole('button', { name: /Tour feedback & notes/ }).click();
    await until(() => row().notes === 'Taxes seem high\nFrom Home Facts', `notes ${JSON.stringify(row().notes)}`);
    await me.getByRole('button', { name: /Edit\s*notes/ }).first().click();
    assert((await me.locator('.flh-tour-notes-form label.wide textarea').inputValue()) === 'Taxes seem high\nFrom Home Facts', 'Tour editor starts from the saved Home Facts text');
    await me.getByLabel(/What gave you pause/).fill('Busy road\nFrom Tour');
    await me.getByRole('button', { name: 'Save notes' }).click();
    await me.getByRole('button', { name: 'Save notes' }).waitFor({ state: 'detached' });
    await me.getByRole('button', { name: 'Home details' }).click();
    assert((await me.locator('#hf-cons').inputValue()) === 'Busy road\nFrom Tour', 'Home Facts shows the Tour edit');
    await typeAtEnd(me, '#hf-cons', '\nBack in Home Facts');
    await me.locator('#hf-pros').click();
    await until(() => row().cons === 'Busy road\nFrom Tour\nBack in Home Facts', `cons ${JSON.stringify(row().cons)}`);
    const r = row();
    assert(r.notes === 'Taxes seem high\nFrom Home Facts' && r.pros === 'Great backyard', `other fields ${JSON.stringify(r)}`);
    assert(!(await banner(me).count()), 'self-conflict between the two editors');
    noErrors(me);
    await me.context().close();
  });

  await step('7a. Close during a pending (slow) save waits for it; nothing typed is lost', async () => {
    seed();
    const me = await participant('owner', { patchDelayMs: 1500 });
    await open(me);
    await typeAtEnd(me, '#hf-pros', '\nTyped then closed');
    await me.locator('.flh-overlay-close').click(); // no blur, no pause: Close commits the draft
    await me.locator('.flh-overlay').waitFor({ state: 'detached', timeout: 20000 });
    assert(row().pros === 'Great backyard\nTyped then closed', `lost on close: ${JSON.stringify(row().pros)}`);
    noErrors(me);
    await me.context().close();
  });

  await step('7b. Close or Escape during a conflict keeps the overlay open with the text; after a choice, Close works', async () => {
    seed();
    const me = await participant('owner');
    const them = await participant('coBuyer');
    await open(me);
    await open(them);
    await typeAtEnd(them, '#hf-pros', '\nTheirs');
    await them.locator('#hf-cons').click();
    await until(() => row().pros === 'Great backyard\nTheirs', 'co-buyer pros');
    await typeAtEnd(me, '#hf-pros', '\nMine, closing');
    await me.locator('.flh-overlay-close').click();
    await banner(me).waitFor({ timeout: 15000 });
    await pause(800);
    assert(await me.locator('.flh-overlay').count(), 'overlay closed during a conflict');
    await me.keyboard.press('Escape');
    await pause(800);
    assert(await me.locator('.flh-overlay').count(), 'Escape closed it during a conflict');
    assert((await me.locator('#hf-pros').inputValue()) === 'Great backyard\nMine, closing', 'text still on screen');
    assert(row().pros === 'Great backyard\nTheirs', 'their text kept');
    await banner(me).getByRole('button', { name: 'Keep mine' }).click();
    await until(() => row().pros === 'Great backyard\nMine, closing', 'Keep mine saved');
    await me.locator('.flh-overlay-close').click();
    await me.locator('.flh-overlay').waitFor({ state: 'detached', timeout: 15000 });
    noErrors(me); noErrors(them);
    await me.context().close(); await them.context().close();
  });

  await browser.close();
  writeFileSync(join(outDir, 'review-results.json'), JSON.stringify(log, null, 2));
  const failed = log.filter((entry) => !entry.ok);
  console.log(`${log.length - failed.length}/${log.length} checks passed`);
  if (failed.length) process.exitCode = 1;
}

await main();
