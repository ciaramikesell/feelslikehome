#!/usr/bin/env node
// Browser QA for Milestone 2 (docs/onboarding-paths-explore-priorities.md):
// two onboarding paths, quick start to Add Home, Explore My Priorities, data
// integrity in the database after every flow, flag-off safety. DEVELOPMENT ONLY.
//
//   1. FLH_TEST_PGHOST=… FLH_TEST_PGPORT=… node scripts/qa/supabase-standin.mjs 54321 > standin.json
//   2. Build once with NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=qa, then
//      FLH_ONBOARDING_V3=on npx next start -p 3200   (flag on)
//      npx next start -p 3300                        (flag off)
//      optional: main built the same way, flag off on 3400 and flag on on 3401 (before/after + flag-off identity)
//   3. FLH_TEST_PGHOST=… FLH_TEST_PGPORT=… node scripts/qa/onboarding-paths-qa.mjs standin.json <outDir>
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';

const [infoPath, outArg] = process.argv.slice(2);
if (!infoPath || !outArg) throw new Error('Usage: onboarding-paths-qa.mjs <standin.json> <outDir>');
const ON = process.env.QA_ON || 'http://localhost:3200';
const OFF = process.env.QA_OFF || 'http://localhost:3300';
const MAIN_OFF = process.env.QA_MAIN_OFF || 'http://localhost:3400';
const MAIN_ON = process.env.QA_MAIN_ON || 'http://localhost:3401';
const info = JSON.parse(readFileSync(infoPath, 'utf8').split('\n')[0]);
const outDir = resolve(outArg);
mkdirSync(outDir, { recursive: true });

const pg = ['-X', '-q', '-A', '-t', '-h', process.env.FLH_TEST_PGHOST, '-p', process.env.FLH_TEST_PGPORT || '5432', '-U', 'postgres', '-d', info.database];
const q = (sql) => {
  const result = spawnSync('psql', [...pg, '-c', `select coalesce(json_agg(t), '[]'::json) from (${sql}) t`], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr);
  return JSON.parse(result.stdout.trim());
};
const exec = (sql) => { const r = spawnSync('psql', [...pg, '-v', 'ON_ERROR_STOP=1', '-c', sql], { encoding: 'utf8' }); if (r.status !== 0) throw new Error(r.stderr); };
const lit = (v) => `'${String(v).replace(/'/g, "''")}'`;

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: Boolean(ok), detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };

/* ------------------------------- people ------------------------------- */
const b64url = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
function newUser(label) {
  const id = randomUUID();
  const email = `${label}.${id.slice(0, 6)}@example.com`;
  exec(`insert into auth.users (id, email, raw_user_meta_data) values (${lit(id)}, ${lit(email)}, ${lit(JSON.stringify({ first_name: label, last_name: 'QA' }))}::jsonb)`);
  return { id, email };
}
function session({ id, email }) {
  const now = Math.floor(Date.now() / 1000);
  const [row] = q(`select id, email, raw_user_meta_data as meta, created_at from auth.users where id = ${lit(id)}`);
  return {
    access_token: `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ sub: id, email, role: 'authenticated', aud: 'authenticated', iat: now, exp: now + 7 * 24 * 3600 })}.qa`,
    refresh_token: `refresh-${id}`, token_type: 'bearer', expires_in: 7 * 24 * 3600, expires_at: now + 7 * 24 * 3600,
    user: { id, aud: 'authenticated', role: 'authenticated', email, user_metadata: row.meta || {}, app_metadata: { provider: 'email' }, created_at: row.created_at },
  };
}
const profile = (id) => q(`select onboarding_complete, onboarding_version, onboarding_state, active_search_id from public.profiles where id = ${lit(id)}`)[0];
const ownSearch = (id) => q(`select id from public.searches where user_id = ${lit(id)}`).map((r) => r.id);
const doc = (searchId, userId) => q(`select priorities from public.search_member_priorities where search_id = ${lit(searchId)} and user_id = ${lit(userId)}`)[0]?.priorities || null;
const ITEM = ['location', 'features', 'exterior', 'homeFeel'];
const dontcares = (p) => ITEM.flatMap((k) => Object.entries(p?.[k]?.tiers || {}).filter(([, t]) => t === 'dontcare').map(([l]) => `${k}:${l}`));
const levelOf = (p, cat, label) => p?.[cat]?.tiers?.[label] ?? null;

