#!/usr/bin/env node
// Browser QA for Milestone 3 (docs/onboarding-motion-polish.md). DEVELOPMENT ONLY.
//
//   Part 1 — dev previews (/dev/onboarding?flow=v3, in-memory services):
//     BEFORE = main under `next dev`, AFTER = this branch under `next dev`.
//     node scripts/qa/onboarding-motion-qa.mjs preview <outDir> <afterBase> <beforeBase>
//   Part 2 — real stack (Supabase stand-in + production build, FLH_ONBOARDING_V3=on):
//     node scripts/qa/onboarding-motion-qa.mjs stack <outDir> <standin.json> <onBase>
//
// "Native" pages get what Capacitor's iOS shell injects at document start
// (bridge handler, window.Capacitor, Capacitor's real native-bridge.js, plugin
// headers) with a fake native side that records every plugin call. `oldBinary`
// omits the Haptics header, like an installed build that predates the plugin.
import { readFileSync, mkdirSync, writeFileSync, renameSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chromium } from 'playwright';

const [mode, outArg, ...rest] = process.argv.slice(2);
if (!['preview', 'stack'].includes(mode) || !outArg) throw new Error('Usage: onboarding-motion-qa.mjs preview|stack <outDir> …');
const outDir = resolve(outArg);
mkdirSync(outDir, { recursive: true });
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: Boolean(ok), detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };
const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {});
const consoleErrors = [];
// 'when fetching the script': the dev preview has no Supabase configuration, so the
// middleware answers /sw.js (the PWA service worker) with 500 — identical on main.
const IGNORED = /favicon|Failed to load resource|maps\.googleapis|Google Maps|places|Download the React DevTools|net::|not implemented on|claim_match_reveal|\[Fast Refresh\]|HMR|webpack|when fetching the script/i;

const nativeBridgeJs = readFileSync('node_modules/@capacitor/ios/Capacitor/Capacitor/assets/native-bridge.js', 'utf8');
const header = (name, methods) => ({ name, methods: [{ name: 'addListener' }, { name: 'removeListener' }, { name: 'removeAllListeners', rtype: 'promise' }, ...methods.map((m) => ({ name: m, rtype: 'promise' }))] });
const nativeInit = ({ haptics = true } = {}) => `
  window.__nativeCalls = [];
  window.webkit = { messageHandlers: { bridge: { postMessage(data) {
    window.__nativeCalls.push({ plugin: data.pluginId, method: data.methodName, options: data.options });
    if (data.methodName !== 'addListener') setTimeout(() => window.Capacitor.fromNative({ callbackId: data.callbackId, pluginId: data.pluginId, methodName: data.methodName, success: true, data: {} }), 0);
  } } } };
  window.Capacitor = { DEBUG: false, isLoggingEnabled: false, Plugins: {} };
  window.WEBVIEW_SERVER_URL = '';
  ${nativeBridgeJs}
  (function (w) { var a = (w.Capacitor = w.Capacitor || {}); var h = (a.PluginHeaders = a.PluginHeaders || []);
    h.push(${JSON.stringify(header('App', ['exitApp', 'getInfo', 'getLaunchUrl', 'getState', 'minimizeApp']))});
    ${haptics ? `h.push(${JSON.stringify(header('Haptics', ['impact', 'notification', 'vibrate', 'selectionStart', 'selectionChanged', 'selectionEnd']))});` : ''}
  })(window);
`;
async function open({ width = 390, height = 844, native = null, reducedMotion = 'no-preference', cookie = null, video = null, deviceScaleFactor = 2 } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor, isMobile: width < 700, hasTouch: width < 700, reducedMotion, ...(video ? { recordVideo: { dir: video, size: { width, height } } } : {}) });
  if (native) await ctx.addInitScript(nativeInit(native));
  if (cookie) await ctx.addCookies([cookie]);
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error' && !IGNORED.test(m.text())) consoleErrors.push(`${page.url()}: ${m.text().slice(0, 180)}`); });
  page.on('pageerror', (e) => { if (!IGNORED.test(e.message)) consoleErrors.push(`${page.url()}: ${e.message.slice(0, 180)}`); });
  return { ctx, page };
}
const haptics = (page) => page.evaluate(() => (window.__nativeCalls || []).filter((c) => c.plugin === 'Haptics').map((c) => `${c.method}${c.options?.style ? `:${c.options.style}` : ''}${c.options?.type ? `:${c.options.type}` : ''}`));
const shot = (page, name, fullPage = false) => page.screenshot({ path: join(outDir, `${name}.png`), fullPage });
const settle = async (page) => { await page.waitForLoadState('networkidle').catch(() => {}); await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(400); };
const card = (page, text) => page.getByRole('button', { name: new RegExp(`^${text}.*Choose importance`) }).first();
const level = (page, text) => page.locator('.hh-sheet').getByRole('button', { name: new RegExp(`^${text}`) }).first();

