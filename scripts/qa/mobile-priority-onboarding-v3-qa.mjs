#!/usr/bin/env node
// Browser QA for Mobile Priority Onboarding V3 (flow 4), against the
// development-only preview (/dev/onboarding?flow=v3 — in-memory services, no
// Supabase). Development only.
//
//   1. npm run dev
//   2. node scripts/qa/mobile-priority-onboarding-v3-qa.mjs [baseUrl] [screenshotDir]
//
// Checks every screen at 375 / 390 / 430 px, desktop (1440) and large text
// (390 px at 150% and 200% zoom): no horizontal overflow, two-column cards on
// phones, Back · Skip · Continue visible with full tap targets, labels never
// clipped. Then walks the whole flow with the mouse and the keyboard: the
// importance sheet, suggestions, duplicate-proof Add your own, Back keeping
// answers, garage Not important (auto-advance and Back), Skip, the editable
// Review; the founder's photos (derivatives only, lazy, per screen, 400w/800w);
// Dead-End Street not offered; and missing, broken and corrupt images.
// Rentals (docs/rental-foundations-onboarding-spec.md, Stage 3): both rental
// flows end to end with exact screen counts, the pets question (Yes / No /
// Not sure, status line, exact Undo, a renter's own level respected), Home
// to Rent's lot-size importance, card hints, and the editable Review.
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://localhost:3100';
const OUT = process.argv[3] || null;
const launch = () => chromium.launch(process.env.FLH_CHROMIUM ? { executablePath: process.env.FLH_CHROMIUM } : {});
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };
const url = (query) => `${BASE}/dev/onboarding?flow=v3&${query}`;

async function ready(page) {
  await page.evaluate(() => document.fonts.ready);
  await page.addStyleTag({ content: 'nextjs-portal{display:none!important}' });
  await page.waitForTimeout(150);
}
async function shot(page, name, fullPage = true) {
  if (!OUT) return;
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage });
}

const SCREENS = [
  ['search-type', 'step=search_type&state=empty'],
  ['basics', 'step=basics&state=populated'],
  ['locations', 'step=locations&state=populated'],
  ['layout', 'step=cat_layout&state=populated'],
  ['kitchen', 'step=cat_kitchen&state=populated'],
  ['living', 'step=cat_living&state=populated'],
  ['bath', 'step=cat_bath&state=populated'],
  ['garage', 'step=cat_garage&state=populated'],
  ['exterior', 'step=cat_exterior&state=populated'],
  ['neighborhood', 'step=cat_neighborhood&state=populated'],
  ['review', 'step=review&state=legacy'],
  ['rent-basics', 'step=basics&state=populated&search=home_rent'],
  ['rent-essentials', 'step=cat_essentials&state=unanswered&search=home_rent'],
  ['rent-essentials-yes', 'step=cat_essentials&state=populated&search=home_rent'],
  ['rent-layout', 'step=cat_rent_layout&state=populated&search=home_rent'],
  ['rent-features', 'step=cat_rent_features&state=populated&search=home_rent'],
  ['rent-exterior', 'step=cat_exterior&state=populated&search=home_rent'],
  ['rent-neighborhood', 'step=cat_neighborhood&state=populated&search=home_rent'],
  ['rent-review', 'step=review&state=legacy&search=home_rent'],
  ['apartment-basics', 'step=basics&state=populated&search=apartment_rent'],
  ['apartment-essentials', 'step=cat_essentials&state=unanswered&search=apartment_rent'],
  ['apartment-unit', 'step=cat_apt_unit&state=populated&search=apartment_rent'],
  ['apartment-property', 'step=cat_apt_property&state=populated&search=apartment_rent'],
  ['apartment-review', 'step=review&state=populated&search=apartment_rent'],
];
const RENTAL_WIDE = [
  ['rent-essentials', 'step=cat_essentials&state=populated&search=home_rent'],
  ['rent-exterior', 'step=cat_exterior&state=populated&search=home_rent'],
  ['rent-review', 'step=review&state=legacy&search=home_rent'],
  ['apartment-unit', 'step=cat_apt_unit&state=populated&search=apartment_rent'],
  ['apartment-review', 'step=review&state=populated&search=apartment_rent'],
];