/* ------------------------------- browser ------------------------------- */
const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {});
const consoleErrors = [];
const IGNORED = /favicon|Failed to load resource|maps\.googleapis|Google Maps|places|Download the React DevTools|net::|claim_match_reveal|import-listing|rentcast/i;
async function pageFor(user, { width = 390, height = 844, reducedMotion = 'no-preference' } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, isMobile: width < 700, hasTouch: width < 700, reducedMotion });
  if (user) await ctx.addCookies([{ name: 'sb-localhost-auth-token', value: `base64-${Buffer.from(JSON.stringify(session(user))).toString('base64url')}`, domain: 'localhost', path: '/' }]);
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error' && !IGNORED.test(m.text())) consoleErrors.push(`${page.url()}: ${m.text().slice(0, 200)}`); });
  page.on('pageerror', (e) => consoleErrors.push(`${page.url()}: ${e.message.slice(0, 200)}`));
  return { ctx, page };
}
const shot = (page, name, fullPage = false) => page.screenshot({ path: join(outDir, `${name}.png`), fullPage });
const settle = (page) => page.waitForLoadState('networkidle').catch(() => {});
const tapContinue = (page) => page.locator('.flh-ob-pf-footer .flh-ob-cta').click();
async function chooseType(page, type = 'home_buy') {
  await page.locator(`input[type="radio"][value="${type}"]`).check({ force: true });
  await tapContinue(page);
  await page.waitForSelector('.flh-ob-setup-path');
}
async function chooseLevel(page, featureText, levelText) {
  await page.getByRole('button', { name: new RegExp(`^${featureText}.*Choose importance`) }).first().click();
  await page.getByRole('button', { name: new RegExp(`^${levelText}`) }).first().click();
  await page.waitForTimeout(250);
}

/* ============================ 0. before (main) ============================ */
{
  const u = newUser('before');
  const { ctx, page } = await pageFor(u);
  await page.goto(`${MAIN_ON}/onboarding`, { waitUntil: 'networkidle' });
  await shot(page, 'before-01-search-type-390');
  await page.locator('input[type="radio"][value="home_buy"]').check({ force: true });
  await tapContinue(page); await settle(page);
  await shot(page, 'before-02-next-screen-is-basics-390');
  await ctx.close();
}

/* ======================= 1. Personalize path (flag on) ======================= */
const personal = newUser('personal');
{
  const { ctx, page } = await pageFor(personal);
  await page.goto(`${ON}/onboarding`, { waitUntil: 'networkidle' });
  await shot(page, 'after-01-search-type-390');
  await chooseType(page);
  await shot(page, 'after-02-setup-path-390');
  const cards = await page.locator('.flh-ob-path-card').evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height));
  check('setup path: two large tappable cards (≥ 44px)', cards.length === 2 && cards.every((h) => h >= 44), cards.map(Math.round).join(', '));
  await page.getByRole('button', { name: /Let’s personalize your search/ }).click();
  await page.waitForSelector('.flh-ob-basics');
  check('personalize → Basics next (no extra introductory page)', await page.locator('.flh-ob-basics').isVisible());
  await tapContinue(page); await page.waitForSelector('.flh-ob-pf-layout');
  check('personalize → the first category (Layout & Living)', await page.locator('.flh-ob-pf-layout').isVisible());
  await tapContinue(page); await page.waitForSelector('.flh-ob-pf-kitchen');
  await chooseLevel(page, 'Walk-in Pantry', 'Must Have');
  await shot(page, 'after-03-personalize-kitchen-390');
  for (let i = 0; i < 10 && !(await page.locator('.flh-ob-review-actions').isVisible().catch(() => false)); i += 1) {
    const skip = page.locator('.flh-ob-pf-skip');
    if (await skip.isVisible().catch(() => false)) await skip.click(); else await tapContinue(page);
    await page.waitForTimeout(300);
  }
  check('personalize → Review at the end', await page.locator('.flh-ob-review-actions').isVisible());
  await shot(page, 'after-04-personalize-review-390', true);
  await page.locator('.flh-ob-review-actions .flh-ob-cta').click();
  await page.waitForURL('**/homes**', { timeout: 20000 });
  const prof = profile(personal.id);
  const search = ownSearch(personal.id)[0];
  const stored = doc(search, personal.id);
  check('personalize: onboarding complete, version 4, path recorded', prof.onboarding_complete && prof.onboarding_version === 4 && prof.onboarding_state.answers.setupPath === 'personalize', JSON.stringify(prof.onboarding_state.answers));
  check('personalize: Walk-in Pantry Must Have saved; skipped categories wrote nothing', levelOf(stored, 'features', 'Walk-in Pantry') === 'must' && dontcares(stored).length === 0, `dontcare: ${dontcares(stored).join(', ') || 'none'}`);
  check('personalize: still exactly one search', ownSearch(personal.id).length === 1);
  await ctx.close();
}

