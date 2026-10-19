#!/usr/bin/env node
// Browser QA for the Floor Plans UI (docs/floor-plans-ui.md). DEVELOPMENT ONLY:
// it runs against the local Supabase stand-in, never a hosted project.
//
//   1. FLH_TEST_PGHOST=… FLH_TEST_PGPORT=… node scripts/qa/supabase-standin.mjs 54321 > standin.json
//   2. NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=qa npx next build
//   3. FLH_FLOOR_PLANS=on npx next start -p 3200      (feature on)
//      npx next start -p 3201                          (same build, feature off)
//   4. node scripts/qa/floor-plans-ui-qa.mjs standin.json <outDir> [onUrl] [offUrl]
//
// Seeds homes into the stand-in's real Postgres, then drives the app as the
// owner, co-buyer and Realtor on iPhone- and iPad-sized touch viewports. The
// stand-in runs the real storage.objects policies, bucket limits and signed-URL
// expiry, so every add / remove is checked against the database rows AND the
// bucket's objects (no leftover upload). Screenshots land in <outDir>; any
// failed step or unexpected console error fails the run.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';

const [infoPath, outArg, base = 'http://localhost:3200', offBase = 'http://localhost:3201'] = process.argv.slice(2);
if (!infoPath || !outArg) throw new Error('Usage: floor-plans-ui-qa.mjs <standin.json> <outDir> [onUrl] [offUrl]');
const info = JSON.parse(readFileSync(infoPath, 'utf8'));
const outDir = resolve(outArg);
mkdirSync(outDir, { recursive: true });
// Expected noise: a deliberately expired / failed signed URL is a failed image
// load, and refused uploads are 4xx responses.
const IGNORED_CONSOLE = /Download the React DevTools|favicon|maps\.googleapis|Google Maps|places|Failed to load resource|bad HTTP response code/i;

const pg = ['-X', '-q', '-A', '-t', '-h', process.env.FLH_TEST_PGHOST, '-p', process.env.FLH_TEST_PGPORT || '5432', '-U', 'postgres', '-d', info.database];
function q(sql) {
  const result = spawnSync('psql', [...pg, '-c', `select coalesce(json_agg(t), '[]'::json) from (${sql}) t`], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr);
  return JSON.parse(result.stdout.trim());
}
function exec(sql) {
  const result = spawnSync('psql', [...pg, '-v', 'ON_ERROR_STOP=1', '-c', sql], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr);
}
const lit = (value) => (value === null ? 'null' : `'${String(value).replace(/'/g, "''")}'`);
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const log = [];
const { owner, coBuyer, realtor } = info.users;

const HOMES = [
  { key: 'linden', address: '412 Linden Ave, Royal Oak, MI 48073', price: '389000', beds: '3', baths: '2', sqft: '1640', photo: true, notes: 'Love the light in the kitchen.', pros: 'Big yard' },
  { key: 'maple', address: '1820 Maple Ridge Dr, Ferndale, MI 48220', price: '342500', beds: '3', baths: '1.5', sqft: '1385', photo: true },
  { key: 'harbor', address: '77 Harbor Point Ct, Grosse Pointe, MI 48236', price: '459900', beds: '4', baths: '2.5', sqft: '2210', photo: false, cons: 'Busy street' },
];
const homeId = (key) => HOMES.find((home) => home.key === key).id;
const PHOTO = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#bcd3e6"/><stop offset="1" stop-color="#f4e7d4"/></linearGradient></defs><rect width="800" height="600" fill="url(#s)"/><rect y="430" width="800" height="170" fill="#8aa06f"/><polygon points="200,260 400,130 600,260" fill="#8b4a36"/><rect x="230" y="260" width="340" height="190" fill="#efe2cf"/><rect x="370" y="340" width="60" height="110" fill="#6b4a3a"/><rect x="265" y="300" width="70" height="60" fill="#9cc1d8"/><rect x="465" y="300" width="70" height="60" fill="#9cc1d8"/></svg>');

