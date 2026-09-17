import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const hotfix = read('supabase/migrations/2026-09-17-listing-import-z-privileges-hotfix.sql');
const provenance = read('supabase/migrations/2026-09-17-listing-import-provenance.sql');
const privacy = read('supabase/migrations/2026-09-09-pass-3c3-lock-legacy-privacy.sql');
const foundation = read('supabase/migrations/2026-09-05-cobuyer-phase-a-foundation.sql');
const realtorRoles = read('supabase/migrations/2026-09-16-realtor-role-foundation.sql');
const suggestions = read('supabase/migrations/2026-09-16-realtor-suggestions.sql');
const collaboration = read('src/lib/supabase/collaboration.js');
const schema = read('supabase/schema.sql');

function schemaPolicy(name) {
  const found = schema.match(new RegExp(`create policy "${name}"[\\s\\S]*?;`));
  assert.ok(found, `missing policy ${name}`);
  return found[0];
}

test('new Homes projection column receives the least-privilege ACL needed by reads and saves', () => {
  assert.match(provenance, /add column if not exists listing_import jsonb/);
  assert.match(collaboration, /HOME_SHARED_COLUMNS_PRE_PASS_B[\s\S]*?'listing_import'/);
  assert.match(collaboration, /listing_import: home\.listingImport \|\| null/);

  for (const privilege of ['select', 'insert', 'update']) {
    assert.match(hotfix, new RegExp(`grant ${privilege} \\(listing_import\\) on public\\.homes to authenticated;`, 'i'));
    assert.match(schema, new RegExp(`grant ${privilege} \\(listing_import\\) on public\\.homes to authenticated;`, 'i'));
  }
});

test('hotfix preserves the intentional no-table-SELECT privacy boundary', () => {
  assert.match(privacy, /revoke select, insert, update on table public\.homes from authenticated/);
  assert.doesNotMatch(hotfix, /grant\s+(?:all|select)\s+on\s+(?:table\s+)?public\.homes/i);
  assert.doesNotMatch(hotfix, /grant\s+all|all tables|disable row level security|drop policy/i);
});

test('Homes SELECT remains RLS-scoped to accepted search relationships', () => {
  assert.match(schema, /alter table public\.homes enable row level security/);
  const select = schemaPolicy('homes_select_member');
  assert.match(select, /can_access_search\(search_id, auth\.uid\(\)\)/);

  const access = foundation.match(/create or replace function public\.can_access_search\([\s\S]*?\$\$;/i)?.[0] || '';
  assert.match(access, /is_search_owner\(p_search_id, p_user_id\)/);
  assert.match(access, /is_search_member\(p_search_id, p_user_id\)/);
  assert.doesNotMatch(access, /search_invitations|invited_email/);
});

test('decision-maker writes, Realtor read-only access, and staged-home rules remain closed', () => {
  const insert = suggestions.match(/create policy "homes_insert_decision_maker"[\s\S]*?;/)?.[0] || '';
  const update = suggestions.match(/create policy "homes_update_decision_maker"[\s\S]*?;/)?.[0] || '';
  assert.match(insert, /not suggestion_staged/);
  assert.match(update, /not suggestion_staged/);
  assert.match(insert, /is_search_decision_maker/);
  assert.match(update, /is_search_decision_maker/);

  const decisionMaker = realtorRoles.match(/create or replace function public\.is_search_decision_maker\([\s\S]*?\$\$;/i)?.[0] || '';
  assert.match(decisionMaker, /is_search_owner/);
  assert.match(decisionMaker, /sm\.role = 'co_buyer'/);
  assert.doesNotMatch(decisionMaker, /sm\.role = 'realtor'/);
  assert.match(collaboration, /eq\('suggestion_staged', false\)/);
});

test('archived and participant-owned state semantics are unaffected', () => {
  const select = schemaPolicy('homes_select_member');
  assert.doesNotMatch(select, /status|Archived|suggestion_staged/);
  assert.match(schemaPolicy('hms_participant_or_realtor_select'), /auth\.uid\(\) = user_id or public\.is_search_realtor/);
  assert.doesNotMatch(hotfix, /home_member_state|realtor_suggestions|suggestion_dispositions/);
});
