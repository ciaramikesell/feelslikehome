// Floor plans data layer (src/lib/homeFloorPlans.js) without a database: file
// rules, the "feature not migrated yet" signal, the orphan sweep's selection,
// and the order of Storage / row operations when something fails midway.
// The permission matrix runs against real Postgres in home-floor-plans-db.test.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  FLOOR_PLAN_ACCEPT, FLOOR_PLAN_BUCKET, MAX_FLOOR_PLAN_BYTES, MAX_FLOOR_PLANS, addFloorPlan, floorPlanFileError,
  isFloorPlansUnavailable, removeFloorPlan, replaceFloorPlan, selectOrphanedFloorPlanObjects, signFloorPlanUrls,
} from '../src/lib/homeFloorPlans.js';

const HOME = '11111111-1111-4111-8111-111111111111';
const file = (type = 'image/png', size = 1024) => ({ type, size });

test('approved limits: four plans, 10 MB, JPEG / PNG / WebP only, in a private bucket of their own', () => {
  assert.equal(MAX_FLOOR_PLANS, 4);
  assert.equal(MAX_FLOOR_PLAN_BYTES, 10 * 1024 * 1024);
  assert.equal(FLOOR_PLAN_BUCKET, 'home-floor-plans');
  assert.equal(FLOOR_PLAN_ACCEPT, 'image/jpeg,image/png,image/webp');
  for (const type of ['image/jpeg', 'image/jpg', 'image/png', 'image/webp']) assert.equal(floorPlanFileError(file(type)), '');
  for (const type of ['image/svg+xml', 'application/pdf', 'image/heic', 'image/gif', '']) assert.match(floorPlanFileError(file(type)), /JPEG, PNG, or WebP/);
  assert.equal(floorPlanFileError(file('image/png', MAX_FLOOR_PLAN_BYTES)), '');
  assert.match(floorPlanFileError(file('image/png', MAX_FLOOR_PLAN_BYTES + 1)), /10MB/);

  const migration = readFileSync(new URL('../supabase/migrations/2026-10-18-home-floor-plans-storage.sql', import.meta.url), 'utf8');
  assert.match(migration, /values \('home-floor-plans', 'home-floor-plans', false, 10485760, array\['image\/jpeg', 'image\/png', 'image\/webp'\]\)/);
  assert.match(readFileSync(new URL('../supabase/migrations/2026-10-18-home-floor-plans.sql', import.meta.url), 'utf8'), />= 4 then/);
});

test('only a missing home_floor_plans table hides the feature; other errors surface', () => {
  assert.equal(isFloorPlansUnavailable({ code: '42P01', message: 'relation "public.home_floor_plans" does not exist' }), true);
  assert.equal(isFloorPlansUnavailable({ code: 'PGRST205', message: "Could not find the table 'public.home_floor_plans' in the schema cache" }), true);
  assert.equal(isFloorPlansUnavailable({ code: '42501', message: 'permission denied for table home_floor_plans' }), false);
  assert.equal(isFloorPlansUnavailable({ code: '08006', message: 'connection failure' }), false);
  assert.equal(isFloorPlansUnavailable(null), false);
});

test('the orphan sweep picks only unreferenced objects older than a day', () => {
  const now = Date.parse('2026-10-20T12:00:00Z');
  const objects = [
    { name: `${HOME}/a.png`, created_at: '2026-10-18T00:00:00Z' }, // referenced
    { name: `${HOME}/b.png`, created_at: '2026-10-18T00:00:00Z' }, // orphan, old
    { name: `${HOME}/c.png`, created_at: '2026-10-20T11:00:00Z' }, // orphan, an hour old: maybe mid-upload
    { name: `${HOME}/d.png`, created_at: null },                   // unknown age: left alone
  ];
  assert.deepEqual(selectOrphanedFloorPlanObjects({ objects, referencedPaths: [`${HOME}/a.png`], now }), [`${HOME}/b.png`]);
});

/* ---------------------------- operation ordering ---------------------------- */