/* ======================== 2. Quick start → Add Home ======================== */
const quick = newUser('quick');
{
  const { ctx, page } = await pageFor(quick);
  await page.goto(`${ON}/onboarding`, { waitUntil: 'networkidle' });
  await chooseType(page);
  await page.getByRole('button', { name: /I’ll figure it out as I go/ }).click();
  await page.waitForSelector('.flh-ob-basics');
  await shot(page, 'after-05-quick-basics-390');
  check('quick start: Basics says optional and finishes with "Start saving homes"', /All optional/.test(await page.locator('.flh-lead').innerText()) && /Start saving homes/.test(await page.locator('.flh-ob-pf-footer .flh-ob-cta').innerText()));
  await page.locator('.flh-ob-pf-skip').click();
  await page.waitForURL('**/homes**', { timeout: 20000 });
  await page.waitForSelector('.hh-add-home-modal', { timeout: 20000 });
  check('quick start → lands directly in Add Home', new URL(page.url()).pathname === '/homes' && await page.locator('.hh-add-home-modal').isVisible(), page.url());
  await shot(page, 'after-06-quick-lands-in-add-home-390');
  const prof = profile(quick.id);
  const stored = doc(ownSearch(quick.id)[0], quick.id);
  check('quick start: onboarding complete (version 4, as_i_go)', prof.onboarding_complete && prof.onboarding_version === 4 && prof.onboarding_state.answers.setupPath === 'as_i_go');
  check('quick start: no dontcare written, no features, one search', dontcares(stored).length === 0 && ITEM.every((k) => !(stored?.[k]?.customItems || []).length) && ownSearch(quick.id).length === 1, `dontcare: ${dontcares(stored).join(', ') || 'none'}`);
  await page.keyboard.press('Escape');
  await page.goto(`${ON}/homes`, { waitUntil: 'networkidle' });
  await ctx.close();
}

/* ============== 3. Quick start keeps a pending shared-listing link ============== */
{
  const linked = newUser('linked');
  const { ctx, page } = await pageFor(linked);
  const listing = 'https://www.zillow.com/homedetails/41-Maple-St-Troy-MI-48084/123_zpid/';
  await page.goto(`${ON}/homes?url=${encodeURIComponent(listing)}`, { waitUntil: 'networkidle' });
  check('signed-up but not onboarded: a shared listing goes to onboarding with the destination kept', new URL(page.url()).pathname === '/onboarding' && (new URL(page.url()).searchParams.get('redirect') || '').includes('/homes?url='), page.url().slice(0, 120));
  await chooseType(page);
  await page.getByRole('button', { name: /I’ll figure it out as I go/ }).click();
  await page.waitForSelector('.flh-ob-basics');
  await tapContinue(page);
  await page.waitForURL('**/homes**', { timeout: 20000 });
  await page.waitForFunction(() => [...document.querySelectorAll('.hh-add-home-modal input')].some((i) => /41 Maple/.test(i.value) || /zillow/.test(i.value)), null, { timeout: 20000 }).catch(() => {});
  const values = await page.locator('.hh-add-home-modal input').evaluateAll((els) => els.map((e) => e.value).filter(Boolean));
  check('quick start finishes onto the shared listing, not a blank Add Home', values.some((v) => /41 Maple|zillow/.test(v)), values.join(' | ').slice(0, 120));
  await ctx.close();
}

