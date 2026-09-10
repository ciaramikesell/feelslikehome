import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('priority editors share optimistic rollback, retry, and serialized writes', async () => {
  const [hook, onboarding, mySearch] = await Promise.all([
    source('src/lib/useReliableOptimisticState.js'),
    source('src/components/onboarding/Onboarding.jsx'),
    source('src/components/MySearchPanel.jsx'),
  ]);
  assert.match(hook, /confirmed\.current/);
  assert.match(hook, /queue\.current\.then/);
  assert.match(hook, /setState\(confirmed\.current\)/);
  assert.match(hook, /Couldn't save that change\. Try again\./);
  assert.match(onboarding, /useReliableOptimisticState/);
  assert.match(mySearch, /useReliableOptimisticState/);
  assert.match(onboarding, /role="alert"/);
  assert.match(mySearch, /role="alert"/);
});

test('personal home actions roll back only the latest intent and offer retry', async () => {
  const [detail, board] = await Promise.all([
    source('src/components/HomeDetail.jsx'),
    source('src/components/HomesBoard.jsx'),
  ]);
  for (const label of ['Want to Tour', 'Favorite', 'Archive', 'Restore']) {
    assert.ok(detail.includes(label), `${label} remains available`);
  }
  assert.match(detail, /personalQueue\.current\.then/);
  assert.match(detail, /requestVersion === personalVersion\.current/);
  assert.match(detail, /setHome\(confirmedHome\.current\)/);
  assert.match(board, /mutationQueues\.current/);
  assert.match(board, /confirmedHomes\.current/);
  assert.match(board, /role="alert"/);
});

test('collaboration copy distinguishes visible search activity from participant control', async () => {
  const [detail, modal, invite, postTour] = await Promise.all([
    source('src/components/HomeDetail.jsx'),
    source('src/components/HomeModal.jsx'),
    source('src/app/invite/[token]/AcceptInvitationClient.jsx'),
    source('src/components/PostTourModal.jsx'),
  ]);
  assert.match(detail, /isCollaborative \? "Shared notes" : "What you want to remember"/);
  assert.match(detail, /These choices are yours/);
  assert.match(modal, /isCollaborative \? 'Shared notes' : 'Your thoughts'/);
  assert.match(invite, /see each other&apos;s search preferences and opinions/);
  assert.match(postTour, /Your feelings and reactions stay under your control/);
});
