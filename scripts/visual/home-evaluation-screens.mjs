#!/usr/bin/env node
// Check the Match / Tour Feedback visual QA. Development only.
//
//   1. npm run dev                                  (serves /dev/home-facts; no .env needed)
//   2. node scripts/visual/home-evaluation-screens.mjs <outDir> [baseUrl] [--only=name,name]
//        Screenshots every evaluation state at 390 / 768 / 1024 / 1440 px and
//        fails on horizontal overflow, console errors, or a failed interaction.
//        Interactions use the preview's in-memory persistence (nothing is sent
//        to Supabase).
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';

const WIDTHS = [
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1440, height: 900 },
];
const IGNORED_CONSOLE = /Download the React DevTools|favicon|bad HTTP response code \(500\) was received when fetching the script/;
const nav = (page, name) => page.locator('.flh-workspace-nav').getByRole('button', { name });

export const SCENARIOS = [
  { name: 'match-new-home', query: 'state=eval-new&section=match' },
  { name: 'match-many-unknown', query: 'state=eval-unknown&section=match' },
  { name: 'match-must-have-mismatch', query: 'state=eval-mismatch&section=match' },
  { name: 'match-mostly-confirmed', query: 'state=eval-mostly&section=match' },
  { name: 'match-two-buyers', query: 'state=eval-two-buyers&section=match' },
  { name: 'match-realtor', query: 'state=eval-realtor&section=match', act: async (page) => assertNoEditing(page) },
  { name: 'tour-not-toured', query: 'state=eval-unknown&section=tour' },
  { name: 'tour-legacy-notes', query: 'state=eval-legacy-notes&section=tour' },
  { name: 'tour-toured', query: 'state=eval-toured&section=tour' },
  { name: 'tour-two-buyers', query: 'state=eval-two-buyers&section=tour' },
  { name: 'tour-realtor', query: 'state=eval-realtor&section=tour', act: async (page) => {
    await assertNoEditing(page);
    await page.getByRole('heading', { name: 'Jordan’s take · toured October 11' }).count();
    if (!(await page.getByText('Sam’s take').count())) throw new Error('co-buyer take is not attributed by name');
  } },
  // Interactions (in-memory persistence; window.__flhPreviewWrites records each write).
  { name: 'act-answer-personal', query: 'state=eval-unknown&section=match', act: async (page, { viewport }) => {
    const group = page.getByRole('group', { name: 'Home Office: your answer' });
    if (viewport.width <= 720) {
      const height = await group.getByRole('button', { name: 'Yes', exact: true }).evaluate((el) => el.getBoundingClientRect().height);
      if (height < 44) throw new Error(`answer tap target is ${height}px`);
    }
    await group.getByRole('button', { name: 'Yes', exact: true }).click();
    await page.waitForFunction(() => window.__flhPreviewWrites?.length === 1);
    const [write] = await page.evaluate(() => window.__flhPreviewWrites);
    if (write.path !== 'personal' || write.checks['features:Home office'] !== true) throw new Error(`unexpected write ${JSON.stringify(write)}`);
    // Answered: it leaves "Still wondering" and appears, compact, under What's confirmed.
    await page.locator('#still-wondering strong', { hasText: /^Home Office$/ }).waitFor({ state: 'detached' });
    await page.locator('.flh-priority-list.is-compact strong', { hasText: /^Home Office$/ }).waitFor();
  } },
  { name: 'act-answer-clear', query: 'state=eval-mismatch&section=match', act: async (page) => {
    await page.getByRole('button', { name: /Change Home Office/ }).click();
    await page.getByRole('group', { name: 'Home Office: your answer' }).getByRole('button', { name: 'Unknown', exact: true }).click();
    await page.waitForFunction(() => window.__flhPreviewWrites?.length === 1);
    const [write] = await page.evaluate(() => window.__flhPreviewWrites);
    if (write.path !== 'personal' || 'features:Home office' in write.checks) throw new Error(`Unknown did not clear: ${JSON.stringify(write)}`);
    if (await page.getByText('A Must-Have isn’t met').count()) throw new Error('Must-Have callout should disappear once the miss is cleared');
  } },
  { name: 'act-answer-save-error', query: 'state=eval-save-error&section=match', act: async (page) => {
    await page.getByRole('group', { name: 'Home Office: your answer' }).getByRole('button', { name: 'No', exact: true }).click();
    await page.getByRole('alert').waitFor();
    // The optimistic answer is rolled back to what was actually saved (Unknown).
    await page.getByRole('group', { name: 'Home Office: your answer' }).getByRole('button', { name: 'Unknown', exact: true, pressed: true }).waitFor();
  } },
  { name: 'act-edit-notes', query: 'state=eval-legacy-notes&section=tour', act: async (page) => {
    await page.getByRole('button', { name: 'Edit notes' }).click();
    await page.getByLabel(/What you loved/).fill('Big backyard, Quiet street, Mature trees');
    await page.getByRole('button', { name: 'Save notes' }).click();
    await page.waitForFunction(() => window.__flhPreviewWrites?.length === 1);
    const [write] = await page.evaluate(() => window.__flhPreviewWrites);
    if (write.path !== 'whole' || write.pros !== 'Big backyard, Quiet street, Mature trees' || write.cons !== 'Dated kitchen' || !write.notes.startsWith('Saw it from the street')) throw new Error(`notes write ${JSON.stringify(write)}`);
    await page.getByText('Mature trees').waitFor();
  } },
  { name: 'act-record-take-opens-survey', query: 'state=eval-unknown&section=tour', act: async (page) => {
    await page.getByRole('button', { name: /record my take/ }).click();
    await page.getByRole('heading', { name: 'Record your take' }).waitFor();
    await page.getByRole('button', { name: 'Cancel' }).click();
    if (await page.evaluate(() => window.__flhPreviewWrites?.length || 0)) throw new Error('opening the survey wrote something');
    if (!(await page.getByText('Your impressions will live here').count())) throw new Error('home was marked toured without saving a take');
  } },
  { name: 'act-sections', query: 'state=eval-toured', act: async (page, { nav: go }) => {
    for (const [label, url] of [['Check the Match', 'section=match'], ['Tour Feedback', 'section=tour']]) {
      await go(new RegExp(label)).click();
      await page.getByRole('heading', { level: 1, name: label }).waitFor();
      if (!page.url().includes(url)) throw new Error(`${label} not in URL`);
    }
    await go(/Home Facts/).click();
    await page.getByRole('heading', { level: 1, name: 'Home Facts' }).waitFor();
  } },
];