/* =================== 4. Explore My Priorities (quick-start user) =================== */
{
  const { ctx, page } = await pageFor(quick);
  await page.goto(`${ON}/search`, { waitUntil: 'networkidle' });
  const card = page.getByRole('link', { name: /Explore My Priorities/ });
  check('My Search shows Explore My Priorities (flag on); Quick Edit still there', await card.isVisible() && await page.locator('.flh-priorities-summary').isVisible());
  await shot(page, 'after-07-my-search-with-explore-390', true);
  const profBefore = profile(quick.id);
  await card.click();
  await page.waitForSelector('.flh-explore-index');
  await shot(page, 'after-08-explore-index-390', true);
  check('Explore index: "What would you like to explore?" with this search’s categories', /What would you like/.test(await page.locator('h1').innerText()) && (await page.locator('.flh-explore-row').count()) === 7);
  await page.getByRole('button', { name: /^Kitchen/ }).click();
  await page.waitForSelector('.flh-ob-pf-kitchen');
  check('Explore page header: Explore · n of N · Kitchen', /Explore · 2 of 7 · Kitchen/i.test(await page.locator('.flh-explore .flh-eyebrow').first().innerText()));
  await chooseLevel(page, 'Walk-in Pantry', 'Important');
  await page.waitForSelector('.flh-save-status:has-text("Saved")', { timeout: 10000 }).catch(() => {});
  check('a clear "Saved" confirmation after an edit', /Saved/.test(await page.locator('.flh-explore-bar-status').innerText()));
  await shot(page, 'after-09-explore-kitchen-saved-390');
  // Skip Living: changes nothing.
  await page.locator('.flh-ob-pf-footer .flh-ob-cta').click(); // Next → Living
  await page.waitForSelector('.flh-ob-pf-living');
  const beforeSkip = doc(ownSearch(quick.id)[0], quick.id);
  await page.locator('.flh-ob-pf-skip').click();
  await page.waitForSelector('.flh-ob-pf-bath');
  await page.waitForTimeout(600);
  const afterSkip = doc(ownSearch(quick.id)[0], quick.id);
  const strip = (p) => { const { explore, ...rest } = p || {}; return rest; };
  check('Skip changes no answer (only the resume point moves)', JSON.stringify(strip(beforeSkip)) === JSON.stringify(strip(afterSkip)) && afterSkip.explore.lastStep === 'cat_bath');
  await page.getByRole('button', { name: /^Done$/ }).click();
  await page.waitForURL('**/search', { timeout: 15000 });
  const stored = doc(ownSearch(quick.id)[0], quick.id);
  check('Done: back on My Search with the edit persisted', levelOf(stored, 'features', 'Walk-in Pantry') === 'important');
  check('re-entry never changes onboarding_complete / _version / _state', JSON.stringify(profile(quick.id)) === JSON.stringify(profBefore));
  check('still no dontcare anywhere', dontcares(stored).length === 0);
  await page.goto(`${ON}/search`, { waitUntil: 'networkidle' });
  check('My Search offers to pick up where they stopped', /Pick up at\s*Bathroom/i.test(await page.locator('.flh-explore-entry').innerText()), (await page.locator('.flh-explore-entry').innerText()).replace(/\s+/g, ' '));
  await page.goto(`${ON}/search/explore`, { waitUntil: 'networkidle' });
  check('Explore index: "Pick up at Bathroom" and Kitchen shows 1 chosen', /Pick up at Bath/.test(await page.locator('.flh-explore-index .flh-ob-cta').innerText()) && /1 chosen/.test(await page.getByRole('button', { name: /^Kitchen/ }).innerText()));
  await ctx.close();
}

/* ========== 5. Returning (personalized) user jumps to Kitchen, edits, exits ========== */
{
  const { ctx, page } = await pageFor(personal);
  await page.goto(`${ON}/search/explore?category=kitchen`, { waitUntil: 'networkidle' });
  const islandLabel = await page.getByRole('button', { name: /^Walk-in Pantry/ }).getAttribute('aria-label');
  check('onboarding answers are prefilled on re-entry (Walk-in Pantry: Must Have)', /Must Have/.test(islandLabel), islandLabel);
  await shot(page, 'after-10-explore-prefilled-kitchen-390');
  await chooseLevel(page, 'Walk-in Pantry', 'Nice to Have');
  await page.getByRole('button', { name: /^Done$/ }).click();
  await page.waitForURL('**/search', { timeout: 15000 });
  check('jump to Kitchen → edit → exit persists', levelOf(doc(ownSearch(personal.id)[0], personal.id), 'features', 'Walk-in Pantry') === 'nice');
  // Revisit after "finishing" every category.
  await page.goto(`${ON}/search/explore?category=neighborhood`, { waitUntil: 'networkidle' });
  await page.locator('.flh-ob-pf-footer .flh-ob-cta').click();
  await page.waitForSelector('.flh-explore-notice');
  check('after the last category: back to the index with a calm "all done" note; still revisitable', /every category/.test(await page.locator('.flh-explore-notice').innerText()) && await page.locator('.flh-explore-row').first().isVisible());
  // Keyboard: focus lands on the page heading when a category opens.
  await page.getByRole('button', { name: /^Bathroom/ }).focus();
  await page.keyboard.press('Enter');
  await page.waitForSelector('.flh-ob-pf-bath');
  check('keyboard: opening a category moves focus to its heading', await page.evaluate(() => document.activeElement?.tagName === 'H1'));
  await ctx.close();
}

