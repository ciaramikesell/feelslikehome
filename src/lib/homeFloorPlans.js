// Floor plans: up to four images per home, shared by everyone on the home's
// search (supabase/migrations/2026-10-18-home-floor-plans*.sql). Separate from
// the cover photo (homePhoto.js) and never a Match input.
//
// Each plan is a home_floor_plans row pointing at an object in the private
// home-floor-plans bucket at '{homeId}/{uuid}.{ext}'. The database decides who
// may read or write (owner / co-buyer write, connected Realtors read); these
// helpers keep the row and the object consistent:
//   add      upload, then insert the row; a failed insert deletes the upload.
//   replace  upload, then repoint the row only if it still points at the old
//            object; a lost race deletes the new upload. The old object is
//            deleted afterwards, best-effort.
//   remove   delete the row (the plan is gone for everyone), then the object,
//            best-effort.
// Whatever best-effort misses is unreadable to Realtors and is removed by
// scripts/ops/floor-plan-orphans.mjs.
export const FLOOR_PLAN_BUCKET = 'home-floor-plans';
export const MAX_FLOOR_PLANS = 4;
export const MAX_FLOOR_PLAN_BYTES = 10 * 1024 * 1024; // 10MB — matches the bucket limit.
export const FLOOR_PLAN_URL_TTL_SECONDS = 15 * 60;
// Browser-reported type -> [extension, the type the bucket allows].
const FLOOR_PLAN_TYPES = Object.freeze({
  'image/jpeg': ['jpg', 'image/jpeg'],
  'image/jpg': ['jpg', 'image/jpeg'],
  'image/png': ['png', 'image/png'],
  'image/webp': ['webp', 'image/webp'],
});
export const FLOOR_PLAN_ACCEPT = 'image/jpeg,image/png,image/webp';
const COLUMNS = 'id,home_id,storage_path,created_by,created_at,updated_at';

export class FloorPlanError extends Error {
  // reason: 'invalid-file' | 'limit' | 'upload-failed' | 'save-failed' | 'changed'
  constructor(reason, message, cause = null) {
    super(message);
    this.name = 'FloorPlanError';
    this.reason = reason;
    this.cause = cause;
  }
}

// '' when the file is acceptable, otherwise the message to show.
export function floorPlanFileError(file) {
  if (!file) return '';
  if (!FLOOR_PLAN_TYPES[file.type]) return 'Please choose a JPEG, PNG, or WebP image.';
  if (file.size > MAX_FLOOR_PLAN_BYTES) return 'That image is larger than 10MB — please choose a smaller one.';
  return '';
}

// True when the database has not had the floor-plans migration yet: the UI
// hides the feature instead of failing (any other error still surfaces).
export function isFloorPlansUnavailable(error) {
  if (!error) return false;
  const message = error.message || '';
  return ['42P01', 'PGRST205'].includes(error.code) || (/home_floor_plans/.test(message) && /does not exist|Could not find the table/.test(message));
}

const isLimitError = (error) => error?.hint === 'floor_plan_limit' || /at most 4 floor plans/.test(error?.message || '');

