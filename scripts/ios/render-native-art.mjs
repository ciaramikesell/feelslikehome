#!/usr/bin/env node
// Renders the native iOS app icon and launch splash from the approved FLH
// brand mark (public/favicon.svg) — the same artwork as the website's
// home-screen icon (public/icons/apple-touch-icon.png), so nothing new is
// designed here. Re-run after a brand change; outputs are committed.
//
//   node scripts/ios/render-native-art.mjs
//
// App icon: 1024×1024, opaque (App Store Connect rejects an icon with an
// alpha channel), the mark at ~56% width on the paper colour, matching
// apple-touch-icon. Splash: 2732×2732 (Capacitor's Splash.imageset, shown
// scaleAspectFill by LaunchScreen.storyboard): the paper colour with a small
// centred mark, so launch flows straight into the app's paper boot screen.
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { chromium } from 'playwright';

const PAPER = '#FAF6EF';
const svg = readFileSync('public/favicon.svg', 'utf8');
const mark = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
// The mark spans x 6–58 of the 64-unit viewBox (52 units).
const svgSizeForMarkWidth = (markPx) => Math.round((markPx * 64) / 52);

async function render(page, size, markPx, out) {
  const svgPx = svgSizeForMarkWidth(markPx);
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<!doctype html><html><body style="margin:0;width:${size}px;height:${size}px;background:${PAPER};display:grid;place-items:center">
    <img src="${mark}" width="${svgPx}" height="${svgPx}" style="display:block;transform:translate(0px, ${Math.round(svgPx * 0.02)}px)"></body></html>`);
  await page.waitForTimeout(100);
  const tmp = join(mkdtempSync(join(tmpdir(), 'flh-art-')), 'shot.png');
  await page.screenshot({ path: tmp, omitBackground: false });
  // Flatten to RGB (no alpha channel) with Python's Pillow, which the repo's QA already uses.
  const result = spawnSync('python3', ['-I', '-c', `from PIL import Image; Image.open(${JSON.stringify(tmp)}).convert('RGB').save(${JSON.stringify(out)}, optimize=True)`], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr);
  console.log(`${out}: ${size}×${size}, mark ${markPx}px`);
}

const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {});
const page = await browser.newPage({ deviceScaleFactor: 1 });
const assets = 'ios/App/App/Assets.xcassets';
await render(page, 1024, Math.round(1024 * 0.56), `${assets}/AppIcon.appiconset/AppIcon-512@2x.png`);
// LaunchScreen.storyboard scales the square splash to fill the screen
// (scaleAspectFill), so on a 390×844pt phone 2732px ≈ 844pt. A 142px mark then
// shows at ~44pt: the same size as the mark on the app's own boot screen
// (NativeBootScreen's BrandMark size 54 → a 44pt mark), so launch hands off to
// the web boot screen without the mark jumping in size.
for (const name of ['splash-2732x2732.png', 'splash-2732x2732-1.png', 'splash-2732x2732-2.png']) {
  await render(page, 2732, 142, `${assets}/Splash.imageset/${name}`);
}
await browser.close();
