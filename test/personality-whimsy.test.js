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

test('decision empty states keep personality and required actions', () => {
  const board = read('src/components/HomesBoard.jsx');
  const compare = read('src/components/CompareBoard.jsx');
  for (const copy of ["No favorites... yet.", "You'll know one when you see one.", 'Nothing calling your name yet.', 'Homes you want to see in person will show up here.', "The ones that weren't meant to be.", "They're still here if you change your mind."]) assert.match(board, new RegExp(copy.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(board, /View my homes/);
  assert.match(compare, /The showdown starts here\./);
  assert.match(compare, /Pick 2–4 homes and see how they stack up\./);
  assert.match(compare, /Add a home/);
});

test('post-tour framing changes copy without changing the rating key or persistence path', () => {
  const modal = read('src/components/PostTourModal.jsx');
  const editor = read('src/components/HomeModal.jsx');
  assert.match(modal, /Forget the checklist for a second\./);
  assert.match(modal, /How did this home feel\?/);
  assert.match(modal, /setRating\(TOUR_RATING_KEY, v\)/);
  assert.match(editor, /hasToured\(form\)[\s\S]*Forget the checklist for a second\./);
});

test('Different Takes stays deferred from the card surface', () => {
  assert.doesNotMatch(read('src/lib/flhMoments.js'), /different-takes|Different takes/);
});