// Records Storage and table calls; each table call answers with `responses`.
function fakeClient(responses = {}) {
  const calls = [];
  const storage = {
    from: (bucket) => ({
      upload: async (path, _file, options) => { calls.push(['upload', bucket, path, options.contentType]); return responses.upload || { data: { path }, error: null }; },
      remove: async (paths) => { calls.push(['remove', bucket, ...paths]); return { data: [], error: null }; },
      createSignedUrls: async (paths) => ({ data: paths.map((path) => (path.endsWith('gone.png') ? { path, signedUrl: null, error: 'not found' } : { path, signedUrl: `https://signed/${path}`, error: null })), error: null }),
    }),
  };
  const from = (table) => {
    const op = { table, kind: 'select' };
    const chain = {
      select() { return chain; }, eq() { return chain; }, order() { return chain; }, in() { return chain; },
      insert(row) { op.kind = 'insert'; op.row = row; return chain; },
      update(row) { op.kind = 'update'; op.row = row; return chain; },
      delete() { op.kind = 'delete'; return chain; },
      single() { return chain; },
      then(resolve) { calls.push([op.kind, table]); return Promise.resolve(responses[op.kind] || { data: [], error: null }).then(resolve); },
    };
    return chain;
  };
  return { calls, client: { storage, from } };
}

test('add uploads under the home folder as the bucket type, then inserts; a refused insert deletes the upload', async () => {
  const ok = fakeClient({ insert: { data: { id: 'p1', home_id: HOME, storage_path: 'x' }, error: null } });
  await addFloorPlan(ok.client, HOME, file('image/jpg'));
  const upload = ok.calls.find((call) => call[0] === 'upload');
  assert.match(upload[2], new RegExp(`^${HOME}/[0-9a-f-]{36}\\.jpg$`));
  assert.equal(upload[3], 'image/jpeg', 'image/jpg is uploaded as the bucket-allowed image/jpeg');
  assert.deepEqual(ok.calls.map((call) => call[0]), ['select', 'upload', 'insert']);

  const refused = fakeClient({ insert: { data: null, error: { message: 'A home can have at most 4 floor plans', hint: 'floor_plan_limit' } } });
  await assert.rejects(addFloorPlan(refused.client, HOME, file()), { reason: 'limit' });
  const uploaded = refused.calls.find((call) => call[0] === 'upload')[2];
  assert.deepEqual(refused.calls.at(-1), ['remove', FLOOR_PLAN_BUCKET, uploaded]);

  const full = fakeClient({ select: { data: [{}, {}, {}, {}], error: null } });
  await assert.rejects(addFloorPlan(full.client, HOME, file()), { reason: 'limit' });
  assert.ok(!full.calls.some((call) => call[0] === 'upload'), 'a full home is refused before uploading');

  const bad = fakeClient();
  await assert.rejects(addFloorPlan(bad.client, HOME, file('image/svg+xml')), { reason: 'invalid-file' });
  assert.deepEqual(bad.calls, []);
});

test('replace deletes the old image only after the row points at the new one; a lost race deletes the new one', async () => {
  const plan = { id: 'p1', homeId: HOME, storagePath: `${HOME}/old.png` };
  const won = fakeClient({ update: { data: [{ id: 'p1', home_id: HOME, storage_path: 'new' }], error: null } });
  await replaceFloorPlan(won.client, plan, file());
  assert.deepEqual(won.calls.map((call) => call[0]), ['upload', 'update', 'remove']);
  assert.deepEqual(won.calls.at(-1), ['remove', FLOOR_PLAN_BUCKET, plan.storagePath]);

  const lost = fakeClient({ update: { data: [], error: null } });
  await assert.rejects(replaceFloorPlan(lost.client, plan, file()), { reason: 'changed' });
  const fresh = lost.calls.find((call) => call[0] === 'upload')[2];
  assert.deepEqual(lost.calls.at(-1), ['remove', FLOOR_PLAN_BUCKET, fresh], 'the new upload is removed, the old image is kept');
});

test('remove deletes the row first, then the image; nothing is deleted when no row was removed', async () => {
  const plan = { id: 'p1', homeId: HOME, storagePath: `${HOME}/old.png` };
  const removed = fakeClient({ delete: { data: [{ id: 'p1' }], error: null } });
  assert.equal(await removeFloorPlan(removed.client, plan), true);
  assert.deepEqual(removed.calls.map((call) => call[0]), ['delete', 'remove']);

  const none = fakeClient({ delete: { data: [], error: null } });
  assert.equal(await removeFloorPlan(none.client, plan), false);
  assert.deepEqual(none.calls.map((call) => call[0]), ['delete']);
});

test('a plan whose image is missing signs to url: null instead of failing the viewer', async () => {
  const { client } = fakeClient();
  const signed = await signFloorPlanUrls(client, [{ storagePath: `${HOME}/ok.png` }, { storagePath: `${HOME}/gone.png` }]);
  assert.deepEqual(signed.map((plan) => plan.url), [`https://signed/${HOME}/ok.png`, null]);
});
