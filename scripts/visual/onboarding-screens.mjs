#!/usr/bin/env node
// Onboarding visual safety net. Development only; never runs against production.
//
//   1. npm run dev                          (serves /dev/onboarding; no .env needed)
//   2. node scripts/visual/onboarding-screens.mjs capture <outDir> [baseUrl]
//        Screenshots every onboarding scenario at 390 / 768 / 1024 / 1440 px,
//        after fonts and images have loaded, and records horizontal overflow
//        in <outDir>/manifest.json (any overflow also fails the run).
//   3. node scripts/visual/onboarding-screens.mjs compare <beforeDir> <afterDir> <diffDir>
//        Pixel-compares matching files; writes red-highlighted diffs and a report.
//   4. node scripts/visual/onboarding-screens.mjs reference <figma.png> <shot.png> <out.png>
//        Places a supplied Figma export beside a screenshot at the same width
//        for human review. It does NOT score fidelity: a device-frame mockup is
//        not pixel-comparable with a browser render.
//
// Uses the Chromium Playwright provides (PLAYWRIGHT_BROWSERS_PATH is honoured).
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { chromium } from 'playwright';

export const WIDTHS = [
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1440, height: 900 },
];

// Each scenario is a preview URL plus optional interactions that reach a state
// the URL alone cannot (a failed save, the completion screen).
export const SCENARIOS = [
  { name: 'basics-empty', query: 'step=basics&state=empty' },
  { name: 'basics-populated', query: 'step=basics&state=populated' },
  { name: 'basics-save-error', query: 'step=basics&state=error', act: async (page) => {
    await page.getByLabel('I’m looking for').selectOption('home_buy');
    await page.locator('.hh-save-error').waitFor();
  } },
  { name: 'basics-garage-open', query: 'step=basics&state=populated', act: async (page) => {
    await page.getByRole('button', { name: /Garage preferences/ }).click();
    await page.getByRole('radiogroup', { name: 'How much does a garage matter?' }).or(page.getByText('How much does a garage matter?')).first().waitFor();
  } },
  { name: 'basics-all-open', query: 'step=basics&state=populated', act: async (page) => {
    await page.getByRole('button', { name: /Garage preferences/ }).click();
    await page.getByRole('button', { name: /More about the home/ }).click();
    await page.getByText('Kinds of homes').waitFor();
  } },
  { name: 'what-matters', query: 'step=what_matters&state=populated' },
  { name: 'rank', query: 'step=rank&state=populated' },
  { name: 'ready', query: 'step=rank&state=populated', act: async (page) => {
    await page.getByRole('button', { name: 'Finish', exact: true }).click();
    await page.getByRole('heading', { name: 'Your search is ready.' }).waitFor();
  } },
  { name: 'shared-basics', query: 'step=basics&state=populated&mode=shared' },
  // Step 2 (approved six-step flow, previewed with flow=v2; not live).
  { name: 'locations-empty', query: 'flow=v2&step=locations&state=empty' },
  { name: 'locations-typing', query: 'flow=v2&step=locations&state=empty', act: async (page) => {
    await page.getByRole('combobox', { name: 'Areas of interest' }).fill('grosse');
    await page.getByRole('listbox', { name: 'Matching areas' }).waitFor();
  } },
  { name: 'locations-no-results', query: 'flow=v2&step=locations&state=empty', act: async (page) => {
    await page.getByRole('combobox', { name: 'Areas of interest' }).fill('zzz');
    await page.getByText('No matching cities').waitFor();
  } },
  { name: 'locations-provider-error', query: 'flow=v2&step=locations&state=empty', act: async (page) => {
    await page.getByRole('combobox', { name: 'Areas of interest' }).fill('fail');
    await page.getByText('Area search isn’t available right now').waitFor();
  } },
  { name: 'locations-populated', query: 'flow=v2&step=locations&state=populated' },
  { name: 'locations-place-form', query: 'flow=v2&step=locations&state=empty', act: async (page) => {
    await page.getByRole('button', { name: /Add a place/ }).click();
    await page.getByRole('button', { name: 'Save place' }).waitFor();
  } },
  { name: 'locations-shared', query: 'flow=v2&step=locations&state=populated&mode=shared' },
  // Step 3 (approved six-step flow, previewed with flow=v2; not live).
  { name: 'people-neither', query: 'flow=v2&step=collaboration&state=empty' },
  { name: 'people-cobuyer', query: 'flow=v2&step=collaboration&state=empty', act: async (page) => {
    await page.getByRole('button', { name: /Co-buyer/ }).click();
    await page.locator('.flh-ob-person.is-selected').waitFor();
  } },
  { name: 'people-realtor', query: 'flow=v2&step=collaboration&state=empty', act: async (page) => {
    await page.getByRole('button', { name: /Realtor/ }).click();
    await page.locator('.flh-ob-person.is-selected').waitFor();
  } },
  { name: 'people-both', query: 'flow=v2&step=collaboration&state=empty', act: async (page) => {
    await page.getByRole('button', { name: /Co-buyer/ }).click();
    await page.getByRole('button', { name: /Realtor/ }).click();
    await page.locator('.flh-ob-person.is-selected').nth(1).waitFor();
  } },
  { name: 'people-existing', query: 'flow=v2&step=collaboration&state=populated' },
  { name: 'people-sharing-open', query: 'flow=v2&step=collaboration&state=empty', act: async (page) => {
    await page.getByRole('button', { name: /How sharing works/ }).click();
    await page.getByText('can be sent later from My Search.').waitFor();
  } },
  { name: 'people-shared-setup', query: 'flow=v2&step=collaboration&state=populated&mode=shared' },
  // Six-step flow: home details move from Step 1 to Step 4, and rank in Step 5.
  { name: 'v2-basics-empty', query: 'flow=v2&step=basics&state=empty' },
  { name: 'v2-basics-populated', query: 'flow=v2&step=basics&state=populated' },
  // A fresh buyer: nothing chosen, "Skip for now".
  { name: 'v2-what-matters-fresh', query: 'flow=v2&step=priorities&state=empty' },
  { name: 'v2-what-matters-several', query: 'flow=v2&step=priorities&state=empty', act: async (page) => {
    for (const name of ['Quiet street', 'Great schools', 'Home office', 'Move-in ready', 'Room to renovate', 'Condo', 'Ranch', 'Two story', 'Garage']) await page.getByRole('button', { name, exact: true }).click();
  } },
  { name: 'v2-what-matters-returning', query: 'flow=v2&step=priorities&state=populated' },
  { name: 'v2-what-matters-more-open', query: 'flow=v2&step=priorities&state=empty', act: async (page) => {
    await page.getByRole('button', { name: /More to consider/ }).click();
    await page.getByRole('button', { name: 'Fireplace', exact: true }).waitFor();
  } },
  { name: 'v2-what-matters-earlier-answer', query: 'flow=v2&step=priorities&state=legacy' },
  // Step 5: no priorities, all Important, distributed across levels (returning), and many.
  { name: 'v2-rank-none', query: 'flow=v2&step=rank&state=empty' },
  { name: 'v2-rank-all-important', query: 'flow=v2&step=rank&state=fresh' },
  { name: 'v2-rank-returning', query: 'flow=v2&step=rank&state=populated' },
  { name: 'v2-rank-many', query: 'flow=v2&step=rank&state=many' },
  { name: 'v2-rank-info-open', query: 'flow=v2&step=rank&state=fresh', act: async (page) => {
    await page.getByRole('button', { name: /How Match handles missing information/ }).click();
    await page.getByText('Unknown never counts against a home').waitFor();
  } },
];

