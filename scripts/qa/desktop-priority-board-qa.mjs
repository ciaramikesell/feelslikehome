#!/usr/bin/env node
// Browser QA for the desktop priority board (flow 4 at ≥ 1024px), against the
// development-only preview (/dev/onboarding?flow=v3 — in-memory services, no
// Supabase). Development only. See docs/desktop-priority-board.md.
//
//   1. npm run dev -- -p 3100
//   2. node scripts/qa/desktop-priority-board-qa.mjs [baseUrl] [screenshotDir]
//
// Checks: exact desktop screen order for all three kinds of search; library →
// column, column → column, column → library, Undo and duplicate prevention;
// click-to-rank and keyboard; Add your own; hover / focus previews with photo
// and icon fallback; previews hidden while dragging and never covering the
// columns; resize between desktop and phone keeping every answer; resumed
// sessions; Review edits; widths 1024–1920, tablets, 150% / 200% zoom and
// phones (which keep the photo-card screens).
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://localhost:3100';
const OUT = process.argv[3] || null;
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };
const url = (query) => `${BASE}/dev/onboarding?flow=v3&${query}`;
const COL = (tier) => `.flh-ob-board-column.is-${tier}`;
const chip = (id, where = '') => `${where} [data-chip-id="${id}"]`.trim();

async function open(page, query) {
  await page.goto(url(query), { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.addStyleTag({ content: 'nextjs-portal{display:none!important}' });
  await page.waitForTimeout(150);
}
async function shot(page, name, fullPage = true) {
  if (!OUT) return;
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage });
}
const texts = (page, selector) => page.locator(selector).allTextContents();
const columnTexts = (page, tier) => texts(page, `${COL(tier)} .flh-ob-board-chip-text`);
async function noOverflow(page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const clipped = [...document.querySelectorAll('.flh-ob-board-chip, .flh-ob-board-column, .flh-ob-board-library, .flh-ob-cta, .flh-ob-pf-card')]
      .filter((element) => { const rect = element.getBoundingClientRect(); return rect.width > 0 && (rect.right > window.innerWidth + 0.5 || rect.left < -0.5); }).length;
    return { overflow: doc.scrollWidth - doc.clientWidth, clipped };
  });
}
async function dragTo(page, source, target) {
  const handle = page.locator(source).first();
  await handle.scrollIntoViewIfNeeded();
  const box = await page.locator(target).first().boundingBox();
  await handle.dragTo(page.locator(target).first(), { targetPosition: { x: Math.min(60, box.width / 2), y: 24 } });
  await page.waitForTimeout(150);
}

