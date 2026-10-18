// Floor Plans foundation, executed for real against Postgres: the
// home_floor_plans table, the private home-floor-plans bucket's storage.objects
// policies, and the src/lib/homeFloorPlans.js data layer that keeps rows and
// objects consistent.
//
// Roles: owner, co-buyer, connected Realtor, outsider, plus members who leave
// or are removed. Focus: uploads without a database row, cross-home access,
// revoked memberships, concurrent adds and replaces, and deletion cleanup.
// Skips unless FLH_TEST_PGHOST is set (docs/database-tests.md).
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { register } from 'node:module';
import { createTestDatabase, DB_TESTS_ENABLED, DB_SKIP_REASON, POST_SNAPSHOT_MIGRATIONS } from './support/supabaseDb.mjs';

register('./support/aliasHooks.mjs', import.meta.url);
const {
  acceptInvitation, createInvitation, createRealtorSuggestion, leaveSearch, promoteSuggestion, removeMember, saveHomePersonalAndShared,
} = await import('../src/lib/supabase/collaboration.js');
const { deleteHome } = await import('../src/lib/supabase/data.js');
const {
  FLOOR_PLAN_BUCKET, MAX_FLOOR_PLAN_BYTES, addFloorPlan, getFloorPlanCounts, getFloorPlans, removeFloorPlan, replaceFloorPlan,
  selectOrphanedFloorPlanObjects, signFloorPlanUrls,
} = await import('../src/lib/homeFloorPlans.js');

const TABLE_MIGRATION = 'supabase/migrations/2026-10-18-home-floor-plans.sql';
const STORAGE_MIGRATION = 'supabase/migrations/2026-10-18-home-floor-plans-storage.sql';
const dbTest = (name, fn) => test(name, { skip: DB_TESTS_ENABLED ? false : DB_SKIP_REASON }, fn);
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const sqlFile = (path) => read(path).replace(/^--.*$/gm, '').trim().replace(/;$/, '');
const denied = (error) => /row-level security|permission denied|42501/i.test(error?.message || String(error));

let db;
before(() => { if (DB_TESTS_ENABLED) db = createTestDatabase(); });
after(() => db?.drop());

/* -------------------------------- fixtures -------------------------------- */

let seq = 0;
async function household(target = db) {
  seq += 1;
  const user = (name) => target.createUser({ email: `${name}.fp${seq}@example.com`, firstName: name });
  const people = { owner: user('owner'), coBuyer: user('cobuyer'), realtor: user('realtor'), outsider: user('outsider') };
  people.search = target.admin(`select id from public.searches where user_id = '${people.owner}'`)[0].id;
  await invite(target, people, people.coBuyer, 'co_buyer');
  await invite(target, people, people.realtor, 'realtor');
  return people;
}
async function invite(target, people, user, role) {
  const email = target.admin(`select email from auth.users where id = '${user}'`)[0].email;
  const invitation = await createInvitation(target.clientFor(people.owner), people.search, people.owner, email, role);
  assert.equal((await acceptInvitation(target.clientFor(user), invitation.token)).success, true);
}
const as = (user, target = db) => target.clientFor(user);
const addHome = async (user, search, address, target = db) => (await saveHomePersonalAndShared(as(user, target), { address, status: 'Saved' }, user, search)).id;
const image = (type = 'image/png', size = 2048) => new Blob([new Uint8Array(size)], { type });
const objectPath = (homeId, ext = 'png') => `${homeId}/${randomUUID()}.${ext}`;
const bucket = (user) => as(user).storage.from(FLOOR_PLAN_BUCKET);
const objectExists = (path) => db.admin(`select 1 from storage.objects where bucket_id = 'home-floor-plans' and name = '${path}'`).length === 1;
const rowCount = (homeId) => db.admin(`select count(*)::int as n from public.home_floor_plans where home_id = '${homeId}'`)[0].n;
const visibleRows = async (user, homeId) => {
  const { data, error } = await as(user).from('home_floor_plans').select('id,storage_path').eq('home_id', homeId);
  assert.equal(error, null, 'reads are filtered by RLS, never an error');
  return data;
};
const canSign = async (user, path) => {
  const { data } = await bucket(user).createSignedUrls([path], 60);
  return Boolean(data?.[0]?.signedUrl);
};
// An object placed without going through the app (or left behind by a failed
// row insert), as the uploading user.
async function rawUpload(user, path, file = image()) {
  return bucket(user).upload(path, file, { contentType: file.type, upsert: false });
}
async function rejects(promise, reason) {
  await assert.rejects(promise, (error) => { assert.equal(error.reason, reason, error.message); return true; });
}

