import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

/* -------------------------------------------------------------------------
 * PR #85: My Search / My Criteria visual refresh.
 *
 * This repo's test suite is source-pattern based (no Next.js/React runtime
 * harness is available in this sandbox) — these tests follow that same
 * convention, matching the style already used for MySearchPanel.jsx and
 * PriorityBoard.jsx elsewhere (see map-mysearch-mobile-pass.test.js,
 * pass-c-search-preferences.test.js). They verify the redesign's structural
 * and copy invariants; they cannot execute the components against fixture
 * data (solo/collaborative/incomplete Supabase rows) the way a component
 * test runner would.
 * ------------------------------------------------------------------------- */

test('solo owner: Searching Together shows the solo state and the invite action, not a collaborator summary', async () => {
  const panel = await source('src/components/MySearchPanel.jsx');
  assert.match(panel, /const isCollaborative = participantCount > 1;/);
  assert.match(panel, /\{isCollaborative \? \(/);
  assert.match(panel, /You&apos;re searching alone\./);
  assert.match(panel, /isOwner && \(/);
  assert.match(panel, /<InviteCoBuyer searchId=\{search\.id\} userId=\{userId\} \/>/);
});

test('owner + co-buyer with completed criteria: a real display name and compact tier/place counts, not an itemized list', async () => {
  const panel = await source('src/components/MySearchPanel.jsx');
  assert.match(panel, /Connected with \{name\}\./);
  assert.match(panel, /\{name\}&apos;s priorities/);
  assert.match(panel, /\{name\}&apos;s places/);
  assert.match(panel, /countOf\('must'\)/);
  assert.match(panel, /countOf\('important'\)/);
  assert.match(panel, /countOf\('nice'\)/);
  // Deliberately compact, not itemized — the old chip-list/address-list
  // rendering of the collaborator's actual priorities/places is gone.
  assert.doesNotMatch(panel, /hh-collaborator-priorities|hh-collaborator-places/);
});

test('owner + co-buyer with incomplete criteria: a simple truthful state using natural language, never the forbidden database-oriented phrasing', async () => {
  const panel = await source('src/components/MySearchPanel.jsx');
  assert.match(panel, /hasn&apos;t added priorities yet/);
  assert.doesNotMatch(panel, /priority-board preferences/);
  assert.doesNotMatch(panel, /participant state/);
  assert.doesNotMatch(panel, /collaborator record/);
});

test('no invented route: there is no "View <name>\'s Criteria" link, since no read-only co-buyer criteria route exists today', async () => {
  const panel = await source('src/components/MySearchPanel.jsx');
  // No rendered link/anchor pointing at a per-participant criteria route.
  assert.doesNotMatch(panel, /<Link[^>]*>[^<]*Criteria/);
  assert.doesNotMatch(panel, /<a[^>]*>[^<]*Criteria/);
  assert.doesNotMatch(panel, /Criteria →/);
  // The omission is explained in-source, not silently absent.
  assert.match(panel, /no dedicated read-only route/);
});

test('collaborator summary is structurally read-only: it never receives patch and cannot mutate the other participant\'s data', async () => {
  const panel = await source('src/components/MySearchPanel.jsx');
  const fn = panel.slice(panel.indexOf('function CollaboratorContext'), panel.indexOf('function SearchingTogetherCard'));
  assert.doesNotMatch(fn, /patch\(/);
  assert.doesNotMatch(fn, /<input|<button/);
});

test('relationship removal uses the collaborator\'s real name and stays secondary/destructive administration', async () => {
  const management = await source('src/components/CoBuyerManagement.jsx');
  const panel = await source('src/components/MySearchPanel.jsx');
  assert.match(management, /collaboratorName = null/);
  assert.match(management, /Remove \$\{collaboratorName \|\| 'collaborator'\} from this search/);
  assert.match(management, /hh-btn-ghost/);
  assert.match(panel, /collaboratorName=\{collaboratorContext\?\.displayName\}/);
});

test('Realtor is never conflated with Searching Together: My Search exposes no Realtor priorities, places, or Match', async () => {
  const panel = await source('src/components/MySearchPanel.jsx');
  assert.doesNotMatch(panel, /getRealtorSearchContext|getRealtorRelationships|realtorContributions|Realtor Match/i);
});

test('Match weighting is unchanged: PriorityBoard\'s weight callout is presentation-only, TIER_META numeric weights are untouched', async () => {
  const board = await source('src/components/PriorityBoard.jsx');
  const constants = await source('src/lib/constants.js');
  assert.match(board, /const TIER_WEIGHT_LABEL = \{ must: 'Highest weight', important: 'Medium weight', nice: 'Lowest weight' \};/);
  assert.match(board, /\{TIER_META\[tier\]\.label\} <span className="hh-tier-weight">\(\{TIER_WEIGHT_LABEL\[tier\]\}\)<\/span>/);
  assert.match(board, /\{items\.length\} \{items\.length === 1 \? 'priority' : 'priorities'\} active/);
  assert.match(constants, /must: \{ label: 'Must have', weight: 4/);
  assert.match(constants, /important: \{ label: 'Important', weight: 2/);
  assert.match(constants, /nice: \{ label: 'Nice to have', weight: 1/);
  // Still passes the same patch function straight through to PriorityBoard —
  // the weight/count line is additive rendering, not a new edit path.
  assert.match(board, /<TierItemsList/);
});

test('priority groups omit redundant Match copy while retaining contextual tour markers', async () => {
  const board = await source('src/components/PriorityBoard.jsx');
  assert.doesNotMatch(board, /Choose the pre-tour details you want Feels Like Home to evaluate from reliable property information/);
  assert.doesNotMatch(board, /Best answered after you tour<\/div>/);
  assert.match(board, /isExperientialCriterion\(item\.categoryKey, item\.label\)/);
});

test('parameter editing (What I\'m Looking For) keeps its existing Edit/Done editor untouched, only retitled', async () => {
  const panel = await source('src/components/MySearchPanel.jsx');
  assert.match(panel, /<SearchCard title="What I'm Looking For">/);
  assert.match(panel, /onClick=\{\(\) => setEditOpen\(true\)\}/);
  assert.match(panel, />\s*Edit\s*\n/);
  assert.match(panel, />\s*Done\s*\n/);
});

test('Places That Matter keeps the existing CommuteDestinations editor and per-place fields, only retitled with the mandated supporting copy', async () => {
  const panel = await source('src/components/MySearchPanel.jsx');
  const destinations = await source('src/components/CommuteDestinations.jsx');
  assert.match(panel, /<SearchCard title="Places That Matter" subtitle="We'll calculate commute times from every home to the places that matter to you\."/);
  assert.doesNotMatch(panel, /key coordinates/i);
  assert.match(panel, /<CommuteDestinations searchId=\{search\.id\} userId=\{userId\} destinations=\{commuteDestinations\}/);
  // Ownership doctrine: the editable list is always the current user's own
  // rows (searchId+userId scoped); a collaborator's places never enter it.
  assert.match(destinations, /createCommuteDestination\(supabase, searchId, userId, values\)/);
});

test('desktop composition: an asymmetric two-column grid with What Matters Most to Me as the wide primary column', async () => {
  const panel = await source('src/components/MySearchPanel.jsx');
  const css = await source('src/app/globals.css');
  assert.match(panel, /className="hh-search-grid"/);
  assert.match(panel, /className="hh-search-primary">\s*<WhatMattersCard/);
  assert.match(panel, /className="hh-search-rail">\s*<BasicsCard/);
  assert.match(css, /\.hh-search-grid \{ display: grid; grid-template-columns: minmax\(0, 1\.65fr\) minmax\(300px, 1fr\)/);
});

test('mobile: the desktop two-column grid collapses to one stacked column; PriorityBoard\'s own mobile compact behavior is untouched', async () => {
  const css = await source('src/app/globals.css');
  const board = await source('src/components/PriorityBoard.jsx');
  const block = css.match(/@media \(max-width: 900px\) \{[\s\S]*?\n\}/)?.[0] || '';
  assert.match(block, /\.hh-search-grid \{ grid-template-columns: 1fr; \}/);
  assert.match(board, /const \[mobileCompact, setMobileCompact\] = useState\(false\);/);
});

test('Match education uses a non-overlapping editorial asset and has no redundant My Search CTA', async () => {
  const panel = await source('src/components/MySearchPanel.jsx');
  const homes = await source('src/app/(app)/homes/page.js');
  const css = await source('src/app/globals.css');
  assert.match(panel, /className="hh-match-editorial hh-match-editorial-search"/);
  assert.match(panel, /<h2>How Match Scores Work<\/h2>/);
  assert.match(panel, /FWFLH%20Transparent\.png/);
  assert.match(panel, /hh-match-editorial-inner/);
  assert.doesNotMatch(panel, /Review My Search/);
  assert.match(css, /\.hh-match-editorial-search \.hh-match-editorial-art \{[\s\S]*?position: static !important;[\s\S]*?object-fit: contain;[\s\S]*?opacity: 1;/);
  assert.match(homes, /href="\/search">Review My Search<\/a>/);
});

test('page identity copy matches the approved spec', async () => {
  const page = await source('src/app/(app)/search/page.js');
  assert.match(page, /Describe the home you want and what matters most\. Feels Like Home uses the priorities you choose here — along with reliable property information — to calculate your personalized Match\./);
});

test('data/loader change is additive and minimal: resolveCollaboratorSearchContext gains only a display name, using the same already-verified relationship', async () => {
  const collaboration = await source('src/lib/supabase/collaboration.js');
  const migration = await source('supabase/migrations/2026-09-16-my-search-collaborator-display-name.sql');
  assert.match(collaboration, /displayName: row\.display_name \|\| null/);
  // Same RPC name/params as before -- no new endpoint, no client-supplied identity.
  assert.match(collaboration, /rpc\('resolve_collaborator_search_context', \{ p_search_id: search\.id \}\)/);

  assert.match(migration, /create or replace function public\.resolve_collaborator_search_context\(p_search_id uuid\)/);
  assert.match(migration, /returns table \(priorities jsonb, commute_destinations jsonb, home_states jsonb, display_name text\)/);
  // The access guard and collaborator resolution are byte-for-byte the same
  // authorization this function already had -- only the final projected
  // column is new.
  assert.match(migration, /if not coalesce\(public\.can_access_search\(p_search_id, v_caller\), false\) then/);
  assert.match(migration, /where participant\.user_id <> v_caller/);
  assert.match(migration, /where sm\.search_id = p_search_id and sm\.role = 'co_buyer'/);
  // Cross-search isolation: every branch of the display-name lookup is still
  // scoped to v_collaborator, resolved only from *this* search's rows.
  assert.match(migration, /where u\.id = v_collaborator/);
});

test('display name derivation reuses the established email-derived, no-contact-details pattern already shipped for the Realtor roster -- not a new mechanism', async () => {
  const migration = await source('supabase/migrations/2026-09-16-my-search-collaborator-display-name.sql');
  const realtorView = await source('supabase/migrations/2026-09-16-realtor-search-view.sql');
  const nameExpr = /coalesce\(nullif\(initcap\(replace\(split_part\(u\.email, '@', 1\), '\.', ' '\)\), ''\), '[^']+'\)/;
  assert.match(migration, nameExpr);
  assert.match(realtorView, nameExpr);
});

test('security: no RLS change, no service-role/anon grant, execute stays restricted to authenticated', async () => {
  const migration = await source('supabase/migrations/2026-09-16-my-search-collaborator-display-name.sql');
  assert.doesNotMatch(migration, /\bpolicy\b/i);
  assert.doesNotMatch(migration, /grant (all|execute|select).*to (service_role|anon)/i);
  assert.match(migration, /revoke execute on function public\.resolve_collaborator_search_context\(uuid\) from anon;/);
  assert.match(migration, /revoke execute on function public\.resolve_collaborator_search_context\(uuid\) from service_role;/);
  assert.match(migration, /grant execute on function public\.resolve_collaborator_search_context\(uuid\) to authenticated;/);
  assert.match(migration, /security definer/);
  assert.match(migration, /set search_path = ''/);
});

test('security: this migration never calls the Realtor-privileged roster function for the co-buyer summary', async () => {
  const migration = await source('supabase/migrations/2026-09-16-my-search-collaborator-display-name.sql');
  // Scoped to the function body (after the leading comment, which names the
  // Realtor functions only as prose precedent) -- no actual call/guard here.
  const body = migration.slice(migration.indexOf('as $$'));
  assert.doesNotMatch(body, /get_realtor_client_roster|is_search_realtor/);
});

test('no household criteria, no averaged priorities, one participant can never edit another\'s criteria', async () => {
  const panel = await source('src/components/MySearchPanel.jsx');
  const collaboration = await source('src/lib/supabase/collaboration.js');
  assert.doesNotMatch(panel, /household/i);
  assert.doesNotMatch(panel, /average/i);
  // savePriorities (the only write path PriorityBoard/BasicsCard drive) is
  // always scoped to the authenticated caller's own row.
  assert.match(collaboration, /export async function savePriorities\(supabase, search, userId, priorities\)/);
  assert.match(collaboration, /\.upsert\(\{ search_id: search\.id, user_id: userId, priorities: savedPriorities \}, \{ onConflict: 'search_id,user_id' \}\)/);
});