function seed() {
  // The revoked-access steps remove the co-buyer and Realtor; every run starts
  // with both connected again (the stand-in's own seed made them members).
  exec(`insert into public.search_members (search_id, user_id, role) values ('${info.search}', '${coBuyer.id}', 'co_buyer'), ('${info.search}', '${realtor.id}', 'realtor') on conflict (search_id, user_id) do nothing`);
  exec(`update public.profiles set active_search_id = '${info.search}' where id = '${coBuyer.id}'`);
  exec(`delete from public.homes where search_id = '${info.search}'`);
  for (const [i, home] of [...HOMES.entries()].reverse()) {
    home.id = randomUUID();
    exec(`insert into public.homes (id, user_id, search_id, address, listing_url, photo_url, price, beds, baths, sqft, notes, pros, cons, created_at)
      values ('${home.id}', '${owner.id}', '${info.search}', ${lit(home.address)}, ${lit(`https://www.zillow.com/homedetails/${home.key}/${i}_zpid/`)}, ${lit(home.photo ? PHOTO : '')}, ${lit(home.price)}, ${lit(home.beds)}, ${lit(home.baths)}, ${lit(home.sqft)}, ${lit(home.notes || '')}, ${lit(home.pros || '')}, ${lit(home.cons || '')}, now() - interval '${i + 1} hours')`);
    exec(`insert into public.home_member_state (home_id, user_id, status) values ('${home.id}', '${owner.id}', 'Saved')`);
  }
}
const rows = (key) => q(`select id, storage_path from public.home_floor_plans where home_id = '${homeId(key)}' order by created_at, id`);
const objects = (key) => q(`select name from storage.objects where bucket_id = 'home-floor-plans' and name like '${homeId(key)}/%' order by name`).map((row) => row.name);
function assertConsistent(key, expected) {
  const r = rows(key);
  const o = objects(key);
  assert(r.length === expected, `${key}: expected ${expected} plan rows, found ${r.length}`);
  assert(o.length === expected, `${key}: expected ${expected} objects (no leftover upload), found ${o.length}: ${o.join(', ')}`);
  assert(r.every((row) => o.includes(row.storage_path)), `${key}: a row points at a missing object`);
}
const qaSwitch = (body) => fetch(`${info.url}/__qa/floor-plans`, { method: 'POST', body: JSON.stringify(body) }).then((res) => res.json());
const apiAs = (user) => createClient(info.url, 'qa', { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${user.session.access_token}` } } });

/* ------------------------------- test images ------------------------------- */

// Plausible plan drawings rendered by the browser itself: PNG, JPEG and WebP.
function planSvg(seedNumber, label) {
  const rooms = [
    [[40, 40, 360, 260, 'Living'], [400, 40, 320, 200, 'Kitchen'], [400, 240, 320, 160, 'Dining'], [40, 300, 220, 260, 'Bed 1'], [260, 300, 140, 120, 'Bath'], [260, 420, 460, 140, 'Bed 2']],
    [[40, 40, 280, 220, 'Primary'], [320, 40, 160, 120, 'Bath'], [480, 40, 240, 220, 'Bed 2'], [320, 160, 160, 100, 'Hall'], [40, 260, 340, 300, 'Bed 3'], [380, 260, 340, 300, 'Loft']],
    [[40, 40, 680, 240, 'Rec room'], [40, 280, 260, 280, 'Laundry'], [300, 280, 200, 280, 'Storage'], [500, 280, 220, 280, 'Mech.']],
    [[40, 40, 420, 520, 'Garage'], [460, 40, 260, 260, 'Mudroom'], [460, 300, 260, 260, 'Workshop']],
    [[40, 40, 330, 250, 'Office'], [370, 40, 350, 250, 'Den'], [40, 290, 680, 270, 'Sunroom']],
  ][seedNumber % 5];
  const shapes = rooms.map(([x, y, w, h, name]) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="#2e2621" stroke-width="6"/><text x="${x + w / 2}" y="${y + h / 2}" font-family="Georgia" font-size="26" fill="#5b4f46" text-anchor="middle">${name}</text>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="760" height="600" viewBox="0 0 760 600"><rect width="760" height="600" fill="#fff"/>${shapes}<text x="720" y="590" font-family="Helvetica" font-size="16" fill="#b95332" text-anchor="end">${label}</text></svg>`;
}
async function makeImages(browser) {
  const page = await browser.newPage({ viewport: { width: 760, height: 600 } });
  const images = [];
  for (let i = 0; i < 6; i += 1) {
    await page.setContent(`<body style="margin:0">${planSvg(i, `Plan ${i + 1}`)}</body>`);
    const type = i % 3 === 1 ? 'jpeg' : 'png';
    const buffer = await page.screenshot({ type, ...(type === 'jpeg' ? { quality: 90 } : {}) });
    images.push({ name: `plan-${i + 1}.${type === 'jpeg' ? 'jpg' : 'png'}`, mimeType: `image/${type}`, buffer });
  }
  // WebP via canvas.
  const webp = await page.evaluate(async (svg) => {
    const img = new Image();
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    await img.decode();
    const canvas = Object.assign(document.createElement('canvas'), { width: 760, height: 600 });
    canvas.getContext('2d').drawImage(img, 0, 0);
    return canvas.toDataURL('image/webp', 0.9).split(',')[1];
  }, planSvg(4, 'Plan W'));
  images.push({ name: 'plan-w.webp', mimeType: 'image/webp', buffer: Buffer.from(webp, 'base64') });
  await page.close();
  return images;
}

/* --------------------------------- browser --------------------------------- */

const DEVICES = {
  iphone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  iphoneLandscape: { viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  ipad: { viewport: { width: 820, height: 1180 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  ipadLandscape: { viewport: { width: 1180, height: 820 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
};

async function signedIn(browser, user, device = 'iphone', { url = base } = {}) {
  const context = await browser.newContext({ ...DEVICES[device], userAgent: device.startsWith('i') ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' : undefined });
  await context.addCookies([{ name: 'sb-localhost-auth-token', value: `base64-${Buffer.from(JSON.stringify(user.session)).toString('base64url')}`, domain: 'localhost', path: '/' }]);
  await context.addInitScript(() => { try { localStorage.setItem('flh-mobile-tour-dismissed', '1'); localStorage.setItem('flh-name-prompt-dismissed', '1'); localStorage.setItem('flh-install-dismissed', '1'); } catch { /* ignore */ } });
  await context.route('**/api/commute', (route) => route.fulfill({ json: { results: {} } }));
  const page = await context.newPage();
  openPages.add(page);
  page.on('close', () => openPages.delete(page));
  page.errors = [];
  page.requests = [];
  page.on('pageerror', (error) => page.errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error' && !IGNORED_CONSOLE.test(message.text())) page.errors.push(message.text()); });
  page.on('request', (request) => page.requests.push(`${request.method()} ${request.url()}`));
  page.base = url;
  page.cdp = DEVICES[device].hasTouch ? await context.newCDPSession(page) : null;
  return page;
}

async function settle(page) {
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(350);
}
async function overflow(page) {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}
const shots = [];
async function shot(page, name, { full = false, locator = null } = {}) {
  await settle(page);
  const file = join(outDir, `${name}.jpg`);
  // Card crops hide the fixed Feedback tab that floats over whatever is beneath it.
  if (locator) await locator.screenshot({ path: file, type: 'jpeg', quality: 82, style: '.beta-feedback-tab { visibility: hidden; }' });
  else await page.screenshot({ path: file, fullPage: full, type: 'jpeg', quality: 82 });
  shots.push(`${name}.jpg`);
  const extra = await overflow(page);
  assert(extra <= 0, `${name}: horizontal overflow ${extra}px`);
}
// A failed step saves what the page showed (failure-<n>.jpg) for diagnosis.
const openPages = new Set();
async function step(name, fn) {
  const started = Date.now();
  try { await fn(); log.push({ step: name, ok: true, ms: Date.now() - started }); console.log('ok  ', name); }
  catch (error) {
    log.push({ step: name, ok: false, error: error.message });
    console.error('FAIL', name, '—', error.message);
    let n = 0;
    for (const open of openPages) await open.screenshot({ path: join(outDir, `failure-${log.length}-${n++}.jpg`), type: 'jpeg', quality: 70 }).catch(() => {});
  }
}

const cardFor = (page, street) => page.locator('article.hh-home-card').filter({ has: page.getByRole('heading', { name: street }) });
const viewer = (page) => page.locator('.hh-fp-viewer');
async function openViewer(page, street, label) {
  await cardFor(page, street).getByRole('button', { name: new RegExp(`^${label}`) }).click();
  await viewer(page).waitFor();
  await page.locator('.hh-fp-viewer .hh-fp-state[role="status"]').waitFor({ state: 'detached' }).catch(() => {});
}
async function imageReady(page) {
  await page.waitForFunction(() => { const img = document.querySelector('.hh-fp-image'); return img && img.complete && img.naturalWidth > 0 && img.classList.contains('is-loaded'); }, null, { timeout: 15000 });
}
const notice = (page) => page.locator('.hh-fp-notice:not(:empty)').first();
async function upload(page, files) {
  await page.locator('.hh-fp-viewer input[type="file"]').setInputFiles(files);
}
async function currentScale(page) {
  return page.evaluate(() => {
    const transform = document.querySelector('.hh-fp-image')?.style.transform || '';
    return Number(transform.match(/scale\(([\d.]+)\)/)?.[1] || 1);
  });
}
async function stageCenter(page) {
  const box = await page.locator('.hh-fp-canvas').boundingBox();
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, box };
}
// Real touch input (Chrome DevTools Protocol), so pointer events arrive as
// pointerType "touch" exactly as on an iPhone / iPad.
async function touch(page, type, points) {
  await page.cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y], id) => ({ x, y, id, radiusX: 4, radiusY: 4, force: 1 })) });
}
async function swipe(page, dx, dy = 0) {
  const { x, y } = await stageCenter(page);
  await touch(page, 'touchStart', [[x, y]]);
  for (let i = 1; i <= 8; i += 1) { await touch(page, 'touchMove', [[x + (dx * i) / 8, y + (dy * i) / 8]]); await page.waitForTimeout(12); }
  await touch(page, 'touchEnd', []);
  await page.waitForTimeout(300);
}
async function pinch(page, from, to) {
  const { x, y } = await stageCenter(page);
  await touch(page, 'touchStart', [[x - from, y], [x + from, y]]);
  for (let i = 1; i <= 10; i += 1) { const d = from + ((to - from) * i) / 10; await touch(page, 'touchMove', [[x - d, y], [x + d, y]]); await page.waitForTimeout(16); }
  await touch(page, 'touchEnd', []);
  await page.waitForTimeout(300);
}
async function doubleTap(page) {
  const { x, y } = await stageCenter(page);
  for (let i = 0; i < 2; i += 1) { await touch(page, 'touchStart', [[x, y]]); await touch(page, 'touchEnd', []); await page.waitForTimeout(90); }
  await page.waitForTimeout(350);
}

/* ----------------------------------- run ----------------------------------- */

async function main() {
  seed();
  await qaSwitch({ reset: true });
  const browser = await chromium.launch({ executablePath: process.env.FLH_CHROMIUM || undefined });
  const images = await makeImages(browser);
  const photoBefore = q(`select id, photo_url from public.homes where search_id = '${info.search}' order by id`);

  /* ---------------------------- feature off ---------------------------- */
  await step('[flag off] My Homes renders as before: Notes intact, no Floor Plans, no plan reads / signing / uploads', async () => {
    const page = await signedIn(browser, owner, 'iphone', { url: offBase });
    await page.goto(`${offBase}/homes`, { waitUntil: 'networkidle' });
    await cardFor(page, '412 Linden Ave').waitFor();
    assert(await page.locator('.hh-floor-plans-action').count() === 0, 'Floor Plans action rendered with the flag off');
    assert(await page.locator('.hh-card-notes-row').count() === 0, 'notes row wrapper rendered with the flag off');
    assert(await cardFor(page, '412 Linden Ave').getByRole('link', { name: 'Notes (2)' }).count() === 1, 'Notes (2) link missing');
    assert(await cardFor(page, '77 Harbor Point Ct').getByRole('link', { name: 'Notes (1)' }).count() === 1, 'Notes (1) link missing');
    const leaks = page.requests.filter((request) => /home_floor_plans|home-floor-plans|can_edit_home_floor_plans/.test(request));
    assert(!leaks.length, `requests with the flag off: ${leaks.join(', ')}`);
    await shot(page, '00-flag-off-iphone-card', { locator: cardFor(page, '412 Linden Ave') });
    assert(!page.errors.length, page.errors.join(' | '));
    await page.context().close();
  });

  /* ------------------------- owner on iPhone ------------------------- */
  const page = await signedIn(browser, owner, 'iphone');
  await step('[owner iPhone] card: Notes left, quiet "Add floor plan" right; cover photo unchanged', async () => {
    await page.goto(`${base}/homes`, { waitUntil: 'networkidle' });
    const card = cardFor(page, '412 Linden Ave');
    await card.waitFor();
    const row = card.locator('.hh-card-notes-row');
    const notesBox = await row.getByRole('link', { name: 'Notes (2)' }).boundingBox();
    const plansBox = await row.getByRole('button', { name: /^Add floor plan/ }).boundingBox();
    assert(notesBox && plansBox && notesBox.x < plansBox.x, 'Notes is not left of Floor Plans');
    const rowBox = await row.boundingBox();
    assert(Math.abs(plansBox.x + plansBox.width - (rowBox.x + rowBox.width)) < 2, 'Floor Plans not right-aligned');
    assert(plansBox.height >= 44, `Floor Plans tap target ${plansBox.height}px < 44px`);
    // No notes: the action still sits on the right.
    const maple = cardFor(page, '1820 Maple Ridge Dr').locator('.hh-card-notes-row');
    const mapleBox = await maple.boundingBox();
    const mapleAction = await maple.getByRole('button', { name: /^Add floor plan/ }).boundingBox();
    assert(Math.abs(mapleAction.x + mapleAction.width - (mapleBox.x + mapleBox.width)) < 2, 'Floor Plans not right-aligned without Notes');
    assert(await card.locator('.hh-home-card-photo img').getAttribute('src') === PHOTO, 'cover photo changed');
    assert(await page.locator('article.hh-home-card .hh-home-card-photo img').count() === 2, 'expected exactly the two cover photos');
    await shot(page, '01-iphone-card-notes-and-floor-plans', { locator: card });
    await shot(page, '02-iphone-my-homes', { full: true });
  });

  await step('[owner iPhone] Notes link still opens Tour Feedback (unchanged)', async () => {
    const href = await cardFor(page, '412 Linden Ave').getByRole('link', { name: 'Notes (2)' }).getAttribute('href');
    assert(/\/homes\/[0-9a-f-]+\?section=tour$/.test(href), `Notes href changed: ${href}`);
  });

  await step('[owner iPhone] empty viewer: explains and offers Add; Escape closes and returns focus', async () => {
    await openViewer(page, '412 Linden Ave', 'Add floor plan');
    await page.getByText('No floor plans yet').waitFor();
    await viewer(page).getByRole('button', { name: 'Add floor plan' }).waitFor();
    await shot(page, '03-iphone-viewer-empty');
    await page.keyboard.press('Escape');
    await viewer(page).waitFor({ state: 'detached' });
    const focused = await page.evaluate(() => document.activeElement?.className || '');
    assert(/hh-floor-plans-action/.test(focused), `focus not returned to the card action (${focused})`);
  });

  await step('[owner iPhone] invalid and oversized files are refused before any upload', async () => {
    await openViewer(page, '412 Linden Ave', 'Add floor plan');
    await upload(page, [{ name: 'plan.gif', mimeType: 'image/gif', buffer: Buffer.from('GIF89a') }]);
    await notice(page).waitFor();
    assert(/JPEG, PNG, or WebP/.test(await notice(page).textContent()), 'no type error');
    await upload(page, [{ name: 'huge.png', mimeType: 'image/png', buffer: Buffer.alloc(10 * 1024 * 1024 + 1) }]);
    await page.getByText(/larger than 10MB/).waitFor();
    assertConsistent('linden', 0);
    await shot(page, '04-iphone-viewer-file-error');
  });

  await step('[owner iPhone] a failed upload leaves no row and no object, and says so', async () => {
    await qaSwitch({ failUpload: true });
    await upload(page, [images[0]]);
    await page.getByText(/couldn.t upload that floor plan/).waitFor();
    await qaSwitch({ failUpload: false });
    assertConsistent('linden', 0);
  });

  await step('[owner iPhone] first plan: uploads, shows, success note, card count updates', async () => {
    await upload(page, [images[0]]);
    await page.getByText('Floor plan added.').waitFor();
    await imageReady(page);
    assertConsistent('linden', 1);
    await shot(page, '05-iphone-viewer-one-plan');
    await page.getByRole('button', { name: 'Close floor plans' }).click();
    await cardFor(page, '412 Linden Ave').getByRole('button', { name: /^Floor plans \(1\)/ }).waitFor();
  });

  await step('[owner iPhone] picking 4 more at 1 of 4: adds 3, explains the limit, nothing left behind', async () => {
    await openViewer(page, '412 Linden Ave', 'Floor plans');
    await imageReady(page);
    await upload(page, [images[1], images[2], images[6], images[3]]);
    await page.getByText(/3 floor plans added\. A home can have up to 4 floor plans/).waitFor({ timeout: 20000 });
    assertConsistent('linden', 4);
    await page.locator('.hh-fp-room', { hasText: '4 of 4 added' }).waitFor();
    assert(await page.getByRole('button', { name: /Add another/ }).count() === 0, 'Add still offered at 4');
    assert(rows('linden').some((row) => row.storage_path.endsWith('.webp')) && rows('linden').some((row) => row.storage_path.endsWith('.jpg')), 'expected PNG, JPEG and WebP plans');
    await imageReady(page);
    await shot(page, '06-iphone-viewer-four-plans');
  });

  await step('[owner iPhone] buttons, thumbnails and arrow keys move between plans; counter follows', async () => {
    const counter = page.locator('.hh-fp-counter');
    assert((await counter.textContent()) === '4 of 4', `expected the newest plan selected, got ${await counter.textContent()}`);
    await page.getByRole('button', { name: 'Previous floor plan' }).click();
    assert((await counter.textContent()) === '3 of 4', 'previous');
    await page.getByRole('button', { name: 'Floor plan 1 of 4' }).click();
    assert((await counter.textContent()) === '1 of 4', 'thumbnail');
    assert(await page.getByRole('button', { name: 'Previous floor plan' }).isDisabled(), 'previous enabled at first plan');
    await page.keyboard.press('ArrowRight');
    assert((await counter.textContent()) === '2 of 4', 'arrow key');
  });

  await step('[owner iPhone] touch: swipe left/right changes plan; pinch zooms; drag pans; double-tap toggles; Fit resets', async () => {
    const counter = page.locator('.hh-fp-counter');
    await imageReady(page);
    await swipe(page, -170);
    assert((await counter.textContent()) === '3 of 4', `swipe left → ${await counter.textContent()}`);
    await swipe(page, 170);
    assert((await counter.textContent()) === '2 of 4', `swipe right → ${await counter.textContent()}`);
    await imageReady(page);
    await pinch(page, 40, 120);
    const pinched = await currentScale(page);
    assert(pinched > 2, `pinch scale ${pinched}`);
    const before = await page.evaluate(() => document.querySelector('.hh-fp-image').style.transform);
    await swipe(page, -120);
    assert((await counter.textContent()) === '2 of 4', 'a drag while zoomed must pan, not change plan');
    const after = await page.evaluate(() => document.querySelector('.hh-fp-image').style.transform);
    assert(before !== after, 'drag did not pan');
    await shot(page, '07-iphone-viewer-pinch-zoomed');
    await page.getByRole('button', { name: 'Fit to screen' }).click();
    await page.waitForTimeout(300);
    assert(await currentScale(page) === 1, 'Fit did not reset');
    await doubleTap(page);
    assert(await currentScale(page) === 2.5, `double tap → ${await currentScale(page)}`);
    await doubleTap(page);
    assert(await currentScale(page) === 1, 'second double tap did not return to fit');
    await page.getByRole('button', { name: 'Zoom in' }).click();
    assert(await currentScale(page) > 1, 'Zoom in');
    await page.getByRole('button', { name: 'Zoom out' }).click();
    assert(await currentScale(page) === 1, 'Zoom out');
  });

  await step('[owner iPhone] pinch never zooms the page itself', async () => {
    const pageScale = await page.evaluate(() => window.visualViewport?.scale ?? 1);
    assert(pageScale === 1, `page zoomed to ${pageScale}`);
  });

  await step('[owner iPhone] remove: confirm, gone for everyone, object deleted', async () => {
    await page.getByRole('button', { name: 'Floor plan 4 of 4' }).click();
    await page.getByRole('button', { name: 'Remove', exact: true }).click();
    await page.getByText('Remove this floor plan for everyone on this search?').waitFor();
    await shot(page, '08-iphone-viewer-confirm-remove');
    await page.getByRole('button', { name: 'Keep it' }).click();
    assertConsistent('linden', 4);
    await page.getByRole('button', { name: 'Remove', exact: true }).click();
    await page.locator('.hh-fp-remove-confirm').click();
    await page.getByText('Floor plan removed.').waitFor();
    assertConsistent('linden', 3);
    await page.locator('.hh-fp-room', { hasText: '3 of 4 added' }).waitFor();
  });

  await step('[owner iPhone] signing fails: plain message + Try again, then recovers', async () => {
    await page.getByRole('button', { name: 'Close floor plans' }).click();
    await qaSwitch({ failSign: true });
    await openViewer(page, '412 Linden Ave', 'Floor plans');
    await page.getByText('This floor plan isn’t available right now.').waitFor();
    await shot(page, '09-iphone-viewer-sign-failure');
    await qaSwitch({ failSign: false });
    await page.getByRole('button', { name: 'Try again' }).click();
    await imageReady(page);
  });

  await step('[owner iPhone] an expired signed URL is re-signed and the image still loads', async () => {
    await page.getByRole('button', { name: 'Close floor plans' }).click();
    await qaSwitch({ ttlSeconds: 1 });
    // Hold image downloads until the 1-second URLs have expired.
    let expiredSeen = 0;
    await page.route('**/storage/v1/object/sign/home-floor-plans/**', async (route) => {
      await new Promise((r) => setTimeout(r, 1300));
      try {
        const response = await route.fetch();
        if (response.status() === 400) expiredSeen += 1;
        await route.fulfill({ response });
      } catch { /* unrouted while held: the page already moved on */ }
    });
    await openViewer(page, '412 Linden Ave', 'Floor plans');
    await page.waitForTimeout(1600);
    await qaSwitch({ ttlSeconds: null });
    await page.unroute('**/storage/v1/object/sign/home-floor-plans/**');
    await imageReady(page);
    assert(expiredSeen > 0, 'the expired URL was never exercised');
    assert(await page.getByText('This floor plan isn’t available right now.').count() === 0, 'showed unavailable after re-sign');
    await page.getByRole('button', { name: 'Close floor plans' }).click();
  });

  await step('[owner iPhone] a plan whose image keeps failing says so (not a blank stage)', async () => {
    await page.route('**/storage/v1/object/sign/home-floor-plans/**', (route) => route.fulfill({ status: 400, body: '{}' }));
    await openViewer(page, '412 Linden Ave', 'Floor plans');
    await page.getByText('This floor plan isn’t available right now.').waitFor({ timeout: 15000 });
    await page.unroute('**/storage/v1/object/sign/home-floor-plans/**');
    await page.getByRole('button', { name: 'Try again' }).click();
    await imageReady(page);
  });

  await step('[owner iPhone] Add/Edit Home overlay has no Floor Plans fields', async () => {
    await page.getByRole('button', { name: 'Close floor plans' }).click();
    await cardFor(page, '412 Linden Ave').getByRole('button', { name: 'Edit' }).click();
    await page.waitForURL(/\/homes\/[0-9a-f-]+/);
    await page.locator('.flh-overlay').waitFor();
    await settle(page);
    assert(await page.locator('.flh-overlay').getByText(/floor plan/i).count() === 0, 'Floor Plans appears inside the home overlay');
    await page.goto(`${base}/homes`, { waitUntil: 'networkidle' });
  });

  await step('[owner iPhone] stale viewer at the limit (co-buyer filled the 4th slot meanwhile): refused, nothing left behind', async () => {
    await openViewer(page, '412 Linden Ave', 'Floor plans');
    await imageReady(page);
    const api = apiAs(coBuyer);
    const { addFloorPlan } = await import('../../src/lib/homeFloorPlans.js');
    await addFloorPlan(api, homeId('linden'), new Blob([images[4].buffer], { type: 'image/png' }));
    assertConsistent('linden', 4);
    await upload(page, [images[5]]);
    await page.getByText(/A home can have up to 4 floor plans, so this one wasn.t added/).waitFor();
    assertConsistent('linden', 4);
    await page.locator('.hh-fp-room', { hasText: '4 of 4 added' }).waitFor(); // the viewer refreshed to the real state
  });

  await step('[owner] iPhone landscape: side rail, image fills the height', async () => {
    await page.setViewportSize(DEVICES.iphoneLandscape.viewport);
    await page.waitForTimeout(400);
    await imageReady(page);
    const footer = await page.locator('.hh-fp-footer').boundingBox();
    const main = await page.locator('.hh-fp-main').boundingBox();
    assert(footer.x > main.x + main.width - 2, 'footer is not a side rail in landscape');
    assert(main.height > 300, `stage height ${main.height}`);
    await shot(page, '10-iphone-landscape-viewer');
    await page.setViewportSize(DEVICES.iphone.viewport);
    await page.getByRole('button', { name: 'Close floor plans' }).click();
  });
  assert(!page.errors.length, `owner page errors: ${page.errors.join(' | ')}`);
  await page.context().close();

  /* ------------------------------- iPad ------------------------------- */
  await step('[co-buyer iPad] sees the plans, can add and remove; grid layout and viewer', async () => {
    const ipad = await signedIn(browser, coBuyer, 'ipad');
    await ipad.goto(`${base}/homes`, { waitUntil: 'networkidle' });
    await cardFor(ipad, '412 Linden Ave').getByRole('button', { name: /^Floor plans \(4\)/ }).waitFor();
    await shot(ipad, '11-ipad-portrait-my-homes');
    await openViewer(ipad, '412 Linden Ave', 'Floor plans');
    await imageReady(ipad);
    await ipad.getByRole('button', { name: 'Remove', exact: true }).waitFor();
    await shot(ipad, '12-ipad-portrait-viewer');
    await ipad.getByRole('button', { name: 'Remove', exact: true }).click();
    await ipad.locator('.hh-fp-remove-confirm').click();
    await ipad.getByText('Floor plan removed.').waitFor();
    assertConsistent('linden', 3);
    await swipe(ipad, -200);
    await pinch(ipad, 60, 160);
    assert(await currentScale(ipad) > 2, 'iPad pinch');
    await ipad.setViewportSize(DEVICES.ipadLandscape.viewport);
    await ipad.getByRole('button', { name: 'Fit to screen' }).click();
    await imageReady(ipad);
    await shot(ipad, '13-ipad-landscape-viewer');
    await ipad.getByRole('button', { name: 'Close floor plans' }).click();
    await shot(ipad, '14-ipad-landscape-my-homes');
    assert(!ipad.errors.length, ipad.errors.join(' | '));
    await ipad.context().close();
  });

  /* ------------------------------ Realtor ------------------------------ */
  await step('[Realtor iPhone] view-only: sees plans, no Add/Remove; API upload/delete refused', async () => {
    const rp = await signedIn(browser, realtor, 'iphone');
    await rp.goto(`${base}/people/${info.search}`, { waitUntil: 'networkidle' });
    const card = rp.locator('article.hh-realtor-home-card').filter({ hasText: '412 Linden Ave' });
    await card.getByRole('button', { name: /^Floor plans \(3\)/ }).waitFor();
    assert(await rp.locator('article.hh-realtor-home-card').filter({ hasText: '1820 Maple Ridge Dr' }).locator('.hh-floor-plans-action').count() === 0, 'Realtor offered Add on an empty home');
    await shot(rp, '15-iphone-realtor-card', { locator: card });
    await card.getByRole('button', { name: /^Floor plans/ }).click();
    await viewer(rp).waitFor();
    await imageReady(rp);
    assert(await viewer(rp).getByRole('button', { name: /Add|Remove/ }).count() === 0, 'Realtor sees Add or Remove');
    await shot(rp, '16-iphone-realtor-viewer');
    const api = apiAs(realtor);
    const path = `${homeId('linden')}/${randomUUID()}.png`;
    const up = await api.storage.from('home-floor-plans').upload(path, new Blob([images[0].buffer], { type: 'image/png' }));
    assert(up.error, 'Realtor upload was accepted');
    const del = await api.from('home_floor_plans').delete().eq('home_id', homeId('linden')).select('id');
    assert(!del.error && del.data.length === 0, 'Realtor delete removed rows');
    assertConsistent('linden', 3);
    assert(!rp.errors.length, rp.errors.join(' | '));
    await rp.context().close();
  });

  /* ------------------------------ revoked ------------------------------ */
  await step('[revoked] co-buyer removed mid-session: write refused, nothing left behind; no private plans afterwards', async () => {
    const cp = await signedIn(browser, coBuyer, 'iphone');
    await cp.goto(`${base}/homes`, { waitUntil: 'networkidle' });
    await openViewer(cp, '412 Linden Ave', 'Floor plans');
    await imageReady(cp);
    exec(`delete from public.search_members where search_id = '${info.search}' and user_id = '${coBuyer.id}'`);
    await upload(cp, [images[5]]);
    await cp.locator('.hh-fp-notice.is-error').waitFor();
    assertConsistent('linden', 3);
    // The viewer refreshed: no plans and no controls for a non-member.
    await cp.getByText('No floor plans yet').waitFor();
    assert(await viewer(cp).getByRole('button', { name: /Add|Remove/ }).count() === 0, 'revoked co-buyer still has controls');
    const api = apiAs(coBuyer);
    const listed = await api.from('home_floor_plans').select('id').eq('home_id', homeId('linden'));
    assert(!listed.error && listed.data.length === 0, 'revoked co-buyer still reads plan rows');
    const signed = await api.storage.from('home-floor-plans').createSignedUrls(rows('linden').map((row) => row.storage_path), 60);
    assert(!signed.error && signed.data.every((entry) => !entry.signedUrl), 'revoked co-buyer still gets signed URLs');
    await cp.context().close();
  });

  await step('[revoked] Realtor removed: client page gone, API reads nothing', async () => {
    exec(`delete from public.search_members where search_id = '${info.search}' and user_id = '${realtor.id}'`);
    const rp = await signedIn(browser, realtor, 'iphone');
    const response = await rp.goto(`${base}/people/${info.search}`, { waitUntil: 'networkidle' });
    assert(response.status() === 404 || await rp.locator('.hh-floor-plans-action').count() === 0, 'revoked Realtor still sees Floor Plans');
    const api = apiAs(realtor);
    const listed = await api.from('home_floor_plans').select('id').eq('home_id', homeId('linden'));
    assert(!listed.error && listed.data.length === 0, 'revoked Realtor still reads rows');
    const signed = await api.storage.from('home-floor-plans').createSignedUrls(rows('linden').map((row) => row.storage_path), 60);
    assert(signed.data.every((entry) => !entry.signedUrl), 'revoked Realtor still gets signed URLs');
    await rp.context().close();
  });

  await step('[outsider / anon] nothing readable', async () => {
    const anon = createClient(info.url, 'qa', { auth: { persistSession: false } });
    const signed = await anon.storage.from('home-floor-plans').createSignedUrls(rows('linden').map((row) => row.storage_path), 60);
    assert(signed.error || signed.data.every((entry) => !entry.signedUrl), 'anon got a signed URL');
  });

  await step('[regression] cover photos untouched; Match inputs untouched', async () => {
    const after = q(`select id, photo_url from public.homes where search_id = '${info.search}' order by id`);
    assert(JSON.stringify(after) === JSON.stringify(photoBefore), 'homes.photo_url changed');
  });

  await browser.close();
  writeFileSync(join(outDir, 'qa-log.json'), JSON.stringify({ shots, log }, null, 2));
  const failed = log.filter((entry) => !entry.ok);
  console.log(`\n${log.length - failed.length}/${log.length} steps passed; ${shots.length} screenshots in ${outDir}`);
  if (failed.length) process.exit(1);
}

main().catch((error) => { console.error(error); process.exit(1); });
