#!/usr/bin/env node
// Feature illustrations for Mobile Priority Onboarding V3.
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
  'first-floor-bedroom': ['First-floor bedroom', `${room(96)}${rect(20, 30, 120, 2, C.ink)}${path('M118 30L118 18L140 18', 'none')}<text x="124" y="54" font-family="sans-serif" font-size="16" font-weight="700" fill="${C.brick}">1F</text>${bed(30, 80, 80)}`],
  'home-office': ['Home office', `${room()}${rect(30, 62, 100, 6, C.wood)}${line(38, 68, 38, 92)}${line(122, 68, 122, 92)}${rect(62, 40, 36, 22, C.blueSoft, 'rx="2"')}${line(80, 62, 80, 62)}${rect(52, 62, 56, 0.1, C.ink)}${rect(108, 46, 10, 16, C.sage, 'rx="2"')}${win(20, 16, 24, 22)}`],
  'finished-basement': ['Finished basement', `${room(96)}${path('M10 20L40 20L40 34L54 34L54 48L68 48L68 62L82 62', 'none')}${rect(90, 72, 54, 16, C.sage, 'rx="4"')}${rect(90, 62, 54, 12, C.moss, 'rx="4"')}${line(95, 88, 95, 96)}${line(139, 88, 139, 96)}${line(70, 74, 70, 94)}${path('M62 74L78 74L74 64L66 64Z', C.gold)}`],
  'primary-ensuite': ['Primary bedroom with its own bathroom', `${room(96)}${rect(96, 26, 34, 70, C.white)}${circle(122, 62, 2, C.ink)}${path('M100 30L126 30', 'none')}${bed(14, 80, 74)}${rect(104, 40, 18, 10, C.blueSoft, 'rx="3"')}`],
  laundry: ['Laundry', `${room()}${rect(30, 40, 46, 52, C.white, 'rx="4"')}${circle(53, 70, 14, C.blueSoft)}${circle(53, 70, 7, C.white)}${line(36, 48, 50, 48)}${rect(84, 40, 46, 52, C.white, 'rx="4"')}${circle(107, 70, 14, C.blueSoft)}${line(90, 48, 104, 48)}${circle(122, 48, 2, C.ink)}`],
  'walkout-basement': ['Walkout basement', `${outdoor(70)}${path('M20 70L20 34L84 34L84 70', C.white)}${path('M14 34L52 12L90 34Z', C.brick)}${path('M84 70L140 104L0 104L0 120L160 120L160 104', C.grass)}${rect(20, 70, 64, 34, C.woodSoft)}${rect(40, 78, 22, 26, C.blueSoft)}${line(51, 78, 51, 104)}${win(30, 44, 16, 14)}${win(58, 44, 16, 14)}`],
  'front-porch': ['Front porch', `${outdoor(94)}${rect(26, 44, 108, 50, C.white)}${path('M18 44L80 14L142 44Z', C.brick)}${rect(26, 58, 108, 6, C.woodSoft)}${line(34, 64, 34, 94)}${line(126, 64, 126, 94)}${line(80, 64, 80, 94)}${rect(66, 68, 14, 26, C.wood)}${rect(20, 94, 120, 6, C.woodSoft)}${rect(92, 72, 24, 10, C.gold, 'rx="2"')}`],
  'countertop-seating': ['Countertop seating', `${room(100)}${rect(14, 54, 132, 8, C.woodSoft)}${rect(22, 62, 116, 38, C.white)}${stool(48, 66)}${stool(80, 66)}${stool(112, 66)}${rect(30, 20, 36, 22, C.white, 'rx="2"')}${rect(94, 20, 36, 22, C.white, 'rx="2"')}`],
  'stainless-appliances': ['Stainless steel appliances', `${room()}${rect(22, 16, 46, 76, C.steel, 'rx="4"')}${line(22, 44, 68, 44)}${line(60, 24, 60, 38)}${line(60, 52, 60, 70)}${rect(80, 50, 58, 42, C.steel, 'rx="3"')}${rect(88, 64, 42, 20, C.steelDark, 'rx="2"')}${circle(94, 56, 3, C.white)}${circle(108, 56, 3, C.white)}${circle(122, 56, 3, C.white)}`],
  'walk-in-pantry': ['Walk-in pantry', `${room(100)}${rect(28, 12, 104, 88, C.woodSoft)}${line(28, 36, 132, 36)}${line(28, 60, 132, 60)}${line(28, 84, 132, 84)}${rect(38, 20, 12, 16, C.brickSoft, 'rx="2"')}${rect(54, 24, 12, 12, C.sage, 'rx="2"')}${rect(96, 20, 14, 16, C.gold, 'rx="2"')}${rect(40, 46, 16, 14, C.white, 'rx="2"')}${rect(76, 44, 12, 16, C.brickSoft, 'rx="2"')}${rect(104, 48, 16, 12, C.sage, 'rx="2"')}${rect(48, 70, 22, 14, C.gold, 'rx="2"')}${rect(92, 68, 14, 16, C.white, 'rx="2"')}`],
  'eat-in-kitchen': ['Eat-in kitchen', `${room(98)}${rect(10, 20, 54, 24, C.white, 'rx="2"')}${rect(10, 58, 54, 40, C.white)}${rect(10, 54, 54, 6, C.woodSoft)}${rect(82, 64, 64, 6, C.wood, 'rx="2"')}${line(90, 70, 90, 98)}${line(138, 70, 138, 98)}${path('M78 98L78 74L84 74', 'none')}${path('M150 98L150 74L144 74', 'none')}${circle(114, 58, 5, C.brickSoft)}`],
  'kitchen-island': ['Kitchen island', `${room(100)}${rect(10, 18, 140, 22, C.white, 'rx="2"')}${line(56, 18, 56, 40)}${line(104, 18, 104, 40)}${rect(30, 60, 100, 8, C.woodSoft)}${rect(36, 68, 88, 32, C.sage)}${line(66, 68, 66, 100)}${line(94, 68, 94, 100)}${circle(54, 54, 5, C.brickSoft)}${path('M98 60L104 50L110 60', 'none')}`],
  'formal-dining': ['Formal dining room', `${room(100)}${line(80, 0, 80, 18)}${path('M64 18L96 18L90 30L70 30Z', C.gold)}${rect(30, 64, 100, 6, C.wood, 'rx="2"')}${line(40, 70, 40, 100)}${line(120, 70, 120, 100)}${path('M24 100L24 56L32 56', 'none')}${path('M136 100L136 56L128 56', 'none')}${path('M72 64L72 54M88 64L88 54', 'none')}${circle(80, 60, 3, C.brick)}`],
  fireplace: ['Fireplace', `${room()}${rect(36, 34, 88, 58, C.white)}${rect(28, 28, 104, 8, C.woodSoft)}${rect(56, 54, 48, 38, C.ink)}${path('M70 92C66 80 76 76 74 66C82 72 86 80 84 92Z', C.gold)}${path('M80 92C78 84 86 80 86 74C92 80 94 86 92 92Z', C.brick)}${rect(52, 14, 10, 14, C.sage, 'rx="2"')}`],
  'high-ceilings': ['High ceilings', `${room(100)}${rect(54, 22, 26, 62, C.blueSoft, 'rx="2"')}${line(67, 22, 67, 84)}${path('M130 12L130 100', 'none')}${path('M124 20L130 12L136 20', 'none')}${path('M124 92L130 100L136 92', 'none')}${rect(16, 78, 30, 14, C.sage, 'rx="4"')}${rect(16, 70, 30, 10, C.moss, 'rx="4"')}`],
  'built-in-shelving': ['Built-in shelving', `${room()}${rect(30, 12, 100, 80, C.woodSoft)}${line(80, 12, 80, 92)}${line(30, 38, 130, 38)}${line(30, 64, 130, 64)}${rect(38, 20, 6, 18, C.brick)}${rect(46, 22, 6, 16, C.blue)}${rect(54, 18, 6, 20, C.gold)}${rect(92, 26, 16, 12, C.sage, 'rx="2"')}${rect(40, 48, 22, 16, C.white, 'rx="2"')}${rect(90, 44, 6, 20, C.moss)}${rect(98, 46, 6, 18, C.brickSoft)}${rect(38, 72, 30, 20, C.wood)}${rect(90, 72, 30, 20, C.wood)}`],
  'large-windows': ['Large windows', `${room(100)}${rect(22, 12, 116, 76, C.sky)}${line(60, 12, 60, 88)}${line(100, 12, 100, 88)}${line(22, 50, 138, 50)}${circle(118, 30, 8, C.gold)}${path('M30 88C40 70 52 70 58 88', C.grass)}${rect(14, 88, 132, 6, C.woodSoft)}`],
  'double-vanity': ['Double vanity', `${room()}${rect(14, 60, 132, 32, C.white)}${rect(10, 54, 140, 8, C.woodSoft)}${path('M32 54C32 60 56 60 56 54', C.blueSoft)}${path('M104 54C104 60 128 60 128 54', C.blueSoft)}${path('M44 54L44 44L50 44', 'none')}${path('M116 54L116 44L122 44', 'none')}${rect(26, 12, 36, 28, C.blueSoft, 'rx="14"')}${rect(98, 12, 36, 28, C.blueSoft, 'rx="14"')}${line(80, 62, 80, 92)}`],
  'soaking-tub': ['Soaking tub', `${room(98)}${path('M22 58L138 58L132 88C130 94 126 96 120 96L40 96C34 96 30 94 28 88Z', C.white)}${path('M34 64L126 64', 'none')}${line(40, 96, 36, 104)}${line(120, 96, 124, 104)}${path('M120 58L120 34C120 28 128 28 128 34', 'none')}${circle(60, 52, 4, C.blueSoft)}${circle(72, 48, 3, C.blueSoft)}`],
  'separate-shower': ['Separate shower and tub', `${room(98)}${rect(14, 14, 50, 84, C.blueSoft)}${line(14, 14, 64, 14)}${path('M48 14L48 26L38 26', 'none')}${path('M32 32L30 40M38 32L38 42M44 32L46 40', 'none')}${path('M74 64L150 64L146 88C144 94 140 96 134 96L88 96C82 96 78 94 76 88Z', C.white)}${line(84, 96, 82, 104)}${line(138, 96, 140, 104)}`],
  'private-toilet': ['Private toilet room', `${room(98)}${rect(18, 16, 56, 82, C.woodSoft)}${circle(64, 60, 3, C.ink)}${rect(98, 32, 30, 22, C.white, 'rx="3"')}${path('M94 56L132 56L128 74C126 80 120 84 113 84C106 84 100 80 98 74Z', C.white)}${rect(104, 84, 18, 12, C.white)}`],
  'linen-closet': ['Linen closet', `${room(100)}${rect(34, 10, 92, 90, C.woodSoft)}${line(34, 36, 126, 36)}${line(34, 62, 126, 62)}${rect(44, 22, 34, 14, C.blueSoft, 'rx="3"')}${rect(84, 24, 32, 12, C.sage, 'rx="3"')}${rect(44, 46, 30, 16, C.white, 'rx="3"')}${rect(80, 48, 36, 14, C.brickSoft, 'rx="3"')}${rect(44, 72, 72, 14, C.white, 'rx="3"')}${line(44, 79, 116, 79)}`],
  workbench: ['Garage workbench', `${room(96)}${rect(16, 12, 128, 34, C.woodSoft)}${circle(36, 28, 4, C.ink)}${circle(52, 28, 4, C.ink)}${path('M70 20L70 38M66 20L74 20', 'none')}${path('M92 22L110 36', 'none')}${rect(20, 58, 120, 8, C.wood)}${line(28, 66, 28, 96)}${line(132, 66, 132, 96)}${rect(36, 74, 40, 16, C.steel, 'rx="2"')}${rect(96, 48, 22, 10, C.brick, 'rx="2"')}`],
  'garage-extension': ['Extended garage', `${outdoor(96)}${rect(14, 46, 132, 50, C.white)}${path('M8 46L42 26L118 26L152 46Z', C.brick)}${rect(24, 58, 50, 38, C.steel)}${line(24, 70, 74, 70)}${line(24, 82, 74, 82)}${rect(86, 58, 50, 38, C.steel, 'stroke-dasharray="5 5"')}${path('M100 76L122 76M116 70L122 76L116 82', 'none')}`],
  'garage-yard-door': ['Garage door to the backyard', `${outdoor(96)}${rect(20, 40, 82, 56, C.white)}${path('M14 40L61 14L108 40Z', C.brick)}${rect(30, 54, 30, 42, C.steel)}${rect(70, 60, 20, 36, C.wood)}${circle(86, 78, 2, C.ink)}${path('M90 96L122 96', 'none')}${tree(132, 58, 14)}`],
  'garage-attached': ['Attached garage', `${outdoor(98)}${house(18, 50, 64, 48)}${win(30, 62, 16, 14)}${rect(56, 68, 14, 30, C.wood)}${rect(82, 64, 64, 34, C.white)}${path('M78 64L114 48L150 64Z', C.brickSoft)}${rect(92, 72, 44, 26, C.steel)}${line(92, 80, 136, 80)}${line(92, 88, 136, 88)}`],
  'garage-detached': ['Detached garage', `${outdoor(98)}${house(14, 50, 64, 48)}${win(26, 62, 16, 14)}${rect(52, 68, 14, 30, C.wood)}${rect(98, 66, 50, 32, C.white)}${path('M94 66L123 50L152 66Z', C.brickSoft)}${rect(106, 74, 34, 24, C.steel)}${line(106, 82, 140, 82)}${line(106, 90, 140, 90)}`],
  'garage-either': ['Either garage', `${outdoor(98)}${rect(20, 58, 50, 40, C.white)}${path('M16 58L45 40L74 58Z', C.brickSoft)}${rect(28, 68, 34, 30, C.steel)}${line(28, 78, 62, 78)}${rect(90, 58, 50, 40, C.white)}${path('M86 58L115 40L144 58Z', C.brickSoft)}${rect(98, 68, 34, 30, C.steel)}${line(98, 78, 132, 78)}<text x="80" y="30" text-anchor="middle" font-family="sans-serif" font-size="14" font-weight="700" fill="${C.brick}">or</text>`],
  'deck-patio': ['Deck or patio', `${outdoor(70)}${rect(0, 70, 160, 50, C.woodSoft)}${line(0, 84, 160, 84)}${line(0, 98, 160, 98)}${line(0, 112, 160, 112)}${rect(54, 64, 52, 6, C.white, 'rx="2"')}${line(80, 70, 80, 92)}${path('M80 26L80 64M56 40L104 40L80 26Z', C.brick)}${path('M28 92L28 70L40 70L40 92', C.moss)}${path('M120 92L120 70L132 70L132 92', C.moss)}`],
  'fenced-yard': ['Fenced yard', `${outdoor(80)}${tree(124, 40, 18)}${[16, 34, 52, 70, 88, 106].map((x) => path(`M${x} 100L${x} 66L${x + 6} 58L${x + 12} 66L${x + 12} 100Z`, C.white)).join('')}${rect(10, 74, 120, 6, C.white)}${rect(10, 88, 120, 6, C.white)}`],
  'mature-trees': ['Mature trees', `${outdoor(92)}${line(46, 66, 46, 100)}${circle(46, 44, 28, C.moss)}${circle(30, 54, 16, C.mossDark)}${line(112, 60, 112, 100)}${circle(112, 40, 24, C.mossDark)}${circle(126, 52, 16, C.moss)}`],
  garden: ['Garden space', `${outdoor(60)}${rect(14, 66, 132, 40, C.wood, 'rx="4"')}${[30, 54, 78, 102, 126].map((x, index) => `${line(x, 66, x, 50)}${circle(x - 5, 52, 5, C.moss)}${circle(x + 5, 48, 5, index % 2 ? C.brick : C.gold)}`).join('')}${line(14, 86, 146, 86)}`],
  pool: ['Pool', `${outdoor(52)}${rect(0, 52, 160, 68, C.woodSoft)}${rect(22, 62, 116, 46, C.blueSoft, 'rx="10"')}${path('M36 82C46 76 56 88 66 82C76 76 86 88 96 82C106 76 116 88 126 82', 'none')}${path('M120 62L120 50M130 62L130 50M120 56L130 56', 'none')}`],
  sidewalks: ['Sidewalks', `${outdoor(54)}${path('M0 120L64 54L96 54L160 120Z', C.steel)}${path('M10 120L68 60M150 120L92 60', 'none')}${path('M40 120L74 74L86 74L120 120Z', '#EDEFF0')}${line(56, 98, 104, 98)}${line(66, 86, 94, 86)}${tree(22, 40, 14)}${tree(140, 40, 14)}`],
  'tree-lined-street': ['Tree-lined street', `${outdoor(70)}${path('M58 120L74 70L86 70L102 120Z', C.steel)}${path('M80 76L80 84M80 94L80 104', 'none')}${tree(28, 54, 18)}${tree(132, 54, 18)}${tree(50, 36, 12)}${tree(110, 36, 12)}`],
  'pet-friendly': ['Pet-friendly', `${room()}${rect(46, 80, 68, 12, C.brickSoft, 'rx="6"')}${path('M58 80C58 58 70 50 86 50C102 50 110 60 110 80Z', C.woodSoft)}${circle(64, 52, 12, C.woodSoft)}${path('M56 44L54 32L64 40', C.wood)}${path('M70 42L74 32L76 44', C.wood)}${circle(60, 52, 1.5, C.ink)}${circle(68, 52, 1.5, C.ink)}${path('M110 74C122 72 124 62 118 58', 'none')}`],
  dishwasher: ['Dishwasher', `${room()}${rect(10, 48, 140, 44, C.white)}${rect(6, 42, 148, 8, C.woodSoft)}${rect(52, 52, 56, 40, C.steel, 'rx="3"')}${line(60, 60, 100, 60)}${circle(96, 56, 1.5, C.ink)}${rect(22, 16, 22, 18, C.blueSoft, 'rx="9"')}${rect(116, 16, 22, 18, C.blueSoft, 'rx="9"')}`],
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
