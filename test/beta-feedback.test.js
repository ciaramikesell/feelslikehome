import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  BETA_FEEDBACK_MESSAGE_MAX,
  buildBetaFeedbackPayload,
  deviceClassForWidth,
  homeIdFromPathname,
  shouldShowBetaFeedback,
} from '../src/lib/betaFeedback.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const component = read('src/components/BetaFeedback.jsx');
const migration = read('supabase/migrations/2026-09-09-pre-beta-feedback.sql');
const schema = read('supabase/schema.sql');
const verifier = read('supabase/beta-feedback-verification.sql');

test('central flag controls widget visibility without deployment configuration', () => {
  assert.equal(shouldShowBetaFeedback(true), true);
  assert.equal(shouldShowBetaFeedback(false), false);
  assert.match(read('src/lib/betaFeedback.js'), /BETA_FEEDBACK_ENABLED = true/);
  assert.match(component, /if \(!shouldShowBetaFeedback\(enabled\)\) return null/);
  assert.match(read('src/components/AppShell.jsx'), /<BetaFeedback userId=\{userId\}/);
  assert.match(read('src/components/onboarding/Onboarding.jsx'), /<BetaFeedback userId=\{userId\}/);
});

test('context payload is a strict privacy-safe allowlist', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const homeId = '22222222-2222-4222-8222-222222222222';
  const payload = buildBetaFeedbackPayload({
    userId: id, pathname: `/homes/${homeId}`, searchId: id, searchType: 'rent_home',
    feedbackType: null, message: '  Font needs to be bigger.  ', viewport: { width: 390.4, height: 844.2 },
    userAgent: 'Browser', appVersion: 'build-1', arbitraryState: { notes: 'private' },
  });
  assert.deepEqual(Object.keys(payload), [
    'user_id', 'search_id', 'home_id', 'route', 'search_intent', 'feedback_type',
    'message', 'is_blocking', 'viewport_width', 'viewport_height', 'device_class',
    'user_agent', 'app_version', 'screenshot_path',
  ]);
  assert.equal(payload.message, 'Font needs to be bigger.');
  assert.equal(payload.home_id, homeId);
  assert.equal(payload.search_intent, 'rental');
  assert.equal(payload.device_class, 'mobile');
  assert.equal(JSON.stringify(payload).includes('private'), false);
});

test('optional context stays null and route home IDs require the expected shape', () => {
  const payload = buildBetaFeedbackPayload({ userId: 'user', pathname: '/compare', message: 'Idea' });
  for (const key of ['search_id', 'home_id', 'search_intent', 'feedback_type', 'viewport_width', 'viewport_height', 'device_class', 'user_agent', 'app_version', 'screenshot_path']) {
    assert.equal(payload[key], null, key);
  }
  assert.equal(homeIdFromPathname('/homes/not-an-id'), null);
  assert.equal(deviceClassForWidth(639), 'mobile');
  assert.equal(deviceClassForWidth(640), 'tablet');
  assert.equal(deviceClassForWidth(1024), 'desktop');
});

test('drawer interaction, reliability, and accessible semantics stay focused', () => {
  assert.match(component, /aria-haspopup="dialog"/);
  assert.match(component, /role="dialog" aria-modal="false" aria-labelledby=/);
  assert.match(component, /event\.key === 'Escape'/);
  assert.match(component, /<label className="hh-label" htmlFor="beta-feedback-message">What did you notice\?<\/label>/);
  assert.match(component, /aria-pressed=\{feedbackType === type\}/);
  assert.match(component, /type="checkbox"/);
  assert.match(component, /if \(status === 'submitting'\) return/);
  assert.match(component, /disabled=\{status === 'submitting'\}/);
  assert.match(component, /Your note is still here/);
  assert.match(component, /role="alert"/);
  assert.match(component, /role="status">Thanks — got it!/);
  assert.match(component, /setMessage\(''\)[\s\S]*setOpen\(false\)/);
  assert.doesNotMatch(component, /screenshot|file|FormData/i);
  assert.equal(BETA_FEEDBACK_MESSAGE_MAX, 2000);
});

test('migration and canonical schema match the one-way feedback security contract', () => {
  for (const sql of [migration, schema]) {
    assert.match(sql, /beta_feedback[\s\S]*?enable row level security/i);
    assert.match(sql, /revoke all on table public\.beta_feedback from public, anon, authenticated/i);
    assert.match(sql, /grant insert \([\s\S]*?\) on public\.beta_feedback to authenticated/i);
    assert.doesNotMatch(sql, /grant (select|update|delete|all)[^;]*beta_feedback/i);
    assert.match(sql, /with check \(auth\.uid\(\) is not null and auth\.uid\(\) = user_id\)/i);
    assert.match(sql, /beta_feedback_type_check[\s\S]*?'broken','confusing','idea'/i);
    assert.match(sql, /beta_feedback_search_intent_check[\s\S]*?'purchase','rental','investment'/i);
    assert.match(sql, /char_length\(btrim\(message\)\) between 1 and 2000/i);
  }
  assert.doesNotMatch(migration, /references public\.(searches|homes)/i);
  assert.doesNotMatch(migration, /create policy[\s\S]*?for (select|update|delete)/i);
});

test('focused verifier is read-only and checks schema, caller binding, denials, and Pass 3C', () => {
  assert.match(verifier, /begin transaction read only/);
  assert.match(verifier, /exact_columns/);
  assert.match(verifier, /rls_enabled/);
  assert.match(verifier, /no_authenticated_select/);
  assert.match(verifier, /no_authenticated_update/);
  assert.match(verifier, /no_authenticated_delete/);
  assert.match(verifier, /caller_bound_insert_only/);
  assert.match(verifier, /pass_3c_grants_unchanged/);
  assert.match(verifier, /rollback;/);
});
