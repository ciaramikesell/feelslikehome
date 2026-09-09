import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('home reads combine shared allowlisted facts with caller-owned state and sanitized lifecycle signals', async () => {
  const collaboration = await source('src/lib/supabase/collaboration.js');
  assert.match(collaboration, /from\('homes'\)\.select\(HOME_SHARED_COLUMNS\)/);
  assert.match(collaboration, /from\('home_member_state'\)[\s\S]*\.eq\('user_id', userId\)\.in\('home_id', homeIds\)/);
  assert.match(collaboration, /rpc\('resolve_cobuyer_lifecycle_signals'/);
  assert.match(collaboration, /co_buyer_wants_to_tour/);
  assert.match(collaboration, /all_participants_archived/);
  assert.doesNotMatch(collaboration, /from\('home_member_state'\)[\s\S]{0,180}\.in\('user_id'/);
  assert.doesNotMatch(collaboration, /if \(home\.userId === userId\)/);
});

test('all owner and collaborator personal writes use home_member_state while shared facts use homes', async () => {
  const collaboration = await source('src/lib/supabase/collaboration.js');
  assert.match(collaboration, /from\('homes'\)\.upsert\(sharedRow\)\.select\(HOME_SHARED_COLUMNS\)/);
  assert.match(collaboration, /await upsertPersonalState\(supabase, savedHome\.id, userId, personal\)/);
  assert.match(collaboration, /saveHomePersonalState[\s\S]*upsertPersonalState\(supabase, home\.id, userId, personal\)/);
  assert.doesNotMatch(collaboration, /isLegacyOwnerSave|isCollaborativeSearch/);
  assert.doesNotMatch(collaboration, /status: home\.status \|\| 'Considering'/);
  for (const sharedField of ['notes: home.notes', 'pros: home.pros', 'cons: home.cons', 'address: home.address']) {
    assert.ok(collaboration.includes(sharedField), `${sharedField} remains shared`);
  }
});

test('priorities read and write only the current participant table, including onboarding', async () => {
  const [collaboration, onboardingPage, onboarding] = await Promise.all([
    source('src/lib/supabase/collaboration.js'),
    source('src/app/onboarding/page.js'),
    source('src/components/onboarding/Onboarding.jsx'),
  ]);
  assert.match(collaboration, /from\('search_member_priorities'\)\.select\('priorities'\).*\.eq\('user_id', userId\)/);
  assert.match(collaboration, /from\('search_member_priorities'\)[\s\S]*\.upsert\(\{ search_id: search\.id, user_id: userId, priorities: savedPriorities \}/);
  assert.match(collaboration, /savedPriorities = prioritiesForExplicitSave\(priorities\)/);
  assert.doesNotMatch(collaboration, /search\.priorities/);
  assert.doesNotMatch(collaboration, /from\('searches'\)\.update\(\{ priorities/);
  assert.match(onboardingPage, /resolvePriorities\(supabase, search, user\.id\)/);
  assert.match(onboarding, /savePriorities\(createClient\(\), \{ id: searchId \}, userId, next\)/);
});

test('runtime search and home metadata reads contain no broad select star', async () => {
  const paths = [
    'src/lib/supabase/collaboration.js',
    'src/lib/supabase/data.js',
    'src/app/api/commute/route.js',
  ];
  const contents = await Promise.all(paths.map(source));
  for (let i = 0; i < paths.length; i += 1) {
    assert.doesNotMatch(contents[i], /from\(['"](?:homes|searches)['"]\)\.select\(['"]\*['"]\)/, paths[i]);
  }
  assert.match(contents[2], /from\('commute_destinations'\)\.select\('\*'\)\.eq\('search_id', search\.id\)[\s\S]*\.eq\('user_id', user\.id\)/);
});
