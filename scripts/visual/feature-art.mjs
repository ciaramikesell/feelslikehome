#!/usr/bin/env node
// Feature illustrations for Mobile Priority Onboarding V3 — ONLY for the
// features that have no founder photograph yet (in-unit laundry, "either
// garage"). Every other card uses the founder's
// photography (src/lib/onboardingImages.js). Remove an entry here once a photo
// for it is added to the manifest.
//
// Provenance: original artwork authored for Feels Like Home in this
// repository (no third-party images, no listing photography, no stock, no
// hotlinks). Each file is a small, flat SVG on the same 4:3 canvas, in the
// app's palette, so every card has the same aspect ratio, corners and weight.
// They illustrate an example of a feature — never a promise about any home.
//
//   node scripts/visual/feature-art.mjs        writes public/images/features/*.svg
//
// Re-running is deterministic. To replace an illustration with a licensed
// photograph later, see docs/mobile-priority-onboarding-v3.md ("Images").
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const OUT = 'public/images/features';
const C = {
  wall: '#F6EEE4', floor: '#E8DACA', ink: '#3A302A', brick: '#C0643F', brickSoft: '#EDC2AE',
  moss: '#7C8C6E', mossDark: '#5E6E52', sage: '#CFDCC6', gold: '#D3A35A', blue: '#5E8A8E', blueSoft: '#C4DADA',
  white: '#FFFFFF', steel: '#C3C8CC', steelDark: '#8E969C', wood: '#B98B5E', woodSoft: '#E1C6A2', sky: '#E4EEF0', grass: '#B9C9A6',
};
const S = `stroke="${C.ink}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"`;
const rect = (x, y, w, h, fill, extra = '') => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" ${S} ${extra}/>`;
const path = (d, fill = 'none') => `<path d="${d}" fill="${fill}" ${S}/>`;
const circle = (cx, cy, r, fill) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" ${S}/>`;
const line = (x1, y1, x2, y2) => `<path d="M${x1} ${y1}L${x2} ${y2}" fill="none" ${S}/>`;
const room = (floorY = 92) => `<rect width="160" height="120" fill="${C.wall}"/><rect y="${floorY}" width="160" height="${120 - floorY}" fill="${C.floor}"/>`;
const outdoor = (groundY = 88) => `<rect width="160" height="120" fill="${C.sky}"/><rect y="${groundY}" width="160" height="${120 - groundY}" fill="${C.grass}"/>`;
const tree = (x, y, r = 16) => `${line(x, y + r, x, y + r + 22)}${circle(x, y, r, C.moss)}`;
const house = (x, y, w, h, roofFill = C.brick) => `${rect(x, y, w, h, C.white)}${path(`M${x - 6} ${y}L${x + w / 2} ${y - h * 0.62}L${x + w + 6} ${y}Z`, roofFill)}`;
const win = (x, y, w, h) => `${rect(x, y, w, h, C.blueSoft, 'rx="2"')}${line(x + w / 2, y, x + w / 2, y + h)}${line(x, y + h / 2, x + w, y + h / 2)}`;
const stool = (x, y) => `${circle(x, y, 7, C.brick)}${line(x, y + 7, x, y + 28)}${line(x - 6, y + 28, x + 6, y + 28)}`;
const bed = (x, y, w = 70) => `${rect(x, y, w, 16, C.white, 'rx="3"')}${rect(x, y - 14, 10, 30, C.wood, 'rx="3"')}${rect(x + 14, y - 6, 18, 8, C.brickSoft, 'rx="3"')}${rect(x + 34, y - 4, w - 34, 6, C.sage, 'rx="2"')}`;
const svg = (body, label) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 120" role="img" aria-label="${label}">${body}</svg>\n`;

const ART = {
  'in-unit-laundry': ['In-unit laundry', `${room()}${rect(30, 40, 46, 52, C.white, 'rx="4"')}${circle(53, 70, 14, C.blueSoft)}${circle(53, 70, 7, C.white)}${line(36, 48, 50, 48)}${rect(84, 40, 46, 52, C.white, 'rx="4"')}${circle(107, 70, 14, C.blueSoft)}${line(90, 48, 104, 48)}${circle(122, 48, 2, C.ink)}`],
  'garage-either': ['Either garage', `${outdoor(98)}${rect(20, 58, 50, 40, C.white)}${path('M16 58L45 40L74 58Z', C.brickSoft)}${rect(28, 68, 34, 30, C.steel)}${line(28, 78, 62, 78)}${rect(90, 58, 50, 40, C.white)}${path('M86 58L115 40L144 58Z', C.brickSoft)}${rect(98, 68, 34, 30, C.steel)}${line(98, 78, 132, 78)}<text x="80" y="30" text-anchor="middle" font-family="sans-serif" font-size="14" font-weight="700" fill="${C.brick}">or</text>`],
};

await mkdir(OUT, { recursive: true });
let total = 0;
for (const [name, [label, body]] of Object.entries(ART)) {
  const content = svg(body, label);
  total += content.length;
  await writeFile(join(OUT, `${name}.svg`), content);
}
console.log(`${Object.keys(ART).length} illustrations, ${(total / 1024).toFixed(1)} KB total → ${OUT}`);
export const FEATURE_ART = Object.freeze(Object.keys(ART));