function fromRow(row) {
  return {
    id: row.id,
    homeId: row.home_id,
    storagePath: row.storage_path,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Count per home, for the My Homes card. null when the feature is unavailable.
export async function getFloorPlanCounts(supabase, homeIds) {
  const counts = new Map();
  if (!homeIds.length) return counts;
  const { data, error } = await supabase.from('home_floor_plans').select('home_id').in('home_id', homeIds);
  if (isFloorPlansUnavailable(error)) return null;
  if (error) throw error;
  for (const row of data || []) counts.set(row.home_id, (counts.get(row.home_id) || 0) + 1);
  return counts;
}

// A home's plans, oldest first. null when the feature is unavailable.
export async function getFloorPlans(supabase, homeId) {
  const { data, error } = await supabase.from('home_floor_plans').select(COLUMNS).eq('home_id', homeId)
    .order('created_at', { ascending: true }).order('id', { ascending: true });
  if (isFloorPlansUnavailable(error)) return null;
  if (error) throw error;
  return (data || []).map(fromRow);
}

// Each plan with a short-lived `url`, or url: null when its image is missing
// or no longer readable (the viewer shows "not available").
export async function signFloorPlanUrls(supabase, plans, expiresIn = FLOOR_PLAN_URL_TTL_SECONDS) {
  if (!plans.length) return [];
  const { data, error } = await supabase.storage.from(FLOOR_PLAN_BUCKET).createSignedUrls(plans.map((plan) => plan.storagePath), expiresIn);
  if (error) throw error;
  const byPath = new Map((data || []).map((entry) => [entry.path, entry.error ? null : (entry.signedUrl || null)]));
  return plans.map((plan) => ({ ...plan, url: byPath.get(plan.storagePath) ?? null }));
}

async function uploadFloorPlanFile(supabase, homeId, file) {
  const problem = floorPlanFileError(file);
  if (!file || problem) throw new FloorPlanError('invalid-file', problem || 'Please choose an image.');
  const [ext, contentType] = FLOOR_PLAN_TYPES[file.type];
  const path = `${homeId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from(FLOOR_PLAN_BUCKET).upload(path, file, { contentType, upsert: false });
  if (error) throw new FloorPlanError('upload-failed', "We couldn't upload that floor plan — please try again.", error);
  return path;
}

async function removeObjects(supabase, paths) {
  try {
    await supabase.storage.from(FLOOR_PLAN_BUCKET).remove(paths);
  } catch {
    // Best-effort: a leftover object is unreadable to Realtors and cleaned up by the operator script.
  }
}

export async function addFloorPlan(supabase, homeId, file) {
  const problem = floorPlanFileError(file);
  if (!file || problem) throw new FloorPlanError('invalid-file', problem || 'Please choose an image.');
  // Saves a pointless upload in the common case; the database enforces the limit.
  const existing = await supabase.from('home_floor_plans').select('id').eq('home_id', homeId);
  if (existing.error) throw existing.error;
  if ((existing.data || []).length >= MAX_FLOOR_PLANS) throw new FloorPlanError('limit', `A home can have up to ${MAX_FLOOR_PLANS} floor plans.`);

  const path = await uploadFloorPlanFile(supabase, homeId, file);
  const { data, error } = await supabase.from('home_floor_plans').insert({ home_id: homeId, storage_path: path }).select(COLUMNS).single();
  if (error || !data) {
    await removeObjects(supabase, [path]);
    if (isLimitError(error)) throw new FloorPlanError('limit', `A home can have up to ${MAX_FLOOR_PLANS} floor plans.`, error);
    throw new FloorPlanError('save-failed', "We couldn't save that floor plan — please try again.", error);
  }
  return fromRow(data);
}

export async function replaceFloorPlan(supabase, plan, file) {
  const path = await uploadFloorPlanFile(supabase, plan.homeId, file);
  const { data, error } = await supabase.from('home_floor_plans').update({ storage_path: path })
    .eq('id', plan.id).eq('storage_path', plan.storagePath).select(COLUMNS);
  if (error || (data || []).length !== 1) {
    await removeObjects(supabase, [path]);
    if (error) throw new FloorPlanError('save-failed', "We couldn't replace that floor plan — please try again.", error);
    throw new FloorPlanError('changed', 'Someone else just changed this floor plan. Here is the latest version.');
  }
  await removeObjects(supabase, [plan.storagePath]);
  return fromRow(data[0]);
}

// true when this call removed it; false when it was already gone (or the
// caller may not remove it).
export async function removeFloorPlan(supabase, plan) {
  const { data, error } = await supabase.from('home_floor_plans').delete().eq('id', plan.id).select('id');
  if (error) throw error;
  if (!(data || []).length) return false;
  await removeObjects(supabase, [plan.storagePath]);
  return true;
}

// Pure. Bucket objects no row references, older than minAgeMs (so an upload
// whose row is still being inserted is never touched).
export function selectOrphanedFloorPlanObjects({ objects, referencedPaths, now = Date.now(), minAgeMs = 24 * 60 * 60 * 1000 }) {
  const referenced = new Set(referencedPaths);
  return objects
    .filter((object) => !referenced.has(object.name))
    .filter((object) => {
      const created = Date.parse(object.created_at);
      return Number.isFinite(created) && now - created >= minAgeMs;
    })
    .map((object) => object.name);
}
