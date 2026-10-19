#!/usr/bin/env node
// Browser QA for Home Facts completeness (PR #160). DEVELOPMENT ONLY.
// Same setup as home-overlay-e2e.mjs (stand-in + dev server with the RentCast
// fixture), then:
//
//   FLH_TEST_PGHOST=… FLH_TEST_PGPORT=… node scripts/qa/home-facts-completeness-e2e.mjs standin.json <outDir> [baseUrl]
//
// Drives the real app on desktop, iPad and iPhone viewports (Chromium device
// emulation) as the owner, the co-buyer and the Realtor against real Postgres:
// HOA Unknown → confirmed $0 → amount, the tax year beside a corrected amount,
// Townhome, and the apartment floor plan / unit. Checks the database after each
// step. Any failed step, horizontal overflow or console error fails the run.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { register } from 'node:module';
import { chromium, devices } from 'playwright';

register('../../test/support/aliasHooks.mjs', import.meta.url);
const { normalizePriorities } = await import('../../src/lib/constants.js');
const { applySearchChoice } = await import('../../src/lib/onboarding.js');

const [infoPath, outArg, base = 'http://localhost:3200'] = process.argv.slice(2);
if (!infoPath || !outArg) throw new Error('Usage: home-facts-completeness-e2e.mjs <standin.json> <outDir> [baseUrl]');
const info = JSON.parse(readFileSync(infoPath, 'utf8').split('\n')[0]);
const outDir = resolve(outArg);
mkdirSync(outDir, { recursive: true });
const OWNER = info.users.owner.id;
const IGNORED_CONSOLE = /Download the React DevTools|favicon|maps\.googleapis|Google Maps|places|Failed to load resource/i;
const VIEWPORTS = [
  ['desktop-1440', { viewport: { width: 1440, height: 900 } }],
  ['ipad-820', devices['iPad Air'] || { viewport: { width: 820, height: 1180 }, isMobile: true, hasTouch: true }],
  ['iphone-390', devices['iPhone 13']],
];

function psql(sql) {
  const result = spawnSync('psql', ['-X', '-q', '-A', '-t', '-h', process.env.FLH_TEST_PGHOST, '-p', process.env.FLH_TEST_PGPORT || '5432', '-U', 'postgres', '-d', info.database, '-c', sql], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
}
const q = (sql) => JSON.parse(psql(`select coalesce(json_agg(t), '[]'::json) from (${sql}) t`));
const lit = (value) => `'${String(value).replace(/'/g, "''")}'`;
const assert = (condition, message) => { if (!condition) throw new Error(message); };
// jsonb stores keys in its own order: compare values, not key order.
const sorted = (value) => (Array.isArray(value) ? value.map(sorted) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, sorted(value[key])])) : value);
const sameJson = (a, b) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));
const homeRow = (id) => q(`select hoa_fee_monthly, property_tax_annual, property_tax_year, property_type, selected_floor_plan_name, selected_unit_label, heating, cooling, listing_import from public.homes where id = '${id}'`)[0];
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

// Phones collapse photo options, year/taxes/utilities and schools: open them.
const expandAll = async (page) => {
  for (let i = 0; i < 8; i += 1) {
    const toggle = page.locator('.flh-phone-collapse-toggle[aria-expanded="false"]:visible').first();
    if (!(await toggle.count())) return;
    await toggle.click();
  }
};
const overlayOpen = async (page) => {
  await page.locator('.flh-overlay[role="dialog"]:not(.is-loading)').waitFor({ timeout: 30000 });
  await page.getByRole('status').filter({ hasText: /Saved/ }).first().waitFor();
  await expandAll(page);
};
const commit = async (page, id, text) => {
  const input = page.locator(`#${id}`);
  await input.scrollIntoViewIfNeeded();
  await input.click();
  await input.fill(text);
  await input.press('Enter');
};
const shot = (page, name, element = null) => (element ? page.locator(element).screenshot({ path: join(outDir, `${name}.png`) }) : page.screenshot({ path: join(outDir, `${name}.png`), fullPage: true }));

