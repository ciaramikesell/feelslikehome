const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const migration = fs.readFileSync('supabase/migrations/2026-09-16-realtor-role-foundation.sql', 'utf8');
const collaboration = fs.readFileSync('src/lib/supabase/collaboration.js', 'utf8');
const invite = fs.readFileSync('src/components/InviteCoBuyer.jsx', 'utf8');
const acceptance = fs.readFileSync('src/app/invite/[token]/AcceptInvitationClient.jsx', 'utf8');
const schema = fs.readFileSync('supabase/schema.sql', 'utf8');

function policy(name) {
  const found = migration.match(new RegExp(`create policy "${name}"[\\s\\S]*?;`));
  assert.ok(found, `missing policy ${name}`);
  return found[0];
}

test('roles are relationship-scoped and existing collaborators safely become co-buyers', () => {
  assert.match(migration, /update public\.search_members set role = 'co_buyer' where role = 'member'/);
  assert.match(migration, /check \(role in \('co_buyer', 'realtor'\)\)/);
  assert.doesNotMatch(migration, /users[^;]*role|profiles[^;]*realtor/i);
  assert.match(migration, /update public\.search_invitations set relationship_type = 'co_buyer' where relationship_type is null/);
});

test('realtor invitation creation, preview, and acceptance preserve the intended relationship', () => {
  assert.match(invite, /value="realtor"/);
  assert.match(collaboration, /relationship_type: relationshipType/);
  assert.match(migration, /returns table \(valid boolean, reason text, relationship_type text\)/);
  assert.match(migration, /values\(inv\.search_id,caller,inv\.relationship_type\)/);
  assert.match(acceptance, /Join as Realtor/);
});

test('invite acceptance stays authenticated, email-bound, expiring, and tamper constrained', () => {
  assert.match(migration, /if caller is null/);
  assert.match(migration, /lower\(caller_email\) is distinct from lower\(inv\.invited_email\)/);
  assert.match(migration, /inv\.status = 'expired' or inv\.expires_at < now\(\)/);
  assert.match(migration, /check \(relationship_type in \('co_buyer', 'realtor'\)\)/);
  assert.match(migration, /relationship_conflict/);
  assert.match(migration, /drop policy if exists "search_members_owner_insert"/);
});

test('realtor reads joined-search decision context while cross-search access remains role keyed', () => {
  for (const name of ['smp_participant_or_realtor_select', 'hms_participant_or_realtor_select', 'commute_destinations_participant_or_realtor_select']) {
    assert.match(policy(name), /is_search_realtor/);
  }
  assert.match(migration, /where sm\.search_id = p_search_id and sm\.user_id = p_user_id and sm\.role = 'realtor'/);
  assert.match(schema, /create policy "homes_select_member"[\s\S]*can_access_search\(search_id, auth\.uid\(\)\)/);
});

test('realtor cannot mutate buyer or co-buyer priorities, home state, commute, or shared homes', () => {
  for (const name of ['smp_decision_maker_insert', 'smp_decision_maker_update', 'hms_decision_maker_insert', 'hms_decision_maker_update', 'commute_destinations_decision_maker_insert', 'commute_destinations_decision_maker_update', 'commute_destinations_decision_maker_delete', 'homes_insert_decision_maker', 'homes_update_decision_maker']) {
    assert.match(policy(name), /is_search_decision_maker/);
  }
  assert.match(migration, /is_search_owner\(p_search_id, p_user_id\) or exists[\s\S]*sm\.role = 'co_buyer'/);
  assert.doesNotMatch(policy('homes_insert_decision_maker'), /can_access_search/);
});

test('realtors never become Match, compare, or archive decision participants', () => {
  const roleFilters = migration.match(/sm\.role = 'co_buyer'/g) || [];
  assert.ok(roleFilters.length >= 5, 'decision RPCs and helper must filter co-buyers');
  assert.match(collaboration, /\.eq\('role', 'co_buyer'\)/);
  assert.doesNotMatch(migration, /Realtor Match/i);
});

test('same account may have a different relationship on each search', () => {
  assert.match(schema, /unique \(search_id, user_id\)/);
  assert.doesNotMatch(schema, /unique\s*\(user_id, role\)/);
  assert.match(collaboration, /membership\?\.role === 'realtor'/);
});

test('archived-home and Match visibility do not grant input mutation', () => {
  const homeReadPolicy = schema.match(/create policy "homes_select_member"[\s\S]*?;/)[0];
  assert.doesNotMatch(homeReadPolicy, /status/);
  assert.match(policy('hms_participant_or_realtor_select'), /is_search_realtor/);
  assert.match(policy('smp_decision_maker_update'), /auth\.uid\(\) = user_id/);
});
