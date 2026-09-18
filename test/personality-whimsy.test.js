import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deriveFlhMoment } from '../src/lib/flhMoments.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const home = (patch = {}) => ({ status: 'Saved', touredAt: null, isFavorite: false, ...patch });

test('FLH Moments use only sanitized collaboration booleans and require a shared search', () => {
  assert.equal(deriveFlhMoment(home({ isFavorite: true, coBuyerFavorited: true }), false), null);
  assert.equal(deriveFlhMoment(home({ isCollaborative: true, isFavorite: true, coBuyerFavorited: false })), null);
  assert.equal(deriveFlhMoment(home({ isCollaborative: true, isFavorite: true, coBuyerFavorited: true })).kind, 'mutual-favorite');
  assert.deepEqual(Object.keys(home({ coBuyerFavorited: true, coBuyerWantsToTour: true })).sort(), ['coBuyerFavorited', 'coBuyerWantsToTour', 'isFavorite', 'status', 'touredAt']);
});

test('FLH Moment priority produces exactly one strongest applicable observation', () => {
  const shared = { isCollaborative: true, status: 'Want to Tour', touredAt: null, coBuyerWantsToTour: true };
  assert.equal(deriveFlhMoment(home(shared)).kind, 'both-want-to-tour');
  const strongest = deriveFlhMoment(home({ ...shared, isFavorite: true, coBuyerFavorited: true }));
  assert.deepEqual(strongest, { kind: 'strong-shared-signal', label: "This one's standing out", hasEyes: true });
  assert.equal(Array.isArray(strongest), false);
  assert.equal(deriveFlhMoment(home({ ...shared, isFavorite: true, coBuyerFavorited: true, touredAt: 'already-toured' })).kind, 'mutual-favorite');
});

test('card placement and Favorite animation remain restrained and accessible', () => {
  const board = read('src/components/HomesBoard.jsx');
  const css = read('src/app/globals.css');
  assert.match(board, /className="hh-flh-moment"/);
  assert.match(board, /className=\{favoritePop \? 'hh-favorite-pop' : undefined\}/);
  assert.match(board, /if \(!isFavorite\)/);
  assert.match(css, /\.hh-flh-moment \{ position: absolute; right: 10px; bottom: 10px;/);
  assert.match(css, /animation: hh-favorite-pop 200ms ease-out/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{ \.hh-favorite-pop \{ animation: none; \} \}/);
});

test('decision empty states use PR #90\'s truthful collections copy and a My Homes path — never a discovery CTA', () => {
  // Superseded by PR #90 (Want to Tour / Favorites / Archive visual refresh):
  // this app is a decision layer, not a listing marketplace, so the old
  // playful copy is replaced with the spec's plainer, more truthful text,
  // and "View my homes" becomes "Go to My Homes" on every collection empty
  // state rather than only Want to Tour's.
  const board = read('src/components/HomesBoard.jsx');
  const compare = read('src/components/CompareBoard.jsx');
  for (const copy of [
    'No favorites yet.', 'Tap the heart on any home you want to keep close.',
    'Nothing on the tour list yet.', 'When a home feels worth seeing in person, mark it Want to Tour.',
    'Nothing archived.', 'Homes you set aside will stay here with your notes and history intact.',
  ]) assert.match(board, new RegExp(copy.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(board, /Browse homes|Discover homes|Find listings|Recommended homes/i);
  const goToMyHomes = board.match(/Go to My Homes/g) || [];
  assert.equal(goToMyHomes.length, 2, 'expected the Go to My Homes CTA on both the Favorites and Want to Tour empty states');
  assert.match(compare, /The showdown starts here\./);
  assert.match(compare, /Pick 2–4 homes and see how they stack up\./);
  assert.match(compare, /Add a home/);
});

test('post-tour framing uses reaction-first V2 without stars', () => {
  const modal = read('src/components/PostTourModal.jsx');
  assert.match(modal, /Where are you at with this home/);
  assert.doesNotMatch(modal, /StarInput|TOUR_RATING_KEY/);
});

test('Different Takes stays deferred from the card surface', () => {
  assert.doesNotMatch(read('src/lib/flhMoments.js'), /different-takes|Different takes/);
});
