#!/usr/bin/env node
// Proves the public homepage is pixel-identical before and after the native
// welcome change in every ordinary browser. DEVELOPMENT ONLY.
//
//   node scripts/qa/homepage-unchanged-qa.mjs <beforeBaseUrl> <afterBaseUrl> <outDir>
//
// Run two production builds of the same commit range side by side (e.g. main
// in a git worktree on :3400 and this branch on :3200, both against the
// Supabase stand-in) and compare full-page, signed-out screenshots of "/".
// Third-party embeds (YouTube) are blocked in both so only FLH pixels count.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium, devices } from 'playwright';

const [before, after, outArg] = process.argv.slice(2);
if (!before || !after || !outArg) throw new Error('Usage: homepage-unchanged-qa.mjs <beforeBaseUrl> <afterBaseUrl> <outDir>');
const outDir = resolve(outArg);
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {});
const cases = {
  'desktop-1440': { viewport: { width: 1440, height: 900 } },
  'desktop-1024': { viewport: { width: 1024, height: 768 } },
  'mobile-safari-iphone-13': devices['iPhone 13'],
  'mobile-safari-iphone-se': devices['iPhone SE'],
  'mobile-320': { viewport: { width: 320, height: 568 }, isMobile: true, hasTouch: true },
};
const results = [];
async function capture(base, options) {
  const ctx = await browser.newContext({ deviceScaleFactor: 1, reducedMotion: 'reduce', ...options });
  const page = await ctx.newPage();
  await page.route(/youtube|ytimg|googlevideo/, (route) => route.abort());
  const images = [];
  page.on('request', (request) => { if (request.resourceType() === 'image') images.push(new URL(request.url()).pathname + new URL(request.url()).search); });
  await page.goto(`${base}/`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(500);
  const png = await page.screenshot({ fullPage: true });
  await ctx.close();
  return { png, images: images.sort() };
}
for (const [name, options] of Object.entries(cases)) {
  const a = await capture(before, options);
  const b = await capture(after, options);
  const samePixels = Buffer.compare(a.png, b.png) === 0;
  const sameImages = JSON.stringify(a.images) === JSON.stringify(b.images);
  writeFileSync(join(outDir, `homepage-${name}-after.png`), b.png);
  if (!samePixels) writeFileSync(join(outDir, `homepage-${name}-before.png`), a.png);
  results.push({ name, identical: samePixels && sameImages, pixels: samePixels, imageRequests: { before: a.images, after: b.images } });
  console.log(`${samePixels && sameImages ? 'IDENTICAL' : 'DIFFERENT'}  ${name} (pixels ${samePixels ? 'same' : 'differ'}, ${b.images.length} image requests ${sameImages ? 'same' : 'differ'})`);
}
await browser.close();
writeFileSync(join(outDir, 'homepage-unchanged.json'), JSON.stringify(results, null, 2));
process.exit(results.every((r) => r.identical) ? 0 : 1);
