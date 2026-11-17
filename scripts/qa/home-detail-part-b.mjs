// Development-only Part B QA. Requires the repository's local Supabase stand-in.
// FLH_TEST_PGHOST=... FLH_TEST_PGPORT=... PLAYWRIGHT_CHROMIUM_EXECUTABLE=... \
// node scripts/qa/home-detail-part-b.mjs <standin.json> <outputDir> [baseUrl]
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { normalizePriorities } from '../../src/lib/constants.js';
import { applySearchChoice } from '../../src/lib/onboarding.js';
import { addCriterion } from '../../src/lib/searchProfile.js';
const [infoPath, out, base = 'http://localhost:3110'] = process.argv.slice(2);
if (!infoPath || !out) throw Error('Usage: home-detail-part-b.mjs <standin.json> <outputDir> [baseUrl]');
const info = JSON.parse(readFileSync(infoPath, 'utf8').split('\n')[0]);
assert.match(info.database, /^flh_test_/, 'use a throwaway stand-in database');
mkdirSync(out, { recursive: true });
const lit = value => `'${String(value).replaceAll("'", "''")}'`;
function sql(statement) {
  const r = spawnSync('psql', ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-h', process.env.FLH_TEST_PGHOST, '-p', process.env.FLH_TEST_PGPORT || '5432', '-U', process.env.FLH_TEST_PGUSER || 'postgres', '-d', info.database, '-c', statement], { encoding: 'utf8' });
  if (r.status) throw Error(r.stderr); return r.stdout.trim();
}
let p = applySearchChoice(normalizePriorities({}), 'home_buy');
p = addCriterion(p, { categoryKey: 'features', label: 'Home office', kind: 'check' }, 'must');
p = addCriterion(p, { categoryKey: 'exterior', label: 'Garage', kind: 'check' }, 'must');
p.preferredPropertyTypes = { ...p.preferredPropertyTypes, values: ['house'], tier: 'must' };
sql(`update public.search_member_priorities set priorities=${lit(JSON.stringify(p))}::jsonb where search_id=${lit(info.search)} and user_id=${lit(info.users.owner.id)}`);
const id = randomUUID();
sql(`insert into public.homes(id,user_id,search_id,address,price,beds,baths,sqft,photo_url,primary_bedroom_location,home_layout,home_condition,notes,pros) values (${lit(id)},${lit(info.users.owner.id)},${lit(info.search)},'14 Linden Lane, Maple Hollow, MI 48001','485000','3','2','1840','/images/onboarding/front-porch.webp','Main Floor',ARRAY['Two Story'],ARRAY['Move-In Ready','New Construction'],'Keep this existing note','Sunny living room')`);
sql(`insert into public.home_member_state(home_id,user_id,status,checks) values (${lit(id)},${lit(info.users.owner.id)},'Saved','{"features:Home office":true}')`);
const row = () => JSON.parse(sql(`select row_to_json(h) from public.homes h where id=${lit(id)}`));
const checks = () => sql(`select checks from public.home_member_state where home_id=${lit(id)} and user_id=${lit(info.users.owner.id)}`);
const originalChecks = checks();
const results = [];
const check = (name, ok) => { results.push({ name, ok: Boolean(ok) }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`); assert.ok(ok, name); };
async function until(fn) { const end = Date.now() + 15000; while (!fn()) { if (Date.now() > end) throw Error('timed out waiting for the saved database value'); await new Promise(r => setTimeout(r, 120)); } }
async function reveal(page, field) {
  await page.locator(`#${field}`).evaluate(node => { for (let parent = node.parentElement; parent; parent = parent.parentElement) if (parent.tagName === 'DETAILS') parent.open = true; });
  await page.locator(`#${field}`).scrollIntoViewIfNeeded();
}
async function fits(page, name) {
  check(`${name}: no page or overlay overflow`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1 && [...document.querySelectorAll('.flh-overlay,.flh-overlay-scroll')].every(n => n.scrollWidth <= n.clientWidth + 1)));
}
const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {});
try {
  for (const width of [320, 375, 390, 430, 1280]) {
    sql(`update public.homes set property_type=null,garage_type=null,garage_spaces='',school_district_name=null,schools_notes='',primary_bedroom_location='Main Floor',home_layout=ARRAY['Two Story'],home_condition=ARRAY['Move-In Ready','New Construction'] where id=${lit(id)}`);
    const ctx = await browser.newContext({ viewport: { width, height: 900 } });
    await ctx.addCookies([{ name: 'sb-localhost-auth-token', value: `base64-${Buffer.from(JSON.stringify(info.users.owner.session)).toString('base64url')}`, domain: 'localhost', path: '/' }]);
    await ctx.addInitScript(() => { for (const k of ['flh-mobile-tour-dismissed', 'flh-name-prompt-dismissed', 'flh-install-dismissed']) localStorage.setItem(k, '1'); });
    const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(`${base}/homes/${id}`, { waitUntil: 'networkidle' }); await page.locator('.flh-match-overview').waitFor();
    await page.addStyleTag({ content: 'nextjs-portal,.beta-feedback-tab {display:none!important}' });
    check(`${width}: photo precedes summary and Match precedes facts`, await page.evaluate(() => {
      const before = (a, b) => Boolean(document.querySelector(a).compareDocumentPosition(document.querySelector(b)) & Node.DOCUMENT_POSITION_FOLLOWING);
      return before('.flh-hf2-photo', '.flh-hf2-identity') && before('.flh-match-overview', '.flh-hf2-facts') && before('.flh-hf2-facts', '.flh-hf-evaluation');
    }));
    check(`${width}: photo controls are visible without disclosure`, await page.getByRole('button', { name: 'Change photo', exact: true }).isVisible() && await page.getByRole('button', { name: 'Remove photo', exact: true }).isVisible());
    check(`${width}: high Match names unanswered Must-Haves`, /100%/.test(await page.locator('.flh-match-overview-score').innerText()) && /unanswered Must-Have/.test(await page.locator('.flh-match-overview').innerText()));
    await fits(page, `${width} overview`);
    const schools = page.locator('details').filter({ has: page.locator('#hf-schools-title') });
    check(`${width}: Schools is discoverable when unknown`, await schools.locator('summary').isVisible());
    await schools.locator('summary').focus(); await page.keyboard.press('Enter');
    await page.getByLabel('District', { exact: true }).fill('Maple Hollow Schools'); await page.keyboard.press('Tab');
    await until(() => row().school_district_name === 'Maple Hollow Schools');
    check(`${width}: keyboard opens Schools and saves district`, true);
    const basic = page.locator('details').filter({ has: page.locator('#hf-basic-title') });
    if (await basic.getAttribute('open') !== null) await basic.locator('summary').click();
    await page.getByRole('button', { name: 'See Match details', exact: true }).click();
    await page.locator('.flh-mc2-source').filter({ hasText: /^Type/ }).first().click();
    check(`${width}: linked fact reveals category and receives focus`, await page.locator('#hf-propertyType').evaluate(n => n === document.activeElement && n.closest('details').open));
    await page.locator('#hf-propertyType').focus();
    await page.locator('#hf-propertyType').dispatchEvent('pointerdown');
    await page.locator('#hf-propertyType').selectOption('townhome'); await until(() => row().property_type === 'townhome');
    check(`${width}: native selector is single-valued and saves once chosen`, await page.locator('#hf-propertyType').evaluate(n => n.tagName === 'SELECT' && !n.multiple));
    check(`${width}: pointer selection dismisses the single-value control`, await page.locator('#hf-propertyType').evaluate(n => n !== document.activeElement));
    await page.locator('#hf-propertyType').focus(); await page.keyboard.press('ArrowDown');
    check(`${width}: keyboard selection retains native focus`, await page.locator('#hf-propertyType').evaluate(n => n === document.activeElement));
    await page.locator('#hf-layout').click();
    check(`${width}: existing layout + primary-floor selections retained`, await page.getByRole('checkbox', { name: 'Two-Story', exact: true }).isChecked() && await page.getByRole('checkbox', { name: 'First-Floor Primary', exact: true }).isChecked());
    await page.getByRole('checkbox', { name: 'Split Level', exact: true }).check();
    await until(() => row().home_layout.includes('Split Level'));
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    check(`${width}: multi-value Done closes and restores focus without dropping values`, await page.locator('#hf-layout').evaluate(n => n === document.activeElement && n.getAttribute('aria-expanded') === 'false') && row().home_layout.includes('Two Story') && row().primary_bedroom_location === 'Main Floor');
    await page.locator('#hf-homeCondition').click();
    check(`${width}: condition retains simultaneous characteristics`, await page.getByRole('checkbox', { name: 'Move-in Ready', exact: true }).isChecked() && await page.getByRole('checkbox', { name: 'New Construction', exact: true }).isChecked());
    await page.keyboard.press('Escape');
    check(`${width}: Escape closes only the multi-value menu`, await page.locator('.flh-overlay').isVisible() && await page.locator('#hf-homeCondition').getAttribute('aria-expanded') === 'false');
    await reveal(page, 'hf-pros'); await page.locator('#hf-pros').fill('Sunny living room\nRoom for a desk'); await page.keyboard.press('Tab');
    await until(() => row().pros.includes('Room for a desk'));
    check(`${width}: shared impressions keep existing notes and personal answers`, row().notes === 'Keep this existing note' && checks() === originalChecks);
    for (const size of [24, 32]) {
      await page.evaluate(size => document.documentElement.style.fontSize = `${size}px`, size);
      await page.locator('.flh-overlay-scroll').evaluate(n => n.scrollTop = 0);
      await fits(page, `${width} ${size / 16 * 100}% text`);
      await page.screenshot({ path: join(out, `overview-${width}-${size / 16 * 100}.png`), animations: 'disabled' });
      await reveal(page, 'hf-garageType');
      await fits(page, `${width} facts ${size / 16 * 100}% text`);
      check(`${width} ${size / 16 * 100}%: photo and disclosure touch targets`, await page.locator('.flh-hf2-photo-action,.flh-facts-group > summary').evaluateAll(nodes => nodes.every(n => n.getBoundingClientRect().height >= 44)));
    }
    await page.evaluate(() => document.documentElement.style.fontSize = '16px');
    if (width === 390) {
      sql(`update public.homes set property_type='other' where id=${lit(id)}`);
      await page.reload({ waitUntil: 'networkidle' }); await page.locator('#hf-propertyType').waitFor();
      check('legacy single-value option survives reload', await page.locator('#hf-propertyType').inputValue() === 'other');
      await page.getByRole('button', { name: 'Photo URL', exact: true }).click();
      const imageUrl = `${base}/images/onboarding/front-porch.webp`;
      await page.getByLabel('Photo URL', { exact: true }).fill(imageUrl); await page.keyboard.press('Tab'); await until(() => row().photo_url === imageUrl);
      await page.getByRole('button', { name: 'Remove photo', exact: true }).click(); await until(() => row().photo_url === '');
      check('photo URL and remove use the existing save path', await page.locator('.flh-hf2-photo-empty small').isVisible());
      await page.locator('input[type="file"]').setInputFiles('public/images/onboarding/front-porch.webp');
      await until(() => row().photo_url.includes('/storage/v1/object/public/home-photos/'));
      check('upload uses the caller’s existing Storage folder', row().photo_url.includes(info.users.owner.id));
    }
    check(`${width}: no runtime errors`, errors.length === 0);
    await ctx.close();
  }
} finally {
  writeFileSync(join(out, 'results.json'), JSON.stringify(results, null, 2));
  await browser.close();
}
console.log(`${results.length}/${results.length} Part B browser checks passed`);
