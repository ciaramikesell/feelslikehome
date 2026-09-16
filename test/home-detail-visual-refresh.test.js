import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(p, 'utf8');

const detail = read('src/components/HomeDetail.jsx');
const detailPage = read('src/app/(app)/homes/[homeId]/page.js');
const matching = read('src/lib/matching.js');
const globalsCss = read('src/app/globals.css');
const realtorContributions = read('src/components/RealtorContributions.jsx');

/* ------------------------------ canonical loader/auth boundary ------------------------------ */

test('regression guard: Home Detail still loads exclusively through requireUser()/withAuthRecovery(), scoped to the active search', () => {
  assert.match(detailPage, /withAuthRecovery\(async \(\) => \{/);
  assert.match(detailPage, /const user = await requireUser\(supabase\);/);
  assert.doesNotMatch(detailPage, /supabase\.auth\.getUser\(\)/);
  // A guessed id from another search still has no detail route — the home is
  // located inside the current user's own getHomesForUser() result, not
  // fetched independently by id.
  assert.match(detailPage, /const home = homes\.find\(\(candidate\) => String\(candidate\.id\) === homeId\);/);
  assert.match(detailPage, /if \(!home\) notFound\(\);/);
});

test('regression guard: no new privileged/RLS path was introduced for this visual pass', () => {
  for (const [name, src] of [['HomeDetail.jsx', detail], ['matching.js', matching]]) {
    assert.doesNotMatch(src, /service_role|SECURITY DEFINER|\.rpc\(/i, `${name} should not introduce a new privileged path`);
  }
});

/* ------------------------------ original listing / edit actions ------------------------------ */

test('original listing renders only when a canonical URL exists, and the edit action is preserved', () => {
  assert.match(detail, /\{home\.listingUrl && <a href=\{home\.listingUrl\} target="_blank" rel="noreferrer">Original listing/);
  assert.match(detail, /\{!readOnly && <button type="button" onClick=\{\(\) => setEditing\(true\)\}>/);
  assert.match(detail, /HomeModal presentation="detail-panel"/);
  assert.match(detail, /onSave=\{saveWhole\}/);
});

/* ------------------------------ Match: unaltered, missing Must-Have visible, Unknown ≠ mismatch ------------------------------ */

test('regression guard: Match computation itself is untouched — the new hero summary only reads computeMatch\'s existing aggregate fields', () => {
  assert.match(detail, /const match = computeMatch\(home, priorities, commuteEvaluation\);/);
  // matchFactualSummary is additive: it must never appear inside computeMatch
  // itself, only consumed alongside it.
  const computeMatchBody = matching.match(/export function computeMatch\([\s\S]*?\n\}/)?.[0] || '';
  assert.doesNotMatch(computeMatchBody, /matchFactualSummary/);
});

test('a missing Must-Have is always named in the new hero summary, never smoothed over by the headline percentage', async () => {
  const { computeMatch, matchFactualSummary } = await import('../src/lib/matching.js');
  const priorities = { searchType: 'buy', bedsMin: { value: '4', tier: 'must' } };
  const home = { beds: '2' }; // objective Must-Have, confirmed NOT met
  const match = computeMatch(home, priorities);
  const summary = matchFactualSummary(match);
  assert.equal(match.mustMet < match.mustEvaluated, true);
  assert.match(summary.mustClause, /Must-Have.* missing/);
});

test('an unevaluated Must-Have is reported as unknown, never as met and never as a mismatch', async () => {
  const { computeMatch, matchFactualSummary } = await import('../src/lib/matching.js');
  // bedsMin is evaluated and met (so pct is non-null); Commute is also a
  // selected Must-Have but no commute data is passed in, so it stays
  // genuinely unevaluated rather than failed.
  const priorities = { searchType: 'buy', bedsMin: { value: '2', tier: 'must' }, location: { tiers: { Commute: 'must' } } };
  const match = computeMatch({ beds: '3' }, priorities);
  const summary = matchFactualSummary(match);
  assert.notEqual(match.pct, null);
  assert.equal(match.mustEvaluated < match.mustTotal, true);
  assert.match(summary.mustClause, /still unknown/);
});

test('all Must-Haves met produces the exact spec\'d factual phrase, and the Important sentence follows the spec\'s "X of Y ... Z doesn\'t match" shape', async () => {
  const { computeMatch, matchFactualSummary } = await import('../src/lib/matching.js');
  const priorities = { searchType: 'buy', bedsMin: { value: '2', tier: 'must' }, bathsMin: { value: '2', tier: 'important' } };
  const home = { beds: '3', baths: '2' };
  const match = computeMatch(home, priorities);
  const summary = matchFactualSummary(match);
  assert.equal(summary.mustClause, 'All Must-Haves met');
  assert.match(summary.importantSentence, /^\d+ of \d+ Important preferences? match\./);
});

test('matchFactualSummary never fabricates a summary when Match itself is unavailable', async () => {
  const { matchFactualSummary } = await import('../src/lib/matching.js');
  assert.equal(matchFactualSummary(null), null);
  assert.equal(matchFactualSummary({ pct: null, mustTotal: 0, mustEvaluated: 0, mustMet: 0, allSelected: [] }), null);
});

test('the hero factual summary only renders when a real Match percentage exists', () => {
  assert.match(detail, /const factualSummary = matchFactualSummary\(match\);/);
  assert.match(detail, /\{factualSummary && \(factualSummary\.mustClause \|\| factualSummary\.importantSentence\) && \(/);
});

test('regression guard: missing/unknown criterion semantics in the full "How it fits your search" breakdown are untouched', () => {
  assert.match(detail, /!item\.evaluated \? \(item\.objective \? 'Needs more information' : 'Evaluate after tour'\)/);
  assert.match(detail, /const stateLabel = !item\.evaluated \? 'Unknown' : item\.met \? 'Satisfied' : 'Missed';/);
  assert.match(detail, /className=\{`hh-detail-criterion \$\{!item\.evaluated \? 'unknown' : item\.met \? 'met' : 'missed'\}`\}/);
  assert.match(detail, /<span className="sr-only">\{stateLabel\}<\/span>/);
});

/* ------------------------------ Property facts: real fields only ------------------------------ */

test('regression guard: Property Facts are still built only from real, existing fields — never fabricated', () => {
  assert.match(detail, /\.filter\(\(\[, value\]\) => value\)/);
  assert.match(detail, /formatHomePrice\(home\.price, priorities\.searchType\)/);
  assert.match(detail, /showsRentalFacts \? \[/);
  assert.match(detail, /\.\.\.\(!showsRentalFacts \? \[/);
  assert.doesNotMatch(detail, /school rating|walkability|crime|neighborhood rating/i);
});

/* ------------------------------ gallery: single photoUrl only, no fabricated gallery ------------------------------ */

test('no multi-image gallery/thumbnail infrastructure was built — the canonical data model only has a single photoUrl field', () => {
  assert.doesNotMatch(detail, /thumbnail|carousel|1 \/ \d|gallery/i);
  assert.match(detail, /\{home\.photoUrl \? <img src=\{home\.photoUrl\}/);
});

/* ------------------------------ participant-owned state: unchanged ------------------------------ */

test('regression guard: Favorite/Want to Tour/Archive/post-tour mutations remain on the participant-owned personal-state path', () => {
  for (const label of ['Want to Tour', 'Favorite', 'Archive', 'Restore']) assert.ok(detail.includes(label), `${label} remains available`);
  assert.match(detail, /savePersonal\(toggleFavorite\(home\)\)/);
  assert.match(detail, /savePersonal\(\{ status: home\.status === 'Want to Tour'/);
  assert.match(detail, /saveHomePersonalState\(createClient\(\), next, userId, searchId\)/);
  assert.match(detail, /setArchiveTarget\(next\)/);
  assert.match(detail, /<ArchiveConfirmModal/);
  assert.match(detail, /<PostTourModal/);
  assert.match(detail, /applyPostTourVerdict\(current, verdict, patch\)/);
});

test('regression guard: collaborator perspective stays a distinct, separately-labeled section — never merged into the current participant\'s own state', () => {
  assert.match(detail, /hasCoBuyerPerspective && <Section eyebrow="Collaborator perspective" title="How your collaborator sees this home">/);
  assert.match(detail, /Different takes/);
  assert.match(detail, /take\.youLiked \? 'You liked it' : "You didn't like it"/);
});

/* ------------------------------ Realtor context: unchanged semantics, no Realtor Match ------------------------------ */

test('regression guard: Realtor context keeps its own ownership/semantics — no Realtor Match, no Realtor mutation of buyer lifecycle state', () => {
  assert.doesNotMatch(realtorContributions, /Realtor Match/);
  assert.doesNotMatch(realtorContributions, /savePersonal|toggleFavorite|archiveHome|applyPostTourVerdict/);
  assert.match(realtorContributions, /No Realtor context has been added yet\./);
  assert.match(realtorContributions, /Your Want to Tour choice stays yours\./);
});

test('regression guard: Property/Shared Notes ownership copy and the editor placeholder are unchanged', () => {
  assert.match(detail, /isCollaborative \? "Shared notes" : "What you want to remember"/);
  assert.match(detail, /placeholder="HOA details, sewer\/water, financing options, recent updates, listing terms, or anything else worth noting\."/);
});

/* ------------------------------ Realtor + Notes: side by side on desktop, stacked on mobile ------------------------------ */

test('From the Realtor and Shared/Property notes share one desktop row without merging their data models', () => {
  assert.match(detail, /<div className="hh-detail-context-row">/);
  // Both children keep their own component/props exactly as before — the row
  // is a layout wrapper only.
  const row = detail.match(/<div className="hh-detail-context-row">[\s\S]*?\n\s*<\/div>\n/)?.[0] || '';
  assert.match(row, /<RealtorContributions searchId=\{searchId\} homeId=\{home\.id\} contributions=\{realtorContributions\}/);
  assert.match(row, /<Section eyebrow="Property notes"/);
  assert.match(globalsCss, /\.hh-detail-context-row \{ display: grid; grid-template-columns: 1fr 1fr;/);
  assert.match(globalsCss, /@media \(max-width: 880px\) \{\s*\n\s*\.hh-detail-context-row \{ grid-template-columns: 1fr;/);
});

/* ------------------------------ mobile responsive rules still exist ------------------------------ */

test('regression guard: the existing mobile hero photo-first ordering is unchanged', () => {
  const mobileHero = globalsCss.match(/@media\(max-width:720px\) \{[\s\S]*?\n\}/)?.[0] || '';
  assert.ok(mobileHero);
  assert.match(mobileHero, /\.hh-detail-photo \{[^}]*order: 1;/);
  assert.match(mobileHero, /\.hh-detail-identity \{[^}]*order: 2;/);
});
