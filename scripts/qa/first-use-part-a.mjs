// Focused, credential-free first-use browser checks. Run with the dev server:
// FLH_CHROMIUM=/usr/bin/chromium node scripts/qa/first-use-part-a.mjs [baseUrl] [outputDir]
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
const base = process.argv[2] || 'http://localhost:3100';
const out = process.argv[3] || '/tmp/flh-first-use';
await mkdir(out, { recursive: true });
const browser = await chromium.launch(process.env.FLH_CHROMIUM ? { executablePath: process.env.FLH_CHROMIUM } : {});
const results = [];
const check = (name, ok) => { results.push({ name, ok }); assert.ok(ok, name); };
async function fits(page, label) {
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
  check(`${label}: no horizontal overflow`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
}
try {
  for (const width of [320, 375, 390, 430]) {
    const context = await browser.newContext({ viewport: { width, height: 844 } });
    const page = await context.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${base}/`);
    await page.evaluate(() => document.documentElement.setAttribute('data-flh-native', ''));
    await fits(page, `welcome ${width}`);
    const lines = await page.locator('.flh-welcome-title').evaluate(el => el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight));
    check(`welcome tagline fits one line at ${width}`, lines < 1.1);
    await page.getByRole('button', { name: /Try a listing import/ }).click();
    await page.getByRole('button', { name: 'Share', exact: true }).click();
    await page.getByRole('button', { name: 'Feels Like Home', exact: true }).click();
    await page.getByRole('button', { name: 'Soaking Tub', exact: true }).click();
    check(`demo explains unknown at ${width}`, await page.locator('.flh-st-sample-result').innerText().then(t => t.includes('never counts against')));
    await fits(page, `demo ${width}`);
    await page.screenshot({ path: `${out}/demo-${width}.png`, fullPage: true, animations: 'disabled' });
    await page.keyboard.press('Escape');
    check(`demo restores focus ${width}`, await page.getByRole('button', { name: /Try a listing import/ }).evaluate(el => el === document.activeElement));
    await page.goto(`${base}/auth/sign-up`);
    await page.getByRole('button', { name: /Try a listing import before/ }).click();
    await page.keyboard.press('Escape');
    await page.getByLabel('First name', { exact: true }).fill('Sample');
    await page.getByLabel('Last name', { exact: true }).fill('Buyer');
    await page.getByLabel('First name', { exact: true }).focus(); await page.keyboard.press('Tab');
    check(`signup keyboard order ${width}`, await page.getByLabel('Last name', { exact: true }).evaluate(el => el === document.activeElement));
    await fits(page, `signup ${width}`);
    for (const search of ['home_buy', 'home_rent', 'apartment_rent']) {
      await page.goto(`${base}/dev/onboarding?flow=v3&step=search_type&search=${search}`);
      const label = { home_buy: 'Home to Buy', home_rent: 'Home to Rent', apartment_rent: 'Apartment to Rent' }[search];
      const radio = page.getByRole('radio', { name: label, exact: true }); await radio.check();
      await page.getByRole('button', { name: 'Continue', exact: true }).click();
      await page.getByRole('button', { name: /Let’s personalize/ }).click();
      await page.getByRole('button', { name: 'Continue', exact: true }).click();
      // Buyer reaches Layout; renters reach their pets question. Skip never chooses a feature.
      if (search === 'home_buy') await page.getByRole('button', { name: 'Skip', exact: true }).click();
      await fits(page, `${search} journey ${width}`);
      await page.screenshot({ path: `${out}/${search}-journey-${width}.png`, fullPage: true, animations: 'disabled' });
      await page.evaluate(() => document.documentElement.style.fontSize = '32px');
      await fits(page, `${search} 200% text ${width}`);
      await page.screenshot({ path: `${out}/${search}-large-text-${width}.png`, fullPage: true, animations: 'disabled' });
    }
    // Existing default preview uses the production flag-off flow, without changing the flag.
    await page.goto(`${base}/dev/onboarding?step=basics`);
    await page.getByRole('radio', { name: 'Home to Buy', exact: true }).check();
    check(`flag-off basics remains usable ${width}`, await page.getByRole('radio', { name: 'Home to Buy', exact: true }).isChecked());
    await fits(page, `flag-off ${width}`);
    check(`no runtime errors ${width}`, errors.length === 0);
    await context.close();
  }
} finally {
  await writeFile(`${out}/results.json`, JSON.stringify(results, null, 2));
  await browser.close();
}
console.log(`${results.length} first-use browser checks passed`);
