#!/usr/bin/env node
// Add Home V3, phase 5: turn raw RentCast captures (.rentcast-capture/raw, git-
// ignored) into sanitized fixtures (test/fixtures/rentcast). See
// docs/add-home-v3-real-response-validation.md §4.
//
// Allowlist-first: a string is kept verbatim only when its key is a known enum /
// type field. Every other string is replaced, and its key is reported so the
// analysis knows it exists. Structure, key presence, null, booleans and number
// types are always kept. A fixture is written only if the leak check finds none
// of the raw identifying values in it.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomInt } from 'node:crypto';

// Kept verbatim: enums and descriptive types, the values this capture is for.
const KEEP_STRING = new Set([
  'propertyType', 'status', 'listingType', 'event', 'state', 'zoning',
  'fireplaceType', 'poolType', 'viewType', 'foundationType', 'architectureType', 'exteriorType', 'roofType',
  'heatingType', 'coolingType', 'garageType', 'floorType', 'roomType', 'unitType', 'ownerType', 'type',
]);
// Whole subtrees about people or businesses: keys kept, every string replaced.
const PEOPLE = new Set(['owner', 'listingAgent', 'listingOffice', 'builder']);
// Identifiers replaced by fixture values.
const ID_KEYS = new Set(['id', 'assessorID', 'mlsNumber', 'legalDescription', 'countyFips', 'stateFips']);
const ADDRESS_KEYS = new Set(['formattedAddress', 'addressLine1', 'addressLine2', 'city', 'zipCode', 'county']);
// Money: rounded so a fixture can't be matched to a public record by exact price.
const MONEY_KEYS = new Set(['price', 'lastSalePrice', 'value', 'land', 'improvements', 'total']);
const AREA_KEYS = new Set(['squareFootage', 'lotSize']);

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
const DIRECTION = /^(?:n|s|e|w|ne|nw|se|sw|north|south|east|west)$/i;

function shiftDate(value, days) {
  const date = new Date(DATE_ONLY.test(value) ? `${value}T00:00:00.000Z` : value);
  date.setUTCDate(date.getUTCDate() + days);
  return DATE_ONLY.test(value) ? date.toISOString().slice(0, 10) : date.toISOString().replace(/\.\d{3}Z$/, value.includes('.') ? '.000Z' : 'Z');
}

function roundMoney(n) {
  if (!Number.isFinite(n) || n === 0) return n;
  return n >= 10000 ? Math.round(n / 1000) * 1000 : Math.round(n / 10) * 10;
}

function maskLike(value, seed) {
  // Same length and character classes, different characters.
  let i = 0;
  return String(value).replace(/[0-9]/g, () => String((seed + i++) % 10)).replace(/[A-Za-z]/g, (c) => (c === c.toUpperCase() ? 'X' : 'x'));
}

