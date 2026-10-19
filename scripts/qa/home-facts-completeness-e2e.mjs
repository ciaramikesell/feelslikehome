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
  // iPad (10th/11th gen) portrait: Playwright's iPad UA and touch, at the device's 820 × 1180.
  ['ipad-820', { ...devices['iPad (gen 11)'], viewport: { width: 820, height: 1180 } }],
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

// installBanner: leave the "Add to your home screen" banner undismissed (it
// shows on iPhone / iPad user agents) to check it never covers a modal's controls.
async function signedIn(browser, who, device, { installBanner = false } = {}) {
  const context = await browser.newContext({ ...device });
  await context.addCookies([{ name: 'sb-localhost-auth-token', value: `base64-${Buffer.from(JSON.stringify(info.users[who].session)).toString('base64url')}`, domain: 'localhost', path: '/' }]);
  await context.addInitScript((keepBanner) => { try { localStorage.setItem('flh-mobile-tour-dismissed', '1'); localStorage.setItem('flh-what-flh-found-dismissed', '1'); if (!keepBanner) localStorage.setItem('flh-install-dismissed', '1'); } catch { /* ignore */ } }, installBanner);
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
const banner = (page) => page.locator('div').filter({ hasText: /^Add to your home screen/ }).filter({ has: page.getByRole('button', { name: 'Dismiss' }) });
const bannerShown = async (page) => (await banner(page).count()) > 0 && banner(page).first().isVisible();
// The control really receives a tap at its centre (nothing fixed on top of it).
const tappable = (page, locator) => locator.evaluate((node) => {
  const box = node.getBoundingClientRect();
  const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
  return !!hit && (hit === node || node.contains(hit));
});
const shot = (page, name, element = null, { viewportOnly = false } = {}) => (element ? page.locator(element).screenshot({ path: join(outDir, `${name}.png`) }) : page.screenshot({ path: join(outDir, `${name}.png`), fullPage: !viewportOnly }));

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

    await step(`[${label}] HOA: Unknown is shown and offered, a confirmed $0 saves and reloads as $0/mo (never \"No HOA\"), then an amount`, async () => {
      owner = await signedIn(browser, 'owner', device);
      await owner.goto(`${base}/homes/${homeId}`, { waitUntil: 'networkidle' });
      await overlayOpen(owner);
      const hoa = owner.locator('#hf-hoaFeeMonthly');
      assert(await hoa.count() === 1, 'HOA field not offered while Unknown');
      assert(await hoa.inputValue() === '' && (await hoa.getAttribute('placeholder')) === 'Unknown', 'Unknown HOA should read as Unknown');
      assert(await owner.getByText('Enter 0 for a $0 monthly fee').count() === 1, 'no $0 hint');
      await shot(owner, `${label}-1-hoa-unknown`);
      await commit(owner, 'hf-hoaFeeMonthly', '0');
      await until(() => Number(homeRow(homeId).hoa_fee_monthly) === 0 && homeRow(homeId).hoa_fee_monthly !== null, 'HOA $0 not saved');
      await owner.locator('.flh-overlay-save').filter({ hasText: /^\s*Saved\s*$/ }).waitFor();
      await owner.reload({ waitUntil: 'networkidle' });
      await overlayOpen(owner);
      assert(await owner.locator('#hf-hoaFeeMonthly').inputValue() === '$0/mo', `reloaded $0 reads "${await owner.locator('#hf-hoaFeeMonthly').inputValue()}"`);
      assert(!/no hoa/i.test(await owner.locator('.flh-overlay').innerText()), 'a $0 fee must never read as "No HOA"');
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
      // Half-typed: the typing pause neither saves nor scolds.
      await owner.locator('#hf-propertyTaxYear').fill('20');
      await owner.waitForTimeout(1300);
      assert(await owner.locator('.flh-quiet-error').count() === 0, 'the invalid-year message showed mid-typing');
      assert(homeRow(homeId).property_tax_year === null, 'a half-typed year was saved');
      // Invalid on Enter: kept on screen with a message, marked invalid, not saved.
      await commit(owner, 'hf-propertyTaxYear', '1850');
      await owner.locator('#hf-propertyTaxYear-invalid').waitFor();
      assert((await owner.locator('#hf-propertyTaxYear-invalid').innerText()).includes('four-digit year'), 'invalid-year message text');
      assert(await owner.locator('#hf-propertyTaxYear').inputValue() === '1850', 'the invalid text was thrown away instead of kept for fixing');
      assert(await owner.locator('#hf-propertyTaxYear').getAttribute('aria-invalid') === 'true', 'not marked invalid');
      await owner.locator('#hf-propertyTaxYear').blur();
      assert(await owner.locator('#hf-propertyTaxYear').inputValue() === '1850' && await owner.locator('#hf-propertyTaxYear-invalid').count() === 1, 'leaving the field silently reverted it');
      await owner.waitForTimeout(1200);
      assert(homeRow(homeId).property_tax_year === null, 'an invalid year was saved');
      await shot(owner, `${label}-3a-tax-year-invalid`, '.flh-hf2-header');
      // Corrected: the message clears and the year saves.
      await commit(owner, 'hf-propertyTaxYear', '2026');
      await until(async () => (await owner.locator('.flh-quiet-error').count()) === 0, 'the message stayed after a valid year');
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
      assert(await realtor.getByText('Enter 0 for a $0 monthly fee').count() === 0, 'the editing hint is shown to a read-only Realtor');
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
      const ios = label !== 'desktop-1440';
      await step(`[${label}] install banner: shown on My Homes${ios ? '' : ' (not on desktop)'}, steps aside for Add Home and a Sheet, back when they close`, async () => {
        owner = await signedIn(browser, 'owner', device, { installBanner: true });
        await owner.goto(`${base}/homes`, { waitUntil: 'networkidle' });
        await owner.waitForTimeout(800);
        assert(await bannerShown(owner) === ios, `banner on My Homes: expected ${ios}`);
        if (ios) await shot(owner, `${label}-8a-banner-my-homes`, null, { viewportOnly: true });
        const add = owner.locator('button.hh-homes-add:visible, button:visible', { hasText: /Add a Property/i }).first();
        await add.click();
        await owner.locator('.hh-add-home-discovery[role="dialog"]').waitFor();
        await owner.waitForTimeout(300);
        assert(!(await bannerShown(owner)), 'banner covers the Add Home dialog');
        const find = owner.getByRole('button', { name: /^Find property/ });
        if (ios) assert(await tappable(owner, owner.getByRole('button', { name: 'Close add home' })), 'Add Home close is covered');
        assert(await find.count() === 1, 'Find button missing');
        await owner.getByRole('button', { name: 'Close add home' }).click();
        await owner.locator('.hh-add-home-discovery').waitFor({ state: 'detached' });
        await owner.waitForTimeout(300);
        assert(await bannerShown(owner) === ios, 'banner did not come back after Add Home closed');
        // A Sheet (the card's Archive confirmation), closed with Escape so nothing is archived.
        await owner.locator('button:visible', { hasText: /^Archive$/ }).first().click();
        await owner.locator('.hh-sheet[role="dialog"]').waitFor();
        await owner.waitForTimeout(300);
        assert(!(await bannerShown(owner)), 'banner covers the Archive sheet');
        await owner.keyboard.press('Escape');
        await owner.locator('.hh-sheet[role="dialog"]').waitFor({ state: 'detached' });
        await owner.waitForTimeout(300);
        assert(await bannerShown(owner) === ios, 'banner did not come back after the sheet closed');
        assert(await owner.evaluate(() => localStorage.getItem('flh-install-dismissed')) === null, 'stepping aside dismissed the banner for good');
      }, () => (owner ? [owner] : []));

      await step(`[${label}] apartment: floor plan name and unit edit in the full editor, save, reload and show`, async () => {
        owner = owner || await signedIn(browser, 'owner', device, { installBanner: true });
        await owner.goto(`${base}/homes/${homeId}`, { waitUntil: 'networkidle' });
        await overlayOpen(owner);
        assert(!(await bannerShown(owner)), 'banner shown over the home overlay');
        assert(await owner.locator('#hf-hoaFeeMonthly').count() === 0, 'HOA offered on an apartment');
        assert(await owner.locator('#hf-propertyTaxYear').count() === 0, 'tax year offered on an apartment');
        await owner.getByRole('button', { name: 'More property details' }).click();
        await owner.locator('#home-floor-plan-name').waitFor();
        await owner.locator('#home-floor-plan-name').fill('The Aspen');
        await owner.locator('#home-unit-label').fill('304');
        assert(!(await bannerShown(owner)), 'banner shown over the editor');
        assert(await tappable(owner, owner.getByRole('button', { name: 'Save changes' })), 'Save changes is covered');
        await shot(owner, `${label}-6-apartment-editor`, null, { viewportOnly: ios });
        await owner.getByRole('button', { name: 'Save changes' }).click();
        await until(() => homeRow(homeId).selected_unit_label === '304' && homeRow(homeId).selected_floor_plan_name === 'The Aspen', 'floor plan / unit not saved');
        await owner.locator('#home-floor-plan-name').waitFor({ state: 'detached' });
        await owner.reload({ waitUntil: 'networkidle' });
        await overlayOpen(owner);
        await owner.locator('.flh-hf2-header').getByText('The Aspen · 304').waitFor();
        await shot(owner, `${label}-7-apartment-facts`, '.flh-hf2-header');
        await owner.goto(`${base}/homes`, { waitUntil: 'networkidle' });
        await owner.getByText('The Aspen · 304').first().waitFor();
        await owner.waitForTimeout(500);
        assert(await bannerShown(owner) === ios, 'banner did not return on My Homes');
        if (ios) {
          // Dismiss still works and still sticks.
          await banner(owner).first().getByRole('button', { name: 'Dismiss' }).click();
          assert(!(await bannerShown(owner)), 'Dismiss did not hide the banner');
          await owner.reload({ waitUntil: 'networkidle' });
          await owner.waitForTimeout(500);
          assert(!(await bannerShown(owner)), 'a dismissed banner came back');
        }
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
