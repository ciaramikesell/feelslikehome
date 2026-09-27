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
  assert.match(panel, /const collaborative = participantCount > 1;/);
  assert.match(panel, /if \(!collaborative && !isOwner\) return null;/);
  assert.match(panel, /You’re searching alone\./);
  assert.match(panel, /Invite a co-buyer or Realtor →/);
  // The existing invitation flow (co-buyer or Realtor) — no new invite path.
  assert.match(panel, /\{open && !collaborative && <InviteCoBuyer searchId=\{search\.id\} userId=\{userId\} embedded onClose=/);
});

test('owner + co-buyer with completed criteria: a real display name and compact tier/place counts, not an itemized list', async () => {
  const panel = await source('src/components/MySearchPanel.jsx');
  assert.match(panel, /`Searching with \$\{collaboratorContext\?\.displayName \|\| 'a co-buyer'\}`/);
  assert.match(panel, /Both perspectives shape every Match\./);
  assert.match(panel, /\{name\}&apos;s priorities/);
  assert.match(panel, /\{name\}&apos;s places/);
  assert.match(panel, /countOf\('must'\)/);
  assert.match(panel, /countOf\('important'\)/);
  assert.match(panel, /countOf\('nice'\)/);
  // Deliberately compact, not itemized.
  assert.doesNotMatch(panel, /hh-collaborator-priorities|hh-collaborator-places/);
  // Membership management stays the existing component, unchanged.
  assert.match(panel, /<CoBuyerManagement userId=\{userId\} search=\{search\} isOwner=\{isOwner\} participantCount=\{participantCount\} memberUserId=\{memberUserId\}/);
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

test('Match weighting is unchanged: level names come from TIER_META, whose numeric weights are untouched', async () => {
  const profile = await source('src/lib/searchProfile.js');
  const board = await source('src/components/RankBoard.jsx');
  const constants = await source('src/lib/constants.js');
  assert.match(profile, /must: Object\.freeze\(\{ label: TIER_META\.must\.label/);
  assert.match(profile, /important: Object\.freeze\(\{ label: TIER_META\.important\.label/);
  assert.match(profile, /nice: Object\.freeze\(\{ label: TIER_META\.nice\.label/);
  assert.match(constants, /must: \{ label: 'Must have', weight: 4/);
  assert.match(constants, /important: \{ label: 'Important', weight: 2/);
  assert.match(constants, /nice: \{ label: 'Nice to have', weight: 1/);
  // The board only ever reports a level change; it has no weight logic of its own.
  assert.doesNotMatch(board, /weight/);
});

test('priority groups omit redundant Match copy while retaining contextual tour markers', async () => {
  const board = await source('src/components/RankBoard.jsx');
  const profile = await source('src/lib/searchProfile.js');
  assert.doesNotMatch(board, /Choose the pre-tour details you want Feels Like Home to evaluate from reliable property information/);
  assert.doesNotMatch(board, /Best answered after you tour<\/div>/);
  assert.match(profile, /experiential: isExperientialCriterion\(def\.key, item\.label\)/);
  assert.match(board, /item\.experiential && <span/);
});

test('parameter editing (What I\'m Looking For) keeps its existing editor, opened from the overview', async () => {
  const panel = await source('src/components/MySearchPanel.jsx');
  const editor = await source('src/components/BasicsEditor.jsx');
  assert.match(panel, /<WhatImLookingFor priorities=\{priorities\} onEdit=\{\(\) => setBasicsOpen\(true\)\} \/>/);
  assert.match(panel, /<BasicsEditor priorities=\{priorities\} patch=\{patch\} \/>/);
  assert.match(panel, />Done<\/button>/);
  // The editor still edits the same fields and their existing importance tiers.
  assert.match(editor, /<TierPicker value=\{tier\} onChange=\{onTierChange\} quiet/);
});

test('Places That Matter opens a focused editor that writes only the current participant\'s own rows', async () => {
  const panel = await source('src/components/MySearchPanel.jsx');
  const editor = await source('src/components/PlacesEditor.jsx');
  assert.match(panel, /href="\/search\/places"/);
  assert.doesNotMatch(panel, /key coordinates/i);
  // Ownership doctrine: the editable list is always the current user's own
  // rows (searchId+userId scoped); a collaborator's places never enter it.
  assert.match(editor, /createCommuteDestination\(supabase, searchId, userId, values\)/);
  assert.match(editor, /updateCommuteDestination\(supabase, id, changes\)/);
  assert.match(editor, /deleteCommuteDestination\(supabase, id\)/);
});

test('desktop composition: an asymmetric two-column grid with What Matters Most as the primary column', async () => {
  const panel = await source('src/components/MySearchPanel.jsx');
  const css = await source('src/app/globals.css');
  assert.match(panel, /className="flh-my-search-grid"/);
  assert.match(panel, /className="flh-my-search-primary">\s*<WhatMattersMost/);
  assert.match(panel, /className="flh-my-search-rail">\s*<WhatImLookingFor/);
  assert.match(css, /@media \(min-width: 960px\) \{ \.flh-my-search-grid \{ grid-template-columns: minmax\(0,1\.05fr\) minmax\(0,1fr\)/);
});

test('mobile: My Search is one stacked column below the desktop breakpoint', async () => {
  const css = await source('src/app/globals.css');
  assert.match(css, /\.flh-my-search-grid \{ display: grid; gap: var\(--flh-stack\); \}/);
  // Two columns only appear at the desktop breakpoint.
  assert.match(css, /@media \(min-width: 960px\) \{ \.flh-my-search-grid \{ grid-template-columns:/);
});

test('the permanent How Match Scores Work section no longer lives on My Search; the Homes link to My Search remains', async () => {
  const panel = await source('src/components/MySearchPanel.jsx');
  const homes = await source('src/app/(app)/homes/page.js');
  const shell = await source('src/components/AppShell.jsx');
  assert.doesNotMatch(panel, /How Match Scores Work/);
  assert.doesNotMatch(panel, /hh-match-editorial/);
  assert.doesNotMatch(panel, /Review My Search/);
  // The underlying explanation still lives in How it works.
  assert.match(shell, /Match on paper/);
  assert.match(homes, /href="\/search">Review My Search<\/a>/);
});

test('page identity copy matches the approved spec', async () => {
  const panel = await source('src/components/MySearchPanel.jsx');
  assert.match(panel, /<PageHeading title="My Search" subtitle="The things that make a place feel like home"/);
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
  // savePriorities (the only write path the priority and Basics editors drive) is
  // always scoped to the authenticated caller's own row.
  assert.match(collaboration, /export async function savePriorities\(supabase, search, userId, priorities\)/);
  assert.match(collaboration, /\.upsert\(\{ search_id: search\.id, user_id: userId, priorities: savedPriorities \}, \{ onConflict: 'search_id,user_id' \}\)/);
});
