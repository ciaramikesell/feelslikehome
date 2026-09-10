import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('invite and join flows disclose visible-but-owner-controlled search activity', async () => {
  const [invite, accept, howTo] = await Promise.all([
    source('src/components/InviteCoBuyer.jsx'),
    source('src/app/invite/[token]/AcceptInvitationClient.jsx'),
    source('src/components/AppShell.jsx'),
  ]);
  assert.match(invite, /Invite collaborator/);
  assert.match(invite, /aren&apos;t hidden/);
  assert.match(invite, /don&apos;t combine them into one score or let another person change/);
  assert.match(accept, /see each other&apos;s search preferences and opinions/);
  assert.match(accept, /no one else can change them for you/);
  assert.match(accept, />\s*Join search\s*</);
  assert.match(howTo, /The conversation is shared/);
  for (const sourceText of [invite, accept]) assert.doesNotMatch(sourceText, /relationship type|spouse|roommate|gender/i);
});

test('collaborator context RPC is search-scoped, narrow, and read-only', async () => {
  const [migration, collaboration] = await Promise.all([
    source('supabase/migrations/2026-09-10-shared-search-collaboration-contract.sql'),
    source('src/lib/supabase/collaboration.js'),
  ]);
  assert.match(migration, /can_access_search\(p_search_id, v_caller\)/);
  assert.match(migration, /h\.search_id = p_search_id and hms\.user_id = v_collaborator/);
  assert.match(migration, /d\.search_id = p_search_id and d\.user_id = v_collaborator/);
  assert.match(migration, /revoke all .* from public/);
  assert.match(migration, /grant execute .* to authenticated/);
  assert.doesNotMatch(migration, /grant select .*search_member_priorities|grant select .*home_member_state|grant select .*commute_destinations/is);
  assert.match(collaboration, /rpc\('resolve_collaborator_search_context'/);
});

test('approved perspectives stay separate and participant writes stay owner-scoped', async () => {
  const [compare, collaboration, schema] = await Promise.all([
    source('src/components/CompareBoard.jsx'),
    source('src/lib/supabase/collaboration.js'),
    source('supabase/schema.sql'),
  ]);
  assert.match(compare, /Perspective label="You"/);
  assert.match(compare, /Perspective label="Collaborator"/);
  assert.match(compare, /Different Takes/);
  assert.doesNotMatch(compare, /Couple Match|Combined Match|Household Match|average Match/i);
  assert.match(collaboration, /user_id: userId/);
  assert.match(schema, /smp_own_update[\s\S]*auth\.uid\(\) = user_id/);
  assert.match(schema, /hms_own_update[\s\S]*auth\.uid\(\) = user_id/);
  assert.match(schema, /commute_destinations_update_own[\s\S]*auth\.uid\(\) = user_id/);
});
