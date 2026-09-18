import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appGroupDir = path.join(rootDir, 'src', 'app', '(app)');
const source = (relPath) => fs.readFileSync(path.join(rootDir, relPath), 'utf8');

// Every page.js nested under the (app) route group, found by walking the
// filesystem rather than hardcoding a list — a page added later without
// requireUser()/withAuthRecovery() should fail this suite, not silently
// reintroduce the null `.id` crash.
function findAppPages(dir) {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...findAppPages(full));
    else if (entry.name === 'page.js') found.push(full);
  }
  return found;
}

const appPages = findAppPages(appGroupDir);

test('at least the known authenticated routes were found under (app)', () => {
  // Guards the walk itself: if this ever comes back empty/short, every
  // other test in this file is silently vacuous.
  assert.ok(appPages.length >= 13, `expected at least 13 (app) pages, found ${appPages.length}`);
  const relPaths = appPages.map((p) => path.relative(rootDir, p));
  for (const expected of [
    'homes/page.js', 'compare/page.js', 'tour/page.js', 'map/page.js', 'search/page.js',
    'favorites/page.js', 'archive/page.js', 'homes/suggestions/page.js', 'homes/[homeId]/page.js',
    'people/page.js', 'people/[searchId]/page.js', 'people/[searchId]/compare/page.js', 'people/[searchId]/homes/[homeId]/page.js',
  ]) {
    assert.ok(relPaths.some((p) => p.endsWith(expected.replace(/\//g, path.sep))), `missing ${expected}`);
  }
});

test('no (app) page dereferences an unchecked auth.getUser() result', () => {
  // This is the exact shape that crashed Homes: destructuring `user` from a
  // raw getUser() call with no null check before using it.
  const unsafePattern = /const\s*\{\s*data:\s*\{\s*user\s*\}\s*\}\s*=\s*await\s+supabase\.auth\.getUser\(\)/;
  const offenders = appPages.filter((file) => unsafePattern.test(fs.readFileSync(file, 'utf8')));
  assert.deepEqual(offenders.map((f) => path.relative(rootDir, f)), []);
});

test('every (app) page resolves its user through the shared requireUser() guard', () => {
  const offenders = [];
  for (const file of appPages) {
    const content = fs.readFileSync(file, 'utf8');
    const importsGuard = /from ['"]@\/lib\/supabase\/auth['"]/.test(content) && /requireUser/.test(content);
    const callsGuard = /const user = await requireUser\(supabase\)/.test(content);
    if (!importsGuard || !callsGuard) offenders.push(path.relative(rootDir, file));
  }
  assert.deepEqual(offenders, []);
});

test('every (app) page wraps its data loading in withAuthRecovery so a downstream Postgrest auth error cannot crash the page', () => {
  const offenders = [];
  for (const file of appPages) {
    const content = fs.readFileSync(file, 'utf8');
    const usesRecovery = /withAuthRecovery/.test(content);
    if (!usesRecovery) offenders.push(path.relative(rootDir, file));
  }
  assert.deepEqual(offenders, []);
});

test('requireUser() runs, and its user is resolved, before any Supabase data query in each page', () => {
  // Structural guard for requirement #5 ("protected data loaders do not
  // execute after failed authentication"): requireUser() must appear before
  // the page's first collaboration/data helper call in source order. Since
  // requireUser() either returns a real user or throws (redirects) before
  // returning, anything textually after it in the same async function only
  // ever runs with a validated user.
  for (const file of appPages) {
    const content = fs.readFileSync(file, 'utf8');
    const guardIndex = content.indexOf('await requireUser(supabase)');
    assert.ok(guardIndex !== -1, `${path.relative(rootDir, file)} never calls requireUser`);
    const afterGuard = content.slice(guardIndex);
    // The first call into the data layer after the guard -- resolveActiveSearch,
    // getRealtorSearchContext, getRealtorRelationships are this app's entry points
    // into collaboration.js/data.js from a page.
    const firstDataCall = afterGuard.search(/resolveActiveSearch\(|getRealtorSearchContext\(|getRealtorRelationships\(|loadPeopleWorkspace\(|getProfile\(|\.from\('prospective_searches'\)/);
    assert.ok(firstDataCall > 0, `${path.relative(rootDir, file)} has no data call after requireUser, or it precedes the guard`);
  }
});

test('the (app) layout resolves the user through requireUser() and still gates onboarding', async () => {
  const layout = await source('src/app/(app)/layout.js');
  assert.match(layout, /from ['"]@\/lib\/supabase\/auth['"]/);
  assert.match(layout, /const user = await requireUser\(supabase\)/);
  assert.match(layout, /withAuthRecovery/);
  // Onboarding-incomplete still redirects, unchanged from before this hotfix.
  assert.match(layout, /if \(!profile\?\.onboarding_complete\) redirect/);
  // No leftover duplicate of the logic now centralized in auth.js.
  assert.doesNotMatch(layout, /function currentPathForRedirect/);
  assert.doesNotMatch(layout, /function withRedirectParam/);
});

test('requireUser() treats every getUser() failure mode identically: null user means redirect to sign-in with the return path preserved', async () => {
  const authSource = await source('src/lib/supabase/auth.js');
  // requireUser doesn't (and must not) special-case *why* user is null --
  // getUser() already collapses "no session", "invalid/missing refresh
  // token", and "terminal auth error" into user: null upstream. Branching
  // here on error shape would be exactly the kind of scattered, error-prone
  // per-case handling the hotfix is trying to avoid.
  assert.match(authSource, /export async function requireUser\(supabase\)/);
  assert.match(authSource, /if \(!user\) await redirectToSignIn\(\)/);
  assert.match(authSource, /return user;/);
  // The redirect target is the app's one canonical sign-in route.
  assert.match(authSource, /'\/auth\/sign-in'/);
});

test('withAuthRecovery only intercepts recognized JWT/session errors -- everything else (bugs, notFound(), redirect()) still surfaces normally', async () => {
  const authSource = await source('src/lib/supabase/auth.js');
  assert.match(authSource, /export async function withAuthRecovery\(loader\)/);
  // GoTrue AuthError shape.
  assert.match(authSource, /error\.__isAuthError/);
  // PostgREST's own JWT-validation codes: PGRST301 (expired) and PGRST303
  // ("JWT issued at future") -- the exact code from the Compare production
  // error. Not the generic "no rows" / RLS-denied path, which never carries
  // one of these codes.
  assert.match(authSource, /PGRST301/);
  assert.match(authSource, /PGRST303/);
  // Recognized errors redirect; everything else rethrows unchanged, so a
  // genuine bug, notFound(), or a page's own redirect() still behaves
  // exactly as before this hotfix.
  assert.match(authSource, /if \(isAuthSessionError\(error\)\) await redirectToSignIn\(\);\s*\n\s*throw error;/);
});

test('there is no redirect loop: requireUser/withAuthRecovery only ever redirect to /auth/sign-in, never back into an (app) route', async () => {
  const authSource = await source('src/lib/supabase/auth.js');
  const redirectTargets = [...authSource.matchAll(/redirect\((?:withRedirectParam\()?'([^']+)'/g)].map((m) => m[1]);
  assert.ok(redirectTargets.length > 0, 'expected at least one redirect target in auth.js');
  for (const target of redirectTargets) {
    assert.equal(target, '/auth/sign-in');
  }
});

test('createClient() is memoized per request so layout.js and a page.js sharing one request share one Supabase client/session', async () => {
  const serverSource = await source('src/lib/supabase/server.js');
  assert.match(serverSource, /import \{ cache \} from 'react'/);
  assert.match(serverSource, /export const createClient = cache\(async function createClient\(\)/);
});

test('getUser() itself is memoized per request, not just the client -- the actual network refresh happens at most once', async () => {
  const authSource = await source('src/lib/supabase/auth.js');
  assert.match(authSource, /import \{ cache \} from 'react'/);
  assert.match(authSource, /const getAuthenticatedUser = cache\(async \(supabase\) => supabase\.auth\.getUser\(\)\)/);
});

test('Homes specifically: the reported null `.id` crash site now goes through requireUser and withAuthRecovery', async () => {
  const homes = await source('src/app/(app)/homes/page.js');
  assert.doesNotMatch(homes, /const \{ data: \{ user \} \} = await supabase\.auth\.getUser\(\)/);
  assert.match(homes, /const user = await requireUser\(supabase\)/);
  assert.match(homes, /return withAuthRecovery\(async \(\) => \{/);
});

test('Compare specifically: a PGRST303-class error from resolveActiveSearch/getHomesForUser no longer reaches the generic error boundary unguarded', async () => {
  const compare = await source('src/app/(app)/compare/page.js');
  assert.match(compare, /return withAuthRecovery\(async \(\) => \{/);
  assert.match(compare, /const user = await requireUser\(supabase\)/);
});

test('the service worker has no session-aware caching to disable: it only intercepts navigations and never touches Supabase/auth/API traffic', async () => {
  const sw = await source('public/sw.js');
  assert.match(sw, /event\.request\.mode !== 'navigate'/);
  assert.doesNotMatch(sw, /supabase/i);
  assert.doesNotMatch(sw, /authorization/i);
  assert.doesNotMatch(sw, /\/auth\//);
  // Confirms the only caching this worker does is the static app-shell
  // precache list, not anything response-derived/session-scoped.
  assert.match(sw, /PRECACHE_URLS = \['\/offline\.html'/);
});

test('middleware still only performs the documented single getUser() refresh side effect, unchanged by this hotfix', async () => {
  const middleware = await source('src/middleware.js');
  const refreshCalls = middleware.match(/supabase\.auth\.getUser\(\)/g) || [];
  assert.equal(refreshCalls.length, 1);
});
