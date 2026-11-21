#!/usr/bin/env node
// Run only against the disposable Supabase stand-in; see the delivery doc.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { base, context, info, lit, ready, row, sql } from './saved-experience-support.mjs';
const out = process.argv[3];
mkdirSync(out, { recursive: true });
const baseline = process.env.FLH_BASELINE_URL || 'http://127.0.0.1:3310';
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || '/usr/bin/chromium' });
const results = [];
async function check(name, run) { await run(); results.push({ name, ok: true }); console.log(`PASS ${name}`); }
const until = async (fn) => { for (let i = 0; i < 80; i++) { if (fn()) return; await new Promise(r => setTimeout(r, 150)); } throw Error('Saved value did not reach database'); };
const id = info.legacyHomeId;
const empty = process.env.FLH_QA_SKIP_CAPTURES ? null : sql(`insert into public.homes(user_id,search_id,address) values(${lit(info.users.owner.id)},${lit(info.search)},'Missing details — QA example') returning id`);
sql(`update public.homes set est_monthly='2031',hoa_fee_monthly=0,sqft='1100', cooling='Central', elementary_school='Historic Elementary',middle_school='Historic Middle',high_school='Historic High',school_district_name='Royal Oak',schools_notes='Enrollment notes',garage_type='attached',garage_spaces='2',basement_style='traditional',basement_condition='finished',laundry_location='basement' where id=${lit(id)}`);
try {
  if (!process.env.FLH_QA_SKIP_CAPTURES) for (const width of [390, 768, 1024, 1440]) for (const [state, homeId] of [['populated', id], ['missing', empty]]) for (const [version, url] of [['before', baseline], ['after', base]]) {
    const ctx = await context(browser, width, { url });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${url}/homes/${homeId}`);
    await page.locator('.flh-hf2').waitFor(); await ready(page);
    await check(`${version} ${state} ${width}: no horizontal overflow or runtime errors`, async () => {
      assert.equal(await page.locator('.flh-overlay-scroll').evaluate(el => el.scrollWidth <= el.clientWidth + 1), true);
      assert.deepEqual(errors, []);
    });
    if (version === 'after') {
      await check(`${state} ${width}: open facts, removed controls absent, one summary in identity`, async () => {
        assert.equal(await page.locator('.flh-hf2-facts details').count(), 0);
        for (const field of ['propertyType', 'layout', 'homeCondition', 'hasHoa', 'elementarySchool', 'middleSchool', 'highSchool', 'propertyTaxAnnual', 'propertyTaxYear', 'yearBuilt', 'heating', 'cooling']) assert.equal(await page.locator(`.flh-hf2 #hf-${field}`).count(), 0, field);
        assert.equal(await page.locator('.flh-hf2-identity .flh-match-overview').count(), 1);
        assert.equal(await page.locator('#flh-match-title').innerText(), 'Match Breakdown');
      });
    }
    await page.screenshot({ path: join(out, `${version}-${width}-${state}-overview.png`) });
    // Expand only the screenshot's scroll surface to show its entire contents.
    // Product CSS and the live interactive layout are never changed by this.
    const style = await page.addStyleTag({ content: '.flh-overlay-backdrop{position:absolute;align-items:flex-start;min-height:100vh;height:auto}.flh-overlay{max-height:none;height:auto;overflow:visible}.flh-overlay-scroll{overflow:visible;max-height:none}html,body{overflow:visible!important}' });
    await page.screenshot({ path: join(out, `${version}-${width}-${state}-full.png`), fullPage: true });
    await page.locator('.flh-hf2-facts').screenshot({ path: join(out, `${version}-${width}-${state}-facts.png`) });
    await style.evaluate(el => el.remove());
    await ctx.close();
  }
  const ctx = await context(browser, 390); const page = await ctx.newPage();
  await page.goto(`${base}/homes/${id}`); await page.locator('#hf-schoolDistrict').waitFor();
  const hidden = Object.fromEntries(['cooling', 'heating', 'year_built', 'property_tax_annual', 'property_tax_year', 'elementary_school', 'middle_school', 'high_school', 'has_hoa', 'property_type', 'home_layout', 'home_condition', 'listing_import'].map(key => [key, row(id)[key]]));
  for (const [field, value, dbField, expected] of [
    ['estMonthly','2123','est_monthly','2123'],['hoaFeeMonthly','125','hoa_fee_monthly',125],
    ['schoolDistrict','','school_district_name',null],['schoolsNotes','','schools_notes',''],
    ['basement','Unfinished Walkout','basement_condition','unfinished'],['pros','Sunny kitchen','pros','Sunny kitchen'],['cons','Busy road','cons','Busy road'],
  ]) await check(`${field}: edit, persist and reload`, async () => {
    await page.locator(`#hf-${field}`).click(); await page.locator(`#hf-${field}`).fill(value); await page.locator(`#hf-${field}`).press('Tab');
    await until(() => row(id)[dbField] === expected);
    await page.reload(); await page.locator(`#hf-${field}`).waitFor();
    assert.ok(!await page.locator(`#hf-${field}`).inputValue() || value !== '', 'cleared field remains clear');
  });
  for (const [field,value,column] of [['garageType','detached','garage_type'],['garageSpaces','3+','garage_spaces'],['laundryLocation','first_floor','laundry_location']]) await check(`${field}: select persists after refresh`, async () => {
    await page.locator(`#hf-${field}`).selectOption(value);await until(() => row(id)[column] === value); await page.reload();await page.locator(`#hf-${field}`).waitFor();assert.equal(await page.locator(`#hf-${field}`).inputValue(),value);
  });
  await check('hidden evidence and legacy school names survive every retained-field edit unchanged', async () => {
    for (const [key,value] of Object.entries(hidden)) assert.deepEqual(row(id)[key],value,key);
    assert.equal(await page.locator('#hf-elementarySchool, #hf-middleSchool, #hf-highSchool').count(),0);
  });
  await check('View Match Details scrolls and transfers keyboard focus', async () => {
    await page.locator('.flh-match-jump').click();assert.equal(await page.evaluate(() => document.activeElement?.id),'');
    assert.equal(await page.locator('.flh-overlay-match').evaluate(el => el === document.activeElement),true);
    assert.equal(await page.locator('.flh-overlay-match').evaluate(el => el.getBoundingClientRect().top >= document.querySelector('.flh-overlay-scroll').getBoundingClientRect().top - 1),true);
  });
  await check('ranked property type remains editable in Match Breakdown through the shared fact writer', async () => {
    await page.locator('#hf-propertyType').selectOption('condo');await until(() => row(id).property_type === 'condo');
    await page.reload();await page.locator('#hf-propertyType').waitFor();assert.equal(await page.locator('#hf-propertyType').inputValue(),'condo');
  });
  await page.goto(`${base}/homes/${id}?section=match`);await page.locator('.flh-overlay-match').waitFor();
  await page.waitForFunction(() => document.activeElement?.classList.contains('flh-overlay-match'));
  results.push({ name: 'legacy section=match URL reaches and focuses Match Breakdown', ok: true });
  await ctx.close();
  for (const who of ['coBuyer','realtor']) await check(`${who}: authorized view loads with existing permission boundaries`, async () => {
    const c=await context(browser,390,{who});const p=await c.newPage();
    await p.goto(`${base}${who==='realtor'?`/people/${info.search}/homes/${id}`:`/homes/${id}`}`);
    await p.locator('.flh-hf2').waitFor();
    if(who==='realtor') assert.equal(await p.locator('.flh-hf2 input, .flh-hf2 select, .flh-hf2 textarea').count(),0);
    else {assert.equal(await p.locator('#hf-schoolDistrict').inputValue(),'');assert.equal(await p.locator('#hf-schoolsNotes').inputValue(),'');}
    await c.close();
  });
} finally {
  if (empty) sql(`delete from public.homes where id=${lit(empty)}`);
  await browser.close();writeFileSync(join(out,'results.json'),JSON.stringify(results,null,2));
}