const browser = await chromium.launch(process.env.FLH_CHROMIUM ? { executablePath: process.env.FLH_CHROMIUM } : {});
if (OUT) await mkdir(OUT, { recursive: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (error) => errors.push(String(error)));

/* ------------------------------- screen order ------------------------------ */

const ORDER = {
  home_buy: ['The Basics', 'The Basics', 'Where you’re looking', 'What matters most', 'Review'],
  home_rent: ['The Basics', 'The Basics', 'Where you’re looking', 'Rental Essentials', 'What matters most', 'Review'],
  apartment_rent: ['The Basics', 'The Basics', 'Where you’re looking', 'Rental Essentials', 'What matters most', 'Review'],
};
for (const [search, expected] of Object.entries(ORDER)) {
  await open(page, `step=search_type&state=populated&search=${search}`);
  const seen = [];
  for (let guard = 0; guard < 12; guard += 1) {
    const eyebrow = (await page.locator('.flh-onboarding-header .flh-eyebrow').first().textContent()).trim();
    if (eyebrow === 'Review') { seen.push('Review'); break; }
    seen.push(eyebrow.replace(/^Step \d+ of \d+ · /, ''));
    await page.locator('.flh-ob-pf-footer .flh-ob-cta').click();
    await page.waitForTimeout(200);
  }
  check(`desktop screen order (${search})`, JSON.stringify(seen) === JSON.stringify(expected), seen.join(' → '));
  await open(page, `step=search_type&state=populated&search=${search}`);
  const rail = await texts(page, '.flh-ob-steps li');
  check(`rail lists the board once (${search})`, rail.filter((text) => /What Matters Most/.test(text)).length === 1 && !rail.some((text) => /Kitchen|The Unit|Rental Features/.test(text)), rail.join(' | '));
}

/* ------------------------------ drag and drop ------------------------------ */

await open(page, 'step=cat_layout&state=empty&search=home_buy');
check('board shown at 1440 for a category step', await page.locator('.flh-ob-board').count() === 1);
check('nothing preselected', (await page.locator('.flh-ob-board-columns .flh-ob-board-chip').count()) === 0);
check('heading and lead', /What matters most to you\?/.test(await page.locator('h1').textContent()) && /Drag the features that matter into the importance column that fits you\./.test(await page.locator('.flh-lead').textContent()));
await shot(page, 'desktop-1440-empty', false);

await dragTo(page, chip('features:Fireplace', '.flh-ob-board-library'), COL('must'));
check('library → Must Have', JSON.stringify(await columnTexts(page, 'must')) === '["Fireplace"]');
check('… and it leaves the library', (await page.locator(chip('features:Fireplace', '.flh-ob-board-library')).count()) === 0);
check('status names the move with Undo', /Fireplace moved to Must Have/.test(await page.locator('.flh-ob-board-status').textContent()) && await page.locator('.flh-ob-board-undo').count() === 1);
await dragTo(page, chip('features:Kitchen Island', '.flh-ob-board-library'), COL('important'));
await dragTo(page, chip('features:Soaking Tub', '.flh-ob-board-library'), COL('nice'));
await dragTo(page, chip('features:Fireplace', COL('must')), COL('important'));
check('column → column', JSON.stringify(await columnTexts(page, 'important')) === '["Kitchen Island","Fireplace"]' || JSON.stringify(await columnTexts(page, 'important')) === '["Fireplace","Kitchen Island"]', (await columnTexts(page, 'important')).join(','));
check('… exactly one copy anywhere', (await page.locator(chip('features:Fireplace')).count()) === 1);
await dragTo(page, chip('features:Kitchen Island', COL('important')), COL('important'));
check('dropping on its own column changes nothing', /Fireplace moved to Important/.test(await page.locator('.flh-ob-board-status').textContent()));
// Drag feedback: targets are marked while dragging.
const dragged = page.locator(chip('features:Soaking Tub', COL('nice')));
const dragBox = await dragged.boundingBox();
await page.mouse.move(dragBox.x + 20, dragBox.y + dragBox.height / 2);
await page.mouse.down();
await page.mouse.move(dragBox.x + 30, dragBox.y + 40, { steps: 4 });
const libBox = await page.locator('.flh-ob-board-library').boundingBox();
// A point inside the library that is on screen (the page may be scrolled).
const libY = Math.max(libBox.y, 0) + 80;
await page.mouse.move(libBox.x + 80, libY, { steps: 8 });
await page.mouse.move(libBox.x + 90, libY + 4, { steps: 2 });
await page.waitForTimeout(150);
const feedback = await page.evaluate(() => ({
  library: document.querySelector('.flh-ob-board-library').classList.contains('is-target'),
  hint: Boolean(document.querySelector('.flh-ob-board-drop-hint')),
  dragging: Boolean(document.querySelector('.flh-ob-board.is-dragging')),
}));
await shot(page, 'desktop-1440-dragging', false);
await page.mouse.up();
await page.waitForTimeout(200);
check('drag feedback: library marked as a drop target with a hint', feedback.library && feedback.hint && feedback.dragging, JSON.stringify(feedback));
check('column → library (unselected)', (await columnTexts(page, 'nice')).length === 0 && (await page.locator(chip('features:Soaking Tub', '.flh-ob-board-library')).count()) === 1);
check('removal says it never counts', /back to the library\. It won’t count/.test(await page.locator('.flh-ob-board-status').textContent()));
await page.locator('.flh-ob-board-undo').click();
await page.waitForTimeout(150);
check('Undo puts it back exactly', JSON.stringify(await columnTexts(page, 'nice')) === '["Soaking Tub"]');

/* --------------------------- click and keyboard ---------------------------- */

await page.locator(chip('features:Double Vanity', '.flh-ob-board-library')).click();
check('click opens the small importance chooser', await page.locator('.flh-ob-board-chooser[role="dialog"]').count() === 1);
await shot(page, 'desktop-1440-chooser', false);
await page.locator('.flh-ob-board-chooser .flh-ob-board-level.is-must').click();
await page.waitForTimeout(150);
check('click-to-rank', (await columnTexts(page, 'must')).includes('Double Vanity'));
check('focus follows the chip', await page.evaluate(() => document.activeElement?.dataset?.chipId) === 'features:Double Vanity');
await page.keyboard.press('Enter');
await page.waitForTimeout(100);
check('keyboard: Enter opens; focus moves into the chooser', await page.evaluate(() => Boolean(document.activeElement?.closest('.flh-ob-board-chooser'))));
check('chooser marks the current level', await page.locator('.flh-ob-board-chooser [aria-pressed="true"]').textContent().then((text) => /Must Have/.test(text)));
await page.keyboard.press('Escape');
await page.waitForTimeout(100);
check('Escape closes without change and returns focus', (await page.locator('.flh-ob-board-chooser').count()) === 0 && await page.evaluate(() => document.activeElement?.dataset?.chipId) === 'features:Double Vanity' && (await columnTexts(page, 'must')).includes('Double Vanity'));
await page.keyboard.press('Enter');
await page.keyboard.press('Tab');
await page.keyboard.press('Enter');
await page.waitForTimeout(150);
check('keyboard: Tab then Enter moves it to Important', (await columnTexts(page, 'important')).includes('Double Vanity'));
await page.keyboard.press('Enter'); // focus starts on the current level (Important)
for (let i = 0; i < 2; i += 1) await page.keyboard.press('Tab'); // Nice to Have → Remove
await page.keyboard.press('Enter');
await page.waitForTimeout(150);
check('keyboard: Remove sends it back to the library', (await page.locator(chip('features:Double Vanity', '.flh-ob-board-library')).count()) === 1);
await page.keyboard.press('Enter');
await page.keyboard.press('Shift+Tab'); // wraps from the first option to the last
check('Tab stays inside the chooser (wraps)', await page.evaluate(() => document.activeElement?.classList.contains('flh-ob-board-cancel')));
await page.keyboard.press('Escape');

/* ------------------------------ Add your own ------------------------------- */

await page.fill('.flh-ob-board-add input', 'pantry');
check('canonical suggestion while typing', JSON.stringify(await texts(page, '.flh-ob-board-match > span:first-child')) === '["Walk-in Pantry"]');
await page.locator('.flh-ob-board-match').first().click();
await page.locator('.flh-ob-board-chooser .flh-ob-board-level.is-nice').click();
await page.waitForTimeout(150);
check('suggestion → immediate importance', (await columnTexts(page, 'nice')).includes('Walk-in Pantry'));
await page.fill('.flh-ob-board-add input', 'Wine fridge');
await page.keyboard.press('Enter');
await page.waitForSelector('.flh-ob-board-chooser');
await page.locator('.flh-ob-board-chooser .flh-ob-board-level.is-important').click();
await page.waitForTimeout(150);
check('own feature added and ranked', (await columnTexts(page, 'important')).some((text) => text === 'Wine fridge'));
await page.fill('.flh-ob-board-add input', '  WINE-fridge ');
await page.keyboard.press('Enter');
await page.waitForSelector('.flh-ob-board-chooser');
check('duplicate typed differently opens the existing one', /Important/.test(await page.locator('.flh-ob-board-chooser [aria-pressed="true"]').textContent()));
await page.keyboard.press('Escape');
check('no duplicate created', (await page.locator('.flh-ob-board-chip-text', { hasText: /^wine.?fridge$/i }).count()) === 1);
await page.fill('.flh-ob-board-add input', 'front porch');
await page.locator('.flh-ob-board-add select').selectOption('kitchen');
await page.keyboard.press('Enter');
await page.waitForSelector('.flh-ob-board-chooser');
check('typed text matching another category reuses it and says where', /under Layout & Living Spaces/.test(await page.locator('.flh-ob-board-chooser-note').textContent()));
await page.keyboard.press('Escape');

/* --------------------------------- previews -------------------------------- */

await page.mouse.move(5, 5);
const fenced = page.locator(chip('exterior:Fenced yard', '.flh-ob-board-library'));
await fenced.scrollIntoViewIfNeeded();
await fenced.hover();
await page.waitForTimeout(150);
check('no preview before the hover delay', (await page.locator('.flh-ob-board-preview').count()) === 0);
await page.waitForTimeout(500);
const previewFacts = await page.evaluate(() => {
  const preview = document.querySelector('.flh-ob-board-preview');
  const img = preview?.querySelector('img');
  const rect = preview?.getBoundingClientRect();
  const cols = document.querySelector('.flh-ob-board-columns').getBoundingClientRect();
  const overlap = rect && !(rect.right <= cols.left || rect.left >= cols.right || rect.bottom <= cols.top || rect.top >= cols.bottom);
  return {
    shown: Boolean(preview), hidden: preview?.getAttribute('aria-hidden'), src: img?.getAttribute('src'), loaded: img ? img.complete && img.naturalWidth > 0 : false,
    name: preview?.querySelector('.flh-ob-board-preview-name')?.textContent, text: preview?.querySelector('.flh-ob-board-preview-text')?.textContent, overlap, width: rect?.width,
  };
});
check('hover preview with the founder photo derivative', previewFacts.shown && /\/images\/onboarding\/cards\/fenced-yard-400\.webp$/.test(previewFacts.src) && previewFacts.loaded, JSON.stringify(previewFacts));
check('preview: name and one sentence', previewFacts.name === 'Fenced Yard' && /\.$/.test(previewFacts.text || ''));
check('preview is decorative (aria-hidden) and small', previewFacts.hidden === 'true' && previewFacts.width < 260);
check('preview never covers the columns', previewFacts.overlap === false);
await shot(page, 'desktop-1440-preview-photo', false);
const describedBy = await fenced.getAttribute('aria-describedby');
check('description available to AT without hover', /yard enclosed by a fence/.test(await page.locator(`[id="${describedBy}"]`).textContent()));
const noHoa = page.locator(chip('location:No HOA', '.flh-ob-board-library'));
await noHoa.scrollIntoViewIfNeeded();
await noHoa.hover();
await page.waitForTimeout(650);
check('fallback: icon tile when there is no photo', await page.locator('.flh-ob-board-preview .flh-ob-pf-media.is-icon svg').count() === 1 && await page.locator('.flh-ob-board-preview img').count() === 0);
await shot(page, 'desktop-1440-preview-icon', false);
// Preview disappears as soon as a drag starts.
const noHoaBox = await noHoa.boundingBox();
await page.mouse.move(noHoaBox.x + 20, noHoaBox.y + noHoaBox.height / 2);
await page.mouse.down();
await page.mouse.move(noHoaBox.x + 60, noHoaBox.y + 60, { steps: 6 });
await page.waitForTimeout(100);
check('preview hidden while dragging', (await page.locator('.flh-ob-board-preview').count()) === 0);
await page.mouse.up();
await page.mouse.move(5, 5);
await page.waitForTimeout(100);
// Keyboard focus shows it too.
await page.locator(chip('features:Fireplace')).focus();
await page.keyboard.press('Shift+Tab');
await page.keyboard.press('Tab');
await page.waitForTimeout(400);
check('keyboard focus shows the preview', (await page.locator('.flh-ob-board-preview').count()) === 1);
await page.keyboard.press('Tab');
await page.waitForTimeout(50);
check('… and moves with focus', (await page.locator('.flh-ob-board-preview').count()) <= 1);

/* ------------------------- responsive and resume --------------------------- */

const ranked = { must: await columnTexts(page, 'must'), important: await columnTexts(page, 'important'), nice: await columnTexts(page, 'nice') };
await page.setViewportSize({ width: 820, height: 1180 });
await page.waitForTimeout(300);
const phoneView = await page.evaluate(() => ({
  board: Boolean(document.querySelector('.flh-ob-board')),
  cards: document.querySelectorAll('.flh-ob-pf-card').length,
  heading: document.querySelector('h1')?.textContent,
  chosen: [...document.querySelectorAll('.flh-ob-pf-card.is-selected .flh-ob-pf-card-title')].map((element) => element.textContent),
}));
check('below 1024px: the phone category screen, same step, no restart', !phoneView.board && phoneView.cards > 0 && /Layout/.test(phoneView.heading), JSON.stringify(phoneView));
await page.locator('.flh-ob-pf-footer .flh-ob-cta').click(); // Layout → Kitchen on the phone
await page.waitForTimeout(200);
const kitchen = await page.evaluate(() => [...document.querySelectorAll('.flh-ob-pf-card.is-selected')].map((card) => `${card.querySelector('.flh-ob-pf-card-title').textContent}:${card.querySelector('.flh-ob-pf-card-level').textContent}`));
check('answers made on the board are on the phone cards', kitchen.includes('Kitchen Island:Important') && kitchen.includes('Walk-in Pantry:Nice to Have'), kitchen.join(', '));
await page.setViewportSize({ width: 1440, height: 900 });
await page.waitForTimeout(300);
const back = { must: await columnTexts(page, 'must'), important: await columnTexts(page, 'important'), nice: await columnTexts(page, 'nice') };
check('back to desktop: the board, every answer kept', await page.locator('.flh-ob-board').count() === 1 && JSON.stringify(back) === JSON.stringify(ranked), JSON.stringify(back));

/* --------------------------------- Review ---------------------------------- */

await page.locator('.flh-ob-pf-footer .flh-ob-cta').click();
await page.waitForTimeout(250);
check('Continue on the board goes to Review', (await page.locator('.flh-ob-pf-review').count()) === 1);
const reviewItems = await texts(page, '.flh-ob-pf-review-item .flh-ob-pf-review-name');
check('Review lists board choices', ['Fireplace', 'Kitchen Island', 'Soaking Tub', 'Walk-in Pantry'].every((name) => reviewItems.some((text) => text.startsWith(name))), reviewItems.join(', '));
await shot(page, 'desktop-1440-review');
await page.locator('.flh-ob-pf-review-item').first().click();
check('Review: a priority opens the importance chooser', await page.locator('[role="dialog"]').count() >= 1);
await page.keyboard.press('Escape');
await page.waitForTimeout(150);
await page.getByRole('button', { name: 'Edit: Kitchen' }).click();
await page.waitForTimeout(250);
check('Review: Edit returns to the unified board', await page.locator('.flh-ob-board').count() === 1 && /Back to review/.test(await page.locator('.flh-ob-pf-footer .flh-ob-cta').textContent()));
await page.locator('.flh-ob-pf-footer .flh-ob-cta').click();
await page.waitForTimeout(250);
check('… and Back to review returns', (await page.locator('.flh-ob-pf-review').count()) === 1);
await page.locator('.flh-ob-topbar .flh-ob-back').click();
await page.waitForTimeout(250);
check('Back from Review lands on the board', await page.locator('.flh-ob-board').count() === 1);
await page.locator('.flh-ob-pf-footer .flh-ob-pf-back').click();
await page.waitForTimeout(250);
check('Back from the board: Where you’re looking', /Where are you/.test(await page.locator('h1').textContent()));

// Resumed mid-way on a phone screen (Bathroom), opened on desktop: the board.
await open(page, 'step=cat_bath&state=populated&search=home_buy');
check('resume on a later category opens the board', await page.locator('.flh-ob-board').count() === 1 && /Step 4 of 4/.test(await page.locator('.flh-eyebrow').first().textContent()));
check('populated: earlier choices are in their columns', (await columnTexts(page, 'must')).includes('Kitchen Island') && (await columnTexts(page, 'nice')).includes('Pot Filler'));
await shot(page, 'desktop-1440-populated', false);
await page.locator('.flh-ob-pf-footer .flh-ob-pf-skip').click();
await page.waitForTimeout(250);
check('Skip on the board: Review offers each category again', (await page.locator('.flh-ob-pf-review').count()) === 1 && (await page.locator('text=Skipped—add anytime.').count()) >= 0);

/* --------------------------- renters and apartments ------------------------ */

await open(page, 'step=cat_essentials&state=populated&search=home_rent');
check('Rental Essentials stays its own screen on desktop', await page.locator('.flh-ob-board').count() === 0 && /rental/i.test(await page.locator('h1').textContent()));
await open(page, 'step=cat_rent_layout&state=populated&search=home_rent');
const rentGroups = await texts(page, '.flh-ob-board-group-title');
check('Home to Rent board: its categories', rentGroups.map((text) => text.replace(/\d+ ranked/, '').trim()).join('|') === 'Layout & Living Spaces|Rental Features|Exterior & Property|Location & Neighborhood', rentGroups.join('|'));
check('Home to Rent: Garage is a chip; lot size field shown', await page.locator(chip('exterior:Garage')).count() === 1 && await page.locator('.flh-ob-board-lot input').count() === 1);
await shot(page, 'desktop-1440-home-to-rent', false);
await open(page, 'step=cat_apt_unit&state=populated&search=apartment_rent');
const aptGroups = await texts(page, '.flh-ob-board-group-title');
check('Apartment board: The Unit · The Property; Garage Parking; no lot size', aptGroups.map((text) => text.replace(/\d+ ranked/, '').trim()).join('|') === 'The Unit|The Property' && /Garage Parking/.test(await page.locator(chip('exterior:Garage')).textContent()) && await page.locator('.flh-ob-board-lot').count() === 0, aptGroups.join('|'));
await shot(page, 'desktop-1440-apartment-to-rent', false);

/* ------------------------- garage (Home to Buy) ---------------------------- */

await open(page, 'step=cat_garage&state=empty&search=home_buy');
check('garage details hidden until a garage matters', await page.locator('.flh-ob-board-group[data-group="garage"] .flh-ob-board-chip').count() === 1);
await dragTo(page, chip('exterior:Garage', '.flh-ob-board-library'), COL('important'));
check('ranking Garage shows details and Attached / Detached', await page.locator('.flh-ob-board-group[data-group="garage"] .flh-ob-board-chip').count() === 3 && await page.locator('.flh-ob-board-segment').count() === 3);
await page.locator('.flh-ob-board-segment', { hasText: 'Detached' }).click();
check('garage type chosen', await page.locator('.flh-ob-board-segment[aria-pressed="true"]').textContent().then((text) => /Detached/.test(text)));

/* ------------------------- widths, tablets and zoom ------------------------ */

const SIZES = [
  ['desktop-1024', { width: 1024, height: 768 }, 'board'],
  ['desktop-1280', { width: 1280, height: 800 }, 'board'],
  ['desktop-1440', { width: 1440, height: 900 }, 'board'],
  ['desktop-1920', { width: 1920, height: 1080 }, 'board'],
  ['tablet-768-portrait', { width: 768, height: 1024 }, 'cards'],
  ['tablet-820-portrait', { width: 820, height: 1180 }, 'cards'],
  ['tablet-1024-portrait', { width: 1024, height: 1366 }, 'board'],
  ['tablet-1180-landscape', { width: 1180, height: 820 }, 'board'],
  ['phone-375', { width: 375, height: 812 }, 'cards'],
  ['phone-390', { width: 390, height: 844 }, 'cards'],
  ['phone-430', { width: 430, height: 932 }, 'cards'],
];
for (const [name, viewport, expected] of SIZES) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const sized = await context.newPage();
  await open(sized, 'step=cat_kitchen&state=populated&search=home_buy');
  const layout = (await sized.locator('.flh-ob-board').count()) ? 'board' : 'cards';
  const facts = await noOverflow(sized);
  const columnsVisible = layout === 'board' ? await sized.evaluate(() => [...document.querySelectorAll('.flh-ob-board-column')].every((column) => column.getBoundingClientRect().width >= 150)) : true;
  check(`${name}: ${expected}, no horizontal overflow or clipping`, layout === expected && facts.overflow <= 0 && facts.clipped === 0 && columnsVisible, `${layout} ${JSON.stringify(facts)}`);
  await shot(sized, `${name}-${layout}`);
  await context.close();
}
// Zoom: a desktop window at 150% / 200% is a narrower CSS viewport.
for (const [name, css, zoom, expected] of [['1280 at 200%', 640, 2, 'cards'], ['1440 at 200%', 720, 2, 'cards'], ['1920 at 200%', 960, 2, 'cards'], ['1920 at 150%', 1280, 1.5, 'board'], ['1440 at 150%', 960, 1.5, 'cards']]) {
  const context = await browser.newContext({ viewport: { width: css, height: Math.round(900 / zoom) }, deviceScaleFactor: zoom });
  const zoomed = await context.newPage();
  await open(zoomed, 'step=cat_kitchen&state=populated&search=home_buy');
  const layout = (await zoomed.locator('.flh-ob-board').count()) ? 'board' : 'cards';
  const facts = await noOverflow(zoomed);
  check(`zoom ${name}: ${expected}, nothing clipped`, layout === expected && facts.overflow <= 0 && facts.clipped === 0, `${layout} ${JSON.stringify(facts)}`);
  await shot(zoomed, `zoom-${name.replace(/ at /, '-').replace('%', 'pct')}-${layout}`);
  await context.close();
}

check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
