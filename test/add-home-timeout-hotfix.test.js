import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fetchWithTimeout } from '../src/lib/fetchWithTimeout.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

/* --------------------------- fetchWithTimeout --------------------------- */

test('fetchWithTimeout aborts a hung request instead of waiting forever', async () => {
  const originalFetch = global.fetch;
  let capturedSignal;
  global.fetch = (url, options) => {
    capturedSignal = options?.signal;
    return new Promise((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    });
  };
  try {
    await assert.rejects(() => fetchWithTimeout('https://example.test', {}, 20), /AbortError|Aborted/);
    assert.ok(capturedSignal instanceof AbortSignal);
  } finally {
    global.fetch = originalFetch;
  }
});

test('fetchWithTimeout passes through a fast, successful response untouched and preserves caller options', async () => {
  const originalFetch = global.fetch;
  global.fetch = async (url, options) => {
    assert.equal(url, 'https://example.test/x');
    assert.equal(options.method, 'POST');
    assert.ok(options.signal instanceof AbortSignal);
    return { ok: true, status: 200 };
  };
  try {
    const res = await fetchWithTimeout('https://example.test/x', { method: 'POST' }, 5000);
    assert.equal(res.ok, true);
  } finally {
    global.fetch = originalFetch;
  }
});

/* ------------------------- external calls are bounded ------------------------- */

test('RentCast and Google Geocoding/Routes calls all go through fetchWithTimeout, not a bare fetch', () => {
  const importListing = read('src/app/api/import-listing/route.js');
  const commute = read('src/app/api/commute/route.js');

  assert.match(importListing, /import \{ fetchWithTimeout \} from '@\/lib\/fetchWithTimeout'/);
  assert.match(importListing, /const res = await fetchWithTimeout\(url,/);
  assert.doesNotMatch(importListing, /await fetch\(url,/);

  assert.match(commute, /import \{ fetchWithTimeout \} from '@\/lib\/fetchWithTimeout'/);
  assert.match(commute, /const response = await fetchWithTimeout\(`\$\{GEOCODING_URL\}/);
  assert.match(commute, /const response = await fetchWithTimeout\(ROUTES_URL,/);
  assert.doesNotMatch(commute, /await fetch\(`\$\{GEOCODING_URL\}/);
  assert.doesNotMatch(commute, /await fetch\(ROUTES_URL,/);
});

/* ------------------------------- error boundary ------------------------------- */

test('a root error.js boundary exists so an uncaught Server Component error (e.g. (app)/layout.js\'s Supabase reads) never reaches Next\'s generic digest page', () => {
  const errorBoundary = read('src/app/error.js');
  assert.match(errorBoundary, /^'use client';/);
  assert.match(errorBoundary, /export default function GlobalError\(\{ error, reset \}\)/);
  assert.match(errorBoundary, /onClick=\{\(\) => reset\(\)\}/);
  assert.match(errorBoundary, /href="\/homes"/);

  // Must never surface infrastructure terminology to the user, whatever the
  // underlying error was — restrict the check to the actual rendered JSX,
  // since surrounding comments (never shown to a user) may reference the
  // real cause for future maintainers.
  const renderedJsx = errorBoundary.match(/return \(([\s\S]*?)\n {2}\);/)?.[1] || '';
  assert.ok(renderedJsx, 'expected to find the returned JSX');
  for (const term of ['Gateway Timeout', '504', 'RentCast', 'Vercel', 'digest', 'Supabase']) {
    assert.doesNotMatch(renderedJsx, new RegExp(term, 'i'));
  }
  // The raw error/digest is only ever logged, never interpolated into the UI.
  assert.doesNotMatch(errorBoundary, /\{error\.(message|digest)\}/);
});

/* ------------------------- partial-save duplicate-on-retry ------------------------- */

test('saveHomePersonalAndShared tags a partial-save failure with the already-persisted home id', () => {
  const collaboration = read('src/lib/supabase/collaboration.js');
  const fn = collaboration.match(/export async function saveHomePersonalAndShared\([\s\S]*?\n\}/)?.[0] || '';
  assert.ok(fn, 'expected to find saveHomePersonalAndShared');
  assert.match(fn, /try \{\s*\n\s*await upsertPersonalState\(supabase, savedHome\.id, userId, personal\);/);
  assert.match(fn, /err\.partialHomeId = savedHome\.id;/);
  assert.match(fn, /throw err;/);
});

test('a retry after a partial-save failure adopts the recovered id instead of inserting a duplicate home', () => {
  const homesBoard = read('src/components/HomesBoard.jsx');
  const homeModal = read('src/components/HomeModal.jsx');

  // HomesBoard's own retry closure (used by optimistic/non-modal saves).
  assert.match(homesBoard, /const recoveredHome = err\?\.partialHomeId && !home\.id \? \{ \.\.\.home, id: err\.partialHomeId \} : home;/);
  assert.match(homesBoard, /setRetrySave\(\(\) => \(\) => saveHome\(recoveredHome, \{ shared, optimistic \}\)\);/);

  // HomeModal's Add Home surface: clicking Save again on the same still-open
  // modal must reuse the id rather than resubmitting with none.
  assert.match(homeModal, /if \(saveErr\?\.partialHomeId && !form\.id\) set\('id', saveErr\.partialHomeId\);/);
});

/* --------------------------- no infrastructure leakage --------------------------- */

test('HomeModal no longer echoes the raw Supabase error message/code into the user-facing save error', () => {
  const homeModal = read('src/components/HomeModal.jsx');
  assert.doesNotMatch(homeModal, /saveErr\?\.message/);
  assert.doesNotMatch(homeModal, /saveErr\?\.code/);
  assert.doesNotMatch(homeModal, /TEMPORARY DIAGNOSTIC/);
  assert.match(homeModal, /We couldn't save this home\. Please try again — your changes here haven't been lost\./);
});
