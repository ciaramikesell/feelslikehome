#!/usr/bin/env node
// Add Home V3, phase 6 (docs/add-home-v3-phase6-ux-audit.md): screenshots and
// layout measurements of the journey after Save Home. DEVELOPMENT ONLY. Same
// setup as the other Add Home QA (stand-in on real Postgres + dev server with
// the RentCast fixture):
//
//   FLH_TEST_PGHOST=… FLH_TEST_PGPORT=… node scripts/qa/post-save-ux-capture.mjs standin.json <outDir> <prefix> [baseUrl]
//
// For desktop 1440 and iPhone 390 it saves three homes as the owner — a
// standard lookup (51621), an enriched RentCast home (51692) and a failed
// lookup saved with an address only (51619) — and captures the saved state, the
// overlay's first screen, the whole overlay and Your Match, then the same
// enriched home as the co-buyer. It writes <prefix>-metrics.json: where Your
// Match starts, the overlay's scroll height, and how many calls to action
// compete on each screen. It only reads and saves homes; nothing is answered.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { chromium, devices } from 'playwright';

const [infoPath, outArg, prefix = 'shot', base = 'http://localhost:3200'] = process.argv.slice(2);
if (!infoPath || !outArg) throw new Error('Usage: post-save-ux-capture.mjs <standin.json> <outDir> <prefix> [baseUrl]');
const info = JSON.parse(readFileSync(infoPath, 'utf8').split('\n')[0]);
const outDir = resolve(outArg);
mkdirSync(outDir, { recursive: true });
const VIEWPORTS = [['desktop-1440', { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 }], ['iphone-390', devices['iPhone 13']]];
const HOMES = [['standard', 51621], ['enriched', 51692], ['sparse', 51619]];
const listingUrl = (number) => `https://www.zillow.com/homedetails/${number}-Sass-Rd-New-Baltimore-MI-48047/${number}_zpid/`;

function psql(sql) {
  const result = spawnSync('psql', ['-X', '-q', '-A', '-t', '-h', process.env.FLH_TEST_PGHOST, '-p', process.env.FLH_TEST_PGPORT || '5432', '-U', 'postgres', '-d', info.database, '-c', sql], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
}
const lit = (value) => `'${String(value).replace(/'/g, "''")}'`;

async function signedIn(browser, who, device) {
  const context = await browser.newContext({ ...device });
  await context.addCookies([{ name: 'sb-localhost-auth-token', value: `base64-${Buffer.from(JSON.stringify(info.users[who].session)).toString('base64url')}`, domain: 'localhost', path: '/' }]);
  await context.addInitScript(() => { try { localStorage.setItem('flh-mobile-tour-dismissed', '1'); localStorage.setItem('flh-what-flh-found-dismissed', '1'); localStorage.setItem('flh-install-dismissed', '1'); } catch { /* ignore */ } });
  return context.newPage();
}

// Whole-overlay capture: grow the viewport to the scroll height, shoot, restore.
async function fullOverlay(page, file) {
  const size = page.viewportSize();
  const height = await page.locator('.flh-overlay-scroll').evaluate((el) => el.scrollHeight + (el.getBoundingClientRect().top || 0) + 40);
  await page.setViewportSize({ width: size.width, height: Math.min(Math.ceil(height), 12000) });
  await page.waitForTimeout(250);
  await page.screenshot({ path: file });
  await page.setViewportSize(size);
  await page.waitForTimeout(150);
}

async function measure(page) {
  return page.evaluate(() => {
    const scroll = document.querySelector('.flh-overlay-scroll');
    const match = document.querySelector('#flh-match-title');
    const top = scroll.getBoundingClientRect().top;
    const visible = (el) => !!el.offsetParent;
    return {
      viewportHeight: window.innerHeight,
      scrollHeight: scroll.scrollHeight,
      yourMatchTop: match ? Math.round(match.getBoundingClientRect().top - top + scroll.scrollTop) : null,
      unknownControls: [...document.querySelectorAll('.flh-overlay .is-unknown')].filter(visible).length,
      buttonsAndLinks: [...document.querySelectorAll('.flh-overlay button, .flh-overlay a')].filter(visible).length,
      unansweredRadios: [...document.querySelectorAll('.flh-mc2-answer')].filter((set) => set.querySelector('.is-unknown.is-checked, .is-facts.is-checked')).length,
      answerControls: document.querySelectorAll('.flh-mc2-answer').length,
      matchText: document.querySelector('.flh-overlay-match')?.innerText.slice(0, 1600) || '',
    };
  });
}

async function addHome(page, number) {
  await page.goto(`${base}/homes`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /Add a Home/ }).first().click();
  await page.getByLabel('Listing link or address').fill(listingUrl(number));
  await page.getByRole('button', { name: /^Find home$/ }).click();
  await page.locator('.flh-found-card, .flh-found').first().waitFor({ timeout: 30000 });
  await page.getByRole('button', { name: /^Save Home$/ }).click();
  await page.locator('.flh-saved').waitFor({ timeout: 60000 });
}

