#!/usr/bin/env node
// Home Facts visual QA. Development only; never runs against production.
//
//   1. npm run dev                                  (serves /dev/home-facts; no .env needed)
//   2. node scripts/visual/home-facts-screens.mjs <outDir> [baseUrl]
//        Screenshots every Home Facts / Add Home scenario at 390 / 768 / 1024 /
//        1440 px and records horizontal overflow in <outDir>/manifest.json (any
//        overflow, console error, or failed interaction also fails the run).
//
// The Add Home scenarios answer /api/import-listing with a fixture, so no
// RentCast key or Supabase session is involved.
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';

const WIDTHS = [
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1440, height: 900 },
];

const IMPORT_RESPONSE = {
  found: true,
  fields: {
    address: '51613 Sass Rd, New Baltimore, MI 48047', price: '335000', beds: '5', baths: '2', sqft: '2080',
    lotSize: '0.29 acres', yearBuilt: '1993', propertyType: 'house', basementNotes: 'Unfinished', garageSpaces: '2',
    daysOnMarket: '23', latitude: 42.68, longitude: -82.73, propertyTaxAnnual: 4210, propertyTaxYear: 2025,
  },
  findings: [], resolutions: [],
  listingFacts: [
    { key: 'stories', label: 'Stories / levels', value: 2, group: 'structure' },
    { key: 'exterior', label: 'Exterior', value: 'Vinyl siding', group: 'structure' },
    { key: 'roof', label: 'Roof', value: 'Asphalt shingle', group: 'structure' },
    { key: 'garageType', label: 'Garage', value: 'Attached', group: 'parking' },
    { key: 'heating', label: 'Heating', value: 'Forced air', group: 'utilities' },
    { key: 'cooling', label: 'Cooling', value: 'Central', group: 'utilities' },
    { key: 'status', label: 'Listing status', value: 'Active', group: 'listing' },
  ],
  descriptionFeatures: [{ id: 'deck', label: 'Deck' }, { id: 'hardwood-floors', label: 'Hardwood floors' }],
};

// Expected noise: the service worker's /sw.js fetch reaches the session
// middleware, which has no Supabase configuration in this preview; and the
// save-error scenario logs its own simulated failure.
const IGNORED_CONSOLE = /Download the React DevTools|favicon|bad HTTP response code \(500\) was received when fetching the script|Simulated save failure/;

