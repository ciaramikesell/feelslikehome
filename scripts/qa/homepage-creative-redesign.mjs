// Public homepage creative redesign QA, against a local production build.
// npm run build && npx next start -p 3210
// node scripts/qa/homepage-creative-redesign.mjs [baseUrl] [outputDir]
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const base = process.argv[2] || 'http://127.0.0.1:3210/';
const dir = resolve(process.argv[3] || 'docs/homepage-creative-redesign');
mkdirSync(`${dir}/screenshots`, { recursive: true });
const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {});
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, ...(detail === undefined ? {} : { detail }) }); if (!ok) console.error('FAIL', name, detail ?? ''); };

async function settle(page) {
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(async () => {
    for (let y = 0; y < document.documentElement.scrollHeight; y += 400) { scrollTo(0, y); await new Promise(r => setTimeout(r, 50)); }
    scrollTo(0, 0);
  });
  await page.waitForFunction(() => [...document.images].filter(i => i.getClientRects().length).every(i => i.complete && i.naturalWidth > 0));
  await page.evaluate(() => Promise.all([...document.images].filter(i => i.getClientRects().length).map(i => i.decode().catch(() => {}))));
  await page.waitForTimeout(900);
}

for (const width of [1440, 1024, 768, 390, 375, 320]) {
  const page = await browser.newPage({ viewport: { width, height: width > 900 ? 900 : 844 }, deviceScaleFactor: 2 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(base, { waitUntil: 'networkidle' });
  await settle(page);
  // A first full-page capture can make Chromium pick a larger srcset candidate
  // for the hero; let that one load and decode before the published capture.
  await page.screenshot({ fullPage: true, type: 'jpeg', quality: 10 });
  await settle(page);
  await page.waitForFunction(() => { const img = document.querySelector('.pl-hero-visual img'); return img.complete && img.naturalWidth > 0; });
  await page.screenshot({ path: `${dir}/screenshots/home-${width}.jpg`, fullPage: true, type: 'jpeg', quality: 82 });
  const metrics = await page.evaluate(() => ({
    height: document.documentElement.scrollHeight,
    overflow: document.documentElement.scrollWidth - innerWidth,
    heroPhoto: document.querySelector('.pl-hero-visual img')?.currentSrc.includes('Warm%20Cottage'),
    smallText: [...document.querySelectorAll('.pl-root *')].filter(el => el.childNodes.length && [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()) && el.getClientRects().length && !el.closest('.sr-only, [aria-hidden="true"] .pl-art-composition') && parseFloat(getComputedStyle(el).fontSize) < 10.5 && !el.closest('.pl-art-composition')).map(el => el.textContent.trim().slice(0, 30)),
    tabs: [...document.querySelectorAll('.pl-step')].map(t => { const r = t.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; }),
  }));
  check(`${width}: no horizontal overflow`, metrics.overflow <= 0, metrics.overflow);
  check(`${width}: approved cottage hero photograph renders`, metrics.heroPhoto);
  check(`${width}: no live copy below 10.5px`, metrics.smallText.length === 0, metrics.smallText);
  check(`${width}: step tabs are at least 44px touch targets`, metrics.tabs.every(([w, h]) => w >= 44 && h >= 44), metrics.tabs);
  if (width <= 640) {
    const nav = await page.evaluate(() => ({
      labels: [...document.querySelectorAll('.pl-step-short')].map(l => ({ size: parseFloat(getComputedStyle(l).fontSize), fits: l.scrollWidth <= l.parentElement.parentElement.clientWidth })),
      gap: parseFloat(getComputedStyle(document.querySelector('.pl-steps')).gap),
      noteHeadOneLine: document.querySelector('.pl-hero-note-kicker').getClientRects().length === 1 && document.querySelector('.pl-hero-note-kicker').getBoundingClientRect().height < 16,
      exampleTag: document.querySelector('.pl-hero-note-tag')?.textContent,
    }));
    check(`${width}: mobile step labels are at least 12px and fit their tab`, nav.labels.every(l => l.size >= 12 && l.fits), nav.labels);
    check(`${width}: step tabs keep spacing between targets`, nav.gap >= 4, nav.gap);
    check(`${width}: hero card shows Example tag on one header line`, nav.exampleTag === 'Example' && nav.noteHeadOneLine, nav);
  }
  check(`${width}: no console or page errors`, errors.length === 0, errors);
  results.push({ name: `${width}: page height`, ok: true, detail: metrics.height });

  // Every step, by click.
  for (let index = 0; index < 4; index += 1) {
    await page.locator('.pl-step').nth(index).click();
    await page.waitForTimeout(120);
    await page.evaluate(() => Promise.all([...document.images].filter(i => i.getClientRects().length).map(i => i.decode().catch(() => {}))));
    await page.waitForTimeout(700);
    const state = await page.evaluate(() => ({
      selected: [...document.querySelectorAll('.pl-step')].findIndex(t => t.getAttribute('aria-selected') === 'true'),
      visible: [...document.querySelectorAll('.pl-stage-panel')].filter(p => !p.hidden).map(p => p.id),
    }));
    check(`${width}: step ${index + 1} selects one tab and one panel`, state.selected === index && state.visible.length === 1, state);
    if (width === 1440 || width === 390) await page.locator('.pl-how').screenshot({ path: `${dir}/screenshots/step-${index + 1}-${width}.jpg`, type: 'jpeg', quality: 82 });
  }
  await page.close();
}

// Keyboard: roving focus with arrows / Home / End, visible focus.
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.locator('.pl-step').first().focus();
  const seq = [];
  for (const key of ['ArrowDown', 'ArrowRight', 'End', 'ArrowDown', 'ArrowUp', 'Home']) {
    await page.keyboard.press(key);
    seq.push(await page.evaluate(() => [...document.querySelectorAll('.pl-step')].indexOf(document.activeElement)));
  }
  check('keyboard arrows, Home and End move focus and selection', JSON.stringify(seq) === '[1,2,3,0,3,0]', seq);
  const tabStops = await page.evaluate(() => [...document.querySelectorAll('.pl-step')].map(t => t.tabIndex));
  check('only the selected tab is in the tab order', JSON.stringify(tabStops) === '[0,-1,-1,-1]', tabStops);
  const ring = await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle);
  check('focused tab shows a visible focus ring', ring === 'solid', ring);
  await page.locator('.pl-step').first().focus();
  await page.keyboard.press('Tab');
  const next = await page.evaluate(() => document.activeElement.className);
  check('Tab leaves the tablist instead of cycling through every step', !next.includes('pl-step'), next);
  await page.close();
}