async function layoutChecks(page, label) {
  const facts = await page.evaluate(() => {
    const doc = document.documentElement;
    const cards = [...document.querySelectorAll('.flh-ob-pf-grid:not(.flh-ob-pf-grid-three) .flh-ob-pf-card')];
    const lefts = [...new Set(cards.map((card) => Math.round(card.getBoundingClientRect().left)))];
    const clipped = [...document.querySelectorAll('.flh-ob-pf-card-title, .flh-page-title, .flh-ob-pf-level-title')].filter((el) => el.scrollWidth > el.clientWidth + 1).map((el) => el.textContent);
    const footer = document.querySelector('.flh-ob-pf-footer');
    const buttons = footer ? [...footer.querySelectorAll('button')].map((button) => ({ text: button.textContent.trim(), h: button.getBoundingClientRect().height, w: button.getBoundingClientRect().width })) : [];
    return { overflow: doc.scrollWidth - doc.clientWidth, columns: lefts.length, cardCount: cards.length, clipped, buttons };
  });
  check(`${label}: no horizontal overflow`, facts.overflow <= 0, `${facts.overflow}px`);
  check(`${label}: no clipped labels`, facts.clipped.length === 0, facts.clipped.join(', '));
  if (facts.buttons.length) check(`${label}: footer targets ≥ 44px`, facts.buttons.every((button) => button.h >= 44 && button.w >= 44), JSON.stringify(facts.buttons));
  return facts;
}

const browser = await launch();
if (OUT) await mkdir(OUT, { recursive: true });

// 1. Every screen at three phone widths, desktop and large text.
for (const width of [375, 390, 430]) {
  const page = await browser.newPage({ viewport: { width, height: 844 }, deviceScaleFactor: 2 });
  for (const [name, query] of SCREENS) {
    await page.goto(url(query), { waitUntil: 'networkidle' });
    await ready(page);
    const facts = await layoutChecks(page, `${name} @${width}`);
    if (facts.cardCount > 1) check(`${name} @${width}: two-column card grid`, facts.columns === 2, `${facts.columns} columns`);
    if (name !== 'search-type' && !name.endsWith('review')) {
      const labels = facts.buttons.map((button) => button.text);
      check(`${name} @${width}: Back · Skip · Continue`, labels.some((t) => /Back/.test(t)) && labels.includes('Skip') && labels.some((t) => /Continue/.test(t)), labels.join(' | '));
    }
    if (width === 390 || ['kitchen', 'garage', 'review'].includes(name) || /^(rent|apartment)-/.test(name)) await shot(page, `${name}-${width}`);
  }
  await page.close();
}
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  for (const [name, query] of [['kitchen', 'step=cat_kitchen&state=populated'], ['review', 'step=review&state=legacy'], ['garage', 'step=cat_garage&state=populated'], ...RENTAL_WIDE]) {
    await page.goto(url(query), { waitUntil: 'networkidle' });
    await ready(page);
    const facts = await layoutChecks(page, `${name} @1440`);
    if (facts.cardCount > 2) check(`${name} @1440: wider grid on desktop`, facts.columns === 3, `${facts.columns} columns`);
    check(`${name} @1440: desktop step rail shown`, await page.locator('.flh-ob-rail').isVisible());
    check(`${name} @1440: rail names every screen (no raw step keys)`, !/cat_|search_type/.test(await page.locator('.flh-ob-rail').textContent()));
    await shot(page, `${name}-desktop-1440`);
  }
  await page.close();
}
for (const zoom of [1.5, 2]) {
  // A 390px phone with text and layout zoomed: the CSS viewport shrinks.
  const page = await browser.newPage({ viewport: { width: Math.round(390 / zoom), height: Math.round(844 / zoom) }, deviceScaleFactor: 2 * zoom });
  for (const [name, query] of [['kitchen', 'step=cat_kitchen&state=populated'], ['garage', 'step=cat_garage&state=populated'], ['review', 'step=review&state=legacy'], ...RENTAL_WIDE]) {
    await page.goto(url(query), { waitUntil: 'networkidle' });
    await ready(page);
    await layoutChecks(page, `${name} @390 large text ${zoom * 100}%`);
    await shot(page, `${name}-large-text-${zoom * 100}`);
  }
  await page.locator('.flh-ob-pf-review-item').first().click().catch(() => {});
  await page.goto(url('step=cat_kitchen&state=populated'), { waitUntil: 'networkidle' });
  await ready(page);
  await page.locator('.flh-ob-pf-card').first().click();
  const sheet = page.getByRole('dialog');
  const box = await sheet.boundingBox();
  check(`importance sheet fits at ${zoom * 100}%`, box && box.width <= page.viewportSize().width + 1, JSON.stringify(box));
  await shot(page, `sheet-large-text-${zoom * 100}`, false);
  await page.close();
}

