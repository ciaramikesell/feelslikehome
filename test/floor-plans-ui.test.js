// Floor Plans UI (Stage C, docs/floor-plans-ui.md): the release flag, the
// viewer's pure geometry and upload batching, the card state each role gets
// (real Postgres), and source guards for what the UI must and must not do —
// off by default, no other Storage path, Notes and the cover photo untouched,
// nothing inside Add/Edit Home. Browser QA: scripts/qa/floor-plans-ui-qa.mjs.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { createTestDatabase, DB_TESTS_ENABLED, DB_SKIP_REASON } from './support/supabaseDb.mjs';
import { floorPlansEnabled, isFlagOn } from '../src/lib/featureFlags.js';
import {
  DOUBLE_TAP_SCALE, MAX_SCALE, MIN_SCALE, classifySwipe, clampOffset, clampScale, fitSize, floorPlansActionLabel, pan,
  pinchGeometry, planUploadBatch, stepIndex, zoomAt,
} from '../src/lib/floorPlanViewer.js';
import { FLOOR_PLAN_URL_TTL_SECONDS, floorPlanFileError } from '../src/lib/homeFloorPlans.js';

register('./support/aliasHooks.mjs', import.meta.url);
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const viewer = read('src/components/FloorPlans.jsx');
const board = read('src/components/HomesBoard.jsx');
const card = board.match(/function HomeCard\([\s\S]*?\n\}\n\nfunction CardGrid/)?.[0] || '';
const realtor = read('src/components/RealtorWorkspace.jsx');
const css = read('src/app/globals.css');
const fpCss = css.slice(css.indexOf('/* ── Floor Plans (FloorPlans.jsx'));

/* ---------------------------------- flag ---------------------------------- */

test('FLH_FLOOR_PLANS defaults off: only on / true / 1 turn it on', () => {
  assert.equal(floorPlansEnabled({}), false);
  for (const value of [undefined, '', 'off', 'false', '0', 'no', 'enabled', ' ']) assert.equal(floorPlansEnabled({ FLH_FLOOR_PLANS: value }), false, String(value));
  for (const value of ['on', 'ON', 'true', '1', ' on ']) assert.equal(floorPlansEnabled({ FLH_FLOOR_PLANS: value }), true, value);
  assert.equal(isFlagOn(null), false);
});

test('the flag is server-side and gates every page that renders plan cards', () => {
  const pages = ['src/app/(app)/homes/(board)/layout.js', 'src/app/(app)/tour/page.js', 'src/app/(app)/favorites/page.js', 'src/app/(app)/archive/page.js', 'src/app/(app)/people/[searchId]/page.js'];
  for (const path of pages) {
    const page = read(path);
    assert.match(page, /floorPlansEnabled\(\) \? loadFloorPlanCardState\(supabase, \{[^}]*\}\) : null/, `${path}: flag-gated load`);
    assert.match(page, /floorPlans=\{floorPlans\}/, `${path}: passes the result down`);
  }
  // No client component reads an env var for it; no NEXT_PUBLIC_ flag is baked into the bundle.
  for (const source of [viewer, board, realtor]) assert.doesNotMatch(source, /process\.env/);
  assert.doesNotMatch(read('src/lib/featureFlags.js'), /NEXT_PUBLIC_/);
});

/* ----------------------------- flag off = as before ----------------------------- */

