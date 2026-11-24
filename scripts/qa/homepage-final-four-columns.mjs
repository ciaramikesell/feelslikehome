// PR #204 editorial showcase regression QA, against a local production build.
// node scripts/qa/homepage-final-four-columns.mjs [baseUrl] [outputDir]
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const base = process.argv[2] || 'http://127.0.0.1:3152';
const dir = resolve(process.argv[3] || 'docs/homepage-final-four-columns/approved-implementation');
mkdirSync(`${dir}/screenshots`, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || '/usr/bin/chromium' });
const results = [];
function check(name, ok) { results.push({ name, ok }); assert.ok(ok, name); }
async function at(page, index) {
  await page.waitForFunction(i => {
    const selected = document.querySelector(`.pl-showcase-dots button:nth-child(${i + 1})`)?.getAttribute('aria-current') === 'true';
    const track = document.querySelector('.pl-showcase-track');
    return selected && Math.abs(track.scrollLeft - track.children[i].offsetLeft + track.children[0].offsetLeft) <= 2;
  }, index);
}
async function captureFullPage(page, path) {
  // Full-document painting can re-snap an off-screen mobile scroller in
  // Chromium. Freeze that invisible behavior only while capturing pixels;
  // interaction assertions always run with the original mandatory snap.
  const track = page.locator('.pl-showcase-track');
  const frozen = await track.evaluate(el => {
    const state = { left: el.scrollLeft, snap: el.style.scrollSnapType };
    el.style.scrollSnapType = 'none';
    el.scrollLeft = state.left;
    return state;
  });
  const size = await page.evaluate(() => ({ width: innerWidth, height: document.documentElement.scrollHeight }));
  const cdp = await page.context().newCDPSession(page);
  try {
    const png = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, fromSurface: true, clip: { x: 0, y: 0, ...size, scale: 1 } });
    writeFileSync(path, Buffer.from(png.data, 'base64'));
  } finally {
    await cdp.detach();
    await track.evaluate((el, state) => { el.scrollLeft = state.left; el.style.scrollSnapType = state.snap; }, frozen);
  }
}
async function ready(page) {
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
}
const fontDir = resolve(process.env.FLH_PROTOTYPE_FONTS || '/workspace/prototypes/flh-homepage-layout/assets/fonts');
async function installFonts(context) {
  const faces = [['Source Serif 4','source-serif-4.ttf','normal','500 700'],['Source Serif 4','source-serif-4-italic.ttf','italic','500 700'],['Plus Jakarta Sans','plus-jakarta-sans.ttf','normal','400 700']];
  const css = faces.map(([family,file,style,weight]) => `@font-face{font-family:'${family}';src:url('${base}/__flh_qa_fonts__/${file}') format('truetype');font-style:${style};font-weight:${weight};font-display:block}`).join('');
  await context.route(/fonts\.googleapis\.com/, r => r.fulfill({ contentType: 'text/css', body: css }));
  await context.route('**/__flh_qa_fonts__/*', r => r.fulfill({ path: resolve(fontDir,new URL(r.request().url()).pathname.split('/').pop()) }));
}
const titles = ['Set Your Preferences', 'Import Homes from Anywhere', 'Compare What Matters', 'Search & Decide Together'];
const captions = ['Decide what matters most to you.', 'Bring your saved listings together.', 'See how each home fits your priorities.', 'Make decisions with your co-buyer and Realtor.'];
try {
  for (const width of [320, 375, 390, 430, 768, 1024, 1280, 1440]) {
    const mobile = width < 640;
    const context = await browser.newContext({ viewport: { width, height: 900 }, isMobile: mobile, hasTouch: mobile, reducedMotion: 'reduce', deviceScaleFactor: 1 });
    await installFonts(context);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await ready(page);
    const section = page.locator('.pl-how');
    const showcase = page.locator('.pl-feature-showcase');
    const track = page.locator('.pl-showcase-track');
    check(`${width}: actual prototype fonts loaded`, await page.evaluate(async () => { const faces = await Promise.all(['600 48px \"Source Serif 4\"','400 16px \"Plus Jakarta Sans\"'].map(font => document.fonts.load(font))); return faces.every(items => items.length > 0 && items.every(face => face.status === 'loaded')); }));
    const heading = await page.locator('#how-title').evaluate(el => { const s = getComputedStyle(el); return { font: s.fontSize, color: s.color, align: s.textAlign, transform: s.textTransform }; });
    check(`${width}: small centered terracotta heading`, heading.font === '12px' && heading.color === 'rgb(152, 67, 41)' && heading.align === 'center' && heading.transform === 'uppercase');
    check(`${width}: web showcase active and native fallback hidden`, await showcase.getAttribute('data-web-showcase') === 'true' && !await page.locator('.pl-native-feature-fallback').isVisible());
    check(`${width}: divider and single CTA retained`, await page.locator('.pl-section-divider').count() === 1 && await page.locator('.pl-hero .pl-button:visible').count() === 1);
    check(`${width}: accessible navigation`, await page.locator('.pl-showcase-dots button').count() === 4 && await page.getByLabel('Previous feature', { exact: true }).isDisabled() && await track.getAttribute('tabindex') === '0');
    let height;
    await section.scrollIntoViewIfNeeded();
    for (let i = 0; i < 4; i++) {
      const button = page.locator('.pl-showcase-dots button').nth(i);
      if (mobile) await button.tap(); else await button.click();
      await at(page, i);
      const slide = page.locator('.pl-showcase-slide').nth(i);
      await slide.locator('img').evaluateAll(els => Promise.all(els.map(el => el.decode())));
      const state = await slide.evaluate(el => {
        const art = el.querySelector('.pl-showcase-art').getBoundingClientRect();
        const copy = document.querySelector('.pl-showcase-copy').getBoundingClientRect();
        const image = el.querySelector('img');
        return { art, copy, fit: [...el.querySelectorAll('.pl-source-photo')].every(photo => getComputedStyle(photo).overflow === 'hidden'), loaded: [...el.querySelectorAll('img')].every(img => img.complete && img.naturalWidth > 0),
          src: image.getAttribute('src'), title: document.querySelector('.pl-showcase-copy > h3').textContent, caption: document.querySelector('.pl-showcase-copy > p').textContent };
      });
      check(`${width}: preserved feature ${i + 1} copy and loaded composition`, state.loaded && state.src.includes('homepage-previews') && state.title === titles[i] && state.caption === captions[i] && state.fit);
      check(`${width}: editorial placement ${i + 1}`, mobile ? state.art.bottom <= state.copy.top + 1 : state.copy.right <= state.art.left && state.art.width > state.copy.width);
      check(`${width}: only active slide exposed to AT ${i + 1}`, await page.locator('.pl-showcase-slide:not([aria-hidden="true"])').count() === 1 && await slide.getAttribute('aria-label') === `${i + 1} of 4: ${titles[i]}`);
      check(`${width}: numbered progress ${i + 1}`, await page.locator('.pl-showcase-count').innerText() === `${String(i + 1).padStart(2, '0')}/04`);
      check(`${width}: slide ${i + 1} status`, (await page.getByRole('status').innerText()).startsWith(`Slide ${i + 1} of 4:`));
      const description = await page.locator('.pl-showcase-copy > p').boundingBox();
      const controls = await page.locator('.pl-showcase-controls').boundingBox();
      check(`${width}: navigation directly below slide ${i + 1} copy`, controls.y - description.y - description.height >= 19 && controls.y - description.y - description.height <= 25);
      if (mobile) {
        const count = await page.locator('.pl-showcase-count').boundingBox();
        check(`${width}: mobile controls and count share a row ${i + 1}`, Math.abs(count.y + count.height / 2 - controls.y - controls.height / 2) < 2 && count.x - controls.x - controls.width <= 14);
      }
      await section.scrollIntoViewIfNeeded();
      check(`${width}: slide ${i + 1} card labels are not overlapped or clipped`, await slide.locator('.pl-art-priority > strong,.pl-art-tier,.pl-art-match > strong,.pl-art-person > strong,.pl-art-participant li > span,.pl-art-person-match,.pl-art-sources strong,.pl-art-saved > strong').evaluateAll(els => els.every(el => { const r = el.getBoundingClientRect(); const top = document.elementFromPoint(r.left + r.width / 2,r.top + r.height / 2); return r.left >= 0 && r.right <= innerWidth && top && (top === el || el.contains(top)); })));
      if (i === 1) check(`${width}: listing-source labels stay inside their tiles`, await slide.locator('.pl-art-sources strong').evaluateAll(els => els.every(el => { const r = el.getBoundingClientRect(), card = el.parentElement.getBoundingClientRect(); return r.left >= card.left && r.right <= card.right; })));
      const box = await track.boundingBox();
      height ??= box.height;
      check(`${width}: stable slide frame ${i + 1}`, Math.abs(box.height - height) < 1);
      if (width === 390 || width === 1440) {
        await page.evaluate(() => document.activeElement?.blur?.());
        await page.mouse.move(0, 0);
        await page.waitForTimeout(150);
        await section.screenshot({ path: `${dir}/screenshots/slide-${i + 1}-${width}.png` });
      }
    }
    check(`${width}: accurate distinct participants and source photos`, await page.locator('.pl-art-participant').count() === 2 && await page.locator('.pl-art-participant').nth(0).locator('li svg[fill="currentColor"]').count() === 3 && await page.locator('.pl-art-participant').nth(1).locator('li svg[fill="none"]').count() === 1 && await page.locator('.pl-art-shared-home img').count() === 1);
    check(`${width}: transparent composition canvas`, await page.locator('.pl-feature-artwork').first().evaluate(el => getComputedStyle(el).backgroundColor === 'rgba(0, 0, 0, 0)'));
    check(`${width}: navigation targets fit viewport and meet 44px`, await page.locator('.pl-showcase-navigation button').evaluateAll(els => els.every(el => { const r = el.getBoundingClientRect(); return r.width >= 44 && r.height >= 44 && r.left >= 0 && r.right <= innerWidth; })));
    check(`${width}: no outer frame and muted compact disclaimer`, await showcase.evaluate(el => { const s = getComputedStyle(el); const note = getComputedStyle(document.querySelector('.pl-illustration-note')); return s.borderTopWidth === '0px' && s.backgroundColor === 'rgba(0, 0, 0, 0)' && parseFloat(note.fontSize) <= 10 && parseFloat(note.marginTop) <= 12; }));
    check(`${width}: last next disabled`, await page.getByLabel('Next feature', { exact: true }).isDisabled());
    await page.getByLabel('Previous feature', { exact: true }).click(); await at(page, 2);
    check(`${width}: focus stays on stationary navigation after slide changes`, await page.getByLabel('Previous feature', { exact: true }).evaluate(el => el === document.activeElement));
    await track.focus(); await page.keyboard.press('Home'); await at(page, 0);
    await page.keyboard.press('ArrowRight'); await at(page, 1);
    await page.keyboard.press('End'); await at(page, 3);
    await page.keyboard.press('ArrowLeft'); await at(page, 2);
    check(`${width}: arrow/Home/End keyboard navigation`, await track.evaluate(el => el === document.activeElement));
    check(`${width}: keyboard focus is visibly outlined`, await track.evaluate(el => getComputedStyle(el).outlineStyle === 'solid' && parseFloat(getComputedStyle(el).outlineWidth) >= 2));
    await page.keyboard.press('Home'); await at(page, 0);
    if (width === 390) {
      const cdp = await context.newCDPSession(page);
      const rect = await track.boundingBox();
      await track.scrollIntoViewIfNeeded();
      const touchRect = await track.boundingBox();
      const x = touchRect.x + touchRect.width * .85, y = touchRect.y + 50;
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      for (let i = 1; i <= 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x - i * 34, y }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await at(page, 1);
      check('390: actual touch swipe advances', (await page.getByRole('status').innerText()).startsWith('Slide 2'));
      await track.focus(); await page.keyboard.press('Home'); await at(page, 0);
    }
    check(`${width}: reduced motion is immediate`, await track.evaluate(el => getComputedStyle(el).scrollBehavior === 'auto'));
    check(`${width}: no page overflow`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    if (width >= 1024) {
      check(`${width}: tall hero retained`, await page.locator('.pl-hero').evaluate(el => el.clientHeight >= innerHeight * .75 && el.clientHeight <= innerHeight * .85));
      check(`${width}: one-line opening retained`, await page.locator('.pl-hero-opening').evaluate(el => { const r = document.createRange(); r.selectNodeContents(el); return r.getClientRects().length === 1; }));
    }
    await page.evaluate(() => { document.activeElement?.blur?.(); window.scrollTo(0, 0); });
    await page.mouse.move(0, 0);
    await page.waitForTimeout(150);
    await captureFullPage(page, `${dir}/screenshots/website-${width}.png`);
    if (width <= 640) {
      await page.locator('.pl-hero .pl-mobile-auth').tap(); await page.waitForURL('**/auth/sign-up'); await page.locator('input[type="email"]').waitFor();
      check(`${width}: signup routing retained`, await page.locator('input[type="email"]').isVisible());
      await ready(page); await page.getByLabel('Open navigation').tap();
      await page.getByRole('navigation', { name: 'Mobile public navigation' }).getByRole('link', { name: 'For Realtors' }).tap();
    } else {
      await page.locator('.pl-hero .pl-desktop-auth').click();
      check(`${width}: signup dialog retained`, await page.getByRole('dialog', { name: 'Create account', exact: true }).isVisible());
      await page.keyboard.press('Escape');
      await page.locator('.pl-nav-surface').getByRole('link', { name: 'For Realtors' }).click();
    }
    await page.waitForURL('**/for-realtors'); await page.locator('.rl-root').waitFor();
    check(`${width}: Realtor route retained`, await page.locator('.rl-root').isVisible());
    check(`${width}: no runtime errors`, !errors.length);
    await context.close();
  }
  for (const width of [390, 1440]) {
    const noJs = await browser.newContext({ viewport: { width, height: 900 }, javaScriptEnabled: false });
    await installFonts(noJs);
    const page = await noJs.newPage(); await page.goto(base, { waitUntil: 'networkidle' });
    // Next's async root can stream into a hidden S:n wrapper that its own
    // inline script normally reveals. Complete that framework wrapper only
    // in this isolated no-JS component test; do not claim full-page no-JS support.
    const streamedWrapper = await page.locator('.pl-root').evaluate(el => { let hidden = false; for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) { if (n.hidden && n.id.startsWith('S:')) { hidden = true; n.hidden = false; } } return hidden; });
    results.push({ name: `${width}: no-JS framework wrapper requires JavaScript`, ok: true, observed: streamedWrapper, scope: 'Component fallback is tested after completing the existing Next SSR stream wrapper.' });
    check(`${width}: no-JS component fallback shows all four features without horizontal track`, await page.locator('.pl-showcase-track').evaluate(el => getComputedStyle(el).display === 'block' && getComputedStyle(el).overflowX === 'visible') && await page.locator('.pl-showcase-slide').count() === 4 && await page.locator('.pl-showcase-fallback-copy:visible').count() === 4 && !await page.locator('.pl-showcase-copy').isVisible() && !await page.locator('.pl-showcase-navigation').isVisible());
    await noJs.close();
  }
  // Native bridge and attribute checks are independent of viewport width.
  for (const width of [390, 1280]) {
    const context = await browser.newContext({ viewport: { width, height: 844 }, isMobile: width < 768, hasTouch: true });
    await installFonts(context);
    await context.addInitScript(() => { window.webkit = { messageHandlers: { bridge: { postMessage() {} } } }; });
    const page = await context.newPage(); await ready(page);
    check(`${width} iOS bridge: shared native flag detected`, await page.locator('html').getAttribute('data-flh-native') === '');
    check(`${width} iOS bridge: welcome unchanged and marketing hidden`, await page.locator('.flh-welcome').isVisible() && !await page.locator('.flh-web-entry').isVisible());
    check(`${width} iOS bridge: no website showcase state or controls`, await page.locator('.pl-feature-showcase').getAttribute('data-web-showcase') === null && await page.locator('.pl-showcase-navigation button').count() === 0);
    if (width === 390) await captureFullPage(page, `${dir}/screenshots/native-welcome-390.png`);
    await page.addStyleTag({ content: 'html[data-flh-native] .flh-web-entry { display: block !important; } .flh-welcome { display: none !important; }' });
    check(`${width} iOS bridge: even test-exposed marketing uses original static fallback`, await page.locator('.pl-native-feature-fallback').isVisible() && !await page.locator('.pl-feature-showcase').isVisible() && await page.locator('.pl-editorial-grid').evaluate(el => getComputedStyle(el).overflowX !== 'auto'));
    check(`${width} iOS bridge: original illustrations retained`, await page.locator('.pl-native-feature-fallback img').evaluateAll(els => els.length === 4 && els.every(el => el.getAttribute('src').includes('homepage-previews'))));
    await context.close();
  }
  const late = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await installFonts(late);
  const latePage = await late.newPage(); await ready(latePage);
  await latePage.locator('.pl-feature-showcase[data-web-showcase="true"]').waitFor();
  await latePage.evaluate(() => document.documentElement.setAttribute('data-flh-native', ''));
  await latePage.waitForFunction(() => !document.querySelector('.pl-feature-showcase').hasAttribute('data-web-showcase'));
  check('late native flag: website interaction removed and fallback restored', await latePage.locator('.pl-showcase-navigation button').count() === 0 && !await latePage.locator('.pl-feature-showcase').isVisible());
  await late.close();
  const motion = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'no-preference' });
  await installFonts(motion);
  const motionPage = await motion.newPage(); await ready(motionPage);
  await motionPage.getByLabel('Next feature', { exact: true }).click(); await at(motionPage, 1);
  check('ordinary motion: smooth desktop navigation settles', true);
  await motionPage.setViewportSize({ width: 390, height: 844 }); await at(motionPage, 1);
  check('resize: feature selection retained between desktop and mobile', true);
  await motion.close();
} finally {
  await browser.close();
  writeFileSync(`${dir}/browser-results.json`, JSON.stringify(results, null, 2) + '\n');
  console.log(`${results.filter(r => r.ok && !('observed' in r)).length} assertions passed; ${results.filter(r => 'observed' in r).length} SSR observations recorded`);
}