// 2. The whole flow, start to finish, with the mouse.
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(url('step=search_type&state=empty'), { waitUntil: 'networkidle' });
  await ready(page);
  await page.getByRole('button', { name: /Continue/ }).click();
  check('search type is required', await page.getByRole('alert').filter({ hasText: 'Choose what you’re looking for' }).isVisible());
  await page.getByRole('radio', { name: /Home to Buy/ }).check();
  await page.getByRole('button', { name: /Continue/ }).click();
  await page.getByRole('heading', { name: /basics of your home search/i }).waitFor();
  const budget = page.getByLabel('Maximum budget');
  await budget.fill('650000');
  check('budget shows $ and thousands separators', (await budget.inputValue()) === '650,000');
  await page.getByRole('button', { name: 'More bedrooms' }).click();
  await page.getByRole('button', { name: /Continue/ }).click();
  await page.getByRole('heading', { name: /Where are you/ }).waitFor();
  await page.getByRole('button', { name: 'Skip' }).click();
  await page.getByRole('heading', { name: /living spaces/ }).waitFor();
  check('progress counts ten question screens', (await page.locator('.flh-ob-count').textContent()) === '4/10');
  await page.getByRole('button', { name: 'Skip' }).click();
  await page.getByRole('heading', { name: 'The kitchen', level: 1 }).waitFor();
  check('nothing is preselected', (await page.locator('.flh-ob-pf-card.is-selected').count()) === 0);

  // Card → bottom sheet → level stays visible on the card.
  await page.getByRole('button', { name: /^Walk-in Pantry: not chosen/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Walk-in Pantry' });
  await dialog.waitFor();
  await page.waitForTimeout(400); // the slide-up animation
  const box = await dialog.boundingBox();
  check('importance picker is a bottom sheet on phones', Math.abs(box.y + box.height - 844) < 2, JSON.stringify(box));
  await shot(page, 'flow-sheet-open-390', false);
  await dialog.getByRole('button', { name: /^Must Have/ }).click();
  check('chosen level shows on the card in words', await page.getByRole('button', { name: /^Walk-in Pantry: Must Have/ }).isVisible());

  // Closing without choosing changes nothing.
  await page.getByRole('button', { name: /^Countertop Seating/ }).click();
  await page.getByRole('button', { name: 'Close' }).click();
  check('closing the sheet changes nothing', await page.getByRole('button', { name: /^Countertop Seating \(your own\): not chosen/ }).isVisible());

  // Suggestion chip → card + sheet straight away.
  await page.getByRole('button', { name: 'Kitchen Island' }).click();
  await page.getByRole('dialog', { name: 'Kitchen Island' }).getByRole('button', { name: /^Important/ }).click();
  check('a suggestion becomes a card with its level', await page.getByRole('button', { name: /^Kitchen Island: Important/ }).isVisible());

  // Add your own, then the same thing differently typed: one card.
  await page.getByRole('textbox', { name: 'Add your own' }).fill('  pot   filler ');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('dialog', { name: 'pot filler' }).getByRole('button', { name: /^Nice to Have/ }).click();
  await page.getByRole('textbox', { name: 'Add your own' }).fill('POT-FILLER');
  await page.getByRole('textbox', { name: 'Add your own' }).press('Enter');
  await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
  check('no duplicate from case, spacing or punctuation', (await page.locator('.flh-ob-pf-card-title', { hasText: /pot filler/i }).count()) === 1);
  await page.getByRole('textbox', { name: 'Add your own' }).fill('front porch');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  check('a feature from another screen is found, not duplicated', await page.getByRole('dialog', { name: 'Front Porch' }).getByText('You’ll find this under Layout & Living Spaces.').isVisible());
  await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
  await shot(page, 'flow-kitchen-chosen-390');

  // Back keeps answers.
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('heading', { name: /living spaces/ }).waitFor();
  await page.getByRole('button', { name: /Continue/ }).click();
  check('Back and forward keep every answer', await page.getByRole('button', { name: /^Walk-in Pantry: Must Have/ }).isVisible() && await page.getByRole('button', { name: /^Kitchen Island: Important/ }).isVisible());

  // Keyboard: Tab to a card, Enter opens, Escape closes without a change.
  await page.getByRole('button', { name: /^Stainless Steel Appliances/ }).focus();
  await page.keyboard.press('Enter');
  await page.getByRole('dialog', { name: 'Stainless Steel Appliances' }).waitFor();
  await page.keyboard.press('Escape');
  check('keyboard: Enter opens the picker, Escape closes it unchanged, focus returns', await page.getByRole('button', { name: /^Stainless Steel Appliances: not chosen/ }).evaluate((el) => el === document.activeElement));

  await page.getByRole('button', { name: /Continue/ }).click();
  await page.getByRole('button', { name: 'Skip' }).click(); // living room
  await page.getByRole('button', { name: 'Skip' }).click(); // bath
  await page.getByRole('heading', { name: 'The garage', level: 1 }).waitFor();
  await page.getByRole('button', { name: /^Important/ }).click();
  check('garage subtype appears once a garage matters', await page.getByRole('heading', { name: 'Attached or detached?' }).isVisible());
  await page.getByRole('button', { name: /^Not important/ }).click();
  await page.getByRole('heading', { name: /Exterior & property/i, level: 1 }).waitFor();
  check('garage Not important advances to the next screen automatically', await page.getByRole('heading', { name: /Exterior & property/i, level: 1 }).isVisible());
  // Back: the earlier answer is shown and can be changed.
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('heading', { name: 'The garage', level: 1 }).waitFor();
  check('Back to the garage shows Not important chosen, with no subtype', await page.getByRole('button', { name: /^Not important/ }).getAttribute('aria-pressed') === 'true'
    && !(await page.getByRole('heading', { name: 'Attached or detached?' }).isVisible()));
  await shot(page, 'flow-garage-not-important-back-390');
  await page.getByRole('button', { name: /^Nice to Have/ }).click();
  check('changing it back brings the subtype back', await page.getByRole('heading', { name: 'Attached or detached?' }).isVisible() && await page.getByRole('heading', { name: 'The garage', level: 1 }).isVisible());
  await page.getByRole('button', { name: /^Not important/ }).click();
  await page.getByRole('heading', { name: /Exterior & property/i, level: 1 }).waitFor();
  await page.getByRole('textbox', { name: /Ideal lot size/ }).fill('0.5');
  await page.getByRole('button', { name: /Continue/ }).click();
  await page.getByRole('button', { name: 'Skip' }).click(); // neighborhood
  await page.getByRole('heading', { name: /Your search is/ }).waitFor();

  // Review: editable in place and per section.
  check('review shows skipped screens', await page.getByRole('region', { name: 'Living Room' }).getByText('Skipped—add anytime.').isVisible());
  check('review shows the garage answer', await page.getByText('Not important', { exact: true }).isVisible());
  await page.getByRole('button', { name: /^Kitchen Island: Important/ }).click();
  await page.getByRole('dialog', { name: 'Kitchen Island' }).getByRole('button', { name: /^Must Have/ }).click();
  check('review edits importance in place', await page.getByRole('button', { name: /^Kitchen Island: Must Have/ }).isVisible());
  await page.getByRole('button', { name: 'Add: Bathroom' }).click();
  await page.getByRole('heading', { name: 'The bathroom', level: 1 }).waitFor();
  await page.getByRole('button', { name: /^Soaking Tub/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: /^Nice to Have/ }).click();
  await page.getByRole('button', { name: 'Back to review' }).click();
  check('editing a section returns to Review with the change', await page.getByRole('button', { name: /^Soaking Tub: Nice to Have/ }).isVisible());
  await shot(page, 'flow-review-390');
  await page.getByRole('button', { name: /Add my first home/ }).click();
  await page.waitForFunction(() => window.__flhPreviewCompletions === 1, null, { timeout: 5000 }).then(() => check('finishing completes onboarding once', true)).catch(() => check('finishing completes onboarding once', false));
  check('no page errors during the flow', errors.length === 0, errors.join(' | '));
  await page.close();
}

// 2b. Home to Rent, start to finish: 8 counted screens, the pets question,
// lot-size importance, hints and the editable Review.
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const count = () => page.locator('.flh-ob-count').textContent();
  const cont = () => page.getByRole('button', { name: /Continue/ }).click();
  const radio = (name) => page.getByRole('radio', { name, exact: true });
  const status = () => page.locator('.flh-ob-pf-pets-status').textContent();
  await page.goto(url('step=search_type&state=empty'), { waitUntil: 'networkidle' });
  await ready(page);
  await page.getByRole('radio', { name: /Home to Rent/ }).check();
  check('rent: search type screen is 1/8', (await count()) === '1/8', await count());
  await cont();
  await page.getByRole('heading', { name: /basics of your rental search/i }).waitFor();
  check('rent: Rental Basics eyebrow and 2/8', (await page.locator('.flh-eyebrow').first().textContent()).includes('Rental Basics') && (await count()) === '2/8');
  const rent = page.getByLabel('Maximum monthly rent');
  await rent.fill('2800');
  check('rent: monthly rent shows $ and thousands separators', (await rent.inputValue()) === '2,800' && await page.locator('.flh-ob-currency').first().isVisible());
  await page.getByRole('button', { name: 'More bedrooms' }).click();
  await cont();
  await page.getByRole('heading', { name: /Where are you/ }).waitFor();
  check('rent: Geography is 3/8', (await count()) === '3/8');
  await page.getByRole('button', { name: 'Skip' }).click();
  await page.getByRole('heading', { name: /rental essentials/i }).waitFor();
  check('rent: Rental Essentials is 4/8 with Back · Skip · Continue', (await count()) === '4/8');
  check('rent: no ranking cards and no Add your own on Rental Essentials', (await page.locator('.flh-ob-pf-card').count()) === 0 && (await page.locator('.flh-ob-pf-add').count()) === 0);
  check('rent: the pets question uses the pet-friendly photo', await page.locator('.flh-ob-pf-pets-media img').evaluate((img) => /pet-friendly-(400|800)\.webp$/.test(img.currentSrc) && img.naturalWidth > 0));
  check('rent: nothing is preselected', !(await radio('Yes').isChecked()) && !(await radio('No').isChecked()) && !(await radio('Not sure yet').isChecked()));
  await radio('Yes').check();
  check('rent: Yes says Pet-Friendly is now a Must Have, with Undo', /Pet-Friendly is now a Must Have\./.test(await status()) && await page.getByRole('button', { name: 'Undo' }).isVisible());
  await shot(page, 'rent-flow-pets-yes-390');
  await page.getByRole('button', { name: 'Undo' }).click();
  check('rent: Undo returns to unanswered', !(await radio('Yes').isChecked()) && /Undone/.test(await status()));
  await radio('Yes').check();
  await radio('Not sure yet').check();
  check('rent: Not sure puts the earlier level back', /Pet-Friendly is no longer one of your priorities\./.test(await status()));
  await radio('No').check();
  check('rent: No after Not sure writes no requirement', (await radio('No').isChecked()) && /no pet requirement|never marked down|Saved: No/i.test(await status()), await status());
  await radio('Yes').check();
  await shot(page, 'rent-flow-pets-final-390');
  // Keyboard: the radios are one tab stop, arrows move within the group.
  await radio('Yes').focus();
  await page.keyboard.press('ArrowDown');
  check('keyboard: arrows move between the three answers', await radio('No').isChecked());
  await page.keyboard.press('ArrowUp');
  check('keyboard: and back to Yes', await radio('Yes').isChecked() && /Must Have/.test(await status()));
  await cont();
  await page.getByRole('heading', { name: /living spaces/i }).waitFor();
  check('rent: Layout is 5/8', (await count()) === '5/8');
  await page.getByRole('button', { name: 'Extra Bedroom' }).click();
  const sheet = page.getByRole('dialog', { name: 'Extra Bedroom' });
  check('rent: Extra Bedroom hint shows in the sheet', await sheet.getByText('An extra bedroom beyond the minimum you entered in Basics.').isVisible());
  await sheet.getByRole('button', { name: /^Nice to Have/ }).click();
  check('rent: Extra Bedroom card carries its hint', await page.locator('.flh-ob-pf-card', { hasText: 'Extra Bedroom' }).locator('.flh-ob-pf-card-hint').isVisible());
  // Back keeps the pets answer.
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('heading', { name: /rental essentials/i }).waitFor();
  check('rent: Back keeps the pets answer', await radio('Yes').isChecked() && /because pets are moving with you/.test(await status()));
  await cont();
  await cont();
  await page.getByRole('heading', { name: /Rental features/i, level: 1 }).waitFor();
  check('rent: Rental Features is 6/8; Garage is one card', (await count()) === '6/8' && (await page.locator('.flh-ob-pf-card-title', { hasText: /^Garage$/ }).count()) === 1);
  await page.getByRole('textbox', { name: 'Add your own' }).fill('Wine fridge');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('dialog', { name: 'Wine fridge' }).getByRole('button', { name: /^Important/ }).click();
  check('rent: a custom addition is ranked immediately', await page.getByRole('button', { name: /^Wine fridge \(your own\): Important/ }).isVisible());
  await cont();
  await page.getByRole('heading', { name: /Exterior & property/i, level: 1 }).waitFor();
  check('rent: Exterior is 7/8', (await count()) === '7/8');
  check('rent: lot-size importance waits for acreage', (await page.getByRole('button', { name: /Lot size importance/ }).count()) === 0);
  await page.getByRole('textbox', { name: /Ideal lot size/ }).fill('0.5');
  const lotButton = page.getByRole('button', { name: /^Lot size importance: not chosen/ });
  check('rent: after acreage, importance is optional and unranked', await lotButton.isVisible() && await page.getByText('Not part of your Match until you choose how much it matters.').isVisible());
  await lotButton.click();
  const lotSheet = page.getByRole('dialog', { name: 'Ideal lot size' });
  check('rent: lot size uses the same four choices', (await lotSheet.getByRole('button', { name: /^(Must Have|Important|Nice to Have|Not important)/ }).count()) === 4);
  await lotSheet.getByRole('button', { name: /^Important/ }).click();
  check('rent: lot size ranked Important', await page.getByRole('button', { name: /^Lot size importance: Important/ }).isVisible() && await page.getByText(/at least 0\.5 acres count toward your Match/).isVisible());
  await shot(page, 'rent-flow-lot-ranked-390');
  await page.getByRole('button', { name: 'Landscaping' }).click();
  check('rent: Landscaping hint', await page.getByRole('dialog', { name: 'Landscaping' }).getByText('A well-kept, landscaped yard.').isVisible());
  await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
  await cont();
  await page.getByRole('heading', { name: /neighborhood/i, level: 1 }).waitFor();
  check('rent: Neighborhood is 8/8', (await count()) === '8/8');
  await page.getByRole('button', { name: 'Skip' }).click();
  await page.getByRole('heading', { name: /Your search is/ }).waitFor();
  const essentials = page.getByRole('region', { name: 'Rental Essentials' });
  check('review: pets answer and its provenance', await essentials.getByText('Pets moving with you:').isVisible() && await essentials.getByText('Because pets are moving with you').isVisible());
  check('review: Pet-Friendly listed once', (await page.getByRole('button', { name: /^Pet-Friendly:/ }).count()) === 1 && (await page.getByRole('region', { name: 'More of your priorities' }).count()) === 0);
  check('review: ranked acreage shows accurately', await page.getByRole('button', { name: /^Ideal lot size, 0\.5 acres: Important/ }).isVisible());
  check('review: skipped Neighborhood says so', await page.getByRole('region', { name: 'Location & Neighborhood' }).getByText('Skipped—add anytime.').isVisible());
  await shot(page, 'rent-flow-review-390');
  // Change the acreage importance on Review.
  await page.getByRole('button', { name: /^Ideal lot size, 0\.5 acres/ }).click();
  await page.getByRole('dialog', { name: 'Ideal lot size' }).getByRole('button', { name: /Not important/ }).click();
  check('review: acreage unranked again, not part of Match', await page.getByRole('button', { name: /^Ideal lot size, 0\.5 acres: not ranked/ }).isVisible());
  // Pet-Friendly changed by hand on Review: provenance becomes the renter's own.
  await page.getByRole('button', { name: /^Pet-Friendly:/ }).click();
  await page.getByRole('dialog', { name: 'Pet-Friendly' }).getByRole('button', { name: /^Important/ }).click();
  check('review: a manual Pet-Friendly edit reads “You set this yourself”', await essentials.getByText('You set this yourself').isVisible());
  // Edit the pets answer from Review: No keeps the renter's own level.
  await page.getByRole('button', { name: 'Edit: Rental Essentials' }).click();
  await page.getByRole('heading', { name: /rental essentials/i }).waitFor();
  await radio('No').check();
  check('edit from Review: No keeps a level the renter set', /Pet-Friendly stays Important because you set it yourself\./.test(await status()));
  await page.getByRole('button', { name: 'Back to review' }).click();
  check('review: answer updated, own level kept', await essentials.getByText('No', { exact: true }).isVisible() && await page.getByRole('button', { name: /^Pet-Friendly: Important/ }).isVisible());
  await shot(page, 'rent-flow-review-edited-390');
  check('rent: no page errors', errors.length === 0, errors.join(' | '));
  await page.close();
}
// 2c. Apartment to Rent: 6 counted screens; pets; hints; Review.
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const count = () => page.locator('.flh-ob-count').textContent();
  await page.goto(url('step=search_type&state=empty'), { waitUntil: 'networkidle' });
  await ready(page);
  await page.getByRole('radio', { name: /Apartment to Rent/ }).check();
  check('apartment: 1/6', (await count()) === '1/6');
  await page.getByRole('button', { name: /Continue/ }).click();
  await page.getByRole('heading', { name: /basics of your apartment search/i }).waitFor();
  check('apartment: Apartment Basics 2/6', (await page.locator('.flh-eyebrow').first().textContent()).includes('Apartment Basics') && (await count()) === '2/6');
  await page.getByRole('button', { name: 'Skip' }).click();
  await page.getByRole('button', { name: 'Skip' }).click();
  await page.getByRole('heading', { name: /rental essentials/i }).waitFor();
  check('apartment: Rental Essentials 4/6', (await count()) === '4/6');
  await page.getByRole('button', { name: 'Skip' }).click();
  await page.getByRole('heading', { name: 'The unit', level: 1 }).waitFor();
  check('apartment: The Unit 5/6', (await count()) === '5/6');
  await page.getByRole('button', { name: 'Private Garage' }).click();
  check('apartment: Private Garage hint', await page.getByRole('dialog', { name: 'Private Garage' }).getByText('A garage for your unit only.').isVisible());
  await page.getByRole('dialog').getByRole('button', { name: /^Must Have/ }).click();
  await page.getByRole('button', { name: /Continue/ }).click();
  await page.getByRole('heading', { name: 'The property', level: 1 }).waitFor();
  check('apartment: The Property 6/6, Garage Parking card', (await count()) === '6/6' && await page.getByRole('button', { name: /^Garage Parking: not chosen/ }).isVisible());
  await page.getByRole('button', { name: /Continue/ }).click();
  await page.getByRole('heading', { name: /Your search is/ }).waitFor();
  check('apartment review: skipped pets question says so', await page.getByRole('region', { name: 'Rental Essentials' }).getByText('Skipped—add anytime.').isVisible());
  check('apartment review: no lot size anywhere', (await page.getByText(/lot size/i).count()) === 0);
  await page.getByRole('button', { name: /^Answer: Rental Essentials/ }).click();
  await page.getByRole('radio', { name: 'Yes', exact: true }).check();
  await page.getByRole('button', { name: 'Back to review' }).click();
  check('apartment review: Yes → Pet-Friendly Must Have because of the answer', await page.getByRole('button', { name: /^Pet-Friendly: Must Have \(because pets are moving with you\)/ }).isVisible());
  await shot(page, 'apartment-flow-review-390');
  await page.getByRole('button', { name: /Add my first apartment/ }).click();
  await page.waitForFunction(() => window.__flhPreviewCompletions === 1, null, { timeout: 5000 }).then(() => check('apartment: finishing completes once', true)).catch(() => check('apartment: finishing completes once', false));
  check('apartment: no page errors', errors.length === 0, errors.join(' | '));
  await page.close();
}
// 2d. A resumed rental session lands where it left off, with progress intact.
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(url('step=cat_rent_features&state=populated&search=home_rent'), { waitUntil: 'networkidle' });
  await ready(page);
  check('resume: Home to Rent resumes on Rental Features at 6/8 with saved choices', (await page.locator('.flh-ob-count').textContent()) === '6/8' && await page.getByRole('button', { name: /^Central Air: Must Have/ }).isVisible());
  await page.goto(url('step=cat_kitchen&state=populated&search=apartment_rent'), { waitUntil: 'networkidle' });
  await ready(page);
  check('resume: a step the apartment flow lacks falls back to a real screen', !(await page.getByText('This step isn’t available').count()));
  await page.goto(url('step=cat_essentials&state=manual&search=home_rent'), { waitUntil: 'networkidle' });
  await ready(page);
  await page.getByRole('radio', { name: 'No', exact: true }).check();
  check('resume: FLH’s Must Have over an earlier own Important — No restores Important', /Pet-Friendly is back to Important\./.test(await page.locator('.flh-ob-pf-pets-status').textContent()));
  await page.close();
}

