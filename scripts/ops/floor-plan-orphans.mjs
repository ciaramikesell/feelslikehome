#!/usr/bin/env node
// Operator sweep for the private home-floor-plans bucket: finds images no
// home_floor_plans row references (left by a deleted home, a best-effort
// delete that failed, or an abandoned upload) and, with --apply, deletes them.
// Postgres cannot delete Storage objects itself, so this is the cleanup path.
//
//   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node scripts/ops/floor-plan-orphans.mjs           # dry run: counts only
//   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node scripts/ops/floor-plan-orphans.mjs --apply   # delete them
//
// Dry run by default. Only objects older than 24 hours are touched, so an
// upload whose row is still being written is never removed. Prints counts,
// never image contents. The service-role key bypasses RLS: run it from a
// trusted machine and never commit or paste the key.
import { createClient } from '@supabase/supabase-js';
import { FLOOR_PLAN_BUCKET, selectOrphanedFloorPlanObjects } from '../../src/lib/homeFloorPlans.js';

const PAGE = 1000;
const apply = process.argv.includes('--apply');
const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const storage = supabase.storage.from(FLOOR_PLAN_BUCKET);

async function list(prefix) {
  const entries = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await storage.list(prefix, { limit: PAGE, offset, sortBy: { column: 'name', order: 'asc' } });
    if (error) throw error;
    entries.push(...data);
    if (data.length < PAGE) return entries;
  }
}

async function referencedPaths() {
  const paths = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase.from('home_floor_plans').select('storage_path').order('id').range(from, from + PAGE - 1);
    if (error) throw error;
    paths.push(...data.map((row) => row.storage_path));
    if (data.length < PAGE) return paths;
  }
}

// Folders come back without an id; files with one.
const folders = (await list('')).filter((entry) => entry.id === null).map((entry) => entry.name);
const objects = [];
for (const folder of folders) {
  for (const entry of await list(folder)) {
    if (entry.id !== null) objects.push({ name: `${folder}/${entry.name}`, created_at: entry.created_at });
  }
}
const orphans = selectOrphanedFloorPlanObjects({ objects, referencedPaths: await referencedPaths() });
console.log(`${objects.length} images in ${folders.length} home folders; ${orphans.length} unreferenced and older than 24 hours.`);

if (!apply) {
  console.log(orphans.length ? 'Dry run: nothing deleted. Re-run with --apply to delete them.' : 'Nothing to clean up.');
} else {
  let deleted = 0;
  for (let i = 0; i < orphans.length; i += 100) {
    const { data, error } = await storage.remove(orphans.slice(i, i + 100));
    if (error) throw error;
    deleted += data.length;
  }
  console.log(`Deleted ${deleted} of ${orphans.length}.`);
}