/* ------------------------- owner and co-buyer (+) ------------------------- */

dbTest('owner and co-buyer add, view and sign the same shared floor plans', async () => {
  const p = await household();
  const home = await addHome(p.owner, p.search, '1 Shared Plan Way');
  const mine = await addFloorPlan(as(p.owner), home, image('image/png'));
  const theirs = await addFloorPlan(as(p.coBuyer), home, image('image/jpeg'));
  assert.equal(mine.createdBy, p.owner);
  assert.equal(theirs.createdBy, p.coBuyer, 'created_by is the caller, never client-supplied');
  assert.match(theirs.storagePath, new RegExp(`^${home}/[0-9a-f-]{36}\\.jpg$`));

  for (const user of [p.owner, p.coBuyer, p.realtor]) {
    const plans = await getFloorPlans(as(user), home);
    assert.deepEqual(plans.map((plan) => plan.id), [mine.id, theirs.id], 'everyone on the search sees the same plans, oldest first');
    const signed = await signFloorPlanUrls(as(user), plans);
    assert.ok(signed.every((plan) => plan.url?.includes(plan.storagePath)), 'every plan gets a signed URL');
  }
  const counts = await getFloorPlanCounts(as(p.realtor), [home]);
  assert.equal(counts.get(home), 2);
});

dbTest('a co-buyer replaces and removes plans the owner uploaded, with confirmation-free data cleanup', async () => {
  const p = await household();
  const home = await addHome(p.owner, p.search, '2 Replace Rd');
  const original = await addFloorPlan(as(p.owner), home, image());
  const replaced = await replaceFloorPlan(as(p.coBuyer), original, image('image/webp'));
  assert.equal(replaced.id, original.id, 'replace keeps the plan (and its place in the limit)');
  assert.notEqual(replaced.storagePath, original.storagePath);
  assert.ok(!objectExists(original.storagePath), "the replaced image is deleted even though another person uploaded it");
  assert.ok(objectExists(replaced.storagePath));

  const second = await addFloorPlan(as(p.coBuyer), home, image());
  assert.equal(await removeFloorPlan(as(p.owner), second), true);
  assert.equal(rowCount(home), 1);
  assert.ok(!objectExists(second.storagePath), 'removing a plan removes its image');
  assert.equal(await removeFloorPlan(as(p.owner), second), false, 'removing it again is a no-op');
});

/* ------------------------------ Realtor (read) ----------------------------- */

dbTest('a connected Realtor can view and sign floor plans but never add, replace or remove them', async () => {
  const p = await household();
  const home = await addHome(p.owner, p.search, '3 Realtor Read Ln');
  const plan = await addFloorPlan(as(p.owner), home, image());

  assert.equal((await visibleRows(p.realtor, home)).length, 1);
  assert.ok(await canSign(p.realtor, plan.storagePath));

  await rejects(addFloorPlan(as(p.realtor), home, image()), 'upload-failed');
  const upload = await rawUpload(p.realtor, objectPath(home));
  assert.ok(denied(upload.error), 'the Realtor cannot put an object in the home folder');
  const insert = await as(p.realtor).from('home_floor_plans').insert({ home_id: home, storage_path: objectPath(home) }).select('id');
  assert.ok(denied(insert.error), 'the Realtor cannot insert a row');
  await rejects(replaceFloorPlan(as(p.realtor), plan, image()), 'upload-failed');
  const update = await as(p.realtor).from('home_floor_plans').update({ storage_path: objectPath(home) }).eq('id', plan.id).select('id');
  assert.deepEqual(update.data || [], [], 'the Realtor cannot repoint a row');
  assert.equal(await removeFloorPlan(as(p.realtor), plan), false);
  await bucket(p.realtor).remove([plan.storagePath]);
  assert.equal(rowCount(home), 1);
  assert.ok(objectExists(plan.storagePath), 'the Realtor cannot delete the image');
});

