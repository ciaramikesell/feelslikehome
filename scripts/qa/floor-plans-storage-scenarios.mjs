// Floor-plan Storage scenarios, written once and run in two places:
//   * test/home-floor-plans-db.test.js — against the local Postgres + Storage
//     shim (proves the scenarios themselves are right);
//   * scripts/qa/floor-plans-storage-smoke.mjs — against a real Supabase
//     project, as real signed-in test users (proves the Storage service
//     behaves the way the shim assumes).
//
// clients: { owner, coBuyer, realtor, outsider, anon? } — Supabase-shaped
// clients, each signed in as that person (anon: no session). homeId: a home in
// the owner's search where the co-buyer and Realtor are members. fetchSigned:
// optional (url) => Promise<{ status, contentType }> to actually download
// signed URLs (real run only). Everything created is removed before returning.
import {
  FLOOR_PLAN_BUCKET, MAX_FLOOR_PLAN_BYTES, addFloorPlan, getFloorPlans, removeFloorPlan, replaceFloorPlan, signFloorPlanUrls,
} from '../../src/lib/homeFloorPlans.js';

// A real 1x1 PNG, so a downloaded signed URL is a valid image.
const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
const png = () => new Blob([PNG], { type: 'image/png' });
const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

export async function runFloorPlanStorageScenarios({ clients, homeId, fetchSigned = null }) {
  const results = [];
  const check = (name, ok, detail = '') => { results.push({ name, ok: Boolean(ok), detail }); };
  // Recorded, never failing: behaviour accepted as best-effort for v1.
  const note = (name, detail) => { results.push({ name, ok: true, info: true, detail }); };
  const folderCount = async () => ((await bucket('owner').list(homeId, { limit: 100 })).data || []).length;
  const bucket = (who) => clients[who].storage.from(FLOOR_PLAN_BUCKET);
  const created = new Set();
  const newPath = () => `${homeId}/${crypto.randomUUID()}.png`;
  const upload = async (who, path, file = png(), contentType = file.type) => {
    const { error } = await bucket(who).upload(path, file, { contentType, upsert: false });
    if (!error) created.add(path);
    return error;
  };
  const signed = async (who, path, expiresIn = 60) => {
    const { data, error } = await bucket(who).createSignedUrls([path], expiresIn);
    return error ? null : (data?.[0]?.signedUrl || null);
  };

  try {
    // Owner adds; everyone on the search sees the same plan.
    const plan = await addFloorPlan(clients.owner, homeId, png());
    created.add(plan.storagePath);
    check('owner adds a floor plan', plan.homeId === homeId);
    for (const who of ['owner', 'coBuyer', 'realtor']) {
      const plans = await getFloorPlans(clients[who], homeId);
      check(`${who} sees the plan`, plans?.some((p) => p.id === plan.id));
    }
    check('outsider sees no plans', (await getFloorPlans(clients.outsider, homeId))?.length === 0);

    // Signed URLs: issued to members only, and they actually serve the image.
    for (const who of ['owner', 'coBuyer', 'realtor']) {
      const [withUrl] = await signFloorPlanUrls(clients[who], [plan]);
      check(`${who} gets a signed URL`, Boolean(withUrl.url));
      if (fetchSigned && withUrl.url) {
        const response = await fetchSigned(withUrl.url);
        check(`${who}'s signed URL serves the image`, response.status === 200 && /image\/png/.test(response.contentType || ''), `${response.status} ${response.contentType}`);
      }
    }
    check('outsider gets no signed URL', !(await signed('outsider', plan.storagePath)));
    if (clients.anon) {
      check('anon gets no signed URL', !(await signed('anon', plan.storagePath)));
      const { data } = await clients.anon.from('home_floor_plans').select('id').eq('home_id', homeId);
      check('anon reads no rows', !(data || []).length);
    }
    if (fetchSigned) {
      const short = await signed('owner', plan.storagePath, 2);
      await sleep(4000);
      const expired = await fetchSigned(short);
      check('an expired signed URL no longer serves the image', expired.status >= 400, String(expired.status));
    }

    // Realtor: read only.
    check('Realtor cannot upload', Boolean(await upload('realtor', newPath())));
    const realtorRow = await clients.realtor.from('home_floor_plans').insert({ home_id: homeId, storage_path: newPath() }).select('id');
    check('Realtor cannot insert a row', Boolean(realtorRow.error));
    await bucket('realtor').remove([plan.storagePath]);
    check('Realtor cannot delete the image', Boolean(await signed('owner', plan.storagePath)));
    check('Realtor cannot remove the plan', (await removeFloorPlan(clients.realtor, plan)) === false);
    check('outsider cannot upload', Boolean(await upload('outsider', newPath())));

    // An upload with no row: buyers see it, the Realtor does not.
    const loose = newPath();
    check('co-buyer can upload', !(await upload('coBuyer', loose)));
    check('Realtor cannot sign an image with no row', !(await signed('realtor', loose)));
    check('owner can sign it (to clean up)', Boolean(await signed('owner', loose)));
    await bucket('owner').remove([loose]);
    check("owner deletes the co-buyer's unattached upload", !(await signed('owner', loose)));
    created.delete(loose);

    // Bucket limits, enforced by the Storage service itself.
    check('SVG is refused', Boolean(await upload('owner', newPath(), new Blob(['<svg/>'], { type: 'image/svg+xml' }))));
    check('PDF is refused', Boolean(await upload('owner', newPath(), new Blob(['%PDF-1.4'], { type: 'application/pdf' }))));
    check('over 10 MB is refused', Boolean(await upload('owner', newPath(), new Blob([new Uint8Array(MAX_FLOOR_PLAN_BYTES + 1)], { type: 'image/png' }))));
    check('a nested path is refused', Boolean(await upload('owner', `${homeId}/x/${crypto.randomUUID()}.png`)));

    // Co-buyer replaces the owner's plan; the old image is gone.
    const replaced = await replaceFloorPlan(clients.coBuyer, plan, png());
    created.add(replaced.storagePath);
    check('co-buyer replaces the plan', replaced.id === plan.id && replaced.storagePath !== plan.storagePath);
    check('the replaced image is deleted', !(await signed('owner', plan.storagePath)));
    created.delete(plan.storagePath);
    check('the Realtor can view the replacement', Boolean(await signed('realtor', replaced.storagePath)));

    // Four plans per home is strict, even when two buyers add at once; the
    // refused add deletes the image it had uploaded.
    for (let i = 0; i < 2; i += 1) created.add((await addFloorPlan(clients.owner, homeId, png())).storagePath);
    const race = await Promise.allSettled([addFloorPlan(clients.owner, homeId, png()), addFloorPlan(clients.coBuyer, homeId, png())]);
    race.filter((r) => r.status === 'fulfilled').forEach((r) => created.add(r.value.storagePath));
    check('two buyers adding the 4th and 5th plan at once: exactly one is saved',
      race.filter((r) => r.status === 'fulfilled').length === 1 && race.some((r) => r.status === 'rejected' && r.reason?.reason === 'limit'),
      race.map((r) => r.status === 'fulfilled' ? 'saved' : r.reason?.reason).join(', '));
    check('the home has exactly 4 plans', (await getFloorPlans(clients.owner, homeId))?.length === 4);
    check("the refused add left no image behind", (await folderCount()) === 4, String(await folderCount()));
    for (const extra of (await getFloorPlans(clients.owner, homeId)).filter((p) => p.id !== replaced.id)) {
      await removeFloorPlan(clients.owner, extra);
      created.delete(extra.storagePath);
    }

    // Eight objects per home folder: exact one at a time, best-effort when
    // simultaneous (Storage pre-checks the policy, then inserts as its admin).
    const filler = [];
    while (created.size < 7) {
      const path = newPath();
      if (await upload('owner', path)) break;
      filler.push(path);
    }
    check('the folder fills to seven objects', (await folderCount()) === 7, String(await folderCount()));
    const burst = [newPath(), newPath()];
    const burstErrors = await Promise.all([upload('owner', burst[0], png()), upload('coBuyer', burst[1], png())]);
    filler.push(...burst.filter((_, i) => !burstErrors[i]));
    note('simultaneous 8th and 9th upload (best-effort cap)', `${burstErrors.filter((e) => !e).length} of 2 accepted; folder holds ${await folderCount()}`);
    check('a further upload is refused', Boolean(await upload('coBuyer', newPath())));
    await bucket('owner').remove(filler);
    filler.forEach((path) => created.delete(path));

    // Remove: row and image both gone, for everyone.
    check('owner removes the plan', (await removeFloorPlan(clients.owner, replaced)) === true);
    created.delete(replaced.storagePath);
    check('the removed image cannot be signed', !(await signed('owner', replaced.storagePath)));
    check('the plan is gone for the Realtor', (await getFloorPlans(clients.realtor, homeId))?.length === 0);
  } catch (error) {
    check('scenario run completed', false, error?.message || String(error));
  } finally {
    const { data } = await clients.owner.from('home_floor_plans').delete().eq('home_id', homeId).select('id');
    if (created.size) await bucket('owner').remove([...created]);
    const leftovers = [];
    for (const path of created) if (await signed('owner', path)) leftovers.push(path);
    check('nothing is left behind', !leftovers.length && !(data || []).length, leftovers.join(', '));
  }
  return results;
}
