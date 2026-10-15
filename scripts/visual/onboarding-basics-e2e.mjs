#!/usr/bin/env node
// Onboarding Basics browser QA against the development preview (/dev/onboarding;
// never production). Start `npm run dev`, then:
//   node scripts/visual/onboarding-basics-e2e.mjs [baseUrl]
// Checks the search-type selector (new and returning users), inline validation,
// Home preferences → What Matters → Rank → completion in the live flow,
// keyboard use, tap-target sizes and horizontal overflow at 390 and 1440px.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const base = `${process.argv[2] || 'http://localhost:3000'}/dev/onboarding`;
const b = await chromium.launch();
const results = [];
const check = async (name, fn) => { try { await fn(); results.push(['PASS', name]); } catch (e) { results.push(['FAIL', name, e.message.split('\n').slice(0,6).join(' ')]); } };
for (const width of [390, 1440]) {
  const page = await b.newPage({ viewport: { width, height: 900 } });
  await check(`${width}: brand-new user — nothing preselected, Continue explains, live flow completes`, async () => {
    await page.goto(`${base}?step=basics&state=empty`, { waitUntil: 'networkidle' });
    for (const name of ['Home to Buy', 'Home to Rent', 'Apartment to Rent']) assert.equal(await page.getByRole('radio', { name: new RegExp(name) }).isChecked(), false);
    assert.equal(await page.getByRole('button', { name: /Home preferences/ }).count(), 0, 'no Home preferences before a type');
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('alert').filter({ hasText: 'Choose what you’re looking for' }).waitFor();
    assert.equal(await page.evaluate(() => document.activeElement?.value), 'home_buy', 'focus moved to the choices');
    assert.match(await page.locator('h1').innerText(), /The Basics/, 'did not proceed');
    await page.getByRole('radio', { name: /Home to Buy/ }).click();
    assert.equal(await page.getByRole('alert').filter({ hasText: 'Choose what' }).count(), 0, 'error clears once chosen');
    assert.equal(await page.getByLabel('Maximum budget').count(), 1);
    await page.getByRole('button', { name: /Home preferences/ }).click();
    await page.getByRole('group', { name: 'Layout' }).getByRole('checkbox', { name: 'Ranch' }).click();
    await page.getByRole('group', { name: 'Garage' }).getByRole('radio', { name: 'Attached' }).click();
    await page.getByRole('group', { name: 'Yard' }).getByRole('checkbox', { name: 'Unfenced' }).click();
    await page.getByRole('group', { name: 'Yard' }).getByRole('checkbox', { name: 'Unfenced' }).click();
    assert.match(await page.locator('.flh-ob-home-prefs .flh-ob-disclosure-summary').innerText(), /^Ranch · Attached garage$/);
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('heading', { name: 'What matters to you?' }).waitFor();
    assert.match(await page.locator('.flh-count-row').innerText(), /Plus 2 home preferences from The Basics/);
    assert.equal(await page.getByRole('button', { name: 'Garage', exact: true }).count(), 0, 'Garage not repeated');
    await page.getByRole('button', { name: 'Kitchen Island', exact: true }).click();
    await page.getByRole('button', { name: 'Rank my priorities' }).click();
    await page.getByRole('heading', { name: 'Now rank what matters most.' }).waitFor();
    const important = await page.locator('.flh-rank-level-important .flh-rank-row').allInnerTexts();
    assert.deepEqual(important.map((t) => t.replace(/\s+/g, ' ').trim()), ['Kitchen Island', 'Garage Attached', 'Layout Ranch']);
    assert.equal(await page.locator('.flh-rank-level-must .flh-rank-row').count(), 0, 'nothing defaults to Must-Have');
    await page.getByRole('button', { name: /^Layout, Ranch/ }).click();
    await page.getByRole('radio', { name: /Must Have/ }).click();
    assert.deepEqual((await page.locator('.flh-rank-level-must .flh-rank-row').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim()), ['Layout Ranch']);
    await page.getByRole('button', { name: 'Finish', exact: true }).click();
    await page.getByRole('heading', { name: 'Your search is ready.' }).waitFor();
  });
  await check(`${width}: returning user — saved type kept; re-choosing changes nothing; switching explains with Undo`, async () => {
    await page.goto(`${base}?step=basics&state=populated`, { waitUntil: 'networkidle' });
    assert.equal(await page.getByRole('radio', { name: /Home to Buy/ }).isChecked(), true);
    await page.getByRole('radio', { name: /Home to Buy/ }).click();
    assert.equal(await page.locator('.flh-ob-switch-note').count(), 0);
    const before = await page.locator('.flh-ob-home-prefs .flh-ob-disclosure-summary').innerText();
    await page.getByRole('radio', { name: /Home to Rent/ }).click();
    const note = await page.locator('.flh-ob-switch-note').innerText();
    assert.match(note, /Now looking for a home to rent\. Removed what no longer applies: .*Ranch/);
    assert.equal(await page.getByText('Maximum monthly rent').count(), 1, 'rent label');
    await page.getByRole('button', { name: 'Undo' }).click();
    assert.equal(await page.getByRole('radio', { name: /Home to Buy/ }).isChecked(), true);
    assert.equal(await page.locator('.flh-ob-home-prefs .flh-ob-disclosure-summary').innerText(), before);
    assert.equal(await page.getByText('Maximum budget').count(), 1);
  });
  await check(`${width}: keyboard — arrow keys move between search types; Space toggles a preference`, async () => {
    await page.goto(`${base}?step=basics&state=empty`, { waitUntil: 'networkidle' });
    await page.getByRole('radio', { name: /Home to Buy/ }).focus();
    await page.keyboard.press('Space');
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.getByRole('radio', { name: /Home to Rent/ }).isChecked(), true);
    await page.getByRole('button', { name: /Home preferences/ }).focus();
    await page.keyboard.press('Enter');
    const pill = page.getByRole('group', { name: 'Home type' }).getByRole('checkbox', { name: 'Townhome' });
    await pill.focus(); await page.keyboard.press('Space');
    assert.equal(await pill.isChecked(), true);
  });
  await check(`${width}: tap targets — search choices ≥ 44px, preference pills ≥ ${width < 560 ? 44 : 36}px`, async () => {
    await page.goto(`${base}?step=basics&state=populated`, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: /Home preferences/ }).click();
    const heights = await page.$$eval('.flh-ob-searchtype-option', (els) => els.map((el) => el.getBoundingClientRect().height));
    assert.ok(heights.every((h) => h >= 44), heights.join(','));
    const pills = await page.$$eval('.flh-ob-pill-compact', (els) => els.map((el) => el.getBoundingClientRect().height));
    assert.ok(pills.every((h) => h >= (width < 560 ? 44 : 36)), pills.join(','));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
  });
  await page.close();
}
await b.close();
for (const r of results) console.log(r.join(' | '));
process.exit(results.some((r) => r[0] === 'FAIL') ? 1 : 0);
