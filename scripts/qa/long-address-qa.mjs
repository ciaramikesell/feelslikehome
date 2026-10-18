#!/usr/bin/env node
// Long-address layout QA for the home overlay and My Homes. DEVELOPMENT ONLY.
// Same harness as home-overlay-e2e.mjs (stand-in + dev server):
//
//   FLH_TEST_PGHOST=… FLH_TEST_PGPORT=… node scripts/qa/long-address-qa.mjs standin.json <outDir> [baseUrl]
//
// Adds homes with hard addresses (very long street, very long city, no comma,
// one unbroken token) and, at each width, measures — not just screenshots —
// that nothing overflows, is clipped, or overlaps: the page and the overlay
// never scroll sideways; the address field shows all of its text; the header
// columns (photo, identity, secondary facts) never intersect; the title bar's
// address never runs under Saved / Close; My Homes cards keep their text inside.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';

const [infoPath, outArg, base = 'http://localhost:3200'] = process.argv.slice(2);
if (!infoPath || !outArg) throw new Error('Usage: long-address-qa.mjs <standin.json> <outDir> [baseUrl]');
const info = JSON.parse(readFileSync(infoPath, 'utf8').split('\n')[0]);
const outDir = resolve(outArg);
mkdirSync(outDir, { recursive: true });
const OWNER = info.users.owner.id;
const WIDTHS = [1440, 1280, 1024, 768, 390, 375, 320];
const ADDRESSES = {
  'long-street': '48211 Northwestern Highway Service Drive Unit 1204, Bloomfield Hills Township, MI 48302',
  'long-city': '7 Elm St, Village of Grosse Pointe Shores, a Michigan City, Wayne County, MI 48236',
  'no-comma': '1234 Extraordinarily Long Street Name Without Any Commas Boulevard Northeast Apartment 12B Detroit MI',
  'unbroken': '99 Supercalifragilisticexpialidociousandthensomemorelettersstreet, Ann Arbor, MI 48104',
};
const psql = (sql) => {
  const result = spawnSync('psql', ['-X', '-q', '-A', '-t', '-h', process.env.FLH_TEST_PGHOST, '-p', process.env.FLH_TEST_PGPORT || '5432', '-U', 'postgres', '-d', info.database, '-c', sql], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
};
const lit = (value) => `'${String(value).replace(/'/g, "''")}'`;

const ids = {};
for (const [key, address] of Object.entries(ADDRESSES)) {
  ids[key] = psql(`insert into public.homes (user_id, search_id, address, price, beds, baths, sqft, lot_size) values ('${OWNER}', '${info.search}', ${lit(address)}, '12345678', '11', '10.5', '12500', '3.75 acres') returning id`).split('\n')[0].trim();
  psql(`insert into public.home_member_state (home_id, user_id, status) values ('${ids[key]}', '${OWNER}', 'Saved')`);
}

// Measurements taken inside the page. Returns a list of problems (empty = pass).
function measure() {
  const problems = [];
  const rect = (node) => node?.getBoundingClientRect();
  const visible = (node) => node && node.offsetParent !== null && rect(node).width > 0 && rect(node).height > 0;
  const overlaps = (a, b) => a && b && a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
  const doc = document.documentElement;
  if (doc.scrollWidth > doc.clientWidth) problems.push(`page scrolls sideways by ${doc.scrollWidth - doc.clientWidth}px`);
  const overlay = document.querySelector('.flh-overlay:not(.is-loading)');
  if (!overlay) return ['overlay not open'];
  const scroll = overlay.querySelector('.flh-overlay-scroll');
  if (scroll.scrollWidth > scroll.clientWidth) problems.push(`overlay scrolls sideways by ${scroll.scrollWidth - scroll.clientWidth}px`);
  if (rect(overlay).right > window.innerWidth + 0.5 || rect(overlay).left < -0.5) problems.push('overlay wider than the viewport');
  // The address field shows all of its text (no hidden overflow either way).
  const address = overlay.querySelector('#hf-address');
  if (address.scrollWidth > address.clientWidth + 1) problems.push(`address clipped horizontally (${address.scrollWidth} > ${address.clientWidth})`);
  if (address.scrollHeight > address.clientHeight + 1) problems.push(`address clipped vertically (${address.scrollHeight} > ${address.clientHeight})`);
  // Every element of the identity column stays inside it.
  const identity = overlay.querySelector('.flh-hf2-identity');
  for (const child of identity.querySelectorAll('.flh-hf2-price, .flh-hf2-address, .flh-hf2-locality, .flh-hf2-specs, .flh-hf-listing-row, .flh-hf-listing-edit')) {
    if (!visible(child)) continue;
    if (rect(child).right > rect(identity).right + 1) problems.push(`${child.className.split(' ')[0]} spills out of its column by ${Math.round(rect(child).right - rect(identity).right)}px`);
    if (child.scrollWidth > child.clientWidth + 1) problems.push(`${child.className.split(' ')[0]} overflows itself`);
  }
  // Header columns never intersect.
  const photo = overlay.querySelector('.flh-hf2-photo');
  const secondary = overlay.querySelector('.flh-hf2-secondary');
  if (overlaps(rect(identity), rect(photo))) problems.push('identity overlaps the photo');
  if (visible(secondary) && overlaps(rect(identity), rect(secondary))) problems.push('identity overlaps the secondary facts');
  // Identity children never overlap each other.
  const rows = [...identity.children].filter(visible);
  for (let i = 0; i < rows.length; i += 1) for (let j = i + 1; j < rows.length; j += 1) {
    if (overlaps(rect(rows[i]), rect(rows[j]))) problems.push(`${rows[i].className || rows[i].tagName} overlaps ${rows[j].className || rows[j].tagName}`);
  }
  // Title bar: the address truncates before Saved / Close.
  const title = overlay.querySelector('.flh-overlay-bar-title');
  const actions = overlay.querySelector('.flh-overlay-bar-actions');
  if (rect(title).right > rect(actions).left + 0.5) problems.push('title bar address runs under Saved / Close');
  const h1 = overlay.querySelector('#flh-overlay-title');
  if (getComputedStyle(h1).textOverflow !== 'ellipsis') problems.push('title bar address is not ellipsized');
  return problems;
}

function measureCards(addresses) {
  const problems = [];
  const doc = document.documentElement;
  if (doc.scrollWidth > doc.clientWidth) problems.push(`My Homes scrolls sideways by ${doc.scrollWidth - doc.clientWidth}px`);
  for (const card of document.querySelectorAll('.hh-home-card')) {
    const text = card.textContent;
    if (!addresses.some((address) => text.includes(address.split(',')[0]))) continue;
    const box = card.getBoundingClientRect();
    for (const node of card.querySelectorAll('.hh-address, .hh-card-locality, .hh-card-price, .hh-card-factline')) {
      const r = node.getBoundingClientRect();
      if (r.right > box.right + 1 || node.scrollWidth > node.clientWidth + 1) problems.push(`card ${node.className}: "${node.textContent.slice(0, 30)}…" spills out`);
    }
  }
  return problems;
}

const browser = await chromium.launch();
const results = [];
for (const width of WIDTHS) {
  const context = await browser.newContext({ viewport: { width, height: width < 500 ? 844 : 900 }, deviceScaleFactor: 1 });
  await context.addCookies([{ name: 'sb-localhost-auth-token', value: `base64-${Buffer.from(JSON.stringify(info.users.owner.session)).toString('base64url')}`, domain: 'localhost', path: '/' }]);
  await context.addInitScript(() => { try { localStorage.setItem('flh-mobile-tour-dismissed', '1'); } catch { /* ignore */ } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${base}/homes`, { waitUntil: 'networkidle' });
  const cardProblems = await page.evaluate(measureCards, Object.values(ADDRESSES));
  await page.screenshot({ path: join(outDir, `cards-${width}.png`), fullPage: true });
  results.push({ width, view: 'my-homes-cards', problems: cardProblems });
  for (const [key, id] of Object.entries(ids)) {
    await page.goto(`${base}/homes/${id}`, { waitUntil: 'networkidle' });
    await page.locator('.flh-overlay:not(.is-loading)').waitFor();
    await page.waitForTimeout(250);
    const problems = await page.evaluate(measure);
    // Editing state: the full address in the field, focused.
    await page.locator('#hf-address').focus();
    await page.waitForTimeout(150);
    const editing = (await page.evaluate(measure)).map((problem) => `while editing: ${problem}`);
    await page.locator('#hf-address').blur();
    await page.screenshot({ path: join(outDir, `${key}-${width}.png`) });
    results.push({ width, view: key, problems: [...problems, ...editing, ...errors.splice(0)] });
  }
  await context.close();
}
await browser.close();
writeFileSync(join(outDir, 'long-address-results.json'), JSON.stringify(results, null, 2));
for (const { width, view, problems } of results) console.log(problems.length ? 'FAIL' : 'ok  ', String(width).padStart(4), view, problems.length ? `— ${problems.join('; ')}` : '');
psql(`delete from public.homes where id in (${Object.values(ids).map(lit).join(',')})`);
if (results.some((result) => result.problems.length)) process.exit(1);