async function settle(page) {
  // Hide the Next.js development indicator; it is not part of the product.
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].filter((img) => !img.complete).map((img) => new Promise((done) => { img.onload = img.onerror = done; })));
  });
  // Two frames so layout that depends on fonts has painted.
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
}

async function capture(outDir, baseUrl = 'http://localhost:3000') {
  await mkdir(outDir, { recursive: true });
  const browser = await chromium.launch();
  const manifest = [];
  try {
    for (const scenario of SCENARIOS) {
      for (const viewport of WIDTHS) {
        const context = await browser.newContext({ viewport, deviceScaleFactor: 1, reducedMotion: 'reduce' });
        const page = await context.newPage();
        const response = await page.goto(`${baseUrl}/dev/onboarding?${scenario.query}`, { waitUntil: 'networkidle' });
        if (!response || response.status() !== 200) throw new Error(`${scenario.name}: preview answered ${response?.status()}`);
        if (scenario.act) await scenario.act(page);
        await settle(page);
        const metrics = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          innerWidth: window.innerWidth,
          scrollHeight: document.documentElement.scrollHeight,
        }));
        // Three views per width: the first screen ("top"), the last screen
        // ("end", where a sticky action bar meets the final content), and the
        // whole document ("full"). Full-page captures pin sticky elements to the
        // first viewport, so judge sticky actions from "top" and "end" only.
        const shots = [];
        for (const view of ['top', 'end', 'full']) {
          await page.evaluate((y) => window.scrollTo(0, y), view === 'end' ? metrics.scrollHeight : 0);
          await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
          const file = `${scenario.name}-${viewport.width}-${view}.png`;
          await page.screenshot({ path: join(outDir, file), fullPage: view === 'full' });
          shots.push(file);
        }
        manifest.push({ files: shots, scenario: scenario.name, ...viewport, ...metrics, horizontalOverflow: metrics.scrollWidth > metrics.innerWidth });
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
  await writeFile(join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  const overflow = manifest.filter((entry) => entry.horizontalOverflow);
  for (const entry of manifest) console.log(`${entry.scenario}-${entry.width}\t${entry.scrollWidth}x${entry.scrollHeight}${entry.horizontalOverflow ? '\tHORIZONTAL OVERFLOW' : ''}`);
  if (overflow.length) {
    console.error(`${overflow.length} screenshot(s) overflow horizontally.`);
    process.exitCode = 1;
  }
}

// Pixel comparison runs inside Chromium's canvas so the script needs no image library.
async function compareImages(page, before, after) {
  const toDataUrl = async (file) => `data:image/png;base64,${(await readFile(file)).toString('base64')}`;
  return page.evaluate(async ({ a, b }) => {
    const load = (src) => new Promise((done, fail) => { const img = new Image(); img.onload = () => done(img); img.onerror = fail; img.src = src; });
    const [imgA, imgB] = await Promise.all([load(a), load(b)]);
    const width = Math.max(imgA.width, imgB.width);
    const height = Math.max(imgA.height, imgB.height);
    const pixels = (img) => {
      const canvas = new OffscreenCanvas(width, height);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ff00ff';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0);
      return ctx.getImageData(0, 0, width, height);
    };
    const da = pixels(imgA);
    const db = pixels(imgB);
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    const out = ctx.createImageData(width, height);
    let changed = 0;
    for (let i = 0; i < da.data.length; i += 4) {
      const delta = Math.abs(da.data[i] - db.data[i]) + Math.abs(da.data[i + 1] - db.data[i + 1]) + Math.abs(da.data[i + 2] - db.data[i + 2]);
      const grey = (da.data[i] + da.data[i + 1] + da.data[i + 2]) / 3;
      if (delta > 24) { changed += 1; out.data.set([230, 40, 40, 255], i); } else { out.data.set([grey, grey, grey, 70], i); }
    }
    ctx.putImageData(out, 0, 0);
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    const buffer = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    for (let i = 0; i < buffer.length; i += 0x8000) binary += String.fromCharCode(...buffer.subarray(i, i + 0x8000));
    return { width, height, sizeA: [imgA.width, imgA.height], sizeB: [imgB.width, imgB.height], changed, ratio: changed / (width * height), png: btoa(binary) };
  }, { a: await toDataUrl(before), b: await toDataUrl(after) });
}

async function compare(beforeDir, afterDir, diffDir) {
  await mkdir(diffDir, { recursive: true });
  const before = JSON.parse(await readFile(join(beforeDir, 'manifest.json'), 'utf8'));
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const report = [];
  try {
    for (const file of before.flatMap((entry) => entry.files)) {
      let result;
      try {
        result = await compareImages(page, join(beforeDir, file), join(afterDir, file));
      } catch {
        report.push({ file, missing: true });
        continue;
      }
      await writeFile(join(diffDir, file), Buffer.from(result.png, 'base64'));
      const { png, ...rest } = result;
      report.push({ file, ...rest, changedPercent: Number((rest.ratio * 100).toFixed(2)) });
    }
  } finally {
    await browser.close();
  }
  await writeFile(join(diffDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  for (const row of report) console.log(row.missing ? `${row.file}\tMISSING` : `${row.file}\t${row.changedPercent}% changed\t${row.sizeA.join('x')} → ${row.sizeB.join('x')}`);
}

async function reference(figmaFile, shotFile, outFile) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  const src = async (file) => `data:image/png;base64,${(await readFile(file)).toString('base64')}`;
  await page.setContent(`<!doctype html><body style="margin:0;padding:24px;background:#3a3a3a;font:600 14px system-ui;color:#fff;display:flex;gap:24px;align-items:flex-start">
    <figure style="margin:0"><figcaption>Figma reference — ${basename(figmaFile)}</figcaption><img src="${await src(figmaFile)}" style="display:block;margin-top:8px;max-width:560px"></figure>
    <figure style="margin:0"><figcaption>Implementation — ${basename(shotFile)}</figcaption><img src="${await src(shotFile)}" style="display:block;margin-top:8px"></figure></body>`);
  await page.waitForLoadState('load');
  await page.screenshot({ path: outFile, fullPage: true });
  await browser.close();
  console.log(`Wrote ${outFile} (side-by-side for review; no automated fidelity score).`);
}

const [command, ...args] = process.argv.slice(2);
if (command === 'capture' && args[0]) await capture(resolve(args[0]), args[1]);
else if (command === 'compare' && args.length >= 3) await compare(resolve(args[0]), resolve(args[1]), resolve(args[2]));
else if (command === 'reference' && args.length >= 3) await reference(resolve(args[0]), resolve(args[1]), resolve(args[2]));
else {
  console.error('Usage: onboarding-screens.mjs capture <outDir> [baseUrl] | compare <before> <after> <diffDir> | reference <figma.png> <shot.png> <out.png>');
  process.exitCode = 2;
}