/* ================= 6. Co-buyer isolation + search switching ================= */
{
  const { owner, coBuyer } = info.users;
  const ownerBefore = doc(info.search, owner.id);
  const { ctx, page } = await pageFor(coBuyer);
  exec(`update public.profiles set active_search_id = ${lit(info.search)} where id = ${lit(coBuyer.id)}`);
  await page.goto(`${ON}/search/explore?category=kitchen`, { waitUntil: 'networkidle' });
  await chooseLevel(page, 'Walk-in Pantry', 'Must Have');
  await page.getByRole('button', { name: /^Done$/ }).click();
  await page.waitForURL('**/search', { timeout: 15000 });
  check('co-buyer edit lands in their own row', levelOf(doc(info.search, coBuyer.id), 'features', 'Walk-in Pantry') === 'must');
  check('owner’s row on the same search is untouched', JSON.stringify(doc(info.search, owner.id)) === JSON.stringify(ownerBefore));
  // Their own search: a different document and a different resume point.
  const ownId = ownSearch(coBuyer.id)[0];
  exec(`update public.profiles set active_search_id = ${lit(ownId)} where id = ${lit(coBuyer.id)}`);
  await page.goto(`${ON}/search/explore`, { waitUntil: 'networkidle' });
  const ownCta = await page.locator('.flh-explore-index .flh-ob-cta').innerText();
  check('switching searches loads that search’s own priorities and resume point', !/Pick up at Kitchen/.test(ownCta) && !/chosen/.test(await page.getByRole('button', { name: /^Kitchen/ }).innerText()), ownCta);
  exec(`update public.profiles set active_search_id = ${lit(info.search)} where id = ${lit(coBuyer.id)}`);
  await page.goto(`${ON}/search/explore`, { waitUntil: 'networkidle' });
  check('…and back on the shared search, its own resume point', /Pick up at Kitchen/.test(await page.locator('.flh-explore-index .flh-ob-cta').innerText()));
  await ctx.close();
}

/* ======================= 7. Entry points stay intact ======================= */
{
  const { ctx, page } = await pageFor(null);
  exec(`insert into public.search_invitations (search_id, invited_by, invited_email, relationship_type) values (${lit(info.search)}, ${lit(info.users.owner.id)}, 'm2.invitee@example.com', 'co_buyer')`);
  const token = q(`select token from public.search_invitations where invited_email = 'm2.invitee@example.com' order by created_at desc limit 1`)[0]?.token;
  await page.goto(`${ON}/invite/${token}`, { waitUntil: 'networkidle' });
  const url = new URL(page.url());
  check('invitation link (signed out) still goes to sign-in with the invitation kept', url.pathname === '/auth/sign-in' && url.searchParams.get('redirect') === `/invite/${token}`);
  await ctx.close();
  const realtor = await pageFor(info.users.realtor);
  await realtor.page.goto(`${ON}/`, { waitUntil: 'networkidle' });
  check('Realtor entry unchanged (never sent through buyer onboarding)', !new URL(realtor.page.url()).pathname.startsWith('/onboarding'), new URL(realtor.page.url()).pathname);
  await realtor.ctx.close();
}

/* ============================ 8. Flag off ============================ */
{
  const fresh = newUser('flagoff');
  const { ctx, page } = await pageFor(fresh);
  await page.goto(`${OFF}/onboarding`, { waitUntil: 'networkidle' });
  check('flag off: new users get the live flow (no setup path, no V3 screens)', !(await page.locator('.flh-ob-setup-path, .flh-ob-pf-step').count()));
  await ctx.close();
  const { ctx: c2, page: p2 } = await pageFor(info.users.owner);
  await p2.goto(`${OFF}/search/explore`, { waitUntil: 'networkidle' });
  // notFound() inside the (app) segment streams Next's not-found page (its loading.js has already sent 200).
  check('flag off: /search/explore shows the not-found page and no Explore UI', /This page could not be found/.test(await p2.locator('body').innerText()) && !(await p2.locator('.flh-explore').count()));
  await p2.goto(`${OFF}/search`, { waitUntil: 'networkidle' });
  check('flag off: no Explore card on My Search', !(await p2.locator('.flh-explore-entry').count()));
  await c2.close();
}

