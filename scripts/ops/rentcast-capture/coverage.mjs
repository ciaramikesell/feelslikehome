#!/usr/bin/env node
// Add Home V3, phase 5: field-population and enum matrix from the sanitized
// fixtures in test/fixtures/rentcast. Prints Markdown for
// docs/add-home-v3-real-response-validation.md §5.
//
//   node scripts/ops/rentcast-capture/coverage.mjs

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

// The fields phase 3 maps, with the type the documentation implies.
export const FIELDS = Object.freeze([
  ['property', 'features.fireplace', 'boolean'],
  ['property', 'features.fireplaceType', 'string'],
  ['property', 'features.pool', 'boolean'],
  ['property', 'features.poolType', 'string'],
  ['property', 'features.viewType', 'string'],
  ['property', 'subdivision', 'string'],
  ['property', 'features.foundationType', 'string'],
  ['property', 'features.floorCount', 'number'],
  ['property', 'hoa.fee', 'number'],
  ['property', 'addressLine2', 'string'],
  ['property', 'propertyType', 'string'],
  ['listing', 'listingType', 'string'],
  ['listing', 'status', 'string'],
  ['listing', 'listedDate', 'date'],
  ['listing', 'removedDate', 'date'],
  ['listing', 'lastSeenDate', 'date'],
  ['listing', 'daysOnMarket', 'number'],
  ['listing', 'history', 'object'],
  ['listing', 'hoa.fee', 'number'],
  ['listing', 'price', 'number'],
]);

const get = (object, path) => path.split('.').reduce((value, key) => (value && typeof value === 'object' && key in value ? value[key] : undefined), object);
const has = (object, path) => {
  const keys = path.split('.');
  const parent = keys.slice(0, -1).reduce((value, key) => (value && typeof value === 'object' ? value[key] : undefined), object);
  return !!parent && typeof parent === 'object' && keys[keys.length - 1] in parent;
};

/** missing | null | false | empty | malformed | a short description of the value */
export function classify(record, path, type) {
  if (!record) return 'no record';
  if (!has(record, path)) return 'missing';
  const value = get(record, path);
  if (value === null) return 'null';
  if (value === false) return 'false';
  if (value === '') return 'empty';
  const ok = type === 'date' ? typeof value === 'string' && !Number.isNaN(new Date(value).getTime())
    : type === 'object' ? typeof value === 'object' && !Array.isArray(value)
      : typeof value === type;
  if (!ok) return `malformed (${Array.isArray(value) ? 'array' : typeof value})`;
  if (type === 'boolean') return 'true';
  if (type === 'object') return `${Object.keys(value).length} entr${Object.keys(value).length === 1 ? 'y' : 'ies'}`;
  if (type === 'string') return JSON.stringify(value.length > 40 ? `${value.slice(0, 40)}…` : value);
  return type === 'date' ? 'date' : String(value);
}

export function loadFixtures(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')));
}

const first = (part) => (Array.isArray(part?.body) ? part.body[0] : part?.body) || null;

export function coverageRows(fixtures) {
  return FIELDS.map(([source, path, type]) => ({
    source, path, type,
    cells: fixtures.map((fx) => classify(first(fx[source]), path, type)),
  }));
}

/** Distinct string values of every enum-like field, across both sources. */
export function enumValues(fixtures) {
  const out = {};
  const walk = (value, path) => {
    if (Array.isArray(value)) { value.forEach((item) => walk(item, path)); return; }
    if (value && typeof value === 'object') {
      Object.entries(value).forEach(([key, child]) => walk(child, /^\d{4}(?:-\d{2}-\d{2})?$/.test(key) ? `${path}.<key>` : `${path}.${key}`));
      return;
    }
    if (typeof value === 'string' && /(?:Type|status|event)$/.test(path)) (out[path] ||= new Set()).add(value);
  };
  fixtures.forEach((fx) => ['property', 'listing'].forEach((source) => walk(first(fx[source]), source)));
  return Object.fromEntries(Object.entries(out).sort().map(([k, v]) => [k, [...v].sort()]));
}

export function matrixMarkdown(fixtures) {
  const rows = coverageRows(fixtures);
  const head = `| Source | Field | ${fixtures.map((fx) => fx.fixture).join(' | ')} |\n|---|---|${fixtures.map(() => '---').join('|')}|`;
  const body = rows.map((r) => `| ${r.source} | \`${r.path}\` | ${r.cells.join(' | ')} |`).join('\n');
  const enums = Object.entries(enumValues(fixtures)).map(([path, values]) => `| \`${path}\` | ${values.map((v) => `\`${v}\``).join(', ')} |`).join('\n');
  return `${head}\n${body}\n\n| Enum field | Values seen |\n|---|---|\n${enums}\n`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const fixtures = loadFixtures(resolve(new URL('../../../test/fixtures/rentcast', import.meta.url).pathname));
  if (!fixtures.length) { console.error('coverage: no fixtures in test/fixtures/rentcast'); process.exit(1); }
  process.stdout.write(matrixMarkdown(fixtures));
}