dbTest('an outsider and anon see nothing and can do nothing', async () => {
  const p = await household();
  const home = await addHome(p.owner, p.search, '4 Private Pl');
  const plan = await addFloorPlan(as(p.owner), home, image());

  assert.deepEqual(await visibleRows(p.outsider, home), []);
  assert.equal(await canSign(p.outsider, plan.storagePath), false);
  assert.ok(denied((await rawUpload(p.outsider, objectPath(home))).error));
  assert.equal(await removeFloorPlan(as(p.outsider), plan), false);
  await bucket(p.outsider).remove([plan.storagePath]);
  assert.ok(objectExists(plan.storagePath));

  assert.throws(() => db.exec('begin; set local role anon; select count(*) from public.home_floor_plans; commit;'), /permission denied/);
  for (const call of [`public.can_read_home_floor_plan_object('${plan.storagePath}')`, `public.can_view_home_floor_plans('${home}')`, `public.can_edit_home_floor_plans('${home}')`]) {
    assert.throws(() => db.exec(`begin; set local role anon; select ${call}; commit;`), /permission denied/);
  }
});

/* ------------------------- uploads without a row --------------------------- */

dbTest('an uploaded image with no row is invisible to the Realtor and outsiders, and cleanable by buyers', async () => {
  const p = await household();
  const home = await addHome(p.owner, p.search, '5 Orphan Ct');
  const path = objectPath(home);
  assert.equal((await rawUpload(p.coBuyer, path)).error, null);

  assert.equal(await canSign(p.realtor, path), false, 'no row: the Realtor cannot read it');
  assert.equal(await canSign(p.outsider, path), false);
  assert.equal(await canSign(p.owner, path), true, 'decision-makers can see it, to finish or clean up');
  await bucket(p.owner).remove([path]);
  assert.ok(!objectExists(path), "the owner can delete the co-buyer's unattached upload");
});

dbTest('a home folder accepts at most eight objects, so unattached uploads cannot pile up', async () => {
  const p = await household();
  const home = await addHome(p.owner, p.search, '6 Spam St');
  for (let i = 0; i < 8; i += 1) assert.equal((await rawUpload(p.coBuyer, objectPath(home))).error, null);
  assert.ok(denied((await rawUpload(p.coBuyer, objectPath(home))).error), 'the ninth object is refused');
  const other = await addHome(p.owner, p.search, '6b Other St');
  assert.equal((await rawUpload(p.coBuyer, objectPath(other))).error, null, 'the cap is per home');
});

dbTest('a failed row insert deletes the image it had just uploaded', async () => {
  const p = await household();
  const home = await addHome(p.owner, p.search, '7 Rollback Row');
  // Four plans arrive between this add's limit pre-check and its insert: the
  // trigger rejects the row, and the upload must not be left behind.
  const client = as(p.owner);
  const realFrom = client.from;
  let raced = false;
  client.from = (table) => {
    const query = realFrom(table);
    const realInsert = query.insert.bind(query);
    query.insert = (row) => {
      if (!raced) {
        raced = true;
        for (let i = 0; i < 4; i += 1) db.exec(`insert into public.home_floor_plans (home_id, storage_path, created_by) values ('${home}', '${objectPath(home)}', '${p.coBuyer}')`);
      }
      return realInsert(row);
    };
    return query;
  };
  await rejects(addFloorPlan(client, home, image()), 'limit');
  assert.equal(rowCount(home), 4);
  assert.equal(db.admin(`select count(*)::int as n from storage.objects where bucket_id = 'home-floor-plans' and name like '${home}/%'`)[0].n, 0, 'no image left behind');
});

