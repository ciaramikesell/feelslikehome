// Add Home V3, phase 5: real RentCast response validation
// (docs/add-home-v3-real-response-validation.md).
//
// Part 1 tests the capture tooling with no network: the 10-request budget, the
// pre-flight gate, stop-on-error with no retry, and redaction plus leak checks.
// Part 2 runs every sanitized live fixture in test/fixtures/rentcast through the
// existing phase 3 normalization. Until the founder runs the capture there are
// none, and those tests skip with that reason.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

register('./support/aliasHooks.mjs', import.meta.url);
const budget = await import('../scripts/ops/rentcast-capture/budget.mjs');
const { redactBody, leakCheck, syntheticLine1 } = await import('../scripts/ops/rentcast-capture/redact.mjs');
const { classify, coverageRows, enumValues, loadFixtures, matrixMarkdown } = await import('../scripts/ops/rentcast-capture/coverage.mjs');
const { normalizeRentCastFields, rentCastAddressMatch, propertyAddressKey, rentCastListingType } = await import('../src/lib/rentcast.js');
const { listingImportSnapshot } = await import('../src/lib/importSnapshot.js');
const { countyRecordContext, listingSnapshotLines } = await import('../src/lib/listingContext.js');

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const NOW = new Date('2026-11-13T12:00:00Z');
const target = (id, mode = 'sale') => ({ id, mode, address: `${id} placeholder` });
const FIVE = ['a', 'b', 'c', 'd', 'e'].map((id, i) => target(id, i === 4 ? 'rental' : 'sale'));
const goodPreflight = {
  apiKeyPresent: true, plan: 'developer', allowanceRemaining: 40,
  allowanceSource: 'RentCast dashboard, API usage', allowanceCheckedAt: '2026-11-13T11:30:00Z',
  overageConfirmed: true, planned: 10, alreadyUsed: 0, now: NOW,
};

/* --------------------------------- budget ---------------------------------- */

test('budget: five properties are exactly ten requests, the same two endpoints FLH uses', () => {
  const planned = budget.plannedRequests(FIVE);
  assert.equal(planned.length, budget.MAX_TOTAL_REQUESTS);
  assert.deepEqual(planned.slice(0, 2).map((r) => r.path), ['/v1/properties', '/v1/listings/sale']);
  assert.equal(planned[9].path, '/v1/listings/rental/long-term');
  // rentcastLookup.js uses the same paths.
  for (const path of Object.values(budget.ENDPOINTS)) assert.ok(read('src/lib/rentcastLookup.js').includes(`'${path}'`), path);
});

test('budget: targets are validated; a sixth property is refused', () => {
  assert.deepEqual(budget.validateTargets(FIVE), []);
  assert.ok(budget.validateTargets([...FIVE, target('f')]).some((p) => p.includes('at most 5')));
  assert.ok(budget.validateTargets([target('a'), target('a')]).some((p) => p.includes('duplicate')));
  assert.ok(budget.validateTargets([{ id: 'Bad Id', mode: 'lease', address: '' }]).length >= 3);
  assert.ok(budget.validateTargets([]).length);
  const example = JSON.parse(read('scripts/ops/rentcast-capture/targets.example.json'));
  assert.equal(budget.validateTargets(example).filter((p) => p.includes('placeholder')).length, 5);
});

test('pre-flight: quota is never assumed; every check must pass before a live request', () => {
  assert.deepEqual(budget.checkPreflight(goodPreflight), { ok: true, problems: [] });
  const none = budget.checkPreflight({ planned: 10, now: NOW });
  assert.equal(none.ok, false);
  for (const needle of ['RENTCAST_API_KEY', '--plan=developer', '--allowance-remaining', '--allowance-source', '--allowance-checked-at', '--no-overage-confirmed']) {
    assert.ok(none.problems.some((p) => p.includes(needle)), needle);
  }
  const cases = [
    [{ allowanceRemaining: 9 }, 'allowance: 9 remaining'],
    [{ alreadyUsed: 4 }, 'exceeds 10'],
    [{ plan: 'foundation' }, 'free Developer plan only'],
    [{ allowanceCheckedAt: '2026-11-13T09:00:00Z' }, 'within the last hour'],
    [{ overageConfirmed: 'yes' }, '--no-overage-confirmed'],
    [{ apiKeyPresent: false }, 'RENTCAST_API_KEY'],
  ];
  for (const [change, needle] of cases) {
    const result = budget.checkPreflight({ ...goodPreflight, ...change });
    assert.equal(result.ok, false, needle);
    assert.ok(result.problems.some((p) => p.includes(needle)), `${needle}: ${result.problems}`);
  }
  // A resumed run only needs allowance for what is left to send.
  assert.equal(budget.checkPreflight({ ...goodPreflight, alreadyUsed: 6, planned: 4, allowanceRemaining: 4 }).ok, true);
});