function insertHome(fields) {
  const id = randomUUID();
  const columns = ['id', 'user_id', 'search_id', ...Object.keys(fields)];
  const values = [lit(id), lit(OWNER), lit(info.search), ...Object.values(fields).map((value) => (value === null ? 'null' : typeof value === 'object' ? `${lit(JSON.stringify(value))}::jsonb` : lit(value)))];
  psql(`insert into public.homes (${columns.join(',')}) values (${values.join(',')})`);
  return id;
}

async function run() {
  const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {});
  const snapshot = { fields: { address: '51613 Sass Rd, New Baltimore, MI 48047', price: '335000', propertyTaxAnnual: 4210, propertyTaxYear: 2025 }, listingFacts: [], descriptionFeatures: [] };

  for (const [label, device] of VIEWPORTS) {
    const homeId = insertHome({
      address: `${label === 'iphone-390' ? 7 : label === 'ipad-820' ? 8 : 9} Facts Ct, New Baltimore, MI 48047`, price: '335000', beds: '4', baths: '2', sqft: '2080',
      listing_url: `https://www.redfin.com/MI/New-Baltimore/${label}-Facts-Ct-48047/home/1`, listing_import: snapshot,
      property_tax_annual: '4210', property_tax_year: '2025', property_type: 'house', heating: 'Forced Air', cooling: 'Central Air',
    });
    let owner; let coBuyer; let realtor;
    const open = () => [owner, coBuyer, realtor].filter(Boolean);

    await step(`[${label}] HOA: Unknown is shown and offered, a confirmed $0 saves and reloads as No HOA, then an amount`, async () => {
      owner = await signedIn(browser, 'owner', device);
      await owner.goto(`${base}/homes/${homeId}`, { waitUntil: 'networkidle' });
      await overlayOpen(owner);
      const hoa = owner.locator('#hf-hoaFeeMonthly');
      assert(await hoa.count() === 1, 'HOA field not offered while Unknown');
      assert(await hoa.inputValue() === '' && (await hoa.getAttribute('placeholder')) === 'Unknown', 'Unknown HOA should read as Unknown');
      assert(await owner.getByText('Enter 0 if there’s no HOA').count() === 1, 'no $0 hint');
      await shot(owner, `${label}-1-hoa-unknown`);
      await commit(owner, 'hf-hoaFeeMonthly', '0');
      await until(() => Number(homeRow(homeId).hoa_fee_monthly) === 0 && homeRow(homeId).hoa_fee_monthly !== null, 'HOA $0 not saved');
      await owner.locator('.flh-overlay-save').filter({ hasText: /^\s*Saved\s*$/ }).waitFor();
      await owner.reload({ waitUntil: 'networkidle' });
      await overlayOpen(owner);
      assert(await owner.locator('#hf-hoaFeeMonthly').inputValue() === 'No HOA · $0/mo', `reloaded $0 reads "${await owner.locator('#hf-hoaFeeMonthly').inputValue()}"`);
      await owner.locator('#hf-hoaFeeMonthly').focus();
      assert(await owner.locator('#hf-hoaFeeMonthly').inputValue() === '0', 'editing a confirmed $0 must not open blank');
      await owner.locator('#hf-hoaFeeMonthly').blur();
      await shot(owner, `${label}-2-hoa-confirmed-zero`, '.flh-hf2-facts');
      assert(q(`select count(*)::int as n from public.home_member_state where home_id = '${homeId}' and checks <> '{}'::jsonb`)[0].n === 0, 'a personal answer was written');
    }, open);

    await step(`[${label}] tax year: correcting the amount clears the listing year; a typed year saves and reloads`, async () => {
      assert(await owner.locator('#hf-propertyTaxYear').inputValue() === '2025', 'listing year not shown');
      await commit(owner, 'hf-propertyTaxAnnual', '4800');
      await until(() => Number(homeRow(homeId).property_tax_annual) === 4800, 'amount not saved');
      await until(() => homeRow(homeId).property_tax_year === null, 'the old listing year was kept for a corrected amount');
      await until(async () => (await owner.locator('#hf-propertyTaxYear').inputValue()) === '', 'year field did not return to Unknown');
      await commit(owner, 'hf-propertyTaxYear', '1850');
      await owner.waitForTimeout(1200);
      assert(homeRow(homeId).property_tax_year === null, 'an invalid year was saved');
      await commit(owner, 'hf-propertyTaxYear', '2026');
      await until(() => homeRow(homeId).property_tax_year === 2026, 'tax year not saved');
      assert(sameJson(homeRow(homeId).listing_import, snapshot), 'the listing snapshot changed');
      await owner.locator('.flh-overlay-save').filter({ hasText: /^\s*Saved\s*$/ }).waitFor();
      await owner.reload({ waitUntil: 'networkidle' });
      await overlayOpen(owner);
      assert(await owner.locator('#hf-propertyTaxYear').inputValue() === '2026', 'tax year did not reload');
      assert((await owner.locator('#hf-propertyTaxAnnual').inputValue()).startsWith('$4,800'), 'amount did not reload');
      await shot(owner, `${label}-3-taxes`, '.flh-hf2-header');
    }, open);

    await step(`[${label}] Townhome: offered, saved as the canonical value, reloads; heating and cooling unchanged`, async () => {
      const select = owner.locator('#hf-propertyType');
      const options = await select.locator('option').allTextContents();
      assert(JSON.stringify(options) === JSON.stringify(['Unknown', 'Single-Family', 'Townhome', 'Multi-Family', 'Condominium']), `options: ${options}`);
      await select.selectOption('townhome');
      await until(() => homeRow(homeId).property_type === 'townhome', 'Townhome not saved');
      await owner.locator('.flh-overlay-save').filter({ hasText: /^\s*Saved\s*$/ }).waitFor();
      await owner.reload({ waitUntil: 'networkidle' });
      await overlayOpen(owner);
      assert(await owner.locator('#hf-propertyType').inputValue() === 'townhome', 'Townhome did not reload');
      assert(await owner.locator('#hf-heating').inputValue() === 'Forced Air' && await owner.locator('#hf-cooling').inputValue() === 'Central Air', 'heating/cooling changed');
      assert(homeRow(homeId).heating === 'Forced Air' && homeRow(homeId).cooling === 'Central Air', 'heating/cooling changed in the database');
      await shot(owner, `${label}-4-property-type`, '.flh-hf2-facts');
    }, open);

    await step(`[${label}] co-buyer edits the HOA amount; the owner sees it; back to Unknown`, async () => {
      coBuyer = await signedIn(browser, 'coBuyer', device);
      await coBuyer.goto(`${base}/homes/${homeId}`, { waitUntil: 'networkidle' });
      await overlayOpen(coBuyer);
      await commit(coBuyer, 'hf-hoaFeeMonthly', '325');
      await until(() => Number(homeRow(homeId).hoa_fee_monthly) === 325, 'co-buyer HOA not saved');
      await coBuyer.locator('.flh-overlay-save').filter({ hasText: /^\s*Saved\s*$/ }).waitFor();
      await owner.reload({ waitUntil: 'networkidle' });
      await overlayOpen(owner);
      assert(await owner.locator('#hf-hoaFeeMonthly').inputValue() === '$325/mo', 'owner does not see the co-buyer HOA');
      await commit(owner, 'hf-hoaFeeMonthly', '');
      await until(() => homeRow(homeId).hoa_fee_monthly === null, 'clearing HOA did not return it to Unknown');
      await owner.locator('.flh-overlay-save').filter({ hasText: /^\s*Saved\s*$/ }).waitFor();
      await commit(owner, 'hf-hoaFeeMonthly', '325');
      await until(() => Number(homeRow(homeId).hoa_fee_monthly) === 325, 'HOA not restored');
      await owner.locator('.flh-overlay-save').filter({ hasText: /^\s*Saved\s*$/ }).waitFor();
    }, open);

    await step(`[${label}] Realtor sees HOA, taxes and Townhome read-only`, async () => {
      realtor = await signedIn(browser, 'realtor', device);
      await realtor.goto(`${base}/people/${info.search}/homes/${homeId}`, { waitUntil: 'networkidle' });
      await realtor.getByText('$325/mo').first().waitFor({ timeout: 30000 });
      assert(await realtor.getByText('Enter 0 if there’s no HOA').count() === 0, 'the editing hint is shown to a read-only Realtor');
      await expandAll(realtor);
      for (const id of ['hf-hoaFeeMonthly', 'hf-propertyTaxAnnual', 'hf-propertyTaxYear', 'hf-propertyType']) {
        assert(await realtor.locator(`#${id}`).count() === 0, `Realtor can edit ${id}`);
      }
      const body = await realtor.locator('body').innerText();
      for (const text of ['$325/mo', 'Townhome', '2026']) assert(body.includes(text), `Realtor does not see ${text}`);
      await shot(realtor, `${label}-5-realtor-read-only`);
    }, open);

    for (const page of open()) await page.context().close();
  }

  // Apartments: the floor plan name and unit in the full editor ("More property details").
  const original = q(`select priorities from public.search_member_priorities where search_id = '${info.search}' and user_id = '${OWNER}'`)[0].priorities;
  try {
    psql(`update public.search_member_priorities set priorities = ${lit(JSON.stringify(applySearchChoice(normalizePriorities({}), 'apartment_rent')))}::jsonb where search_id = '${info.search}' and user_id = '${OWNER}'`);
    for (const [label, device] of VIEWPORTS) {
      const homeId = insertHome({ address: `${label.length} Tower Pl, Ann Arbor, MI 48104`, property_name: `The Tower ${label}`, property_type: 'apartment', price: '' });
      let owner;
      await step(`[${label}] apartment: floor plan name and unit edit in the full editor, save, reload and show`, async () => {
        owner = await signedIn(browser, 'owner', device);
        await owner.goto(`${base}/homes/${homeId}`, { waitUntil: 'networkidle' });
        await overlayOpen(owner);
        assert(await owner.locator('#hf-hoaFeeMonthly').count() === 0, 'HOA offered on an apartment');
        assert(await owner.locator('#hf-propertyTaxYear').count() === 0, 'tax year offered on an apartment');
        await owner.getByRole('button', { name: 'More property details' }).click();
        await owner.locator('#home-floor-plan-name').waitFor();
        await owner.locator('#home-floor-plan-name').fill('The Aspen');
        await owner.locator('#home-unit-label').fill('304');
        await shot(owner, `${label}-6-apartment-editor`);
        await owner.getByRole('button', { name: 'Save changes' }).click();
        await until(() => homeRow(homeId).selected_unit_label === '304' && homeRow(homeId).selected_floor_plan_name === 'The Aspen', 'floor plan / unit not saved');
        await owner.locator('#home-floor-plan-name').waitFor({ state: 'detached' });
        await owner.reload({ waitUntil: 'networkidle' });
        await overlayOpen(owner);
        await owner.locator('.flh-hf2-header').getByText('The Aspen · 304').waitFor();
        await shot(owner, `${label}-7-apartment-facts`, '.flh-hf2-header');
        await owner.goto(`${base}/homes`, { waitUntil: 'networkidle' });
        await owner.getByText('The Aspen · 304').first().waitFor();
      }, () => (owner ? [owner] : []));
      if (owner) await owner.context().close();
    }
  } finally {
    psql(`update public.search_member_priorities set priorities = ${lit(JSON.stringify(original))}::jsonb where search_id = '${info.search}' and user_id = '${OWNER}'`);
  }

  await browser.close();
  writeFileSync(join(outDir, 'results.json'), JSON.stringify(log, null, 2));
  const failed = log.filter((entry) => !entry.ok);
  console.log(`\n${log.length - failed.length}/${log.length} steps passed`);
  if (failed.length) process.exit(1);
}

await run();