/* ============== 9. Flag off is pixel-identical to main (signed in) ============== */
for (const [path, width, height] of [['/search', 390, 844], ['/search', 1280, 900], ['/search/priorities', 390, 844], ['/search/priorities', 1280, 900], ['/homes', 1280, 900]]) {
  const grab = async (base) => {
    const { ctx, page } = await pageFor(info.users.owner, { width, height, reducedMotion: 'reduce' });
    await page.goto(`${base}${path}`, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(600);
    const png = await page.screenshot({ fullPage: true });
    await ctx.close();
    return png;
  };
  const a = await grab(MAIN_OFF);
  const b = await grab(OFF);
  const same = Buffer.compare(a, b) === 0;
  if (!same) { writeFileSync(join(outDir, `flagoff-diff-main${path.replace(/\//g, '_')}-${width}.png`), a); writeFileSync(join(outDir, `flagoff-diff-branch${path.replace(/\//g, '_')}-${width}.png`), b); }
  check(`flag off: ${path} at ${width}px is pixel-identical to main`, same);
}

/* ====================== 10. Responsive + accessibility ====================== */
for (const width of [320, 375, 390, 430]) {
  const u = newUser(`w${width}`);
  const { ctx, page } = await pageFor(u, { width, height: width === 320 ? 568 : 844 });
  await page.goto(`${ON}/onboarding`, { waitUntil: 'networkidle' });
  await chooseType(page);
  await shot(page, `setup-path-${width}`);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  await page.getByRole('button', { name: /I’ll figure it out as I go/ }).click();
  await page.waitForSelector('.flh-ob-basics');
  await page.locator('.flh-ob-pf-skip').click();
  await page.waitForURL('**/homes**', { timeout: 20000 });
  await page.keyboard.press('Escape');
  await page.goto(`${ON}/search/explore`, { waitUntil: 'networkidle' });
  await shot(page, `explore-index-${width}`);
  const overflowIndex = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  await page.getByRole('button', { name: /^Kitchen/ }).click();
  await page.waitForSelector('.flh-ob-pf-kitchen');
  await shot(page, `explore-kitchen-${width}`);
  const overflowCat = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  const small = await page.locator('.flh-explore-bar button, .flh-ob-pf-footer button').evaluateAll((els) => els.map((el) => el.getBoundingClientRect()).filter((r) => r.height < 44).length);
  check(`${width}px: no horizontal overflow; bar and footer controls ≥ 44px`, overflow <= 0 && overflowIndex <= 0 && overflowCat <= 0 && small === 0, `overflow ${overflow}/${overflowIndex}/${overflowCat}, small ${small}`);
  await ctx.close();
}
{
  // Large text: a 390pt phone at 200% zoom is ~195 CSS px wide.
  const u = newUser('zoom');
  exec(`update public.profiles set onboarding_complete = true where id = ${lit(u.id)}`);
  const { ctx, page } = await pageFor(u, { width: 195, height: 422 });
  await page.goto(`${ON}/search/explore`, { waitUntil: 'networkidle' });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  await shot(page, 'explore-index-large-text-200pct');
  check('large text (200%): Explore index fits without sideways scrolling', overflow <= 0, `${overflow}px`);
  await ctx.close();
}
{
  const { ctx, page } = await pageFor(personal, { width: 1280, height: 900 });
  await page.goto(`${ON}/search`, { waitUntil: 'networkidle' });
  await shot(page, 'desktop-my-search-with-explore-1280', true);
  await page.goto(`${ON}/search/explore?category=kitchen`, { waitUntil: 'networkidle' });
  await shot(page, 'desktop-explore-kitchen-1280');
  await ctx.close();
}
{
  const { ctx, page } = await pageFor(personal, { reducedMotion: 'reduce' });
  await page.goto(`${ON}/search/explore?category=kitchen`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /^Walk-in Pantry/ }).click();
  const anim = await page.locator('.hh-sheet').first().evaluate((el) => getComputedStyle(el).animationDuration).catch(() => '0s');
  check('Reduce Motion: the importance sheet does not slide', parseFloat(anim) < 0.01, anim);
  await ctx.close();
}

await browser.close();
check('no unexpected console errors', consoleErrors.length === 0, consoleErrors.slice(0, 4).join(' | '));
writeFileSync(join(outDir, 'results.json'), JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