/* ----------------------------- cross-home access ---------------------------- */

dbTest('rows and objects can never cross into another home, search or path shape', async () => {
  const a = await household();
  const b = await household();
  const homeA = await addHome(a.owner, a.search, '8 Home A');
  const homeB = await addHome(b.owner, b.search, '8 Home B');
  const planB = await addFloorPlan(as(b.owner), homeB, image());

  assert.ok(denied((await rawUpload(a.owner, objectPath(homeB))).error), "A's owner cannot upload into B's home folder");
  assert.equal(await canSign(a.owner, planB.storagePath), false);
  assert.equal(await canSign(a.realtor, planB.storagePath), false, "A's Realtor cannot read B's plans");
  assert.deepEqual(await visibleRows(a.realtor, homeB), []);
  await bucket(a.coBuyer).remove([planB.storagePath]);
  assert.ok(objectExists(planB.storagePath), "A's co-buyer cannot delete B's image");

  const pointAtB = await as(a.owner).from('home_floor_plans').insert({ home_id: homeA, storage_path: planB.storagePath }).select('id');
  assert.equal(pointAtB.error?.code, '23514', "a row for home A cannot reference home B's image");
  const rowForB = await as(a.owner).from('home_floor_plans').insert({ home_id: homeB, storage_path: objectPath(homeB) }).select('id');
  assert.ok(denied(rowForB.error), 'a row for a home outside your search is refused');

  const planA = await addFloorPlan(as(a.owner), homeA, image());
  const repoint = await as(a.owner).from('home_floor_plans').update({ storage_path: planB.storagePath }).eq('id', planA.id).select('id');
  assert.ok(repoint.error, "a plan cannot be repointed at another home's image");
  const move = await as(a.owner).from('home_floor_plans').update({ home_id: homeB }).eq('id', planA.id).select('id');
  assert.ok(denied(move.error), 'home_id cannot change');
  const spoof = await as(a.owner).from('home_floor_plans').insert({ home_id: homeA, storage_path: objectPath(homeA), created_by: a.coBuyer }).select('id');
  assert.ok(denied(spoof.error), 'created_by cannot be supplied');

  for (const name of [
    `${homeA}/nested/${randomUUID()}.png`, `${homeA}/${randomUUID()}.svg`, `${homeA}/${randomUUID()}.PNG`,
    `${homeA.toUpperCase()}/${randomUUID()}.png`, `${randomUUID()}.png`, `${homeA}/plan.png`, `../${homeA}/${randomUUID()}.png`,
  ]) {
    assert.ok(denied((await rawUpload(a.owner, name)).error), `object name refused: ${name}`);
  }
});

/* --------------------------- revoked memberships ---------------------------- */

dbTest('a removed co-buyer and a removed or departed Realtor lose every floor-plan permission at once', async () => {
  const p = await household();
  const home = await addHome(p.owner, p.search, '9 Revoked Rd');
  const plan = await addFloorPlan(as(p.coBuyer), home, image());

  await removeMember(as(p.owner), p.search, p.coBuyer);
  assert.deepEqual(await visibleRows(p.coBuyer, home), [], 'removed co-buyer: no rows');
  assert.equal(await canSign(p.coBuyer, plan.storagePath), false, 'removed co-buyer: no new signed URLs, even for their own upload');
  assert.ok(denied((await rawUpload(p.coBuyer, objectPath(home))).error));
  assert.equal(await removeFloorPlan(as(p.coBuyer), plan), false);
  await bucket(p.coBuyer).remove([plan.storagePath]);
  assert.ok(objectExists(plan.storagePath));
  assert.equal((await getFloorPlans(as(p.owner), home)).length, 1, "the plan they added stays with the home");

  await removeMember(as(p.owner), p.search, p.realtor);
  assert.deepEqual(await visibleRows(p.realtor, home), []);
  assert.equal(await canSign(p.realtor, plan.storagePath), false);

  const q = await household();
  const qHome = await addHome(q.owner, q.search, '9b Departed Dr');
  const qPlan = await addFloorPlan(as(q.owner), qHome, image());
  assert.ok(await canSign(q.realtor, qPlan.storagePath));
  await leaveSearch(as(q.realtor), q.realtor, q.search);
  assert.equal(await canSign(q.realtor, qPlan.storagePath), false, 'a Realtor who leaves loses access');
  await leaveSearch(as(q.coBuyer), q.coBuyer, q.search);
  await rejects(addFloorPlan(as(q.coBuyer), qHome, image()), 'upload-failed');
});

