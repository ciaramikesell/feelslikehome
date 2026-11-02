#!/usr/bin/env node
// Regenerates the fixture set from plans.mjs:
//   images/<id>.png|jpg      rendered with the local Chromium (Playwright)
//   source/<id>.svg          the vector source of each image
//   ground-truth/<id>.json   annotations (buildGroundTruth)
//   replay/oracle/<id>.json  perfect extraction (buildOracleExtraction)
//   replay/flawed/<id>.json  deliberately wrong extraction (flawed.mjs)
//   manifest.json            sha256 of every image (the runner refuses any
//                            image that does not match)
//
// Usage: node scripts/floor-plan-eval/fixtures/generate.mjs
// Offline: no network access is needed or used.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { PLANS } from './plans.mjs';
import { renderPlanSvg } from './svg.mjs';
import {
  addJpegComment, addPngTextChunks, buildGroundTruth, buildOracleExtraction, SYNTHETIC_EXIF, SYNTHETIC_PNG_TEXT, SYNTHETIC_XMP,
} from './build.mjs';
import { buildFlawedExtraction } from './flawed.mjs';
import { PIPELINE_VERSION } from '../vocabulary.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = (...p) => path.join(here, ...p);
for (const dir of ['images', 'source', 'ground-truth', 'replay/oracle', 'replay/flawed']) fs.mkdirSync(out(dir), { recursive: true });

const DEVICE_SCALE = 1.5;

function photoHtml(svg, width, height) {
  const data = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
  // A printed sheet photographed on a table: perspective skew, slight
  // rotation, blur, uneven light and glare.
  return `<!doctype html><html><body style="margin:0;background:#5b5650;width:${width + 220}px;height:${height + 220}px;overflow:hidden">
  <div style="position:absolute;left:110px;top:90px;transform:perspective(1600px) rotateX(7deg) rotateY(-4deg) rotateZ(-3deg);box-shadow:0 18px 40px rgba(0,0,0,.45)">
    <img src="${data}" width="${width}" height="${height}" style="display:block;filter:blur(0.9px) contrast(0.86) sepia(0.18) brightness(0.97)">
    <div style="position:absolute;inset:0;background:radial-gradient(ellipse at 72% 28%, rgba(255,255,255,.62) 0%, rgba(255,255,255,0) 38%),linear-gradient(100deg, rgba(0,0,0,.18), rgba(0,0,0,0) 45%, rgba(0,0,0,.12))"></div>
  </div></body></html>`;
}

const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {});
const manifest = { pipelineVersion: PIPELINE_VERSION, generatedBy: 'scripts/floor-plan-eval/fixtures/generate.mjs', license: 'CC0-1.0', fixtures: [] };
try {
  for (const plan of PLANS) {
    const { svg, width, height } = renderPlanSvg(plan);
    fs.writeFileSync(out('source', `${plan.id}.svg`), svg);
    const page = await browser.newPage({ viewport: plan.photo ? { width: width + 220, height: height + 220 } : { width, height }, deviceScaleFactor: DEVICE_SCALE });
    if (plan.photo) await page.setContent(photoHtml(svg, width, height));
    else await page.setContent(`<!doctype html><html><body style="margin:0">${svg}</body></html>`);
    await page.waitForLoadState('networkidle');
    const png = await page.screenshot({ type: 'png', fullPage: false });
    await page.close();

    let image;
    let file;
    if (plan.format === 'jpeg') {
      image = await sharp(png).jpeg({ quality: 84 }).withExif(SYNTHETIC_EXIF).withXmp(SYNTHETIC_XMP).toBuffer();
      image = addJpegComment(image, 'Taken at 14 Sample Court open house (synthetic)');
      file = `${plan.id}.jpg`;
    } else {
      image = await sharp(png).png({ compressionLevel: 9 }).toBuffer();
      if (plan.personalMetadata) image = addPngTextChunks(image, SYNTHETIC_PNG_TEXT);
      file = `${plan.id}.png`;
    }
    fs.writeFileSync(out('images', file), image);
    const meta = await sharp(image).metadata();
    const gt = buildGroundTruth(plan);
    fs.writeFileSync(out('ground-truth', `${plan.id}.json`), `${JSON.stringify({ ...gt, file: `images/${file}` }, null, 2)}\n`);
    const oracle = buildOracleExtraction(plan);
    fs.writeFileSync(out('replay/oracle', `${plan.id}.json`), `${JSON.stringify(oracle, null, 2)}\n`);
    fs.writeFileSync(out('replay/flawed', `${plan.id}.json`), `${JSON.stringify(buildFlawedExtraction(plan.id, oracle), null, 2)}\n`);
    manifest.fixtures.push({
      id: plan.id, file: `images/${file}`, groundTruth: `ground-truth/${plan.id}.json`, source: `source/${plan.id}.svg`,
      sha256: crypto.createHash('sha256').update(image).digest('hex'), bytes: image.length, width: meta.width, height: meta.height,
      format: plan.format, homeId: plan.homeId, searchProfile: plan.searchProfile, cases: plan.cases, description: plan.description,
      personalMetadata: Boolean(plan.personalMetadata),
    });
    console.log(`${file.padEnd(40)} ${meta.width}×${meta.height} ${(image.length / 1024).toFixed(0)} KB`);
  }
} finally {
  await browser.close();
}
fs.writeFileSync(out('manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`wrote ${manifest.fixtures.length} fixtures`);