/** A synthetic street line that keeps the house-number form, direction, suffix and unit form. */
export function syntheticLine1(line1, index) {
  if (typeof line1 !== 'string') return line1;
  const tokens = line1.trim().split(/\s+/);
  const unitAt = tokens.findIndex((token, i) => i > 0 && /^(?:apt|unit|ste|suite|#.*)$/i.test(token));
  const street = unitAt > 0 ? tokens.slice(0, unitAt) : tokens;
  const unit = unitAt > 0 ? tokens.slice(unitAt) : [];
  const out = [];
  if (/^\d+[A-Za-z]?$/.test(street[0] || '')) { out.push(`${90000 + index}${/[A-Za-z]$/.test(street[0]) ? 'A' : ''}`); street.shift(); }
  const lead = street.length > 1 && DIRECTION.test(street[0]) ? street.shift() : null;
  const trail = street.length > 1 && DIRECTION.test(street[street.length - 1]) ? street.pop() : null;
  // The street type (Ln, Rd, Avenue …) stays; a one-word name ("Broadway") has none.
  const suffix = street.length > 1 && /^[A-Za-z]{2,10}\.?$/.test(street[street.length - 1]) ? street.pop() : null;
  out.push(...[lead, 'Fixture', suffix, trail].filter(Boolean));
  if (unit.length) out.push(syntheticUnit(unit.join(' ')));
  return out.join(' ');
}

function syntheticUnit(line2) {
  if (typeof line2 !== 'string' || !line2.trim()) return line2;
  const m = line2.trim().match(/^(apt|apartment|unit|ste|suite|#)\s*/i);
  return `${m ? m[0] : ''}101${/[A-Za-z]$/.test(line2.trim()) && /\d[A-Za-z]$/.test(line2.trim()) ? 'A' : ''}`;
}

function addressIdentity(record, index) {
  const caseLike = (sample, text) => (typeof sample === 'string' && sample === sample.toUpperCase() ? text.toUpperCase() : text);
  return {
    addressLine1: syntheticLine1(record.addressLine1, index),
    addressLine2: record.addressLine2 == null ? record.addressLine2 : syntheticUnit(record.addressLine2),
    city: record.city == null ? record.city : caseLike(record.city, 'Fixtureville'),
    zipCode: record.zipCode == null ? record.zipCode : String(index).padStart(5, '0'),
    county: record.county == null ? record.county : caseLike(record.county, 'Fixture'),
  };
}

function syntheticFormatted(record, identity) {
  const original = record.formattedAddress;
  if (typeof original !== 'string') return original;
  let out = original;
  for (const key of ['addressLine1', 'addressLine2', 'city', 'zipCode']) {
    if (typeof record[key] === 'string' && record[key] && typeof identity[key] === 'string') out = out.split(record[key]).join(identity[key]);
  }
  return out;
}

/**
 * Redact one raw response body (array or object). Returns { body, unknownStrings }.
 * `index` gives the synthetic address; `shiftDays` moves every date by the same
 * whole number of weeks, so intervals and daysOnMarket stay consistent.
 */
export function redactBody(body, { index, shiftDays, kind }) {
  const unknownStrings = new Set();
  let idSeed = index * 7;
  const walk = (value, key, path, inPeople) => {
    if (value === null || typeof value === 'boolean') return value;
    if (Array.isArray(value)) return value.map((item) => walk(item, key, `${path}[]`, inPeople));
    if (typeof value === 'number') {
      if (key === 'latitude' || key === 'longitude') return Math.round(value * 100) / 100;
      if (MONEY_KEYS.has(key)) return roundMoney(value);
      if (AREA_KEYS.has(key)) return Math.round(value / 10) * 10;
      if (inPeople) return 0;
      return value;
    }
    if (typeof value === 'string') {
      if (inPeople) return '[redacted]';
      if (ISO_DATE.test(value) || DATE_ONLY.test(value)) return shiftDate(value, shiftDays);
      if (ID_KEYS.has(key)) return key === 'id' ? `fixture-${index}-${kind}` : maskLike(value, idSeed++);
      if (key === 'mlsName') return 'FixtureMLS';
      if (key === 'subdivision') return value === value.toUpperCase() ? 'FIXTURE SUBDIVISION' : 'Fixture Subdivision';
      if (KEEP_STRING.has(key)) return value;
      unknownStrings.add(path);
      return '[redacted]';
    }
    if (typeof value === 'object') {
      const record = value;
      const identity = 'formattedAddress' in record || 'addressLine1' in record ? addressIdentity(record, index) : null;
      const out = {};
      for (const [childKey, child] of Object.entries(record)) {
        // Date-keyed objects (history, taxes keyed by year stay as years).
        const outKey = DATE_ONLY.test(childKey) ? shiftDate(childKey, shiftDays) : childKey;
        const childPath = `${path ? `${path}.` : ''}${DATE_ONLY.test(childKey) ? '<date>' : /^\d{4}$/.test(childKey) ? '<year>' : childKey}`;
        if (identity && ADDRESS_KEYS.has(childKey) && !inPeople) {
          out[outKey] = childKey === 'formattedAddress' ? syntheticFormatted(record, identity) : identity[childKey];
        } else {
          out[outKey] = walk(child, childKey, childPath, inPeople || PEOPLE.has(childKey));
        }
      }
      return out;
    }
    return value;
  };
  return { body: walk(body, '', '', false), unknownStrings: [...unknownStrings].sort() };
}

/** Raw values that must never appear in a fixture. */
export function sensitiveValues(body) {
  const values = new Set();
  const walk = (value, key, inPeople) => {
    if (Array.isArray(value)) { value.forEach((item) => walk(item, key, inPeople)); return; }
    if (value && typeof value === 'object') { Object.entries(value).forEach(([k, v]) => walk(v, k, inPeople || PEOPLE.has(k))); return; }
    if (typeof value === 'string' && value.trim().length >= 3 && !KEEP_STRING.has(key)
      && (inPeople || ID_KEYS.has(key) || ADDRESS_KEYS.has(key) || key === 'subdivision' || key === 'mlsName')) {
      values.add(value.trim());
      if (key === 'addressLine1') value.split(/\s+/).filter((t) => t.length >= 4 && !/^\d+$/.test(t) && !/^(?:street|avenue|drive|road|lane|court|place|north|south|east|west)$/i.test(t)).forEach((t) => values.add(t));
    }
    if (typeof value === 'number' && (key === 'latitude' || key === 'longitude') && !Number.isInteger(value * 100)) values.add(String(value));
  };
  walk(body, '', false);
  return [...values];
}

/** Every problem found in a redacted fixture; an empty list means it may be committed. */
export function leakCheck(redacted, rawBodies) {
  const text = JSON.stringify(redacted);
  const lower = text.toLowerCase();
  const problems = [];
  rawBodies.flatMap(sensitiveValues).forEach((value) => {
    if (lower.includes(value.toLowerCase())) problems.push(`raw value still present: ${value.length} chars at ${lower.indexOf(value.toLowerCase())}`);
  });
  if (/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(text)) problems.push('an email address');
  if (/\(?\b\d{3}\)?[-. ]\d{3}[-. ]\d{4}\b/.test(text)) problems.push('a phone number');
  if (/"(?:latitude|longitude)":-?\d+\.\d{3,}/.test(text)) problems.push('coordinates with more than 2 decimals');
  if (/https?:\/\//i.test(text)) problems.push('a URL');
  if (/api[-_]?key/i.test(text)) problems.push('an API-key field');
  return problems;
}

// CLI: node scripts/ops/rentcast-capture/redact.mjs
if (import.meta.url === `file://${process.argv[1]}`) {
  const ROOT = resolve(new URL('../../..', import.meta.url).pathname);
  const RAW = join(ROOT, '.rentcast-capture', 'raw');
  const OUT = join(ROOT, 'test', 'fixtures', 'rentcast');
  const targets = JSON.parse(readFileSync(join(ROOT, '.rentcast-capture', 'targets.json'), 'utf8'));
  if (!existsSync(RAW)) { console.error('redact: no raw captures'); process.exit(1); }
  const files = readdirSync(RAW).filter((f) => f.endsWith('.json'));
  mkdirSync(OUT, { recursive: true });
  let failed = false;
  targets.forEach((target, i) => {
    const index = i + 1;
    const shiftDays = 7 * randomInt(8, 40) * (randomInt(0, 2) ? 1 : -1); // never recorded
    const parts = {};
    const raws = [];
    for (const kind of ['property', 'listing']) {
      const file = files.find((f) => f === `${target.id}.${kind}.json`);
      if (!file) continue;
      const raw = JSON.parse(readFileSync(join(RAW, file), 'utf8'));
      raws.push(raw.body);
      const { body, unknownStrings } = redactBody(raw.body, { index, shiftDays, kind });
      parts[kind] = { endpoint: raw.path, httpStatus: raw.httpStatus, headers: raw.headers, unknownStrings, body };
    }
    if (!Object.keys(parts).length) return;
    const synthetic = parts.property?.body?.[0]?.formattedAddress || parts.listing?.body?.[0]?.formattedAddress || null;
    const fixture = {
      fixture: target.id, mode: target.mode, requestedAddress: synthetic,
      note: 'Sanitized real RentCast response (phase 5). Address, ids, names, contacts replaced; coordinates 2 dp; money and areas rounded; dates shifted by a constant whole number of weeks. Keys, nesting, nulls, booleans and enum strings as returned.',
      ...parts,
    };
    const problems = leakCheck(fixture, raws);
    if (problems.length) { failed = true; console.error(`redact: ${target.id} NOT written:`); problems.forEach((p) => console.error(`  - ${p}`)); return; }
    writeFileSync(join(OUT, `${target.id}.json`), `${JSON.stringify(fixture, null, 2)}\n`);
    console.log(`redact: ${target.id} → test/fixtures/rentcast/${target.id}.json (${(parts.property?.unknownStrings.length || 0) + (parts.listing?.unknownStrings.length || 0)} unknown string fields masked)`);
  });
  process.exit(failed ? 1 : 0);
}