dbTest('a pending Realtor suggestion takes no floor plans until a buyer accepts it', async () => {
  const p = await household();
  const created = await createRealtorSuggestion(as(p.realtor), p.search, { address: '10 Staged St', listingUrl: 'https://example.com/10-staged' });
  assert.equal(created.result, 'created');
  for (const user of [p.owner, p.coBuyer, p.realtor]) {
    assert.ok(denied((await rawUpload(user, objectPath(created.home_id))).error), 'no upload on a staged home');
    const insert = await as(user).from('home_floor_plans').insert({ home_id: created.home_id, storage_path: objectPath(created.home_id) }).select('id');
    assert.ok(denied(insert.error), 'no row on a staged home');
  }
  await promoteSuggestion(as(p.owner), created.suggestion_id);
  const plan = await addFloorPlan(as(p.coBuyer), created.home_id, image());
  assert.ok(await canSign(p.realtor, plan.storagePath), 'once accepted, buyers add plans and the Realtor can view them');
});

/* ------------------------------- concurrency -------------------------------- */

function concurrentInsert(userId, homeId) {
  const sql = `begin;
set local role authenticated;
set local request.jwt.claim.sub = '${userId}';
insert into public.home_floor_plans (home_id, storage_path) values ('${homeId}', '${objectPath(homeId)}');
select pg_sleep(0.6);
commit;
`;
  const args = ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-h', process.env.FLH_TEST_PGHOST, '-U', process.env.FLH_TEST_PGUSER || 'postgres', '-d', db.name, '-f', '-'];
  if (process.env.FLH_TEST_PGPORT) args.push('-p', process.env.FLH_TEST_PGPORT);
  return new Promise((resolve) => {
    const child = spawn('psql', args, { env: { ...process.env, PGOPTIONS: '-c client_min_messages=warning' } });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (status) => resolve({ ok: status === 0, stderr }));
    child.stdin.end(sql);
  });
}

dbTest('two buyers adding the fourth and fifth plan at the same moment: exactly one succeeds', async () => {
  const p = await household();
  const home = await addHome(p.owner, p.search, '11 Race Row');
  for (let i = 0; i < 3; i += 1) await addFloorPlan(as(p.owner), home, image());
  const results = await Promise.all([concurrentInsert(p.owner, home), concurrentInsert(p.coBuyer, home)]);
  assert.equal(results.filter((r) => r.ok).length, 1, results.map((r) => r.stderr).join('\n'));
  assert.match(results.find((r) => !r.ok).stderr, /at most 4 floor plans/);
  assert.equal(rowCount(home), 4);

  const multi = await as(p.owner).from('home_floor_plans').insert({ home_id: home, storage_path: objectPath(home) }).select('id');
  assert.match(multi.error?.message || '', /at most 4 floor plans/, 'a fifth is refused');
});

dbTest('a multi-row insert cannot exceed four in one statement', async () => {
  const p = await household();
  const home = await addHome(p.owner, p.search, '12 Batch Blvd');
  const values = Array.from({ length: 5 }, () => `('${home}', '${objectPath(home)}')`).join(', ');
  const result = db.runAs(p.owner, `insert into public.home_floor_plans (home_id, storage_path) values ${values}`);
  assert.match(result.error?.message || '', /at most 4 floor plans/);
  assert.equal(rowCount(home), 0);
});

