#!/usr/bin/env node
// Card-sized derivatives of the founder's onboarding photography.
//
//   node scripts/visual/onboarding-card-images.mjs
//
// Reads every photo listed in src/lib/onboardingImages.js from
// public/images/onboarding/<file> (the founder's originals — never modified or
// deleted) and writes 4:3 centre-cropped WebP derivatives to
// public/images/onboarding/cards/<key>-400.webp and -800.webp.
// 400w covers 1x/2x phones (cards are ~170–195 CSS px wide); 800w covers 3x
// phones and desktop retina. Quality 74, metadata stripped. Requires
// ImageMagick 6.9+ with WebP (`convert`). Deterministic; safe to re-run.
import { execFileSync } from 'node:child_process';
import { mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ONBOARDING_PHOTOS, CARD_WIDTHS } from '../../src/lib/onboardingImages.js';

const SRC = 'public/images/onboarding';
const OUT = join(SRC, 'cards');
mkdirSync(OUT, { recursive: true });

let total = 0;
for (const [key, photo] of Object.entries(ONBOARDING_PHOTOS)) {
  for (const width of CARD_WIDTHS) {
    const height = Math.round((width * 3) / 4);
    const out = join(OUT, `${key}-${width}.webp`);
    execFileSync('convert', [
      `${join(SRC, photo.file)}[0]`, '-auto-orient', '-strip',
      '-resize', `${width}x${height}^`, '-gravity', photo.gravity || 'center', '-extent', `${width}x${height}`,
      '-quality', '74', '-define', 'webp:method=6', out,
    ]);
    const size = statSync(out).size;
    total += size;
    console.log(`${out}\t${(size / 1024).toFixed(1)} KB`);
  }
}
console.log(`total ${(total / 1024).toFixed(0)} KB`);