async function run() {
  const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {});
  psql(`delete from public.homes where search_id = ${lit(info.search)} and (address ~ '^5162[0-9] Sass Rd' or address ~ '^5169[0-9] Sass Rd' or address ~ '^51619 Sass Rd' or listing_url ~ '/5161[9]-Sass')`);
  const metrics = {};
  for (const [label, device] of VIEWPORTS) {
    for (const [kind, number] of HOMES) {
      psql(`delete from public.homes where search_id = ${lit(info.search)} and (address ~ ${lit(`^${number} `)} or listing_url ~ ${lit(`/${number}-Sass`)})`);
      const page = await signedIn(browser, 'owner', device);
      await addHome(page, number);
      await page.screenshot({ path: join(outDir, `${prefix}-${label}-${kind}-1-saved.png`) });
      metrics[`${label}/${kind}/saved`] = await page.evaluate(() => ({
        actions: [...document.querySelectorAll('.flh-saved button')].filter((el) => el.offsetParent).map((el) => el.innerText.trim() || el.getAttribute('aria-label')),
        text: document.querySelector('.flh-saved')?.innerText,
      }));
      await page.getByRole('button', { name: /^(View home|See your Match|Open home)/ }).first().click();
      await page.locator('.flh-overlay[role="dialog"]:not(.is-loading)').waitFor({ timeout: 30000 });
      await page.waitForTimeout(600);
      await page.screenshot({ path: join(outDir, `${prefix}-${label}-${kind}-2-overlay-top.png`) });
      metrics[`${label}/${kind}/overlay`] = await measure(page);
      await fullOverlay(page, join(outDir, `${prefix}-${label}-${kind}-3-overlay-full.png`));
      await page.locator('#flh-match-title').evaluate((el) => el.scrollIntoView({ block: 'start' }));
      await page.waitForTimeout(300);
      await page.screenshot({ path: join(outDir, `${prefix}-${label}-${kind}-4-match.png`) });
      await page.context().close();
      console.log('captured', label, kind);
    }
    // The co-buyer opens the owner's enriched home: same shared facts, own Match.
    const id = psql(`select id from public.homes where search_id = ${lit(info.search)} and address ~ '^51692 '`);
    const co = await signedIn(browser, 'coBuyer', device);
    await co.goto(`${base}/homes/${id}`, { waitUntil: 'networkidle' });
    await co.locator('.flh-overlay[role="dialog"]:not(.is-loading)').waitFor({ timeout: 30000 });
    await co.waitForTimeout(600);
    await co.screenshot({ path: join(outDir, `${prefix}-${label}-cobuyer-2-overlay-top.png`) });
    metrics[`${label}/cobuyer/overlay`] = await measure(co);
    await fullOverlay(co, join(outDir, `${prefix}-${label}-cobuyer-3-overlay-full.png`));
    await co.locator('#flh-match-title').evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await co.waitForTimeout(300);
    await co.screenshot({ path: join(outDir, `${prefix}-${label}-cobuyer-4-match.png`) });
    await co.context().close();
    console.log('captured', label, 'cobuyer');
  }
  writeFileSync(join(outDir, `${prefix}-metrics.json`), JSON.stringify(metrics, null, 2));
  await browser.close();
}

run().catch((error) => { console.error(error); process.exit(1); });