dbTest('two buyers replacing the same plan from the same view: the second is told it changed and leaves nothing behind', async () => {
  const p = await household();
  const home = await addHome(p.owner, p.search, '13 Replace Race');
  const plan = await addFloorPlan(as(p.owner), home, image());
  const first = await replaceFloorPlan(as(p.owner), plan, image());
  await rejects(replaceFloorPlan(as(p.coBuyer), plan, image()), 'changed');
  const objects = db.admin(`select name from storage.objects where bucket_id = 'home-floor-plans' and name like '${home}/%'`).map((row) => row.name);
  assert.deepEqual(objects, [first.storagePath], "only the winning replacement's image remains");

  await removeFloorPlan(as(p.owner), first);
  await rejects(replaceFloorPlan(as(p.coBuyer), first, image()), 'changed');
  assert.equal(db.admin(`select count(*)::int as n from storage.objects where bucket_id = 'home-floor-plans' and name like '${home}/%'`)[0].n, 0, 'replacing a plan someone removed leaves nothing');
});

/* ------------------------------ deletion cleanup ---------------------------- */

dbTest('a removed plan whose image could not be deleted is unreadable to the Realtor and still deletable by buyers', async () => {
  const p = await household();
  const home = await addHome(p.owner, p.search, '14 Leftover Ln');
  const plan = await addFloorPlan(as(p.owner), home, image());
  // The row delete succeeds but the best-effort object delete never runs.
  const { data } = await as(p.coBuyer).from('home_floor_plans').delete().eq('id', plan.id).select('id');
  assert.equal(data.length, 1);
  assert.equal(await canSign(p.realtor, plan.storagePath), false, 'removed means removed for the Realtor');
  await bucket(p.coBuyer).remove([plan.storagePath]);
  assert.ok(!objectExists(plan.storagePath));
});

dbTest('deleting a home removes its floor-plan rows; its images become unreadable and are found by the orphan sweep', async () => {
  const p = await household();
  const home = await addHome(p.owner, p.search, '15 Demolished Dr');
  const kept = await addHome(p.owner, p.search, '15b Standing St');
  const plans = [await addFloorPlan(as(p.owner), home, image()), await addFloorPlan(as(p.coBuyer), home, image())];
  const keptPlan = await addFloorPlan(as(p.owner), kept, image());

  await deleteHome(as(p.owner), home);
  assert.equal(db.admin(`select count(*)::int as n from public.homes where id = '${home}'`)[0].n, 0);
  assert.equal(rowCount(home), 0, 'rows cascade with the home');
  for (const plan of plans) {
    assert.ok(objectExists(plan.storagePath), 'Postgres cannot delete Storage objects; the sweep does');
    for (const user of [p.owner, p.coBuyer, p.realtor]) assert.equal(await canSign(user, plan.storagePath), false);
  }

  const objects = db.admin(`select name, created_at from storage.objects where bucket_id = 'home-floor-plans' and (name like '${home}/%' or name like '${kept}/%')`);
  const referencedPaths = db.admin('select storage_path from public.home_floor_plans').map((row) => row.storage_path);
  const later = Date.now() + 25 * 60 * 60 * 1000;
  assert.deepEqual(selectOrphanedFloorPlanObjects({ objects, referencedPaths, now: later }).sort(), plans.map((plan) => plan.storagePath).sort());
  assert.deepEqual(selectOrphanedFloorPlanObjects({ objects, referencedPaths }), [], 'nothing younger than a day is swept');
  assert.ok(objectExists(keptPlan.storagePath));
});

/* ------------------------- bucket limits and contract ------------------------ */

dbTest('the bucket refuses SVG, PDF and oversized files even if the app check is bypassed', async () => {
  const p = await household();
  const home = await addHome(p.owner, p.search, '16 Limits Loop');
  assert.equal((await bucket(p.owner).upload(objectPath(home), image('image/svg+xml'), { contentType: 'image/svg+xml' })).error?.statusCode, '415');
  assert.equal((await bucket(p.owner).upload(objectPath(home), image('application/pdf'), { contentType: 'application/pdf' })).error?.statusCode, '415');
  assert.equal((await bucket(p.owner).upload(objectPath(home), image('image/png', MAX_FLOOR_PLAN_BYTES + 1), { contentType: 'image/png' })).error?.statusCode, '413');
  assert.equal((await bucket(p.owner).upload(objectPath(home), image('image/png', MAX_FLOOR_PLAN_BYTES), { contentType: 'image/png' })).error, null, 'exactly 10 MB is allowed');
  await rejects(addFloorPlan(as(p.owner), home, image('image/svg+xml')), 'invalid-file');
  await rejects(addFloorPlan(as(p.owner), home, image('image/heic')), 'invalid-file');
});