// Touch swipe on the stage advances steps.
{
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  await page.goto(base, { waitUntil: 'networkidle' });
  const box = await page.locator('.pl-stage').boundingBox();
  await page.locator('.pl-stage').scrollIntoViewIfNeeded();
  const b = await page.locator('.pl-stage').boundingBox();
  await page.evaluate(({ x, y }) => {
    const stage = document.querySelector('.pl-stage');
    const fire = (type, cx) => stage.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerType: 'touch', clientX: cx, clientY: y }));
    fire('pointerdown', x + 120); fire('pointerup', x - 20);
  }, { x: b.x + b.width / 2, y: b.y + 60 });
  const selected = await page.evaluate(() => [...document.querySelectorAll('.pl-step')].findIndex(t => t.getAttribute('aria-selected') === 'true'));
  check('touch swipe left on the stage advances to step 2', selected === 1 && !!box, selected);
  await context.close();
}

// Reduced motion removes animation and transition.
{
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.locator('.pl-step').nth(2).click();
  const motion = await page.evaluate(() => ({
    panel: getComputedStyle(document.querySelector('.pl-stage-panel:not([hidden])')).animationName,
    note: getComputedStyle(document.querySelector('.pl-hero-note')).animationName,
    step: getComputedStyle(document.querySelector('.pl-step')).transitionDuration,
  }));
  check('reduced motion disables panel, note and step motion', motion.panel === 'none' && motion.note === 'none' && motion.step === '0s', motion);
  await context.close();
}

// No JavaScript: Next streams this dynamic route inside hidden wrappers that
// JavaScript reveals, so a full no-JS page is not established (pre-existing,
// not specific to this page). The component still ships a <noscript> rule that
// shows all four steps if the wrapper behaviour changes.

// Native shell: the public homepage is not shown inside the iOS app.
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.addInitScript(() => { window.webkit = { messageHandlers: { bridge: { postMessage() {} } } }; });
  await page.goto(base, { waitUntil: 'networkidle' });
  const native = await page.evaluate(() => ({
    flag: document.documentElement.hasAttribute('data-flh-native'),
    web: getComputedStyle(document.querySelector('.flh-web-entry')).display,
    welcome: !!document.querySelector('.flh-welcome') && getComputedStyle(document.querySelector('.flh-welcome')).display !== 'none',
  }));
  check('native bridge hides the public homepage and shows the native welcome', native.flag && native.web === 'none' && native.welcome, native);
  await page.screenshot({ path: `${dir}/screenshots/native-welcome-390.jpg`, type: 'jpeg', quality: 82 });
  await page.close();
}

// Public navigation and auth entries.
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(base, { waitUntil: 'networkidle' });
  check('Realtor route linked', await page.locator('a[href="/for-realtors"]').count() >= 3);
  await page.getByRole('button', { name: 'Create a free account' }).first().click();
  check('hero CTA opens the account panel', await page.locator('.pl-auth-popover[role="dialog"]').isVisible());
  await page.keyboard.press('Escape');
  await page.locator('.pl-closing .pl-desktop-auth').click();
  await page.waitForTimeout(900);
  const closing = await page.evaluate(() => ({ open: !!document.querySelector('.pl-auth-popover'), y: scrollY, focus: document.activeElement?.tagName }));
  check('closing CTA scrolls to the account panel and focuses its first field', closing.open && closing.y < 5 && closing.focus === 'INPUT', closing);
  await page.close();
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await mobile.goto(base, { waitUntil: 'networkidle' });
  check('mobile CTA links to sign-up', await mobile.locator('.pl-hero .pl-mobile-auth').getAttribute('href') === '/auth/sign-up');
  await mobile.locator('.pl-mobile-menu summary').click();
  check('mobile menu exposes sign in and get started', await mobile.locator('.pl-mobile-menu a[href="/auth/sign-in"]').isVisible() && await mobile.locator('.pl-mobile-menu a[href="/auth/sign-up"]').isVisible());
  await mobile.close();
}

await browser.close();
writeFileSync(`${dir}/browser-results.json`, `${JSON.stringify(results, null, 2)}\n`);
const failed = results.filter(r => !r.ok);
console.log(`${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