test('ledger: the eleventh request is refused, and a stopped capture sends nothing more', () => {
  const ledger = budget.emptyLedger();
  for (let i = 0; i < 10; i += 1) budget.reserveRequest(ledger, { targetId: 't', kind: String(i) }, NOW);
  assert.equal(ledger.requests.length, 10);
  assert.throws(() => budget.reserveRequest(ledger, { targetId: 't', kind: 'x' }), /budget exhausted/);
  const stopped = { ...budget.emptyLedger(), stopped: 'auth' };
  assert.throws(() => budget.reserveRequest(stopped, { targetId: 't', kind: 'property' }), /stopped/);
});

test('responses: only 200 and 404 continue; auth, billing, quota, refusal, outage and timeout stop with no retry', () => {
  assert.deepEqual(budget.classifyResponse(200), { outcome: 'ok', stop: null });
  assert.deepEqual(budget.classifyResponse(404), { outcome: 'empty', stop: null });
  const stops = { 401: 'auth', 403: 'auth', 402: 'billing', 429: 'quota_or_rate_limit', 400: 'invalid_address', 500: 'unexpected_status', 503: 'unexpected_status', timeout: 'timeout', network: 'network' };
  for (const [status, reason] of Object.entries(stops)) {
    assert.equal(budget.classifyResponse(/^\d+$/.test(status) ? Number(status) : status).stop, reason, status);
  }
});

test('evidence headers: rate-limit and usage headers kept; cookies and anything key-like never', () => {
  const kept = budget.evidenceHeaders(new Headers({
    'content-type': 'application/json', 'x-ratelimit-remaining': '19', 'set-cookie': 'a=b', 'x-api-key': 'secret', 'x-request-id': 'abc', 'retry-after': '5',
  }));
  assert.deepEqual(Object.keys(kept).sort(), ['content-type', 'retry-after', 'x-ratelimit-remaining']);
});

