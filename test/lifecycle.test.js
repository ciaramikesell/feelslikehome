import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  applyPostTourVerdict, archiveHome, hasOutstandingWantToTour, hasToured,
  restoreHome, toggleFavorite,
} from '../src/lib/lifecycle.js';

const base = () => ({
  status: 'Saved', touredAt: null, isFavorite: false, reaction: null,
  rejectionReason: '', ratings: { 'tour:overall': 4 }, checks: { light: true },
});

test('Favorite is independent before and after a tour', () => {
  const before = { ...base(), reaction: 'considering' };
  const favorite = toggleFavorite(before);
  assert.equal(favorite.isFavorite, true);
  assert.equal(favorite.reaction, 'considering');
  const loved = applyPostTourVerdict(favorite, 'love', {}, '2026-09-09T12:00:00.000Z');
  const unfavorite = toggleFavorite(loved);
  assert.equal(unfavorite.isFavorite, false);
  assert.equal(unfavorite.reaction, 'love');
  assert.equal(unfavorite.touredAt, loved.touredAt);
});

test('Love It records a tour, saves, and favorites', () => {
  const result = applyPostTourVerdict({ ...base(), status: 'Want to Tour' }, 'love', {}, '2026-09-09T12:00:00.000Z');
  assert.deepEqual([result.status, result.reaction, result.isFavorite, result.touredAt], ['Saved', 'love', true, '2026-09-09T12:00:00.000Z']);
});

test('Still Considering records a tour and preserves Favorite', () => {
  const result = applyPostTourVerdict({ ...base(), isFavorite: true, reaction: 'love' }, 'considering', {}, 'now');
  assert.deepEqual([result.status, result.reaction, result.isFavorite, result.touredAt], ['Saved', 'considering', true, 'now']);
});

test('Not for Me stays active until archive confirmation and preserves evaluation', () => {
  const draft = applyPostTourVerdict({ ...base(), isFavorite: true }, 'not_for_me', { notes: 'Quiet', ratings: { 'tour:overall': 2 } }, 'now');
  assert.equal(draft.status, 'Saved');
  assert.equal(draft.reaction, 'not_for_me');
  const confirmed = archiveHome(draft, 'Too far');
  assert.equal(confirmed.status, 'Archived');
  assert.equal(confirmed.touredAt, 'now');
  assert.equal(confirmed.isFavorite, true);
  assert.deepEqual(confirmed.ratings, { 'tour:overall': 2 });
  assert.equal(confirmed.notes, 'Quiet');
});

test('Archive and restore preserve durable lifecycle and never infer touring from ratings', () => {
  const original = { ...base(), touredAt: 'then', reaction: 'love', isFavorite: true };
  const archived = archiveHome(original, 'reason');
  const restored = restoreHome(archived);
  assert.deepEqual(restored, { ...original, status: 'Saved', rejectionReason: '' });
  const ratingsOnly = restoreHome({ ...base(), status: 'Archived', touredAt: null });
  assert.equal(ratingsOnly.touredAt, null);
  assert.equal(hasToured(ratingsOnly), false);
});

test('tour compatibility and outstanding intent are independent', () => {
  assert.equal(hasToured({ status: 'Toured', touredAt: null }), true);
  assert.equal(hasOutstandingWantToTour({ status: 'Want to Tour', touredAt: 'then' }), false);
  assert.equal(hasOutstandingWantToTour({ status: 'Want to Tour', touredAt: null }), true);
  assert.equal(hasOutstandingWantToTour({ status: 'Saved', touredAt: 'then' }), false);
});

test('application sources keep ownership, household union, modal initialization, and confirmation behavior', async () => {
  const [collaboration, board, detail, modal] = await Promise.all([
    readFile(new URL('../src/lib/supabase/collaboration.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/HomesBoard.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/HomeDetail.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/PostTourModal.jsx', import.meta.url), 'utf8'),
  ]);
  assert.match(collaboration, /\.eq\('user_id', userId\)/);
  assert.match(collaboration, /toured_at: personal\.touredAt/);
  assert.match(collaboration, /is_favorite: Boolean\(personal\.isFavorite\)/);
  assert.match(collaboration, /currentUserWantsToTour \|\| coBuyerWantsToTour/);
  assert.doesNotMatch(board, /h\.status === 'Toured' && h\.reaction !== 'love'/);
  assert.match(board, /applyPostTourVerdict\(home, verdict, patch\)/);
  assert.match(detail, /setArchiveTarget\(next\)/);
  assert.match(detail, /<ArchiveConfirmModal/);
  assert.match(modal, /\['love', 'considering', 'not_for_me'\]\.includes\(home\.reaction\)/);
  assert.doesNotMatch(modal, /home\.isFavorite.*initialVerdict/);
});