const SCENARIOS = [
  { name: '01-add-home-found', query: 'view=add&state=found', act: async (page) => {
    await page.getByText('We found your home').waitFor();
    if (await page.getByRole('button', { name: /Review details first/ }).count()) throw new Error('a competing Review action is still shown');
  } },
  { name: '01b-add-home-saved', query: 'view=add&state=found', act: async (page) => {
    // Nothing is saved while the found card is showing.
    if (await page.getByTestId('preview-saved').count()) throw new Error('saved before Add to My Homes');
    // A double click must still save exactly once, with the imported values and snapshot.
    await page.getByRole('button', { name: 'Add to My Homes' }).dblclick();
    const saved = page.getByTestId('preview-saved');
    await saved.waitFor();
    await page.waitForTimeout(400);
    const attrs = await saved.evaluate((el) => ({ ...el.dataset, text: el.textContent }));
    const expect = { saveCalls: '1', address: '51613 Sass Rd, New Baltimore, MI 48047', price: '335000', garage: '2', snapshotFacts: '7' };
    for (const [key, value] of Object.entries(expect)) if (attrs[key] !== value) throw new Error(`saved ${key}=${attrs[key]}, expected ${value}`);
    if (!attrs.listingUrl.startsWith('https://www.zillow.com/')) throw new Error('listing URL lost');
    if (!attrs.text.includes('?added=import')) throw new Error('not routed to the import landing');
  } },
  { name: '01c-add-home-save-error', query: 'view=add&state=error', act: async (page) => {
    await page.getByRole('button', { name: 'Add to My Homes' }).click();
    await page.getByRole('alert').waitFor();
  } },
  { name: '01e-add-home-duplicate', query: 'view=add&state=duplicate', act: async (page) => { await page.getByText('This home is already here').waitFor(); } },
  { name: '01f-add-home-manual', query: 'view=add&state=manual', act: async (page) => {
    await page.getByText(/Can.t find the home/).click();
    await page.getByRole('button', { name: 'Enter manually' }).click();
    await page.getByRole('heading', { name: 'Where is this home?' }).waitFor();
  } },
  { name: '02-home-facts-landing', query: 'state=full', act: async (page) => { await page.getByText('We found your home.').waitFor(); } },
  { name: '03-home-details-editing', query: 'state=full', act: async (page) => {
    await page.getByRole('button', { name: 'Edit home details' }).click();
    await page.getByRole('group', { name: /Home condition/ }).waitFor();
    await page.locator('.flh-hf-group.is-details').scrollIntoViewIfNeeded();
  } },
  { name: '03b-property-editing', query: 'state=full', act: async (page) => {
    await page.getByRole('button', { name: 'Edit property' }).click();
    await page.getByLabel('Lot size (acres)').fill('10,890 sq ft');
    await page.getByText('Saves as 0.25 acres').waitFor();
  } },
  { name: '04-saved-home-facts', query: 'state=saved' },
  { name: '05-legacy-home', query: 'state=legacy', act: async (page) => { await page.getByText('Listing says: Forced air').waitFor(); } },
  { name: '06-no-photo', query: 'state=nophoto' },
  { name: '07-partial-import', query: 'state=partial' },
  { name: '08-unknown-facts', query: 'state=unknown' },
  { name: '09-manual-entry', query: 'state=manual', act: async (page) => { await page.getByText('Your home is saved.').waitFor(); } },
  { name: '10-realtor-read-only', query: 'state=realtor', act: async (page) => {
    if (await page.getByRole('button', { name: /^Edit/ }).count()) throw new Error('Realtor view shows an Edit control');
    await page.locator('.flh-workspace-nav').getByRole('button', { name: /Match Criteria/ }).click();
    await page.getByRole('heading', { level: 1, name: 'Match Criteria' }).waitFor();
    if (await page.getByRole('radio').count()) throw new Error('Realtor view shows answer controls');
    await page.locator('.flh-workspace-nav').getByRole('button', { name: /Tour Feedback/ }).click();
    await page.getByRole('heading', { level: 1, name: 'Tour Feedback' }).waitFor();
    for (const name of [/Want to tour/, /Record your take/, /Add pros, cons/, /Archive/]) {
      if (await page.getByRole('button', { name }).count()) throw new Error(`Realtor Tour Feedback shows ${name}`);
    }
  } },
  { name: '11-cobuyer', query: 'state=cobuyer' },
  { name: '12-match-criteria', query: 'state=saved&section=match', act: async (page) => {
    await page.getByRole('heading', { level: 1, name: 'Match Criteria' }).waitFor();
    for (const tier of ['Must-Haves', 'Important', 'Nice to Have']) await page.getByRole('heading', { level: 2, name: tier }).waitFor();
    const current = await page.locator('.flh-workspace-nav [aria-current="page"]').textContent();
    if (!current.includes('Match Criteria')) throw new Error('nav does not mark Match Criteria current');
  } },
  { name: '12b-unknown-section-falls-back', query: 'state=saved&section=bogus', act: async (page) => {
    await page.getByRole('heading', { level: 1, name: 'Home Facts' }).waitFor();
  } },
  { name: '13-tour-feedback', query: 'state=saved&section=tour' },
  { name: '14-next-and-switch-sections', query: 'state=saved', act: async (page) => {
    await page.getByRole('button', { name: /Next: Match Criteria/ }).click();
    await page.getByRole('heading', { level: 1, name: 'Match Criteria' }).waitFor();
    if (!page.url().includes('section=match')) throw new Error('Next did not reach Match Criteria');
    await page.locator('.flh-workspace-nav').getByRole('button', { name: /Tour Feedback/ }).click();
    await page.getByRole('heading', { level: 1, name: 'Tour Feedback' }).waitFor();
    await page.locator('.flh-workspace-nav').getByRole('button', { name: /Home Facts/ }).click();
    await page.getByRole('heading', { level: 1, name: 'Home Facts' }).waitFor();
    if (page.url().includes('section=')) throw new Error('Home Facts should carry no section parameter');
    // Switching areas never stacks history entries.
    if (await page.evaluate(() => window.history.length) !== 2) throw new Error('section switches added history entries');
  } },
];

async function main() {
  const [outArg, baseUrl = 'http://localhost:3000'] = process.argv.slice(2);
  if (!outArg) throw new Error('Usage: home-facts-screens.mjs <outDir> [baseUrl]');
  const outDir = resolve(outArg);
  await mkdir(outDir, { recursive: true });
  const browser = await chromium.launch();
  const manifest = [];
  let failed = false;
  for (const viewport of WIDTHS) {
    for (const scenario of SCENARIOS) {
      const page = await browser.newPage({ viewport });
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => { if (message.type() === 'error' && !IGNORED_CONSOLE.test(message.text())) errors.push(message.text()); });
      await page.route('**/api/import-listing', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(IMPORT_RESPONSE) }));
      const file = `${scenario.name}-${viewport.width}.png`;
      let error = null;
      try {
        await page.goto(`${baseUrl}/dev/home-facts?${scenario.query}`, { waitUntil: 'networkidle' });
        await page.evaluate(() => document.fonts.ready);
        if (scenario.act) await scenario.act(page);
        await page.waitForTimeout(250);
        await page.screenshot({ path: join(outDir, file), fullPage: !/^0(1[a-f]?|3b?)-/.test(scenario.name) });
      } catch (err) { error = err.message; }
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth).catch(() => null);
      const entry = { file, width: viewport.width, overflow, error, consoleErrors: errors };
      if (error || overflow > 0 || errors.length) { failed = true; console.error('FAIL', entry); }
      manifest.push(entry);
      await page.close();
    }
  }
  await browser.close();
  await writeFile(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`${manifest.length} screenshots → ${outDir}${failed ? ' (with failures)' : ''}`);
  if (failed) process.exitCode = 1;
}

main().catch((error) => { console.error(error); process.exit(1); });