// 3. Photos: shown on the cards, card-sized, lazy, one screen at a time.
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });
  const requested = [];
  page.on('response', async (response) => {
    if (!/\/images\/(onboarding|features)\//.test(response.url())) return;
    const body = await response.body().catch(() => Buffer.alloc(0));
    requested.push({ url: new URL(response.url()).pathname, bytes: body.length });
  });
  await page.goto(url('step=cat_kitchen&state=populated'), { waitUntil: 'networkidle' });
  await ready(page);
  const shown = await page.evaluate(() => [...document.querySelectorAll('.flh-ob-pf-media img')].map((img) => ({ src: img.currentSrc, ok: img.complete && img.naturalWidth > 0, loading: img.loading })));
  check('kitchen cards show the founder’s photos', shown.length >= 4 && shown.every((img) => img.ok && /\/images\/onboarding\/cards\//.test(img.src)), JSON.stringify(shown.map((img) => img.src.split('/').pop())));
  check('only card derivatives are fetched — never an original upload', requested.length > 0 && requested.every((entry) => /\/cards\/|\/features\//.test(entry.url)), JSON.stringify(requested));
  check('a 3x phone gets the 800w derivative', shown.some((img) => /-800\.webp$/.test(img.src)));
  check('each fetched card image is ≤ 120 KB', requested.every((entry) => entry.bytes <= 120 * 1024), JSON.stringify(requested.map((entry) => [entry.url.split('/').pop(), Math.round(entry.bytes / 1024)])));
  check('no other screen’s photos are loaded', requested.every((entry) => !/garage|pool|sidewalk|bath|tub|vanity/.test(entry.url)), JSON.stringify(requested.map((entry) => entry.url)));
  check('cards below the first row load lazily', shown.slice(4).every((img) => img.loading === 'lazy') && shown.slice(0, 4).every((img) => img.loading === 'eager'));
  await page.close();
}
{
  // A 1x screen gets the 400w derivative; the cul-de-sac photo is on Neighborhood.
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  await page.goto(url('step=cat_neighborhood&state=populated'), { waitUntil: 'networkidle' });
  await ready(page);
  const facts = await page.evaluate(() => ({
    imgs: [...document.querySelectorAll('.flh-ob-pf-media img')].map((img) => img.currentSrc.split('/').pop()),
    chips: [...document.querySelectorAll('.flh-ob-pf-chip')].map((chip) => chip.textContent.trim()),
    icons: [...document.querySelectorAll('.flh-ob-pf-media.is-icon')].length,
  }));
  check('1x phones get the 400w derivative', facts.imgs.length > 0 && facts.imgs.every((name) => /-400\.webp$/.test(name)), JSON.stringify(facts.imgs));
  check('Dead-End Street is not suggested; Cul-de-Sac is', !facts.chips.some((chip) => /Dead-End/i.test(chip)) && facts.chips.some((chip) => /Cul-de-Sac/.test(chip)), JSON.stringify(facts.chips));
  check('No HOA stays an icon', facts.icons >= 1);
  await page.getByRole('button', { name: 'Cul-de-Sac' }).click();
  await page.getByRole('dialog', { name: 'Cul-de-Sac' }).getByRole('button', { name: /^Important/ }).click();
  check('Cul-de-Sac card uses the uploaded photo', await page.locator('.flh-ob-pf-card', { hasText: 'Cul-de-Sac' }).locator('img').evaluate((img) => /cul-de-sac-400\.webp$/.test(img.currentSrc) && img.naturalWidth > 0));
  await shot(page, 'neighborhood-photos-390');
  await page.close();
}
{
  // Illustration fallback where no photo exists (In-Unit Laundry, The Unit),
  // and apartment amenities never use house photography (rental spec §5).
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(url('step=cat_apt_unit&state=populated&search=apartment_rent'), { waitUntil: 'networkidle' });
  await ready(page);
  const srcs = await page.evaluate(() => [...document.querySelectorAll('.flh-ob-pf-media img')].map((img) => [img.currentSrc.split('/').pop(), img.naturalWidth > 0]));
  check('renters: The Unit uses the illustration where no photo exists', srcs.some(([src, ok]) => src === 'in-unit-laundry.svg' && ok), JSON.stringify(srcs));
  await page.goto(url('step=cat_apt_property&state=populated&search=apartment_rent'), { waitUntil: 'networkidle' });
  await ready(page);
  const property = await page.evaluate(() => [...document.querySelectorAll('.flh-ob-pf-media img')].map((img) => img.currentSrc.split('/').pop()));
  check('apartments: no house Pool or Deck photo', !property.some((src) => /^(pool|deck-patio)-/.test(src)), JSON.stringify(property));
  await page.close();
}
{
  // Buyers never see Rental Essentials.
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(url('step=cat_layout&state=populated&search=home_buy'), { waitUntil: 'networkidle' });
  await ready(page);
  check('buyers never see Rental Essentials', !(await page.locator('.flh-ob-rail, .flh-ob-topbar').first().textContent()).includes('Rental Essentials') && (await page.locator('.flh-ob-count').textContent()) === '4/10');
  await page.close();
}

// 4. Images missing or broken: every card still has its label and an icon tile.
for (const [label, handler] of [['missing (network error)', (route) => route.abort()], ['broken (404)', (route) => route.fulfill({ status: 404, body: '' })], ['corrupt bytes', (route) => route.fulfill({ status: 200, contentType: 'image/webp', body: 'not an image' })]]) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.route(/\/images\/(onboarding|features)\//, handler);
  await page.goto(url('step=cat_kitchen&state=populated'), { waitUntil: 'networkidle' });
  await ready(page);
  await page.waitForTimeout(300);
  const facts = await page.evaluate(() => ({ imgs: document.querySelectorAll('.flh-ob-pf-media img').length, titles: [...document.querySelectorAll('.flh-ob-pf-card-title')].map((el) => el.textContent) }));
  const icons = await page.locator('.flh-ob-pf-media.is-icon').count();
  check(`images ${label}: icon tiles replace them, labels remain`, facts.imgs === 0 && icons >= 4 && facts.titles.includes('Kitchen Island'), JSON.stringify({ ...facts, icons }));
  if (label.startsWith('missing')) await shot(page, 'kitchen-images-unavailable-390');
  await page.close();
}

await browser.close();
const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
