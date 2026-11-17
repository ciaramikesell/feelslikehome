import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { createTestDatabase, DB_TESTS_ENABLED, DB_SKIP_REASON } from './support/supabaseDb.mjs';
import { parsePhotoUrl, serializePhotoFrame } from '../src/lib/photoFraming.js';
register('./support/aliasHooks.mjs', import.meta.url);
const { createInvitation, acceptInvitation, saveHomeSharedFields, getHomesForUser } = await import('../src/lib/supabase/collaboration.js');
const dbTest = (name, fn) => test(name, { skip: DB_TESTS_ENABLED ? false : DB_SKIP_REASON }, fn);
let db; const ids = {};
const backend = 'https://project.supabase.co';
let source; let home;
before(async () => {
  if (!DB_TESTS_ENABLED) return;
  db = createTestDatabase();
  for (const role of ['owner', 'coBuyer', 'realtor', 'outsider']) ids[role] = db.createUser({ email: `${role}.photo@example.com`, firstName: role, lastName: 'QA' });
  ids.search = db.admin(`select id from public.searches where user_id='${ids.owner}'`)[0].id;
  for (const [key, role] of [['coBuyer', 'co_buyer'], ['realtor', 'realtor']]) {
    const invitation = await createInvitation(db.clientFor(ids.owner), ids.search, ids.owner, `${key}.photo@example.com`, role);
    assert.equal((await acceptInvitation(db.clientFor(ids[key]), invitation.token)).success, true);
  }
  source = `${backend}/storage/v1/object/public/home-photos/${ids.owner}/original.webp#keep%23this`;
  const inserted = await db.clientFor(ids.owner).from('homes').insert({ user_id: ids.owner, search_id: ids.search, address: '14 Linden Lane', price: '485000', photo_url: source, notes: 'Keep this note' }).select('id').single();
  assert.equal(inserted.error, null); home = inserted.data.id;
});
after(() => db?.drop());
const row = () => db.admin(`select photo_url,address,price,notes,listing_import from public.homes where id='${home}'`)[0];

dbTest('owner and co-buyer share a position across fresh reads; Realtor reads without gaining photo writes', async () => {
  const framed = serializePhotoFrame(source, { x: 15, y: 75 }, backend);
  const before = row();
  await saveHomeSharedFields(db.clientFor(ids.owner), home, { photoUrl: framed }, { expected: { photoUrl: source } });
  for (const key of ['owner', 'coBuyer']) {
    const [saved] = await getHomesForUser(db.clientFor(ids[key]), ids[key], ids.search, { homeId: home });
    assert.equal(saved.photoUrl, framed);
    assert.deepEqual(parsePhotoUrl(saved.photoUrl, backend).position, { x: 15, y: 75 });
  }
  const realtor = await db.clientFor(ids.realtor).from('homes').select('photo_url').eq('id', home).single();
  assert.equal(realtor.data.photo_url, framed);
  const next = serializePhotoFrame(framed, { x: 35, y: 65 }, backend);
  await assert.rejects(() => saveHomeSharedFields(db.clientFor(ids.realtor), home, { photoUrl: next }, { expected: { photoUrl: framed } }));
  await assert.rejects(() => saveHomeSharedFields(db.clientFor(ids.outsider), home, { photoUrl: next }, { expected: { photoUrl: framed } }));
  assert.equal(row().photo_url, framed);
  await saveHomeSharedFields(db.clientFor(ids.coBuyer), home, { photoUrl: next }, { expected: { photoUrl: framed } });
  assert.deepEqual(row(), { ...before, photo_url: next });
});

dbTest('a stale framing save cannot overwrite a replacement, another framing edit, or create a duplicate home', async () => {
  const old = row().photo_url;
  const replacement = source.replace('original.webp', 'replacement.webp');
  await saveHomeSharedFields(db.clientFor(ids.coBuyer), home, { photoUrl: replacement });
  await assert.rejects(() => saveHomeSharedFields(db.clientFor(ids.owner), home, { photoUrl: serializePhotoFrame(old, { x: 90, y: 10 }, backend) }, { expected: { photoUrl: old } }), error => error.code === 'FLH_SHARED_NOTES_CONFLICT');
  assert.equal(row().photo_url, replacement);
  const first = serializePhotoFrame(replacement, { x: 20, y: 80 }, backend);
  await saveHomeSharedFields(db.clientFor(ids.owner), home, { photoUrl: first }, { expected: { photoUrl: replacement } });
  await assert.rejects(() => saveHomeSharedFields(db.clientFor(ids.coBuyer), home, { photoUrl: serializePhotoFrame(replacement, { x: 80, y: 20 }, backend) }, { expected: { photoUrl: replacement } }));
  assert.equal(row().photo_url, first);
  assert.equal(db.admin(`select count(*)::int as n from public.homes where id='${home}'`)[0].n, 1);
  assert.equal(db.admin('select count(*)::int as n from storage.objects')[0].n, 0, 'positioning never creates storage objects');
});