async function assertNoEditing(page) {
  for (const name of [/^Yes$/, /^No$/, /^Change/, /^Edit/, /record my take/i, /Want to tour/, /Favorite/, /Archive/, /Record your take/, /Add in Home Facts/]) {
    const count = await page.locator('main').getByRole('button', { name }).count();
    if (count) throw new Error(`read-only view shows a ${name} button`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const only = args.find((arg) => arg.startsWith('--only='))?.slice(7).split(',');
  const [outArg, baseUrl = 'http://localhost:3000'] = args.filter((arg) => !arg.startsWith('--'));
  if (!outArg) throw new Error('Usage: home-evaluation-screens.mjs <outDir> [baseUrl]');
  const outDir = resolve(outArg);
  await mkdir(outDir, { recursive: true });
  const browser = await chromium.launch();
  const manifest = [];
  let failed = false;
  for (const viewport of WIDTHS) {
    for (const scenario of SCENARIOS.filter((item) => !only || only.includes(item.name))) {
      const page = await browser.newPage({ viewport });
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => { if (message.type() === 'error' && !IGNORED_CONSOLE.test(message.text())) errors.push(message.text()); });
      const file = `${scenario.name}-${viewport.width}.png`;
      let error = null;
      try {
        await page.goto(`${baseUrl}/dev/home-facts?${scenario.query}`, { waitUntil: 'networkidle' });
        await page.evaluate(() => document.fonts.ready);
        if (scenario.act) await scenario.act(page, { nav: (name) => nav(page, name), viewport });
        await page.waitForTimeout(250);
        await page.screenshot({ path: join(outDir, file), fullPage: true });
      } catch (err) { error = err.message; }
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth).catch(() => null);
      const entry = { file, width: viewport.width, overflow, error, consoleErrors: errors };
      if (error || overflow > 0 || errors.length) { failed = true; console.error('FAIL', entry); }
      manifest.push(entry);
      await page.close();
    }
  }
  await browser.close();
  await writeFile(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`${manifest.length} screenshots → ${outDir}${failed ? ' (with failures)' : ''}`);
  if (failed) process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((error) => { console.error(error); process.exit(1); });
