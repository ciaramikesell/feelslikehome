// PR #204 regression QA: production mobile website carousel and native exclusion.
// node scripts/qa/homepage-final-four-columns.mjs [baseUrl] [outputDir]
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const base = process.argv[2] || 'http://127.0.0.1:3143';
const dir = resolve(process.argv[3] || 'docs/homepage-final-four-columns/mobile-web-amendment');
mkdirSync(`${dir}/screenshots`, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || '/usr/bin/chromium' });
const results = [];
function check(name, ok) { results.push({ name, ok }); assert.ok(ok, name); }
async function at(page, index) {
  await page.waitForFunction(i => document.querySelector(`.pl-carousel-dots button:nth-child(${i + 1})`)?.getAttribute('aria-current') === 'true', index);
}
async function ready(page) {
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
}
try {
  for (const width of [320, 375, 390, 430, 768, 1024, 1280, 1440]) {
    const mobile = width < 640;
    const context = await browser.newContext({ viewport: { width, height: 900 }, isMobile: mobile, hasTouch: mobile, reducedMotion: 'reduce', deviceScaleFactor: 1 });
    await context.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await ready(page);
    const section = page.locator('.pl-how');
    const track = page.locator('.pl-editorial-grid');
    const heading = await page.locator('#how-title').evaluate(el => { const s = getComputedStyle(el); return { font: s.fontSize, color: s.color, align: s.textAlign, spacing: s.letterSpacing, transform: s.textTransform }; });
    check(`${width}: restored centered #203 eyebrow`, heading.font === '12px' && heading.color === 'rgb(152, 67, 41)' && heading.align === 'center' && heading.transform === 'uppercase');
    check(`${width}: illustrations and copy remain intact`, await page.locator('.pl-editorial-feature').count() === 4 && await page.locator('.pl-editorial-feature img').nth(3).getAttribute('alt').then(s => s.includes('Finished Basement is outlined')));
    check(`${width}: divider and single CTA retained`, await page.locator('.pl-section-divider').count() === 1 && await page.locator('.pl-hero .pl-button:visible').count() === 1);
    if (mobile) {
      check(`${width}: mobile web enables carousel`, await section.getAttribute('data-web-carousel') === 'true' && await section.getAttribute('aria-roledescription') === 'carousel');
      const geometry = await track.evaluate(el => ({ width: el.clientWidth, slide: el.children[0].clientWidth, step: el.children[1].offsetLeft - el.children[0].offsetLeft, overflow: getComputedStyle(el).overflowX }));
      check(`${width}: large slide with next peek`, geometry.slide >= geometry.width * .8 && geometry.step < geometry.width && geometry.overflow === 'auto');
      check(`${width}: accessible controls and starting state`, await page.locator('.pl-carousel-dots button').count() === 4 && await page.getByLabel('Previous feature', { exact: true }).isDisabled() && await track.getAttribute('tabindex') === '0');
      await section.scrollIntoViewIfNeeded();
      for (let i = 0; i < 4; i++) {
        await page.locator('.pl-carousel-dots button').nth(i).tap(); await at(page, i);
        await page.locator('.pl-editorial-feature img').nth(i).evaluate(el => el.decode());
        check(`${width}: pagination ${i + 1} updates status`, (await page.getByRole('status').innerText()).startsWith(`Slide ${i + 1} of 4:`));
        if (width === 390) await section.screenshot({ path: `${dir}/screenshots/slide-${i + 1}-390.png` });
      }
      check(`${width}: last next disabled`, await page.getByLabel('Next feature', { exact: true }).isDisabled());
      await page.getByLabel('Previous feature', { exact: true }).tap(); await at(page, 2);
      await track.focus(); await page.keyboard.press('Home'); await at(page, 0);
      await page.keyboard.press('ArrowRight'); await at(page, 1);
      await page.keyboard.press('End'); await at(page, 3);
      await page.keyboard.press('ArrowLeft'); await at(page, 2);
      check(`${width}: arrow/Home/End keyboard navigation`, await track.evaluate(el => el === document.activeElement));
      await page.keyboard.press('Home'); await at(page, 0);
      if (width === 390) {
        const cdp = await context.newCDPSession(page);
        const rect = await track.boundingBox();
        const x = rect.x + rect.width * .85, y = rect.y + 90;
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
        for (let i = 1; i <= 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x - i * 32, y }] });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await at(page, 1);
        check('390: actual touch swipe advances', (await page.getByRole('status').innerText()).startsWith('Slide 2'));
        await page.locator('.pl-carousel-dots button').nth(0).tap(); await at(page, 0);
      }
      check(`${width}: reduced-motion scroll is immediate`, await track.evaluate(el => getComputedStyle(el).scrollBehavior === 'auto'));
    } else {
      const columns = await track.evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length);
      check(`${width}: tablet/desktop grid unchanged`, columns === (width >= 1200 ? 4 : 2) && await section.getAttribute('data-web-carousel') === null && await page.locator('.pl-carousel-navigation').count() === 0);
    }
    check(`${width}: no page overflow`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `${dir}/screenshots/website-${width}.png`, fullPage: true });
    if (mobile) {
      await page.locator('.pl-hero .pl-mobile-auth').tap(); await page.waitForURL('**/auth/sign-up'); await page.locator('input[type="email"]').waitFor();
      check(`${width}: signup routing retained`, await page.locator('input[type="email"]').isVisible());
    } else {
      await page.locator('.pl-hero .pl-desktop-auth').click();
      check(`${width}: signup dialog retained`, await page.getByRole('dialog', { name: 'Create account', exact: true }).isVisible());
    }
    check(`${width}: no runtime errors`, !errors.length);
    await context.close();
  }
  // A real bridge-shaped runtime, not just a narrow viewport or fake user agent.
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await context.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await context.addInitScript(() => { window.webkit = { messageHandlers: { bridge: { postMessage() {} } } }; });
  const page = await context.newPage(); await ready(page);
  check('iOS bridge: shared first-paint native flag detected', await page.locator('html').getAttribute('data-flh-native') === '');
  check('iOS bridge: native welcome remains visible', await page.locator('.flh-welcome').isVisible() && !await page.locator('.flh-web-entry').isVisible());
  check('iOS bridge: mounted homepage never enables carousel', await page.locator('.pl-how').getAttribute('data-web-carousel') === null && await page.locator('.pl-carousel-navigation').count() === 0);
  await page.screenshot({ path: `${dir}/screenshots/native-welcome-390.png`, fullPage: true });
  // Unhide only for the test: otherwise native welcome could mask an accidental
  // carousel in the mounted marketing component. Production CSS is untouched.
  await page.addStyleTag({ content: 'html[data-flh-native] .flh-web-entry { display: block !important; } .flh-welcome { display: none !important; }' });
  check('iOS bridge: even exposed homepage keeps static stacked fallback', await page.locator('.pl-editorial-grid').evaluate(el => getComputedStyle(el).overflowX !== 'auto' && getComputedStyle(el).gridTemplateColumns.split(' ').length === 1));
  await context.close();
  const late = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await late.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  const latePage = await late.newPage(); await ready(latePage);
  await latePage.locator('.pl-how[data-web-carousel="true"]').waitFor();
  await latePage.evaluate(() => document.documentElement.setAttribute('data-flh-native', ''));
  await latePage.waitForFunction(() => !document.querySelector('.pl-how').hasAttribute('data-web-carousel'));
  check('late native flag: carousel and controls removed', await latePage.locator('.pl-carousel-navigation').count() === 0);
  await late.close();
  // Motion-enabled navigation and width changes use the same component.
  const motion = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'no-preference' });
  await motion.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  const motionPage = await motion.newPage(); await ready(motionPage);
  await motionPage.getByLabel('Next feature', { exact: true }).click(); await at(motionPage, 1);
  check('ordinary motion: smooth navigation settles on target', true);
  await motionPage.setViewportSize({ width: 768, height: 900 });
  await motionPage.waitForFunction(() => !document.querySelector('.pl-how').hasAttribute('data-web-carousel'));
  await motionPage.setViewportSize({ width: 390, height: 844 });
  await at(motionPage, 0);
  check('resize: desktop/tablet switches back to mobile at first slide', true);
  await motion.close();
} finally {
  await browser.close();
  writeFileSync(`${dir}/browser-results.json`, JSON.stringify(results, null, 2) + '\n');
  console.log(`${results.filter(r => r.ok).length}/${results.length} assertions passed`);
}