if (mode === 'preview') {
  const [after, before] = rest;
  const url = (base, query) => `${base}/dev/onboarding?flow=v3&${query}`;
  /* ------------------------------ before / after ------------------------------ */
  const screens = [
    ['kitchen', 'step=cat_kitchen&state=populated&search=home_buy'],
    ['bathroom', 'step=cat_bath&state=populated&search=home_buy'],
    ['exterior', 'step=cat_exterior&state=populated&search=home_buy'],
    ['garage', 'step=cat_garage&state=empty&search=home_buy'],
    ['layout', 'step=cat_layout&state=empty&search=home_buy'],
    ['neighborhood', 'step=cat_neighborhood&state=empty&search=home_buy'],
    ['rental-features', 'step=cat_rent_features&state=empty&search=home_rent'],
    ['apartment-unit', 'step=cat_apt_unit&state=empty&search=apartment_rent'],
  ];
  for (const [name, query] of screens) {
    for (const [label, base] of [['before', before], ['after', after]]) {
      const { ctx, page } = await open();
      await page.goto(url(base, query), { waitUntil: 'networkidle' });
      await settle(page);
      await shot(page, `${label}-${name}-390`);
      await ctx.close();
    }
  }

  /* ---------------------------- haptics (native) ---------------------------- */
  {
    const { ctx, page } = await open({ native: {} });
    await page.goto(url(after, 'step=cat_kitchen&state=empty&search=home_buy'), { waitUntil: 'networkidle' });
    await settle(page);
    await card(page, 'Walk-in Pantry').click();
    await page.locator('.flh-ob-pf-sheet').waitFor();
    await page.waitForTimeout(260);
    await shot(page, 'motion-01-sheet-open-390');
    await level(page, 'Must Have').click();
    check('choosing a level: the sheet starts sliding away (phones)', await page.locator('.hh-sheet-backdrop.is-closing').count() === 1);
    await page.waitForTimeout(60);
    check('…and the card is marked just-set for its one-shot spring', await page.locator('.flh-ob-pf-card.is-just-set').count() === 1);
    await shot(page, 'motion-02-choice-landing-390');
    await page.waitForTimeout(250);
    check('the sheet is gone within ~250ms (no wait before the next tap)', await page.locator('.flh-ob-pf-sheet').count() === 0);
    await page.waitForTimeout(250);
    check('the spring does not loop: the class clears', await page.locator('.flh-ob-pf-card.is-just-set').count() === 0);
    await shot(page, 'motion-03-choice-landed-390');
    await card(page, 'Walk-in Pantry').click();
    await level(page, 'Remove').click();
    await page.waitForTimeout(300);
    // Navigation and passive actions: no haptics.
    await page.locator('.flh-ob-pf-footer .flh-ob-cta').click(); await page.waitForTimeout(400);
    await page.locator('.flh-ob-pf-back').first().click(); await page.waitForTimeout(400);
    await page.locator('.flh-ob-pf-skip').click(); await page.waitForTimeout(400);
    await card(page, 'Fireplace').click();
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    check('haptics: one selection tick per importance chosen (incl. Not important); none for Next, Back, Skip or closing the sheet', JSON.stringify(await haptics(page)) === JSON.stringify(['selectionChanged', 'selectionChanged']), (await haptics(page)).join(', '));
    await ctx.close();
  }
  {
    const { ctx, page } = await open({ native: {} });
    await page.goto(url(after, 'step=cat_garage&state=empty&search=home_buy'), { waitUntil: 'networkidle' });
    await settle(page);
    await page.getByRole('button', { name: /^Important/ }).first().click();
    await page.waitForTimeout(200);
    await page.getByRole('button', { name: /^Important/ }).first().click();
    await page.getByRole('button', { name: /^Attached garage/i }).click();
    check('garage: a tick when the importance changes; none for re-tapping it or choosing the garage type', JSON.stringify(await haptics(page)) === JSON.stringify(['selectionChanged']), (await haptics(page)).join(', '));
    await ctx.close();
  }
  for (const [label, native] of [['an older installed build (no Haptics plugin)', { haptics: false }], ['mobile Safari / desktop (no native bridge)', null]]) {
    const { ctx, page } = await open({ native });
    const before = consoleErrors.length;
    await page.goto(url(after, 'step=cat_kitchen&state=empty&search=home_buy'), { waitUntil: 'networkidle' });
    await settle(page);
    await card(page, 'Walk-in Pantry').click();
    await level(page, 'Important').click();
    await page.waitForTimeout(400);
    const set = /Important/.test(await card(page, 'Walk-in Pantry').getAttribute('aria-label'));
    check(`${label}: choosing works normally, no haptic calls, no errors`, set && (await haptics(page)).length === 0 && consoleErrors.length === before);
    await ctx.close();
  }

  /* ------------------------------ reduced motion ------------------------------ */
  {
    const { ctx, page } = await open({ reducedMotion: 'reduce' });
    await page.goto(url(after, 'step=cat_kitchen&state=empty&search=home_buy'), { waitUntil: 'networkidle' });
    await settle(page);
    await card(page, 'Walk-in Pantry').click();
    await level(page, 'Must Have').click();
    check('Reduce Motion: the sheet closes at once (no slide)', await page.locator('.flh-ob-pf-sheet').count() === 0);
    const animation = await page.locator('.flh-ob-pf-card.is-selected').first().evaluate((el) => getComputedStyle(el).animationName);
    const pressed = await page.locator('.flh-ob-pf-card').first().evaluate((el) => { el.classList.add('qa-probe'); return getComputedStyle(el).transitionDuration; });
    check('Reduce Motion: no spring on the card; transitions effectively off', animation === 'none' && parseFloat(pressed) < 0.001, `${animation} / ${pressed}`);
    await ctx.close();
  }

  /* ------------------------------ keyboard & focus ------------------------------ */
  {
    const { ctx, page } = await open();
    await page.goto(url(after, 'step=cat_bath&state=empty&search=home_buy'), { waitUntil: 'networkidle' });
    await settle(page);
    await card(page, 'Double Vanity').focus();
    await page.keyboard.press('Enter');
    await page.locator('.flh-ob-pf-sheet').waitFor();
    check('keyboard: the sheet opens with focus inside it', await page.evaluate(() => !!document.activeElement?.closest('.hh-sheet')));
    for (let i = 0; i < 8 && !(await page.evaluate(() => /^Important/.test(document.activeElement?.innerText || ''))); i += 1) await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(350);
    const focused = await page.evaluate(() => document.activeElement?.getAttribute('aria-label') || '');
    check('keyboard: choosing returns focus to the card, whose name now says the level in words', /^Double Vanity: Important/.test(focused), focused);
    await ctx.close();
  }

  /* ------------------------ on-screen keyboard (Add your own) ------------------------ */
  {
    const { ctx, page } = await open({ height: 844 });
    await page.goto(url(after, 'step=cat_kitchen&state=empty&search=home_buy'), { waitUntil: 'networkidle' });
    await settle(page);
    const input = page.getByPlaceholder('Type a feature');
    await input.scrollIntoViewIfNeeded();
    await input.focus();
    // An iPhone keyboard leaves roughly half the screen.
    await page.setViewportSize({ width: 390, height: 420 });
    await page.waitForTimeout(300);
    await input.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await page.waitForTimeout(200);
    const visible = await input.evaluate((el) => { const r = el.getBoundingClientRect(); const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return r.top >= 0 && r.bottom <= innerHeight && (hit === el || el.contains(hit)); });
    await shot(page, 'keyboard-add-your-own-390x420');
    check('with the keyboard up, the Add-your-own field stays visible and is not covered by the sticky footer', visible);
    await input.fill('Pot filler');
    await page.keyboard.press('Enter');
    await page.locator('.flh-ob-pf-sheet').waitFor();
    check('adding your own feature opens the importance sheet (no level preselected)', !(await page.locator('.flh-ob-pf-level.is-current').count()));
    await ctx.close();
  }

  /* -------------------------- responsive / large text -------------------------- */
  for (const [width, height] of [[320, 568], [375, 667], [390, 844], [430, 932], [195, 422]]) {
    const { ctx, page } = await open({ width, height });
    let worst = 0;
    for (const query of ['step=cat_kitchen&state=populated&search=home_buy', 'step=cat_garage&state=empty&search=home_buy', 'step=cat_apt_unit&state=empty&search=apartment_rent', 'step=review&state=populated&search=home_buy']) {
      await page.goto(url(after, query), { waitUntil: 'networkidle' });
      await settle(page);
      worst = Math.max(worst, await page.evaluate(() => document.documentElement.scrollWidth - innerWidth));
    }
    await page.goto(url(after, 'step=cat_kitchen&state=empty&search=home_buy'), { waitUntil: 'networkidle' });
    await settle(page);
    await shot(page, `responsive-kitchen-${width}`);
    await card(page, 'Walk-in Pantry').click();
    await page.locator('.flh-ob-pf-sheet').waitFor();
    await page.waitForTimeout(260);
    const sheetOverflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    const small = await page.locator('.flh-ob-pf-level').evaluateAll((els) => els.filter((el) => el.getBoundingClientRect().height < 44).length);
    const clipped = await page.locator('.flh-ob-pf-level-title, .flh-ob-pf-card-title, .flh-page-title').evaluateAll((els) => els.filter((el) => el.scrollWidth > el.clientWidth + 1).length);
    await shot(page, `responsive-sheet-${width}`);
    check(`${width}px${width === 195 ? ' (200% text)' : ''}: no horizontal overflow, nothing clipped, sheet buttons ≥ 44px`, worst <= 0 && sheetOverflow <= 0 && small === 0 && clipped === 0, `overflow ${worst}/${sheetOverflow}, small ${small}, clipped ${clipped}`);
    await ctx.close();
  }

  /* ------------------------------ completion moment ------------------------------ */
  {
    const { ctx, page } = await open();
    await page.goto(url(after, 'step=cat_neighborhood&state=populated&search=home_buy'), { waitUntil: 'networkidle' });
    await settle(page);
    await page.locator('.flh-ob-pf-footer .flh-ob-cta').click();
    await page.locator('.flh-ob-review-actions').waitFor();
    await page.waitForTimeout(350);
    await shot(page, 'completion-review-390');
    const status = await page.locator('.flh-ob-pf-review-total').innerText();
    check('finishing the last category: a small completion moment on Review', await page.locator('.flh-ob-done-mark').count() === 1 && /^Nicely done\./.test(status), status);
    check('the moment is truthful (no claim of a found or verified home)', !/found|perfect|verified|guarantee/i.test(await page.locator('.flh-ob-pf-review').innerText()));
    await page.getByRole('button', { name: /Edit.*Kitchen|Kitchen.*Edit/ }).first().click().catch(async () => { await page.locator('.flh-ob-review-edit').nth(1).click(); });
    await page.locator('.flh-ob-pf-footer .flh-ob-cta').waitFor();
    await page.locator('.flh-ob-pf-footer .flh-ob-cta').click();
    await page.locator('.flh-ob-review-actions').waitFor();
    check('returning to Review after an edit: no repeat celebration', await page.locator('.flh-ob-done-mark').count() === 0);
    await ctx.close();
  }
  {
    // Opening Review directly (resume, or the desktop board) shows the usual mark.
    const { ctx, page } = await open();
    await page.goto(url(after, 'step=review&state=populated&search=home_buy'), { waitUntil: 'networkidle' });
    check('Review opened directly: no celebration', await page.locator('.flh-ob-done-mark').count() === 0);
    await ctx.close();
  }

  /* ------------------------- desktop board unchanged ------------------------- */
  for (const query of ['step=cat_kitchen&state=populated&search=home_buy', 'step=cat_kitchen&state=empty&search=home_rent']) {
    const grab = async (base) => {
      const { ctx, page } = await open({ width: 1440, height: 900, deviceScaleFactor: 1, reducedMotion: 'reduce' });
      await page.goto(url(base, query), { waitUntil: 'networkidle' });
      await settle(page);
      await page.waitForTimeout(800);
      const png = await page.screenshot({ fullPage: true });
      await ctx.close();
      return png;
    };
    const a = await grab(before);
    const b = await grab(after);
    const same = Buffer.compare(a, b) === 0;
    if (!same) { writeFileSync(join(outDir, `desktop-board-before-${query.replace(/[^a-z_]+/gi, '-')}.png`), a); writeFileSync(join(outDir, `desktop-board-after-${query.replace(/[^a-z_]+/gi, '-')}.png`), b); }
    check(`desktop Feature Library / board (1440) is pixel-identical to main (${query.split('&').pop()})`, same);
  }

  /* --------------------------------- motion demo --------------------------------- */
  {
    const dir = join(outDir, 'video-tmp');
    const { ctx, page } = await open({ video: dir, deviceScaleFactor: 1 });
    await page.goto(url(after, 'step=cat_kitchen&state=empty&search=home_buy'), { waitUntil: 'networkidle' });
    await settle(page);
    await page.waitForTimeout(700);
    for (const [feature, choice] of [['Walk-in Pantry', 'Must Have'], ['Countertop Seating', 'Important'], ['Stainless Steel Appliances', 'Nice to Have']]) {
      await card(page, feature).click();
      await page.waitForTimeout(700);
      await level(page, choice).click();
      await page.waitForTimeout(900);
    }
    await page.locator('.flh-ob-pf-footer .flh-ob-cta').click();
    await page.waitForTimeout(1200);
    await ctx.close();
    const file = readdirSync(dir).find((name) => name.endsWith('.webm'));
    if (file) renameSync(join(dir, file), join(outDir, 'motion-demo-kitchen-390.webm'));
    spawnSync('rm', ['-rf', dir]);
    check('motion demo recorded', Boolean(file));
  }
}

