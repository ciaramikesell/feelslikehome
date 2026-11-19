// Run against a local production build, with the usual test Supabase stand-in.
// PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium node scripts/qa/homepage-approved-refinement.mjs [baseUrl] [outputDir]
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const base = process.argv[2] || 'http://127.0.0.1:3140';
const output = resolve(process.argv[3] || 'docs/homepage-approved-refinement');
mkdirSync(`${output}/screenshots`, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || '/usr/bin/chromium' });
const results = [];
const labels = ['Set Your Preferences', 'Import Homes from Anywhere', 'Compare What Matters', 'Search & Decide Together'];
const captions = [
  'Tell Feels Like Home what matters to you — and how important each priority is to your decision.',
  'Keep the listings you’ve found in one place, no matter where you discovered them.',
  'See how each home fits your priorities, with your personal Match clearly broken down.',
  'Compare your own priorities alongside your co-buyer’s, with suggestions from your Realtor.',
];
function check(name, ok) { results.push({ name, ok }); assert.ok(ok, name); }
try {
  for (const width of [320, 375, 390, 430, 768, 1024, 1280, 1440]) {
    const mobile = width < 768;
    const context = await browser.newContext({ viewport: { width, height: 900 }, isMobile: mobile, hasTouch: mobile, reducedMotion: 'reduce', deviceScaleFactor: 1 });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    const buttons = page.locator('.pl-feature-button');
    check(`${width}: four label-only controls`, await buttons.count() === 4 && !(await page.locator('.pl-feature-text > span').count()));
    check(`${width}: no hero description`, await page.locator('.pl-hero .pl-lede').count() === 0);
    const hero = await page.locator('.pl-hero-opening').evaluate(el => {
      const r = document.createRange(); r.selectNodeContents(el);
      return { lines: r.getClientRects().length, text: r.getBoundingClientRect().width, available: el.parentElement.clientWidth, font: parseFloat(getComputedStyle(el).fontSize) };
    });
    if (width >= 1024) check(`${width}: desktop opening fits one tasteful line`, hero.lines === 1 && hero.text <= hero.available + 1 && hero.font >= 25);
    await page.screenshot({ path: `${output}/screenshots/homepage-${width}.png`, fullPage: true });
    await page.locator('#how-it-works').scrollIntoViewIfNeeded();
    let initial;
    for (let i = 0; i < 4; i++) {
      const control = buttons.nth(i);
      check(`${width}: label ${i + 1}`, await control.innerText() === labels[i]);
      if (mobile) await control.tap(); else await control.click();
      await page.waitForFunction(() => { const img = document.querySelector('.pl-preview-stage img'); return img.complete && img.naturalWidth > 0; });
      check(`${width}: selected ${i + 1} and matching caption`, await control.getAttribute('aria-pressed') === 'true' && await page.locator('figcaption p[aria-hidden="false"]').innerText() === captions[i]);
      const geometry = await page.evaluate(() => {
        const panel = document.querySelector('.pl-feature-preview').getBoundingClientRect();
        const intro = document.querySelector('.pl-values-intro').getBoundingClientRect();
        const stage = document.querySelector('.pl-preview-stage').getBoundingClientRect();
        const img = document.querySelector('.pl-preview-stage img');
        return { height: panel.height, ratio: stage.width / stage.height, left: panel.right <= intro.left, below: panel.top > intro.top, fit: getComputedStyle(img).objectFit, overflow: document.documentElement.scrollWidth > innerWidth };
      });
      initial ??= geometry.height;
      check(`${width}: stable uncropped frame ${i + 1}`, Math.abs(geometry.height - initial) < 1 && Math.abs(geometry.ratio - 4 / 3) < .02 && geometry.fit === 'contain' && !geometry.overflow);
      check(`${width}: responsive column order ${i + 1}`, width > 900 ? geometry.left : geometry.below);
      if (width === 390 || width === 1280) await page.locator('#how-it-works').screenshot({ path: `${output}/screenshots/feature-${i + 1}-${width}.png` });
    }
    if (!mobile) {
      await page.reload({ waitUntil: 'networkidle' });
      await buttons.nth(1).hover();
      check(`${width}: hover preview`, await buttons.nth(1).getAttribute('aria-pressed') === 'true');
      await page.mouse.move(0, 0);
      await buttons.nth(2).focus();
      check(`${width}: focus preview`, await buttons.nth(2).getAttribute('aria-pressed') === 'true');
      await page.keyboard.press('Enter');
      await buttons.nth(3).hover();
      check(`${width}: Enter selection persists across hover`, await buttons.nth(2).getAttribute('aria-pressed') === 'true');
      await buttons.nth(3).focus(); await page.keyboard.press('Space');
      check(`${width}: Space activates`, await buttons.nth(3).getAttribute('aria-pressed') === 'true');
      check(`${width}: focus visible`, await buttons.nth(3).evaluate(el => getComputedStyle(el).outlineStyle !== 'none'));
      await page.locator('.pl-hero .pl-desktop-auth').click();
      check(`${width}: signup-first account dialog`, await page.getByRole('dialog', { name: 'Create account', exact: true }).isVisible());
      await page.keyboard.press('Escape');
      check(`${width}: CTA focus restored`, await page.locator('.pl-hero .pl-desktop-auth').evaluate(el => el === document.activeElement));
    } else {
      check(`${width}: mobile signup destination`, await page.locator('.pl-hero .pl-mobile-auth').getAttribute('href') === '/auth/sign-up');
      await page.getByLabel('Open navigation').tap();
      check(`${width}: mobile Realtor destination`, await page.getByRole('navigation', { name: 'Mobile public navigation' }).getByRole('link', { name: 'For Realtors' }).getAttribute('href') === '/for-realtors');
    }
    const realtorLink = mobile
      ? page.getByRole('navigation', { name: 'Mobile public navigation' }).getByRole('link', { name: 'For Realtors' })
      : page.locator('.pl-nav-surface').getByRole('link', { name: 'For Realtors' });
    await realtorLink.click();
    await page.waitForURL('**/for-realtors');
    await page.locator('.rl-root').waitFor({ state: 'visible' });
    check(`${width}: Realtor page navigation`, await page.locator('.rl-root').isVisible());
    if (mobile) {
      await page.goto(base, { waitUntil: 'networkidle' });
      await page.locator('.pl-hero .pl-mobile-auth').tap();
      await page.waitForURL('**/auth/sign-up');
      await page.locator('input[type="email"]').waitFor({ state: 'visible' });
      check(`${width}: mobile signup routing`, await page.locator('input[type="email"]').isVisible());
    }
    check(`${width}: no browser exceptions`, errors.length === 0);
    await context.close();
  }
} finally {
  await browser.close();
  writeFileSync(`${output}/browser-results.json`, JSON.stringify(results, null, 2) + '\n');
  console.log(`${results.filter(r => r.ok).length}/${results.length} browser assertions passed`);
}
