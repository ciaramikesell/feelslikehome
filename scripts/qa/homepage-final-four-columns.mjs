// Local production QA. Requires a signed-out build and optional #203 baseline.
// node scripts/qa/homepage-final-four-columns.mjs [afterUrl] [beforeUrl] [outDir]
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const [after = 'http://127.0.0.1:3141', before = 'http://127.0.0.1:3140', out = 'docs/homepage-final-four-columns'] = process.argv.slice(2);
const dir = resolve(out);
mkdirSync(`${dir}/screenshots`, { recursive: true });
const results = [];
function check(name, ok) { results.push({ name, ok }); assert.ok(ok, name); }
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || '/usr/bin/chromium' });
const titles = ['Set Your Preferences', 'Import Homes from Anywhere', 'Compare What Matters', 'Search & Decide Together'];
const captions = ['Decide what matters most to you.', 'Bring your saved listings together.', 'See how each home fits your priorities.', 'Make decisions with your co-buyer and Realtor.'];
async function loaded(page) {
  await page.evaluate(async () => {
    const images = [...document.querySelectorAll('.pl-editorial-feature img')];
    for (const img of images) { img.scrollIntoView(); await img.decode(); }
    await document.fonts.ready;
    window.scrollTo(0, 0);
  });
}
async function metadata(page) {
  return page.evaluate(() => ({ title: document.title, meta: [...document.querySelectorAll('meta[name="description"],meta[property^="og:"],meta[name^="twitter:"],link[rel="canonical"]')].map(el => el.outerHTML) }));
}
try {
  for (const width of [320, 375, 390, 430, 768, 1024, 1280, 1440]) {
    const mobile = width < 768;
    const ctx = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile, reducedMotion: 'reduce' });
    // Deterministic font fallback captures; production font declarations stay untouched.
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => {
      window.__homepageShifts = [];
      new PerformanceObserver(list => { for (const e of list.getEntries()) if (!e.hadRecentInput) window.__homepageShifts.push(e.value); }).observe({ type: 'layout-shift', buffered: true });
    });
    await page.goto(after, { waitUntil: 'networkidle' });
    const initial = await page.locator('.pl-editorial-feature').evaluateAll(els => els.map(el => ({ height: el.offsetHeight, top: el.offsetTop })));
    await loaded(page);
    const final = await page.locator('.pl-editorial-feature').evaluateAll(els => els.map(el => ({ height: el.offsetHeight, top: el.offsetTop })));
    check(`${width}: images reserve layout before loading`, JSON.stringify(initial) === JSON.stringify(final));
    const layout = await page.evaluate(() => {
      const grid = document.querySelector('.pl-editorial-grid');
      const hero = document.querySelector('.pl-hero').getBoundingClientRect();
      const opening = document.querySelector('.pl-hero-opening');
      const range = document.createRange(); range.selectNodeContents(opening);
      const rect = range.getBoundingClientRect();
      return { columns: getComputedStyle(grid).gridTemplateColumns.split(' ').length, overflow: document.documentElement.scrollWidth > innerWidth,
        lines: range.getClientRects().length, fits: rect.width <= opening.parentElement.clientWidth + 1, font: parseFloat(getComputedStyle(opening).fontSize), hero: hero.height / innerHeight,
        shifts: window.__homepageShifts.reduce((a, b) => a + b, 0), heading: getComputedStyle(document.querySelector('#how-title')).textTransform };
    });
    check(`${width}: 4→2→1 grid`, layout.columns === (width >= 1200 ? 4 : width >= 640 ? 2 : 1));
    check(`${width}: no overflow`, !layout.overflow);
    check(`${width}: no layout shift`, layout.shifts < .01);
    if (width >= 1024) {
      check(`${width}: one-line desktop opening`, layout.lines === 1 && layout.fits && layout.font >= 25);
      check(`${width}: taller hero around 80% viewport`, layout.hero >= .75 && layout.hero <= .85);
    }
    check(`${width}: centered meaningful heading`, await page.locator('#how-title').textContent() === 'How it works' && layout.heading === 'uppercase');
    check(`${width}: four articles and no selectors or collaboration`, await page.locator('.pl-editorial-feature').count() === 4 && await page.locator('.pl-how button,.pl-collaboration,[aria-pressed]').count() === 0);
    check(`${width}: one discreet note`, await page.locator('.pl-illustration-note').count() === 1);
    check(`${width}: decorative divider hidden from AT`, await page.locator('.pl-section-divider').getAttribute('aria-hidden') === 'true');
    for (let i = 0; i < 4; i++) {
      const feature = page.locator('.pl-editorial-feature').nth(i);
      check(`${width}: title/caption ${i + 1}`, await feature.locator('h3').innerText() === titles[i] && await feature.locator('p').innerText() === captions[i]);
      const image = await feature.locator('img').evaluate(el => ({ loaded: el.complete && el.naturalWidth > 0, ratio: el.width / el.height, alt: el.alt, fit: getComputedStyle(el).objectFit, lazy: el.loading, border: getComputedStyle(el).borderWidth, shadow: getComputedStyle(el).boxShadow }));
      check(`${width}: intact lazy illustration ${i + 1}`, image.loaded && Math.abs(image.ratio - 4 / 3) < .02 && image.alt.length > 30 && image.fit === 'contain' && image.lazy === 'lazy' && image.border === '0px' && image.shadow === 'none');
    }
    check(`${width}: approved fourth-image semantics`, await page.locator('.pl-editorial-feature img').nth(3).getAttribute('alt').then(s => s.includes('Finished Basement is outlined')));
    await page.screenshot({ path: `${dir}/screenshots/after-${width}.png`, fullPage: true });
    if (width === 390 || width === 1440) await page.locator('.pl-how').screenshot({ path: `${dir}/screenshots/editorial-${width}.png` });
    const afterMeta = await metadata(page);
    // Navigation/CTA retain existing desktop popover and mobile signup route.
    if (mobile) {
      const cta = page.locator('.pl-hero .pl-mobile-auth');
      check(`${width}: mobile signup href`, await cta.getAttribute('href') === '/auth/sign-up');
      await cta.tap(); await page.waitForURL('**/auth/sign-up');
      await page.locator('input[type="email"]').waitFor();
      check(`${width}: signup form route`, await page.locator('input[type="email"]').isVisible());
      await page.goto(after, { waitUntil: 'networkidle' });
      await page.getByLabel('Open navigation').tap();
      await page.getByRole('navigation', { name: 'Mobile public navigation' }).getByRole('link', { name: 'For Realtors' }).tap();
    } else {
      const cta = page.locator('.pl-hero .pl-desktop-auth');
      await cta.focus(); await page.keyboard.press('Enter');
      check(`${width}: signup-first dialog`, await page.getByRole('dialog', { name: 'Create account', exact: true }).isVisible());
      await page.keyboard.press('Escape');
      check(`${width}: CTA focus restored`, await cta.evaluate(el => el === document.activeElement));
      await page.locator('.pl-nav-surface').getByRole('link', { name: 'For Realtors' }).click();
    }
    await page.waitForURL('**/for-realtors'); await page.locator('.rl-root').waitFor();
    check(`${width}: Realtor navigation`, await page.locator('.rl-root').isVisible());
    if (width === 390 || width === 1440) {
      await page.evaluate(() => document.fonts.ready);
      await page.locator('.rl-root img').evaluateAll(async els => { for (const img of els) { img.scrollIntoView(); await img.decode(); } window.scrollTo(0, 0); });
      const realtorAfter = await page.screenshot({ fullPage: true });
      await page.goto(`${before}/for-realtors`, { waitUntil: 'domcontentloaded' });
      await page.locator('.rl-root').waitFor();
      await page.evaluate(() => document.fonts.ready);
      await page.locator('.rl-root img').evaluateAll(async els => { for (const img of els) { img.scrollIntoView(); await img.decode(); } window.scrollTo(0, 0); });
      const realtorBefore = await page.screenshot({ fullPage: true });
      check(`${width}: standalone Realtor pixels unchanged`, Buffer.compare(realtorAfter, realtorBefore) === 0);
      await page.goto(before, { waitUntil: 'domcontentloaded' });
      await page.locator('.pl-preview-stage img').waitFor();
      await page.locator('#how-it-works').scrollIntoViewIfNeeded();
      await page.locator('.pl-preview-stage img').evaluate(el => el.decode());
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: `${dir}/screenshots/before-${width}.png`, fullPage: true });
      check(`${width}: social/link metadata unchanged`, JSON.stringify(afterMeta) === JSON.stringify(await metadata(page)));
    }
    check(`${width}: no runtime exceptions`, errors.length === 0);
    await ctx.close();
  }
} finally {
  await browser.close();
  writeFileSync(`${dir}/browser-results.json`, JSON.stringify(results, null, 2) + '\n');
  console.log(`${results.filter(r => r.ok).length}/${results.length} assertions passed`);
}