dbTest('preflight and verification are all ok; both migrations re-run cleanly', () => {
  const pre = db.admin(sqlFile('supabase/home-floor-plans-preflight.sql'));
  assert.deepEqual(pre.filter((row) => !row.ok), []);
  const verify = db.admin(sqlFile('supabase/home-floor-plans-verification.sql'));
  assert.deepEqual(verify.filter((row) => !row.ok), []);
  assert.deepEqual(db.applyFile(TABLE_MIGRATION), { ok: true, error: null });
  assert.deepEqual(db.applyFile(STORAGE_MIGRATION), { ok: true, error: null });
  assert.deepEqual(db.admin(sqlFile('supabase/home-floor-plans-verification.sql')).filter((row) => !row.ok), []);
});

dbTest('before the migrations: preflight passes, the app hides the feature, the legacy column is untouched', async () => {
  const before = createTestDatabase({ steps: POST_SNAPSHOT_MIGRATIONS.filter((step) => !/home-floor-plans/.test(step.file || '')) });
  try {
    assert.deepEqual(before.admin(sqlFile('supabase/home-floor-plans-preflight.sql')).filter((row) => !row.ok), []);
    const owner = before.createUser({ email: 'owner.legacy@example.com' });
    assert.equal(await getFloorPlanCounts(before.clientFor(owner), [randomUUID()]), null, 'no table: counts read as unavailable');
    assert.equal(await getFloorPlans(before.clientFor(owner), randomUUID()), null);

    const legacy = () => before.admin(`select data_type, is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'homes' and column_name = 'floor_plan_image_url'`);
    const columnBefore = legacy();
    assert.deepEqual(before.applyFile(TABLE_MIGRATION), { ok: true, error: null });
    assert.deepEqual(before.applyFile(STORAGE_MIGRATION), { ok: true, error: null });
    assert.deepEqual(legacy(), columnBefore, 'homes.floor_plan_image_url is unchanged');
  } finally { before.drop(); }
});

dbTest('the storage migration aborts when an unscoped storage policy would also open the private bucket', () => {
  const target = createTestDatabase({ steps: POST_SNAPSHOT_MIGRATIONS.filter((step) => !/home-floor-plans-storage/.test(step.file || '')) });
  try {
    target.exec('create policy "any_authenticated_read" on storage.objects for select to authenticated using (true);');
    assert.equal(target.admin(sqlFile('supabase/home-floor-plans-preflight.sql')).find((row) => row.section === 9).ok, false, 'preflight flags it');
    const result = target.applyFile(STORAGE_MIGRATION);
    assert.equal(result.ok, false);
    assert.match(result.error, /could grant access to home-floor-plans: any_authenticated_read/);
    assert.equal(target.admin(`select count(*)::int as n from storage.buckets where id = 'home-floor-plans'`)[0].n, 0, 'nothing applied');
  } finally { target.drop(); }
});

/* ----------------------------- scope boundaries ----------------------------- */

test('the foundation never touches cover photos, Match or the legacy floor_plan_image_url column', () => {
  for (const path of [TABLE_MIGRATION, STORAGE_MIGRATION, 'src/lib/homeFloorPlans.js']) {
    const source = read(path).replace(/^\s*(--|\/\/).*$/gm, '');
    assert.doesNotMatch(source, /home-photos|photo_url|floor_plan_image_url/, `${path} stays away from cover photos and the legacy column`);
    assert.doesNotMatch(source, /matching|matchCriteria|lot_size|lotSize/, `${path} stays away from Match and lot size`);
    assert.doesNotMatch(source, /alter table public\.homes/i);
  }
});
