#!/usr/bin/env node
// Real-Supabase smoke test for floor-plan Storage, run BEFORE the UI ships.
// It runs scripts/qa/floor-plans-storage-scenarios.mjs as four real signed-in
// test users against a Supabase project where both floor-plan migrations are
// applied and verified. It uses only the anon key and those users' own
// sessions — never a service-role key — so it can only do what the policies
// allow, which is what it checks.
//
// Setup (once per project): create four confirmed test accounts in that
// project's Auth (owner, co-buyer, Realtor, outsider). The script connects the
// co-buyer and Realtor to the owner's search if they are not already, adds
// one temporary home, runs the scenarios, and deletes the home and every
// image it created. Memberships between the test accounts are left in place.
//
//   FLH_SMOKE_URL=https://<ref>.supabase.co FLH_SMOKE_ANON_KEY=… \
//   FLH_SMOKE_OWNER=owner@… FLH_SMOKE_COBUYER=… FLH_SMOKE_REALTOR=… FLH_SMOKE_OUTSIDER=… \
//   FLH_SMOKE_PASSWORD=… \
//   node scripts/qa/floor-plans-storage-smoke.mjs --project=<ref>
//
// --project must repeat the project ref from FLH_SMOKE_URL: a guard against
// pointing it at the wrong project. It writes (temporarily) to that project.
import { register } from 'node:module';
import { createClient } from '@supabase/supabase-js';
import { runFloorPlanStorageScenarios } from './floor-plans-storage-scenarios.mjs';

register('../../test/support/aliasHooks.mjs', import.meta.url);
const { acceptInvitation, createInvitation, saveHomePersonalAndShared } = await import('../../src/lib/supabase/collaboration.js');
const { deleteHome } = await import('../../src/lib/supabase/data.js');

const env = process.env;
const required = ['FLH_SMOKE_URL', 'FLH_SMOKE_ANON_KEY', 'FLH_SMOKE_OWNER', 'FLH_SMOKE_COBUYER', 'FLH_SMOKE_REALTOR', 'FLH_SMOKE_OUTSIDER', 'FLH_SMOKE_PASSWORD'];
const missing = required.filter((name) => !env[name]);
if (missing.length) { console.error(`Missing: ${missing.join(', ')}`); process.exit(1); }
const ref = new URL(env.FLH_SMOKE_URL).hostname.split('.')[0];
const confirmed = process.argv.find((arg) => arg.startsWith('--project='))?.slice('--project='.length);
if (confirmed !== ref) { console.error(`Refusing to run: pass --project=${ref} to confirm the target project.`); process.exit(1); }

const client = () => createClient(env.FLH_SMOKE_URL, env.FLH_SMOKE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
async function signIn(email) {
  const supabase = client();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password: env.FLH_SMOKE_PASSWORD });
  if (error) throw new Error(`Sign-in failed for ${email}: ${error.message}`);
  return { supabase, userId: data.user.id, email };
}

const people = {
  owner: await signIn(env.FLH_SMOKE_OWNER),
  coBuyer: await signIn(env.FLH_SMOKE_COBUYER),
  realtor: await signIn(env.FLH_SMOKE_REALTOR),
  outsider: await signIn(env.FLH_SMOKE_OUTSIDER),
};
const { data: search, error: searchError } = await people.owner.supabase.from('searches').select('id').eq('user_id', people.owner.userId).single();
if (searchError) throw searchError;

for (const [who, role] of [['coBuyer', 'co_buyer'], ['realtor', 'realtor']]) {
  const { data: member } = await people[who].supabase.from('search_members').select('role').eq('search_id', search.id).eq('user_id', people[who].userId).maybeSingle();
  if (member?.role === role) continue;
  if (member) throw new Error(`${people[who].email} is already a ${member.role} on the owner's search; use a fresh test account.`);
  const invitation = await createInvitation(people.owner.supabase, search.id, people.owner.userId, people[who].email, role);
  const accepted = await acceptInvitation(people[who].supabase, invitation.token);
  if (!accepted.success) throw new Error(`Could not connect ${people[who].email} as ${role}: ${accepted.reason}`);
}

const home = await saveHomePersonalAndShared(people.owner.supabase, { address: `FLH floor-plan smoke ${new Date().toISOString()}`, status: 'Saved' }, people.owner.userId, search.id);
let results = [];
try {
  results = await runFloorPlanStorageScenarios({
    clients: { owner: people.owner.supabase, coBuyer: people.coBuyer.supabase, realtor: people.realtor.supabase, outsider: people.outsider.supabase, anon: client() },
    homeId: home.id,
    fetchSigned: async (url) => {
      const response = await fetch(url);
      await response.arrayBuffer();
      return { status: response.status, contentType: response.headers.get('content-type') };
    },
  });
} finally {
  await deleteHome(people.owner.supabase, home.id);
}

for (const { name, ok, info, detail } of results) console.log(`${info ? 'INFO' : ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
const checks = results.filter((result) => !result.info);
const failed = checks.filter((result) => !result.ok).length;
console.log(`\n${checks.length - failed} passed, ${failed} failed on project ${ref}.`);
process.exit(failed ? 1 : 0);