test('flag off: the card renders exactly the old Notes link and mounts no viewer', () => {
  assert.match(card, /floorPlans = null \}\) \{/);
  assert.match(card, /\{floorPlans \? \([\s\S]*?\) : notesLink\}/);
  assert.match(card, /const notesLink = noteCount > 0 && <Link className="hh-notes-indicator" scroll=\{false\} onClick=\{onOpen\} href=\{`\$\{homeHref\}\$\{homeHref\.includes\('\?'\) \? '&' : '\?'\}section=tour`\}><StickyNote size=\{13\} aria-hidden="true" \/> Notes \(\{noteCount\}\)<\/Link>;/);
  assert.match(card, /const floorPlansAction = floorPlans && <FloorPlansAction/);
  assert.match(board, /const floorPlanViewer = floorPlans && floorPlanHome && \(/);
  assert.match(board, /const floorPlanCards = useMemo\(\(\) => floorPlans && \{/);
  assert.match(realtor, /\{floorPlans && <div className="hh-realtor-home-extras">/);
  assert.match(realtor, /\{floorPlanCards && floorPlanHome && <FloorPlansViewer/);
  // Reads, signing and uploads all live in the viewer, which only mounts on a tap.
  for (const call of ['getFloorPlans', 'signFloorPlanUrls', 'addFloorPlan', 'removeFloorPlan', 'canEditFloorPlans']) {
    assert.doesNotMatch(board, new RegExp(call), `HomesBoard calls ${call}`);
    assert.doesNotMatch(realtor, new RegExp(call), `RealtorWorkspace calls ${call}`);
  }
});

/* ------------------------ reuse the foundation, nothing else ------------------------ */

test('the viewer uses only the foundation data layer: no direct Storage calls, no replace, no PDF, no URLs', () => {
  assert.doesNotMatch(viewer, /\.storage\b|\.from\(['"]home_floor_plans|createSignedUrl|\.upload\(/);
  assert.match(viewer, /from '@\/lib\/homeFloorPlans'/);
  for (const fn of ['addFloorPlan', 'removeFloorPlan', 'getFloorPlans', 'signFloorPlanUrls', 'canEditFloorPlans', 'floorPlanFileError', 'FLOOR_PLAN_ACCEPT']) assert.match(viewer, new RegExp(`\\b${fn}\\b`));
  assert.doesNotMatch(viewer, /replaceFloorPlan/);
  assert.match(viewer, /accept=\{FLOOR_PLAN_ACCEPT\}/);
  assert.doesNotMatch(viewer, /application\/pdf|\.pdf|type="url"|<input[^>]*type="text"/);
  // No names, labels, ordering or reordering.
  assert.doesNotMatch(viewer, /label:|rename|reorder|drag(?:start|over|end)|sort_order|position:/i);
});

test('nothing about floor plans inside Add/Edit Home, Match, Home Facts or the cover photo', () => {
  for (const path of ['src/components/HomeModal.jsx', 'src/components/HomeOverlay.jsx', 'src/components/HomeDetail.jsx', 'src/components/HomeFacts.jsx', 'src/lib/matching.js', 'src/lib/homeFacts.js', 'src/lib/homePhoto.js']) {
    assert.doesNotMatch(read(path), /FloorPlans|homeFloorPlans|floorPlanViewer|home_floor_plans/, path);
  }
  // The single cover photo on the card is untouched.
  assert.match(card, /<img src=\{home\.photoUrl\} alt=\{`\$\{identity\.accessible\} \$\{vocabulary\.singularLower\} photo`\} onError=\{\(\) => setImgError\(true\)\} \/>/);
});

/* -------------------------------- card action -------------------------------- */

test('card action: Realtors with no plans see nothing; buyers are offered Add; counts read like Notes', () => {
  assert.equal(floorPlansActionLabel(0, false), null);
  assert.equal(floorPlansActionLabel(0, true), 'Add floor plan');
  assert.equal(floorPlansActionLabel(1, false), 'Floor plans (1)');
  assert.equal(floorPlansActionLabel(4, true), 'Floor plans (4)');
  assert.equal(floorPlansActionLabel(null, false), 'Floor plans', 'unknown count still lets anyone look');
  assert.match(realtor, /<FloorPlansAction count=\{floorPlans\.countFor\(home\)\} canEdit=\{false\}/);
  // Notes on the left, Floor Plans on the right, quiet text styling, 44px on phones.
  assert.match(card, /<div className="hh-card-notes-row">\s*\{notesLink \|\| <span aria-hidden="true" \/>\}\s*\{floorPlansAction\}/);
  assert.match(fpCss, /\.hh-card-notes-row \{ display: flex; align-items: center; justify-content: space-between;/);
  assert.match(fpCss, /\.hh-floor-plans-action \{[^}]*margin-left: auto;[^}]*background: none; color: var\(--ink-soft\);/);
  assert.match(fpCss, /@media \(max-width: 700px\) \{ \.hh-floor-plans-action, \.hh-card-notes-row \.hh-notes-indicator \{ min-height: 44px; \} \}/);
});

/* ------------------------------ viewer geometry ------------------------------ */

test('fit never upscales a small plan and contains a large one', () => {
  assert.deepEqual(fitSize({ width: 400, height: 800 }, { width: 2000, height: 1000 }), { width: 400, height: 200 });
  assert.deepEqual(fitSize({ width: 1000, height: 800 }, { width: 300, height: 200 }), { width: 300, height: 200 });
  assert.deepEqual(fitSize({ width: 0, height: 0 }, { width: 300, height: 200 }), { width: 0, height: 0 });
  assert.deepEqual(fitSize({ width: 300, height: 300 }, null), { width: 0, height: 0 });
});

test('zoom stays between fit and 4×, keeps the pinch point still, and never pans off the image', () => {
  const stage = { width: 400, height: 600 };
  const fitted = { width: 400, height: 300 };
  assert.equal(clampScale(0.2), MIN_SCALE);
  assert.equal(clampScale(99), MAX_SCALE);
  assert.equal(clampScale(Number.NaN), MIN_SCALE);
  // Zooming about the centre does not move it.
  assert.deepEqual(zoomAt({ scale: 1, x: 0, y: 0 }, 2, { x: 0, y: 0 }, stage, fitted), { scale: 2, x: 0, y: 0 });
  // About a point to the right: the image shifts left so that point stays put.
  const zoomed = zoomAt({ scale: 1, x: 0, y: 0 }, 2, { x: 100, y: 0 }, stage, fitted);
  assert.equal(zoomed.scale, 2);
  assert.equal(zoomed.x, -100);
  // Back to fit always recentres.
  assert.deepEqual(zoomAt(zoomed, 0.5, { x: 50, y: 50 }, stage, fitted), { scale: 1, x: 0, y: 0 });
  // Pan limits: at 2× the image is 800×600 in a 400×600 stage → ±200 horizontally, 0 vertically.
  assert.deepEqual(pan({ scale: 2, x: 0, y: 0 }, -999, 999, stage, fitted), { scale: 2, x: -200, y: 0 });
  assert.deepEqual(clampOffset({ x: 50, y: 50 }, 1, stage, fitted), { x: 0, y: 0 });
  assert.equal(DOUBLE_TAP_SCALE > MIN_SCALE && DOUBLE_TAP_SCALE < MAX_SCALE, true);
});

test('swipes: horizontal turns the page, a pull down closes, small or diagonal moves do nothing', () => {
  assert.equal(classifySwipe(-80, 5, 300), 'next');
  assert.equal(classifySwipe(80, -5, 300), 'prev');
  assert.equal(classifySwipe(-30, 0, 40), 'next', 'a quick flick');
  assert.equal(classifySwipe(-30, 0, 400), null, 'a slow nudge');
  assert.equal(classifySwipe(10, 140, 300), 'dismiss');
  assert.equal(classifySwipe(10, -140, 300), null, 'pushing up never closes');
  assert.equal(classifySwipe(70, 70, 300), null, 'diagonal');
  assert.deepEqual(pinchGeometry({ x: 0, y: 0 }, { x: 30, y: 40 }), { distance: 50, mid: { x: 15, y: 20 } });
});

test('moving between plans stops at the ends', () => {
  assert.equal(stepIndex(0, -1, 3), 0);
  assert.equal(stepIndex(2, 1, 3), 2);
  assert.equal(stepIndex(1, 1, 3), 2);
  assert.equal(stepIndex(5, 0, 2), 1, 'a removed plan leaves the selection on the last one');
  assert.equal(stepIndex(0, 1, 0), 0);
});

/* -------------------------------- uploads -------------------------------- */

const file = (type = 'image/png', size = 1024, name = 'p') => ({ type, size, name });
test('picking more than the room left uploads only what fits; bad files are never uploaded', () => {
  const picked = [file('image/png'), file('application/pdf'), file('image/jpeg'), file('image/webp'), file('image/png', 11 * 1024 * 1024), file('image/png')];
  const { accepted, rejected, overLimit } = planUploadBatch(picked, 2, floorPlanFileError);
  assert.deepEqual(accepted, [picked[0], picked[2]]);
  assert.equal(overLimit, 2);
  assert.deepEqual(rejected.map((item) => item.file), [picked[1], picked[4]]);
  assert.match(rejected[0].message, /JPEG, PNG, or WebP/);
  assert.match(rejected[1].message, /10MB/);
  assert.deepEqual(planUploadBatch([file()], 0, floorPlanFileError), { accepted: [], rejected: [], overLimit: 1 });
});

test('upload flow: sequential foundation adds, a lost race stops the batch, the viewer reloads the real state', () => {
  assert.match(viewer, /for \(const file of accepted\) \{[\s\S]*?const plan = await addFloorPlan\(supabase, homeId, file\);/);
  assert.match(viewer, /error instanceof FloorPlanError && error\.reason === 'limit'\) \{ limitReached = true; break; \}/);
  assert.match(viewer, /await load\(\{ quiet: true, focusId: lastAdded \}\);/);
  // Loading / success / error states are all announced.
  assert.match(viewer, /Adding \$\{Math\.min\(upload\.done \+ 1, upload\.total\)\} of \$\{upload\.total\}…/);
  assert.match(viewer, /role="alert">\{notice\.text\}/);
  assert.match(viewer, /role="status" aria-live="polite"/);
  // The file input is reset so picking the same file again still fires.
  assert.match(viewer, /if \(fileRef\.current\) fileRef\.current\.value = '';/);
});

test('remove asks first and says for everyone; an already-removed plan is explained', () => {
  assert.match(viewer, /Remove this floor plan for everyone on this search\?/);
  assert.match(viewer, /That floor plan was already removed, or you can no longer change floor plans for this home\./);
});

/* ------------------------------ signed URLs ------------------------------ */

test('signed URLs are refreshed before they lapse, on return from the background, and once per failing image', () => {
  assert.equal(FLOOR_PLAN_URL_TTL_SECONDS, 15 * 60);
  assert.match(viewer, /const RESIGN_AFTER_MS = \(FLOOR_PLAN_URL_TTL_SECONDS - 120\) \* 1000;/);
  assert.match(viewer, /document\.visibilityState === 'visible' && Date\.now\(\) - signedAt\.current >= RESIGN_AFTER_MS/);
  assert.match(viewer, /if \(retried\.current\.has\(plan\.id\)\) \{ setBroken/);
  assert.match(viewer, /This floor plan isn’t available right now\./);
  // Edit controls come from a fresh database answer each time, never the card's hint alone.
  assert.match(viewer, /Promise\.all\(\[getFloorPlans\(supabase, homeId\), canEditFloorPlans\(supabase, homeId\)\]\)/);
  assert.match(viewer, /\{canEdit && \(/);
});

/* --------------------------- image memory (WKWebView) --------------------------- */

test('memory: the viewer mounts exactly one full-resolution image — the selected plan — and preloads nothing', () => {
  // One <img> in the whole component, inside ZoomStage, which is keyed by plan.
  assert.equal((viewer.match(/<img\b/g) || []).length, 1);
  const stage = viewer.slice(viewer.indexOf('function ZoomStage('), viewer.indexOf('function FloorPlansViewer('));
  assert.match(stage, /<img\s+ref=\{imageRef\}\s+src=\{plan\.url\}/);
  assert.match(viewer, /<ZoomStage\s+key=\{current\.id\}/);
  assert.equal((viewer.match(/<ZoomStage\b/g) || []).length, 1);
  // No preloading or off-screen decoding of other plans.
  assert.doesNotMatch(viewer, /new Image\(|rel="preload"|rel=.prefetch|\.decode\(\)|createImageBitmap|<canvas|URL\.createObjectURL|fetch\(/);
  assert.match(stage, /decoding="async"/);
});

test('memory: the plan picker is numbered buttons, not thumbnails of the originals', () => {
  const picker = viewer.slice(viewer.indexOf('<ol className="hh-fp-pages"'), viewer.indexOf('</ol>'));
  assert.ok(picker.length > 0, 'numbered picker missing');
  assert.doesNotMatch(picker, /<img|plan\.url|background-?[Ii]mage/);
  assert.match(picker, /aria-label=\{`Floor plan \$\{i \+ 1\} of \$\{plans\.length\}`\}/);
  assert.match(picker, /aria-current=\{i === index \? 'true' : undefined\}/);
  assert.match(picker, /\{i \+ 1\}/);
  assert.doesNotMatch(viewer + fpCss, /hh-fp-thumb/);
  assert.match(fpCss, /\.hh-fp-page \{[^}]*width: 44px; height: 44px;/);
  // Signing is unchanged: one batch of plain signed URLs, no (paid) transforms.
  assert.doesNotMatch(viewer, /transform:\s*\{|render\/image|createSignedUrl\(/);
});

test('memory: a stage that unmounts drops its image src (cancels the download, frees the bitmap) and ignores late events', () => {
  const stage = viewer.slice(viewer.indexOf('function ZoomStage('), viewer.indexOf('function FloorPlansViewer('));
  // A callback ref: object refs are already null when unmount cleanups run.
  assert.match(stage, /const imageRef = useCallback\(\(node\) => \{[\s\S]*?released\.current = true;\s*image\.current\?\.removeAttribute\('src'\);\s*image\.current = null;/);
  assert.doesNotMatch(stage, /imageRef\.current/);
  assert.match(stage, /onLoad=\{\(event\) => \{\s*if \(released\.current\) return;/);
  assert.match(stage, /onError=\{\(\) => \{ if \(!released\.current\) onImageError\?\.\(plan\); \}\}/);
});

test('memory: CSS sizing is not the optimisation — no permanent compositing layer for the zoomed image', () => {
  // The fitted width/height only change how the bitmap is drawn, not its size.
  assert.match(fpCss, /\.hh-fp-image \{[^}]*transform-origin: center;/);
  assert.doesNotMatch(fpCss.match(/\.hh-fp-image \{[^}]*\}/)[0], /will-change/);
  assert.match(fpCss, /\.hh-fp-image\.is-gesturing \{ transition: opacity \.2s ease; will-change: transform; \}/);
});

/* ---------------------------- accessibility / devices ---------------------------- */

test('viewer: modal dialog, focus trap, Escape, labelled 44px controls, keyboard zoom and pan', () => {
  assert.match(viewer, /role="dialog" aria-modal="true" aria-labelledby=\{titleId\}/);
  assert.match(viewer, /event\.key === 'Escape'/);
  assert.match(viewer, /event\.key === 'Tab'/);
  for (const label of ['Close floor plans', 'Previous floor plan', 'Next floor plan', 'Zoom out', 'Fit to screen', 'Zoom in']) assert.match(viewer, new RegExp(`aria-label="${label}"`));
  assert.match(viewer, /aria-label=\{`Floor plan \$\{i \+ 1\} of \$\{plans\.length\}`\}/);
  assert.match(viewer, /previouslyFocused\?\.focus\?\.\(\)/);
  assert.match(fpCss, /\.hh-fp-icon-button \{[^}]*width: 44px; height: 44px;/);
  assert.match(fpCss, /\.hh-fp-text-button \{[^}]*min-height: 44px;/);
});

test('touch: the stage owns its gestures (no page zoom), the viewer clears notch / home bar and sits above the install prompt', () => {
  assert.match(fpCss, /\.hh-fp-canvas \{[^}]*touch-action: none;/);
  assert.match(viewer, /addEventListener\('gesturestart', cancel\)/);
  assert.match(viewer, /addEventListener\('wheel', onWheel, \{ passive: false \}\)/);
  assert.match(fpCss, /\.hh-fp-backdrop \{ position: fixed; inset: 0; z-index: 200;/);
  assert.match(fpCss, /padding: calc\(8px \+ var\(--flh-safe-top, 0px\)\)/);
  assert.match(fpCss, /calc\(12px \+ var\(--flh-safe-bottom, 0px\)\)/);
  assert.match(fpCss, /env\(safe-area-inset-left, 0px\)/);
  assert.match(fpCss, /@media \(orientation: landscape\) and \(max-height: 560px\) \{/);
  assert.match(fpCss, /@media \(prefers-reduced-motion: reduce\) \{\s*\.hh-fp-image \{ transition: none; \}/);
});

/* ------------------------- card state per role (real Postgres) ------------------------- */

const dbTest = (name, fn) => test(name, { skip: DB_TESTS_ENABLED ? false : DB_SKIP_REASON }, fn);
let db;
before(() => { if (DB_TESTS_ENABLED) db = createTestDatabase(); });
after(() => db?.drop());

// The harness's rpc() returns a scalar function's result as [value]; PostgREST
// returns the bare value. Same answer, PostgREST's shape.
const asPostgrest = (client) => ({
  ...client,
  from: client.from,
  storage: client.storage,
  rpc: async (fn, args) => {
    const result = await client.rpc(fn, args);
    return Array.isArray(result.data) && result.data.length === 1 && typeof result.data[0] !== 'object' ? { ...result, data: result.data[0] } : result;
  },
});

dbTest('card state and edit access follow the database: owner / co-buyer edit, Realtor views, removed members get nothing', async () => {
  const { acceptInvitation, createInvitation, removeMember, saveHomePersonalAndShared } = await import('../src/lib/supabase/collaboration.js');
  const { addFloorPlan, canEditFloorPlans, loadFloorPlanCardState } = await import('../src/lib/homeFloorPlans.js');
  const user = (name) => db.createUser({ email: `${name}.fpui@example.com`, firstName: name });
  const owner = user('owner');
  const coBuyer = user('cobuyer');
  const realtorId = user('realtor');
  const outsider = user('outsider');
  const search = db.admin(`select id from public.searches where user_id = '${owner}'`)[0].id;
  for (const [id, role] of [[coBuyer, 'co_buyer'], [realtorId, 'realtor']]) {
    const email = db.admin(`select email from auth.users where id = '${id}'`)[0].email;
    const invitation = await createInvitation(db.clientFor(owner), search, owner, email, role);
    assert.equal((await acceptInvitation(db.clientFor(id), invitation.token)).success, true);
  }
  const as = (id) => asPostgrest(db.clientFor(id));
  const home = (await saveHomePersonalAndShared(db.clientFor(owner), { address: '1 Plan St', status: 'Saved' }, owner, search)).id;
  const other = (await saveHomePersonalAndShared(db.clientFor(owner), { address: '2 Plan St', status: 'Saved' }, owner, search)).id;
  await addFloorPlan(db.clientFor(owner), home, new Blob([new Uint8Array(64)], { type: 'image/png' }));
  await addFloorPlan(db.clientFor(coBuyer), home, new Blob([new Uint8Array(64)], { type: 'image/webp' }));

  const state = (id, withSearch = true) => loadFloorPlanCardState(as(id), withSearch ? { searchId: search, userId: id, homeIds: [home, other] } : { homeIds: [home, other] });
  assert.deepEqual(await state(owner), { canEdit: true, counts: { [home]: 2 } });
  assert.deepEqual(await state(coBuyer), { canEdit: true, counts: { [home]: 2 } });
  assert.deepEqual(await state(realtorId), { canEdit: false, counts: { [home]: 2 } });
  assert.deepEqual(await state(realtorId, false), { canEdit: false, counts: { [home]: 2 } }, 'the Realtor page asks without a search');
  assert.deepEqual(await state(outsider), { canEdit: false, counts: {} }, 'an outsider learns nothing');
  assert.deepEqual(await loadFloorPlanCardState(as(owner), { searchId: search, userId: owner, homeIds: [] }), { canEdit: true, counts: {} });

  assert.equal(await canEditFloorPlans(as(owner), home), true);
  assert.equal(await canEditFloorPlans(as(coBuyer), home), true);
  assert.equal(await canEditFloorPlans(as(realtorId), home), false);
  assert.equal(await canEditFloorPlans(as(outsider), home), false);

  // Removal is immediate: no counts, no edit access.
  await removeMember(db.clientFor(owner), search, coBuyer);
  assert.deepEqual(await state(coBuyer), { canEdit: false, counts: {} });
  assert.equal(await canEditFloorPlans(as(coBuyer), home), false);
  db.exec(`delete from public.search_members where search_id = '${search}' and user_id = '${realtorId}'`);
  assert.deepEqual(await state(realtorId, false), { canEdit: false, counts: {} });
});

test('card state never throws: a failed read leaves counts unknown and edit off', async () => {
  const { loadFloorPlanCardState } = await import('../src/lib/homeFloorPlans.js');
  const broken = {
    from: () => ({ select: () => ({ in: () => Promise.resolve({ data: null, error: { code: '08006', message: 'connection failure' } }) }) }),
    rpc: () => Promise.reject(new Error('offline')),
  };
  assert.deepEqual(await loadFloorPlanCardState(broken, { searchId: 's', userId: 'u', homeIds: ['h'] }), { canEdit: false, counts: null });
  const missing = {
    from: () => ({ select: () => ({ in: () => Promise.resolve({ data: null, error: { code: '42P01', message: 'relation "public.home_floor_plans" does not exist' } }) }) }),
    rpc: () => Promise.resolve({ data: true, error: null }),
  };
  assert.equal(await loadFloorPlanCardState(missing, { searchId: 's', userId: 'u', homeIds: ['h'] }), null, 'not migrated: the feature hides itself');
});