if (mode === 'stack') {
  const [infoPath, on] = rest;
  const info = JSON.parse(readFileSync(infoPath, 'utf8').split('\n')[0]);
  const pg = ['-X', '-q', '-A', '-t', '-h', process.env.FLH_TEST_PGHOST, '-p', process.env.FLH_TEST_PGPORT || '5432', '-U', 'postgres', '-d', info.database];
  const q = (sql) => JSON.parse(spawnSync('psql', [...pg, '-c', `select coalesce(json_agg(t), '[]'::json) from (${sql}) t`], { encoding: 'utf8' }).stdout.trim());
  const exec = (sql) => { const r = spawnSync('psql', [...pg, '-v', 'ON_ERROR_STOP=1', '-c', sql], { encoding: 'utf8' }); if (r.status !== 0) throw new Error(r.stderr); };
  const lit = (v) => `'${String(v).replace(/'/g, "''")}'`;
  const b64url = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const newUser = (label) => {
    const id = randomUUID(); const email = `${label}.${id.slice(0, 6)}@example.com`;
    exec(`insert into auth.users (id, email, raw_user_meta_data) values (${lit(id)}, ${lit(email)}, '{"first_name":"QA"}'::jsonb)`);
    return { id, email };
  };
  const cookieFor = ({ id, email }) => {
    const now = Math.floor(Date.now() / 1000);
    const [row] = q(`select raw_user_meta_data as meta, created_at from auth.users where id = ${lit(id)}`);
    const session = {
      access_token: `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ sub: id, email, role: 'authenticated', aud: 'authenticated', iat: now, exp: now + 604800 })}.qa`,
      refresh_token: `refresh-${id}`, token_type: 'bearer', expires_in: 604800, expires_at: now + 604800,
      user: { id, aud: 'authenticated', role: 'authenticated', email, user_metadata: row.meta || {}, app_metadata: { provider: 'email' }, created_at: row.created_at },
    };
    return { name: 'sb-localhost-auth-token', value: `base64-${Buffer.from(JSON.stringify(session)).toString('base64url')}`, domain: 'localhost', path: '/' };
  };

  // Onboarding, native: one tick per importance; one light tap only when setup is saved.
  {
    const user = newUser('m3native');
    const { ctx, page } = await open({ native: {}, cookie: cookieFor(user) });
    await page.goto(`${on}/onboarding`, { waitUntil: 'networkidle' });
    await page.locator('input[type="radio"][value="home_buy"]').check({ force: true });
    await page.locator('.flh-ob-pf-footer .flh-ob-cta').click();
    await page.getByRole('button', { name: /Let’s personalize your search/ }).click();
    await page.locator('.flh-ob-basics').waitFor();
    await page.locator('.flh-ob-pf-footer .flh-ob-cta').click();
    await page.locator('.flh-ob-pf-layout').waitFor();
    await page.locator('.flh-ob-pf-footer .flh-ob-cta').click();
    await page.locator('.flh-ob-pf-kitchen').waitFor();
    await card(page, 'Walk-in Pantry').click();
    await level(page, 'Must Have').click();
    await page.waitForTimeout(300);
    for (let i = 0; i < 10 && !(await page.locator('.flh-ob-review-actions').isVisible().catch(() => false)); i += 1) {
      const skip = page.locator('.flh-ob-pf-skip');
      if (await skip.isVisible().catch(() => false)) await skip.click(); else await page.locator('.flh-ob-pf-footer .flh-ob-cta').click();
      await page.waitForTimeout(350);
    }
    check('real flow: the completion moment appears on Review', await page.locator('.flh-ob-done-mark').count() === 1);
    await shot(page, 'stack-completion-review-390');
    const beforeFinish = await haptics(page);
    await page.locator('.flh-ob-review-actions .flh-ob-cta').click();
    await page.waitForURL('**/homes**', { timeout: 20000 });
    const after = await haptics(page).catch(() => null);
    check('onboarding (native): a tick for the importance; nothing for Continue/Skip; one light tap once setup is saved', JSON.stringify(beforeFinish) === JSON.stringify(['selectionChanged']) && (after === null || JSON.stringify(after) === JSON.stringify(['selectionChanged', 'impact:LIGHT']) || JSON.stringify(after) === '[]'), `${beforeFinish.join(', ')} → ${after?.join(', ')}`);
    check('…and the data is saved exactly as before (Must Have; nothing else)', q(`select priorities->'features'->'tiers' as tiers from public.search_member_priorities where user_id = ${lit(user.id)}`)[0]?.tiers?.['Walk-in Pantry'] === 'must');
    await ctx.close();
  }
  // Explore, native: Done after an edit taps once; Done after only looking is silent.
  {
    const user = newUser('m3explore');
    exec(`update public.profiles set onboarding_complete = true where id = ${lit(user.id)}`);
    for (const edit of [true, false]) {
      const { ctx, page } = await open({ native: {}, cookie: cookieFor(user) });
      // The confirmation fires just before navigating away; record it in sessionStorage so it survives.
      await page.addInitScript(() => { const push = Array.prototype.push; window.__keep = () => sessionStorage.setItem('qa-h', JSON.stringify((window.__nativeCalls || []).filter((c) => c.plugin === 'Haptics').map((c) => c.method + (c.options?.style ? `:${c.options.style}` : '')))); });
      await page.goto(`${on}/search/explore?category=bath`, { waitUntil: 'networkidle' });
      await page.locator('.flh-ob-pf-bath').waitFor();
      if (edit) { await card(page, 'Double Vanity').click(); await level(page, 'Important').click(); await page.waitForTimeout(800); }
      await page.locator('.flh-ob-pf-footer .flh-ob-cta').click(); // Next: no haptic
      await page.waitForTimeout(400);
      await page.evaluate(() => { const done = [...document.querySelectorAll('.flh-explore-done')][0]; done.addEventListener('click', () => setTimeout(() => window.__keep(), 200), { once: true }); });
      await page.locator('.flh-explore-done').click();
      await page.waitForURL('**/search', { timeout: 15000 });
      const calls = JSON.parse(await page.evaluate(() => sessionStorage.getItem('qa-h')) || 'null');
      const expected = edit ? ['selectionChanged', 'impact:LIGHT'] : [];
      check(`Explore (native), ${edit ? 'after an edit' : 'just looking'}: ${edit ? 'one tick, then one light tap on Done' : 'no haptics at all'}`, JSON.stringify(calls) === JSON.stringify(expected), JSON.stringify(calls));
      await ctx.close();
    }
  }
  // Explore progress + overflow on the real stack.
  {
    const user = newUser('m3progress');
    exec(`update public.profiles set onboarding_complete = true where id = ${lit(user.id)}`);
    for (const width of [320, 390]) {
      const { ctx, page } = await open({ width, height: width === 320 ? 568 : 844, cookie: cookieFor(user) });
      await page.goto(`${on}/search/explore?category=kitchen`, { waitUntil: 'networkidle' });
      await page.locator('.flh-explore-progress').waitFor();
      const done = await page.locator('.flh-explore-progress span.is-done').count();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      await shot(page, `stack-explore-kitchen-${width}`);
      check(`Explore ${width}px: slim progress shows Kitchen as 2 of 7; no overflow`, done === 2 && overflow <= 0, `${done} filled, overflow ${overflow}`);
      await ctx.close();
    }
  }
}

await browser.close();
check('no unexpected console errors', consoleErrors.length === 0, consoleErrors.slice(0, 4).join(' | '));
writeFileSync(join(outDir, `results-${mode}.json`), JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
