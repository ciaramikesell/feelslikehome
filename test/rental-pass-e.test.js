import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { formatDateOnly, formatHomePrice, formatPropertyType, formatTriState, homePriceLabel, preferencePriceLabel } from '../src/lib/homeDisplay.js';

test('listing price formatting and labels distinguish Rental from Purchase and Investment', () => {
  for (const intent of ['rental', 'rent_home', 'rent_apartment']) {
    assert.equal(formatHomePrice('2150', intent), '$2,150/mo');
    assert.equal(homePriceLabel(intent), 'Monthly Rent');
    assert.equal(preferencePriceLabel(intent), 'Maximum Monthly Price');
  }
  assert.equal(formatHomePrice('2150', 'purchase'), '$2,150');
  assert.equal(formatHomePrice('2150', 'investment'), '$2,150');
  assert.equal(formatHomePrice(null, 'rental'), '');
  assert.equal(homePriceLabel('purchase'), 'Price');
  assert.equal(preferencePriceLabel('purchase'), 'Maximum Budget');
});

test('Rental shared facts use readable, calm, date-only presentation', () => {
  assert.equal(formatPropertyType('apartment'), 'Apartment');
  assert.equal(formatPropertyType('townhome'), 'Townhome');
  assert.equal(formatPropertyType(null), 'Unknown');
  assert.equal(formatDateOnly('2026-10-01'), 'October 1, 2026');
  assert.equal(formatDateOnly(''), 'Unknown');
  assert.equal(formatTriState(true), 'Yes');
  assert.equal(formatTriState(false), 'No');
  assert.equal(formatTriState(null), 'Unknown');
});

test('Rental surfaces use centralized prices and suppress purchase financial rows', async () => {
  const [cards, detail, compare, map, modal] = await Promise.all([
    readFile(new URL('../src/components/HomesBoard.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/HomeDetail.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/CompareBoard.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/SavedHomesMap.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/HomeModal.jsx', import.meta.url), 'utf8'),
  ]);
  assert.match(cards, /formatHomePrice\(home\.price, priorities\.searchType\)/);
  assert.match(cards, /showsPurchaseFinancials && home\.estMonthly/);
  assert.match(detail, /formatHomePrice\(home\.price, priorities\.searchType\)/);
  assert.match(detail, /!showsRentalFacts \? \[/);
  const rentalRows = compare.match(/if \(showsRentalFacts\) return \[price[\s\S]*?\n  \];/)?.[0] || '';
  assert.ok(rentalRows);
  assert.doesNotMatch(rentalRows, /estMonthly|pps|hoa|tax/);
  assert.match(map, /formatHomePrice\(selected\.price, priorities\.searchType\)/);
  assert.match(modal, /!showsRentalFacts && <CompactField label="Est\. monthly pmt"/);
});

test('cross-intent helper copy is neutral', async () => {
  const sources = await Promise.all(['CoBuyerHomesLine.jsx', 'AppShell.jsx', 'onboarding/Onboarding.jsx', 'ArchiveConfirmModal.jsx']
    .map((file) => readFile(new URL(`../src/components/${file}`, import.meta.url), 'utf8')));
  const joined = sources.join('\n');
  assert.doesNotMatch(joined, /Buying together\?|taxes too high/i);
  assert.match(joined, /Searching together\?/);
  assert.match(joined, /Zillow, Realtor, Homes\.com, builder websites, rental sites/);
});
