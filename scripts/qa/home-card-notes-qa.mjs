#!/usr/bin/env node
// Browser QA for the Home Card Notes / Pros / Cons previews and the calmer
// property-facts rows. DEVELOPMENT ONLY — runs against the local stand-in.
//
//   1. FLH_TEST_PGHOST=… FLH_TEST_PGPORT=… node scripts/qa/supabase-standin.mjs 54321 > standin.json
//   2. NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=qa npx next dev -p 3200
//   3. FLH_TEST_PGHOST=… FLH_TEST_PGPORT=… node scripts/qa/home-card-notes-qa.mjs standin.json <outDir> [baseUrl]
//
// Seeds four homes (all three groups; only a long Cons list; a legacy
// one-line comma pro; nothing written) and one commute place. At 1440 and on
// an iPhone it checks: counts render below Commute and above the actions,
// only for written groups; desktop hover / click-to-pin; touch tap / tap
// outside; keyboard Tab / Enter / Escape; popovers stay inside the card; no
// horizontal overflow; no console errors. Then adds a home with notes from
// the Add Home card and edits Pros in Tour Feedback, checking the card.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { chromium, devices } from 'playwright';

const [infoPath, outArg, base = 'http://localhost:3200'] = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
if (!infoPath || !outArg) throw new Error('Usage: home-card-notes-qa.mjs <standin.json> <outDir> [baseUrl]');
const info = JSON.parse(readFileSync(infoPath, 'utf8').split('\n')[0]);
const outDir = resolve(outArg);
mkdirSync(outDir, { recursive: true });
const IGNORED_CONSOLE = /Download the React DevTools|favicon|maps\.googleapis|Google Maps|places|Failed to load resource/i;
const pg = ['-X', '-q', '-A', '-t', '-h', process.env.FLH_TEST_PGHOST, '-p', process.env.FLH_TEST_PGPORT || '5432', '-U', 'postgres', '-d', info.database];
function exec(sql) {
  const result = spawnSync('psql', [...pg, '-v', 'ON_ERROR_STOP=1', '-c', sql], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
}
const lit = (value) => (value === null || value === undefined ? 'null' : `'${String(value).replace(/'/g, "''")}'`);
const arr = (values) => `array[${values.map(lit).join(',')}]::text[]`;
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const owner = info.users.owner.id;

const HOMES = [
  { street: '210 Maple Ave', price: '439000', beds: '4', baths: '2.5', sqft: '2140', garage: '2', condition: 'finished', style: 'traditional', layout: ['Two Story'], homeCondition: ['Move-In Ready'], school: 'Royal Oak',
    notes: 'Seller offering $5k toward closing costs\nOccupancy after closing required\nTaxes seem high', pros: 'Great backyard\nUpdated kitchen\nQuiet street', cons: 'Small primary bedroom\nOnly one full bath\nBusy road nearby',
    expect: ['Notes (3)', 'Pros (3)', 'Cons (3)'] },
  { street: '4471 Long Description Blvd', price: '612500', beds: '5', baths: '3.5', sqft: '3480', garage: '3+', condition: 'partially_finished', style: 'walkout', layout: ['Split Level', 'Colonial'], homeCondition: ['Needs Cosmetic Updates'],
    school: 'Bloomfield Hills Schools — Lahser High School attendance area (verify boundaries with the district)', notes: '', pros: '',
    cons: '- The primary bathroom has not been updated since the original 1987 construction and would need a full gut renovation\n- Shared driveway with the neighbor to the north (easement recorded)\n- Backs onto a busy road\n- Roof is 20 years old\n- Basement had water in 2019\n- HOA requires approval for fences\n- No garage storage\n- Small kitchen pantry',
    expect: ['Cons (8)'] },
  { street: '9 Legacy Ct', price: '389900', beds: '3', baths: '1', sqft: '1210', garage: '0', condition: 'none', style: 'none', layout: ['Ranch'], homeCondition: [], school: 'Troy',
    notes: '', pros: 'Bright, open living room, Huge backyard', cons: '', expect: ['Pros (1)'] },
  { street: '77 Short St', price: '359000', beds: '3', baths: '2', sqft: '1500', garage: '1', condition: null, style: null, layout: [], homeCondition: [], school: null, notes: '', pros: '', cons: '', expect: [] },
];

function seed() {
  exec(`delete from public.homes where search_id = '${info.search}'`);
  exec(`delete from public.commute_destinations where search_id = '${info.search}'`);
  exec(`insert into public.commute_destinations (search_id, user_id, label, address) values ('${info.search}', '${owner}', 'Work', '100 Renaissance Center, Detroit, MI')`);
  HOMES.forEach((home, index) => {
    home.id = randomUUID();
    exec(`insert into public.homes (id, user_id, search_id, address, price, beds, baths, sqft, garage_spaces, basement_condition, basement_style, home_layout, home_condition, school_district_name, notes, pros, cons, created_at)
      values ('${home.id}', '${owner}', '${info.search}', ${lit(`${home.street}, Royal Oak, MI 48073`)}, ${lit(home.price)}, ${lit(home.beds)}, ${lit(home.baths)}, ${lit(home.sqft)}, ${lit(home.garage)},
        ${lit(home.condition)}, ${lit(home.style)}, ${arr(home.layout)}, ${arr(home.homeCondition)}, ${lit(home.school)}, ${lit(home.notes)}, ${lit(home.pros)}, ${lit(home.cons)}, now() - interval '${index} minutes')`);
    exec(`insert into public.home_member_state (home_id, user_id, status, checks) values ('${home.id}', '${owner}', 'Saved', '{}'::jsonb)
      on conflict (home_id, user_id) do update set status = excluded.status`);
  });
}

const log = [];
async function step(name, fn) {
  const started = Date.now();
  try { await fn(); log.push({ step: name, ok: true, ms: Date.now() - started }); console.log('ok  ', name); }
  catch (error) { log.push({ step: name, ok: false, error: error.message }); console.error('FAIL', name, '—', error.message); }
}
const VIEWPORTS = {
  desktop: { viewport: { width: 1440, height: 900 } },
  iphone: devices['iPhone 13'],
};
async function signedIn(browser, device) {
  const context = await browser.newContext(VIEWPORTS[device]);
  await context.addCookies([{ name: 'sb-localhost-auth-token', value: `base64-${Buffer.from(JSON.stringify(info.users.owner.session)).toString('base64url')}`, domain: 'localhost', path: '/' }]);
  await context.addInitScript(() => { try { localStorage.setItem('flh-mobile-tour-dismissed', '1'); localStorage.setItem('flh-name-prompt-dismissed', '1'); localStorage.setItem('flh-install-dismissed', '1'); } catch { /* ignore */ } });
  await context.route('**/api/commute', (route) => route.fulfill({ json: { results: {} } }));
  await context.route('**/api/import-listing**', (route) => route.fulfill({ status: 404, json: { error: 'not_found' } }));
  const page = await context.newPage();
  page.errors = [];
  page.on('pageerror', (error) => page.errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error' && !IGNORED_CONSOLE.test(message.text())) page.errors.push(message.text()); });
  return page;
}
const cardFor = (page, street) => page.locator('article.hh-home-card').filter({ has: page.getByRole('heading', { name: street }) });
const hideChrome = '.beta-feedback-tab, nextjs-portal { visibility: hidden !important; }';
const triggers = (card) => card.locator('.hh-note-preview-trigger');
const labelsOf = async (card) => (await triggers(card).allTextContents()).map((text) => text.replace(', preview', '').trim());

async function insideCard(card, selector) {
  return card.evaluate((el, sel) => {
    const box = el.getBoundingClientRect();
    const node = el.querySelector(sel);
    const r = node.getBoundingClientRect();
    return r.left >= box.left - 0.5 && r.right <= box.right + 0.5;
  }, selector);
}
async function noPageOverflow(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert(overflow <= 0, `horizontal overflow ${overflow}px`);
}

async function main() {
  seed();
  // --seed-only: seed the four homes and stop (used to capture "before" shots from main).
  if (process.argv.includes('--seed-only')) return;
  const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {});
  for (const device of ['desktop', 'iphone']) {
    const page = await signedIn(browser, device);

    await step(`[${device}] counts only for written groups, below Commute and above the actions; calm fact rows; no overflow`, async () => {
      await page.goto(`${base}/homes`, { waitUntil: 'networkidle' });
      await cardFor(page, HOMES[0].street).waitFor();
      await page.evaluate(() => document.fonts.ready);
      for (const home of HOMES) {
        const card = cardFor(page, home.street);
        const labels = await labelsOf(card);
        assert(JSON.stringify(labels) === JSON.stringify(home.expect), `${home.street}: ${JSON.stringify(labels)}`);
        if (labels.length) {
          const order = await card.evaluate((el) => {
            const y = (sel) => el.querySelector(sel)?.getBoundingClientRect().top;
            return { commute: y('.hh-card-commute'), notes: y('.hh-note-previews'), actions: y('.hh-home-card-actions') };
          });
          assert(order.commute < order.notes && order.notes < order.actions, `${home.street}: order ${JSON.stringify(order)}`);
          assert(await insideCard(card, '.hh-note-previews'), `${home.street}: counts row overflows`);
        }
        // Facts: label beside value (same row), labels not uppercase.
        const fact = await card.locator('.hh-property-fact').first().evaluate((row) => {
          const dt = row.querySelector('dt').getBoundingClientRect(); const dd = row.querySelector('dd').getBoundingClientRect();
          return { sameRow: Math.abs(dt.top - dd.top) < 4 && dd.left > dt.right, transform: getComputedStyle(row.querySelector('dt')).textTransform };
        }).catch(() => null);
        if (fact) assert(fact.sameRow && fact.transform === 'none', `${home.street}: facts ${JSON.stringify(fact)}`);
      }
      if (device === 'desktop') await page.locator('.hh-homes-grid').screenshot({ path: join(outDir, 'desktop-1440-cards.png'), style: hideChrome });
      else for (const [index, home] of HOMES.entries()) await cardFor(page, home.street).screenshot({ path: join(outDir, `iphone-card-${index + 1}.png`), style: hideChrome });
      await noPageOverflow(page);
      assert(!page.errors.length, page.errors.join(' | '));
    });

    if (device === 'desktop') {
      await step('[desktop] hover previews without a click; moving into the preview keeps it; leaving closes it; click pins', async () => {
        const card = cardFor(page, HOMES[0].street);
        const pros = triggers(card).nth(1);
        await card.scrollIntoViewIfNeeded();
        await pros.hover();
        const popover = card.locator('.hh-note-popover');
        await popover.waitFor();
        assert(await popover.locator('li').count() === 3, 'Pros list length');
        assert((await popover.locator('li').allTextContents()).join('|').includes('Updated kitchen'), 'Pros text');
        assert(await pros.getAttribute('aria-expanded') === 'true', 'aria-expanded');
        assert(await insideCard(card, '.hh-note-popover'), 'popover inside card');
        await card.screenshot({ path: join(outDir, 'desktop-hover-pros.png'), style: hideChrome });
        await popover.hover();
        assert(await popover.isVisible(), 'closed while moving into the preview');
        await page.mouse.move(5, 5);
        await popover.waitFor({ state: 'detached' });
        // Hover another, then click to pin; leaving keeps it; a second click closes.
        await triggers(card).nth(2).hover();
        assert((await card.locator('.hh-note-popover strong').textContent()) === 'Cons', 'hover switches to Cons');
        await triggers(card).nth(2).click();
        await page.mouse.move(5, 5);
        await page.waitForTimeout(150);
        assert(await card.locator('.hh-note-popover').isVisible(), 'pinned preview closed on leave');
        await triggers(card).nth(2).click();
        await card.locator('.hh-note-popover').waitFor({ state: 'detached' });
        // Long list: bounded and scrollable inside the card.
        const long = cardFor(page, HOMES[1].street);
        await triggers(long).first().hover();
        await long.locator('.hh-note-popover').waitFor();
        assert(await insideCard(long, '.hh-note-popover'), 'long popover inside card');
        const scroll = await long.locator('.hh-note-popover').evaluate((el) => el.scrollHeight > el.clientHeight);
        console.log(`     long Cons preview scrolls: ${scroll}`);
        await long.screenshot({ path: join(outDir, 'desktop-hover-long-cons.png'), style: hideChrome });
        await page.mouse.move(5, 5);
        await noPageOverflow(page);
        assert(!page.errors.length, page.errors.join(' | '));
      });

      await step('[desktop] keyboard: Tab shows the preview with a visible focus ring; Enter pins; Escape closes and keeps focus; link reachable', async () => {
        const card = cardFor(page, HOMES[0].street);
        await card.locator('.hh-card-commute').evaluate((el) => { el.setAttribute('tabindex', '-1'); el.focus(); });
        await page.keyboard.press('Tab');
        const notes = triggers(card).first();
        assert(await notes.evaluate((el) => el === document.activeElement), 'Tab did not reach Notes');
        const outline = await notes.evaluate((el) => { const s = getComputedStyle(el); return { style: s.outlineStyle, width: parseFloat(s.outlineWidth) }; });
        assert(outline.style !== 'none' && outline.width >= 2, `focus outline ${JSON.stringify(outline)}`);
        const popover = card.locator('.hh-note-popover');
        await popover.waitFor();
        assert((await popover.locator('strong').textContent()) === 'Notes', 'focus previews Notes');
        await card.screenshot({ path: join(outDir, 'desktop-keyboard-notes.png'), style: hideChrome });
        await page.keyboard.press('Escape');
        await popover.waitFor({ state: 'detached' });
        assert(await notes.evaluate((el) => el === document.activeElement), 'focus lost after Escape');
        await page.keyboard.press('Enter');
        await popover.waitFor();
        await page.keyboard.press('Tab');
        assert(await page.evaluate(() => document.activeElement?.textContent) === 'View or edit notes', 'Tab into the preview link');
        await page.keyboard.press('Tab');
        assert(await triggers(card).nth(1).evaluate((el) => el === document.activeElement), 'Tab on to Pros');
        assert((await card.locator('.hh-note-popover strong').textContent()) === 'Pros', 'Pros previews on focus');
        await page.keyboard.press('Escape');
        assert(!page.errors.length, page.errors.join(' | '));
      });
    } else {
      await step('[iphone] tap opens the preview, tap again closes, tap outside closes; 44px targets', async () => {
        const card = cardFor(page, HOMES[0].street);
        await card.locator('.hh-note-previews').scrollIntoViewIfNeeded();
        const cons = triggers(card).nth(2);
        const height = await cons.evaluate((el) => el.getBoundingClientRect().height);
        assert(height >= 44, `tap target ${height}px`);
        await cons.tap();
        const popover = card.locator('.hh-note-popover');
        await popover.waitFor();
        assert((await popover.locator('strong').textContent()) === 'Cons', 'tap opens Cons');
        assert(await insideCard(card, '.hh-note-popover'), 'popover inside card');
        await card.screenshot({ path: join(outDir, 'iphone-tap-cons.png'), style: hideChrome });
        await cons.tap();
        await popover.waitFor({ state: 'detached' });
        await triggers(card).first().tap();
        await popover.waitFor();
        await triggers(card).nth(1).tap();
        assert((await card.locator('.hh-note-popover strong').textContent()) === 'Pros', 'tap switches to Pros');
        await card.locator('.hh-card-pricing').tap();
        await popover.waitFor({ state: 'detached' });
        // Long list on a phone: inside the card, scrollable.
        const long = cardFor(page, HOMES[1].street);
        await long.locator('.hh-note-previews').scrollIntoViewIfNeeded();
        await triggers(long).first().tap();
        await long.locator('.hh-note-popover').waitFor();
        assert(await insideCard(long, '.hh-note-popover'), 'long popover inside card');
        await long.screenshot({ path: join(outDir, 'iphone-tap-long-cons.png'), style: hideChrome });
        await long.locator('.hh-card-pricing').tap();
        await noPageOverflow(page);
        assert(!page.errors.length, page.errors.join(' | '));
      });

      await step('[iphone] Add Home: optional Notes / Pros / Cons, collapsed; saved with the home and counted on its card', async () => {
        await page.goto(`${base}/homes?add=1`, { waitUntil: 'networkidle' });
        await page.locator('.hh-manual-fallback summary').tap();
        await page.getByRole('button', { name: 'Enter manually' }).tap();
        await page.locator('#found-home-address').fill('500 Added Notes Rd, Royal Oak, MI 48073');
        const details = page.locator('details.flh-found-notes');
        assert(!(await details.evaluate((el) => el.open)), 'notes section should start collapsed');
        await details.locator('summary').tap();
        await page.locator('#add-home-pros').fill('Walk to downtown\nBig garage');
        await page.locator('#add-home-cons').fill('Small yard');
        assert((await page.locator('#add-home-pros-hint').textContent()).startsWith('2'), 'live entry count');
        await page.locator('.flh-found').screenshot({ path: join(outDir, 'iphone-add-home-notes.png'), style: hideChrome });
        await noPageOverflow(page);
        await page.getByRole('button', { name: 'Add to My Homes' }).tap();
        await page.waitForURL(/\/homes\/[^/?]+/, { timeout: 20000 });
        const stored = exec(`select pros || '|' || cons from public.homes where address like '500 Added Notes Rd%'`);
        assert(stored === 'Walk to downtown\nBig garage|Small yard', `stored ${JSON.stringify(stored)}`);
        await page.goto(`${base}/homes`, { waitUntil: 'networkidle' });
        const labels = await labelsOf(cardFor(page, '500 Added Notes Rd'));
        assert(JSON.stringify(labels) === JSON.stringify(['Pros (2)', 'Cons (1)']), `added card ${JSON.stringify(labels)}`);
        assert(!page.errors.length, page.errors.join(' | '));
      });

      await step('[iphone] edit Pros in Tour Feedback ("View or edit notes"): saved and reflected on the card', async () => {
        const card = cardFor(page, HOMES[2].street);
        await card.locator('.hh-note-previews').scrollIntoViewIfNeeded();
        await triggers(card).first().tap();
        await card.getByRole('link', { name: 'View or edit notes' }).tap();
        await page.waitForURL(/section=tour/);
        await page.getByRole('button', { name: /Edit\s*notes/ }).first().tap();
        const pros = page.getByLabel(/What you loved/);
        await pros.fill('Bright, open living room, Huge backyard\nNew roof');
        await page.getByRole('button', { name: 'Save notes' }).tap();
        await page.getByRole('button', { name: 'Save notes' }).waitFor({ state: 'detached' });
        await page.locator('.flh-tour-list.is-loved li').nth(1).waitFor();
        const items = await page.locator('.flh-tour-list.is-loved li').allTextContents();
        assert(items.length === 2 && items[0].includes('Bright, open living room, Huge backyard'), `tour list ${JSON.stringify(items)}`);
        await page.locator('.flh-tour-list.is-loved').screenshot({ path: join(outDir, 'iphone-tour-feedback-pros.png'), style: hideChrome }).catch(() => {});
        await page.goto(`${base}/homes`, { waitUntil: 'networkidle' });
        const labels = await labelsOf(cardFor(page, HOMES[2].street));
        assert(JSON.stringify(labels) === JSON.stringify(['Pros (2)']), `edited card ${JSON.stringify(labels)}`);
        assert(!page.errors.length, page.errors.join(' | '));
      });
    }
    await page.context().close();
  }
  await browser.close();
  writeFileSync(join(outDir, 'results.json'), JSON.stringify({ homes: HOMES.map(({ street, expect }) => ({ street, expect })), log }, null, 2));
  const failed = log.filter((entry) => !entry.ok);
  console.log(`${log.length - failed.length}/${log.length} steps passed`);
  if (failed.length) process.exitCode = 1;
}

await main();