test('capture script: key, URLs and addresses are never printed; raw output only in the git-ignored folder; no retry', () => {
  const source = read('scripts/ops/rentcast-capture/capture.mjs');
  const printing = source.split('\n').filter((line) => /console\.(?:log|error|warn)|fail\(/.test(line));
  for (const line of printing) assert.doesNotMatch(line, /apiKey|RENTCAST_API_KEY\b(?!.*not set)|target\.address|\$\{BASE\}|request\.path/, line);
  assert.match(source, /\.rentcast-capture\/ is not in \.gitignore/);
  assert.match(source, /reserveRequest\(ledger, request\);\n\s*save\(\); \/\/ counted before it is sent/);
  assert.doesNotMatch(source, /\bretry\s*\(|for \(let attempt|while \(/i);
  assert.match(read('.gitignore'), /^\/\.rentcast-capture\/$/m);
});

test('CI and deployment never run the capture: no npm script, workflow, build hook or app import; the script refuses there', () => {
  const pkg = JSON.parse(read('package.json'));
  for (const [name, command] of Object.entries(pkg.scripts || {})) assert.doesNotMatch(command, /rentcast-capture/, name);
  const files = execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split('\n').filter(Boolean);
  const outside = files.filter((f) => !f.startsWith('scripts/ops/rentcast-capture/') && f !== 'test/rentcast-real-fixtures.test.js'
    && f !== 'docs/add-home-v3-real-response-validation.md' && f !== '.gitignore' && /\.(?:m?js|jsx|ts|tsx|json|ya?ml|toml|sh)$/.test(f));
  for (const file of outside) assert.doesNotMatch(read(file), /rentcast-capture/, file);
  // The tests import only the pure modules; the capture CLI is read as text, never run.
  assert.doesNotMatch(read('test/rentcast-real-fixtures.test.js'), /import\([^)]*capture\.mjs/);
  for (const file of ['redact.mjs', 'coverage.mjs']) assert.match(read(`scripts/ops/rentcast-capture/${file}`), /if \(import\.meta\.url === `file:\/\/\$\{process\.argv\[1\]\}`\)/, file);
  const out = (() => {
    try { execFileSync(process.execPath, ['scripts/ops/rentcast-capture/capture.mjs', '--dry-run'], { encoding: 'utf8', env: { ...process.env, CI: 'true', RENTCAST_API_KEY: '' }, stdio: 'pipe' }); return 'ran'; } catch (err) { return String(err.stderr); }
  })();
  assert.match(out, /refusing to run in CI or a deployment environment/);
});

test('git: nothing under the raw capture folder is tracked', () => {
  const tracked = execFileSync('git', ['ls-files', '.rentcast-capture', 'scripts/ops/rentcast-capture/targets.json'], { encoding: 'utf8' });
  assert.equal(tracked.trim(), '');
});

/* -------------------------------- redaction -------------------------------- */
// An INVENTED record with the kinds of identifying data a real response can
// carry (owner, agent, office, ids, precise coordinates). Not a real property.
const RAW_PROPERTY = [{
  id: '4821-Maplecrest-Ln,-Plainsburg,-OH-44000', formattedAddress: '4821 N Maplecrest Ln, Unit 4B, Plainsburg, OH 44000',
  addressLine1: '4821 N Maplecrest Ln', addressLine2: 'Unit 4B', city: 'Plainsburg', state: 'OH', zipCode: '44000', county: 'Hollister',
  latitude: 41.123456, longitude: -81.654321, propertyType: 'Condo', bedrooms: 2, bathrooms: 1.5, squareFootage: 1187, lotSize: 4357,
  yearBuilt: 1961, assessorID: '12-345-678', legalDescription: 'LOT 7 MAPLECREST CONDO PH 2', subdivision: 'MAPLECREST CONDOS', zoning: 'R3',
  lastSaleDate: '2019-06-14T00:00:00.000Z', lastSalePrice: 187350,
  hoa: { fee: 315 },
  features: { fireplace: true, fireplaceType: 'Gas Log', pool: false, poolType: null, floorCount: 1, foundationType: 'Slab', viewType: null, unitCount: 1 },
  taxAssessments: { 2024: { year: 2024, value: 142300, land: 21000, improvements: 121300 } },
  propertyTaxes: { 2024: { year: 2024, total: 3127 } },
  history: { '2019-06-14': { event: 'Sale', date: '2019-06-14T00:00:00.000Z', price: 187350 } },
  owner: { names: ['Jordan Q Example'], type: 'Individual', mailingAddress: { formattedAddress: '77 Elsewhere Rd, Farcity, OH 44111', addressLine1: '77 Elsewhere Rd' } },
  ownerOccupied: true,
  oddVendorNote: 'call 330-555-0142',
}];
const RAW_LISTING = [{
  id: '4821-Maplecrest-Ln-L', formattedAddress: '4821 N Maplecrest Ln, Unit 4B, Plainsburg, OH 44000',
  addressLine1: '4821 N Maplecrest Ln', addressLine2: 'Unit 4B', city: 'Plainsburg', state: 'OH', zipCode: '44000', county: 'Hollister',
  latitude: 41.123461, longitude: -81.654318, propertyType: 'Condo', status: 'Active', price: 224900, listingType: 'Standard',
  listedDate: '2026-09-02T00:00:00.000Z', removedDate: null, createdDate: '2025-02-10T00:00:00.000Z', lastSeenDate: '2026-11-10T00:00:00.000Z', daysOnMarket: 72,
  mlsName: 'NorthernOhioMLS', mlsNumber: '5061234', hoa: { fee: 315 },
  listingAgent: { name: 'Pat Agent', phone: '3305550199', email: 'pat@example-realty.test', website: 'https://example-realty.test' },
  listingOffice: { name: 'Example Realty', phone: '3305550100', email: 'office@example-realty.test' },
  history: {
    '2026-09-02': { event: 'Sale Listing', price: 224900, listingType: 'Standard', listedDate: '2026-09-02T00:00:00.000Z', removedDate: null, daysOnMarket: 72 },
    '2025-02-10': { event: 'Sale Listing', price: 239900, listingType: 'Standard', listedDate: '2025-02-10T00:00:00.000Z', removedDate: '2025-05-01T00:00:00.000Z', daysOnMarket: 80 },
  },
}];

const shape = (value) => (Array.isArray(value) ? value.map(shape)
  : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([k, v]) => [/^\d{4}-\d{2}-\d{2}$/.test(k) ? '<date>' : k, shape(v)]))
    : value === null ? null : typeof value);

test('redaction: structure, nulls, booleans, number types and enum strings kept; identity replaced', () => {
  const { body } = redactBody(RAW_PROPERTY, { index: 3, shiftDays: 70, kind: 'property' });
  assert.deepEqual(shape(body), shape(RAW_PROPERTY));
  const [p] = body;
  assert.deepEqual(p.features, { fireplace: true, fireplaceType: 'Gas Log', pool: false, poolType: null, floorCount: 1, foundationType: 'Slab', viewType: null, unitCount: 1 });
  assert.equal(p.formattedAddress, '90003 N Fixture Ln, Unit 101A, Fixtureville, OH 00003');
  assert.equal(p.subdivision, 'FIXTURE SUBDIVISION');
  assert.equal(p.id, 'fixture-3-property');
  assert.deepEqual([p.latitude, p.longitude], [41.12, -81.65]);
  assert.deepEqual([p.lastSalePrice, p.squareFootage, p.hoa.fee, p.propertyTaxes['2024'].total], [187000, 1190, 315, 3130]);
  assert.equal(p.owner.names[0], '[redacted]');
  assert.equal(p.owner.mailingAddress.formattedAddress, '[redacted]');
  assert.equal(p.oddVendorNote, '[redacted]');
});

test('redaction: unknown strings are masked and reported; dates move together so intervals hold', () => {
  const { body, unknownStrings } = redactBody(RAW_LISTING, { index: 3, shiftDays: -91, kind: 'listing' });
  assert.deepEqual(unknownStrings, []); // every string here is known
  assert.deepEqual(redactBody(RAW_PROPERTY, { index: 3, shiftDays: 7, kind: 'property' }).unknownStrings, ['[].oddVendorNote']);
  const [l] = body;
  const days = (a, b) => (new Date(b) - new Date(a)) / 86400000;
  assert.equal(days(l.listedDate, l.lastSeenDate), days(RAW_LISTING[0].listedDate, RAW_LISTING[0].lastSeenDate));
  assert.deepEqual(Object.keys(l.history), ['2026-06-03', '2024-11-11']);
  const prior = l.history['2024-11-11'];
  assert.equal(days(prior.listedDate, prior.removedDate), 80);
  assert.equal(prior.daysOnMarket, 80);
  assert.equal(l.daysOnMarket, 72);
  assert.deepEqual([l.status, l.listingType, prior.event, l.removedDate], ['Active', 'Standard', 'Sale Listing', null]);
  assert.deepEqual([l.mlsName, l.mlsNumber.length, /^\d+$/.test(l.mlsNumber), l.mlsNumber === RAW_LISTING[0].mlsNumber], ['FixtureMLS', 7, true, false]);
  assert.deepEqual(Object.values(l.listingAgent), ['[redacted]', '[redacted]', '[redacted]', '[redacted]']);
});

test('redaction: the synthetic address still parses, matches across sources and keeps its unit', () => {
  const [p] = redactBody(RAW_PROPERTY, { index: 2, shiftDays: 0, kind: 'property' }).body;
  const [l] = redactBody(RAW_LISTING, { index: 2, shiftDays: 0, kind: 'listing' }).body;
  assert.equal(rentCastAddressMatch(p.formattedAddress, l.formattedAddress), 'match');
  assert.match(propertyAddressKey(p.formattedAddress), /\|101a\|00002$/);
  assert.equal(syntheticLine1('120 Oak Ridge Rd SW', 1), '90001 Fixture Rd SW');
  assert.equal(syntheticLine1('7 Broadway', 4), '90004 Fixture');
});

test('leak check: clean redaction passes; any raw identity, contact, URL or precise point fails', () => {
  const property = redactBody(RAW_PROPERTY, { index: 1, shiftDays: 14, kind: 'property' }).body;
  const listing = redactBody(RAW_LISTING, { index: 1, shiftDays: 14, kind: 'listing' }).body;
  assert.deepEqual(leakCheck({ property, listing }, [RAW_PROPERTY, RAW_LISTING]), []);
  const leaked = leakCheck({ property: RAW_PROPERTY, listing: RAW_LISTING }, [RAW_PROPERTY, RAW_LISTING]);
  for (const needle of ['raw value still present', 'an email address', 'a phone number', 'coordinates with more than 2 decimals', 'a URL']) {
    assert.ok(leaked.some((p) => p.startsWith(needle)), needle);
  }
  // The leak report never repeats the leaked value itself.
  assert.equal(leaked.some((p) => p.includes('Maplecrest')), false);
});

test('coverage: each field is classified populated, null, false, missing, empty or malformed', () => {
  assert.equal(classify({ features: { fireplace: false } }, 'features.fireplace', 'boolean'), 'false');
  assert.equal(classify({ features: { fireplace: 'Y' } }, 'features.fireplace', 'boolean'), 'malformed (string)');
  assert.equal(classify({ features: {} }, 'features.poolType', 'string'), 'missing');
  assert.equal(classify({ features: { viewType: null } }, 'features.viewType', 'string'), 'null');
  assert.equal(classify({ subdivision: '' }, 'subdivision', 'string'), 'empty');
  assert.equal(classify(null, 'subdivision', 'string'), 'no record');
  const fx = [{ fixture: 'demo', property: { body: redactBody(RAW_PROPERTY, { index: 1, shiftDays: 0, kind: 'property' }).body }, listing: { body: redactBody(RAW_LISTING, { index: 1, shiftDays: 0, kind: 'listing' }).body } }];
  const row = (path) => coverageRows(fx).find((r) => r.path === path).cells[0];
  assert.deepEqual([row('features.fireplaceType'), row('features.pool'), row('history'), row('removedDate')], ['"Gas Log"', 'false', '2 entries', 'null']);
  assert.deepEqual(enumValues(fx)['listing.history.<key>.event'], ['Sale Listing']);
  assert.match(matrixMarkdown(fx), /\| property \| `features.fireplace` \| true \|/);
});

/* ------------------------- sanitized live fixtures ------------------------- */

const FIXTURES = loadFixtures(new URL('./fixtures/rentcast', import.meta.url).pathname);
const NO_FIXTURES = FIXTURES.length ? false : 'no sanitized live RentCast fixtures yet: the phase 5 capture has not been run (see docs/add-home-v3-real-response-validation.md)';
const firstOf = (part) => (Array.isArray(part?.body) ? part.body[0] : part?.body) || null;
const FIELD_KEYS = new Set(['address', 'price', 'beds', 'baths', 'sqft', 'lotSize', 'yearBuilt', 'propertyType', 'garageSpaces', 'heating', 'cooling', 'exterior', 'roof', 'garageType', 'listingId', 'daysOnMarket', 'latitude', 'longitude', 'hoaFeeMonthly', 'propertyTaxAnnual', 'propertyTaxYear']);

test('live fixtures: committed fixtures carry no contact, URL, precise point or raw id', { skip: NO_FIXTURES }, () => {
  for (const fx of FIXTURES) {
    assert.deepEqual(leakCheck(fx, []), [], fx.fixture);
    for (const part of [fx.property, fx.listing].filter(Boolean)) {
      const record = firstOf(part);
      if (record?.id) assert.match(record.id, /^fixture-\d+-(?:property|listing)$/, fx.fixture);
    }
  }
});

test('live fixtures: phase 3 normalization holds on real shapes', { skip: NO_FIXTURES }, () => {
  for (const fx of FIXTURES) {
    const property = firstOf(fx.property);
    const listing = firstOf(fx.listing);
    const result = normalizeRentCastFields(property, listing, { requestedAddress: fx.requestedAddress, listingKind: fx.mode === 'rental' ? 'rental' : 'sale' });
    const label = fx.fixture;
    // The synthetic address must still match both sources, or nothing is tested.
    for (const [source, check] of Object.entries(result.addressCheck)) if (check) assert.notEqual(check, 'mismatch', `${label} ${source}`);
    assert.ok(Object.keys(result.fields).every((key) => FIELD_KEYS.has(key)), `${label}: ${Object.keys(result.fields)}`);
    assert.equal(result.listingFacts.some((item) => item.value === false), false, `${label}: a false became a fact`);
    const facts = Object.fromEntries(result.listingFacts.map((item) => [item.key, item.value]));
    if (property?.features?.fireplace !== true) assert.equal('fireplace' in facts, false, label);
    if (property?.features?.pool !== true) assert.equal('pool' in facts, false, label);
    if (listing && typeof listing.listingType === 'string' && !rentCastListingType(listing.listingType)) {
      assert.equal(result.listing?.listingType, undefined, `${label}: an unknown listingType was reported`);
    }
    for (const period of result.listing?.history || []) {
      assert.match(period.listedDate, /^\d{4}-\d{2}-\d{2}$/);
      if (period.removedDate) assert.ok(period.removedDate >= period.listedDate, label);
    }
    if (listing?.status !== 'Active') assert.equal('price' in result.fields, false, `${label}: inactive price used as asking price`);
    // What the buyer would see renders without throwing.
    const snapshot = listingImportSnapshot({ ...result, searchedAddress: fx.requestedAddress }, '2026-11-13T12:00:00.000Z');
    countyRecordContext(snapshot);
    listingSnapshotLines(snapshot);
  }
});
