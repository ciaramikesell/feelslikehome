import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const migrationsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../supabase/migrations');
// Filenames are YYYY-MM-DD-prefixed, so lexical sort is chronological order
// — the same order Postgres would apply them in.
const files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
const sources = files.map((f) => ({ file: f, content: readFileSync(path.join(migrationsDir, f), 'utf8') }));

// The proven-defective combination (accept_invitation, claim_prospective_search):
// a PL/pgSQL function whose `returns table (...)` declares an OUT column
// named `search_id` (or any other identifier also used as a table column),
// combined with an unqualified `ON CONFLICT (<that column>, ...)` target
// list inside that same function body. PL/pgSQL gives INSERT's own column
// list and UPDATE's SET target a free pass from this ambiguity, but not
// ON CONFLICT's target list — confirmed empirically against a real
// Postgres instance for search_id specifically (see
// accept-invitation-ambiguous-search-id.db.test.js and
// claim-prospective-search-ambiguous-search-id.db.test.js).
//
// This scans every function definition across every migration file for
// that exact shape recurring — for search_id specifically (the proven
// case) and, narrowly, for any other RETURNS TABLE column reused as a bare
// ON CONFLICT target column, without broadly flagging every ON CONFLICT in
// the codebase (most aren't inside a function with a colliding variable at
// all, and are fine).
function findFunctions(source) {
  const results = [];
  const fnStart = /create (?:or replace )?function\s+public\.(\w+)\([^)]*\)\s*\nreturns\s+table\s*\(([^)]*)\)/gi;
  let match;
  while ((match = fnStart.exec(source))) {
    const [, name, columns] = match;
    const bodyStart = match.index;
    // Find this function's own closing `end; $tag$;` (or bare `$$;`),
    // scoped to the tag this specific function opened with.
    const afterHeader = source.slice(bodyStart);
    const tagMatch = afterHeader.match(/\bas\s+(\$\w*\$)/);
    if (!tagMatch) continue;
    const tag = tagMatch[1];
    const closeIdx = afterHeader.indexOf(`end; ${tag};`, tagMatch.index);
    const body = closeIdx > -1 ? afterHeader.slice(0, closeIdx + `end; ${tag};`.length) : afterHeader;
    const outColumns = columns.split(',').map((c) => c.trim().split(/\s+/)[0]).filter(Boolean);
    results.push({ name, outColumns, body });
  }
  return results;
}

test('no function\'s CURRENT (latest create-or-replace) definition combines a RETURNS TABLE output column with an unqualified ON CONFLICT target list naming that same column', () => {
  // A superseded `create or replace` in an earlier, already-applied
  // migration file is historical record, not something to rewrite (see
  // 2026-09-16-realtor-notes-tours-buyer-invitations.sql and
  // 2026-09-16-realtor-started-searches.sql, both superseded by later
  // migrations) — only each function's LATEST definition across the whole
  // migration history is what's actually live once properly deployed, so
  // only that is checked here.
  const latestByName = new Map();
  for (const { file, content } of sources) {
    for (const fn of findFunctions(content)) {
      latestByName.set(fn.name, { file, ...fn });
    }
  }

  const offenders = [];
  for (const { file, name, outColumns, body } of latestByName.values()) {
    for (const col of outColumns) {
      // Only bare, unqualified `on conflict (col` / `on conflict(col` —
      // not `on conflict on constraint ...`, which is exactly the fix.
      const badPattern = new RegExp(`on conflict\\s*\\(\\s*${col}\\b`, 'i');
      if (badPattern.test(body)) {
        offenders.push(`${file}: function ${name}() returns "${col}" and also uses "on conflict (${col}, ...)" unqualified`);
      }
    }
  }
  assert.deepEqual(offenders, [], `found the proven-ambiguous pattern recurring in a CURRENT function definition:\n${offenders.join('\n')}`);
});

test('sanity check: the scanner actually finds accept_invitation and claim_prospective_search as RETURNS TABLE functions with a search_id output column (proves the test above isn\'t vacuously passing)', () => {
  const accept = sources.find((s) => s.file === '2026-09-25-accept-invitation-ambiguous-search-id-fix.sql');
  const claim = sources.find((s) => s.file === '2026-09-26-claim-prospective-search-ambiguous-search-id-fix.sql');
  assert.ok(accept, 'expected to find the accept_invitation fix migration');
  assert.ok(claim, 'expected to find the claim_prospective_search fix migration');
  const acceptFns = findFunctions(accept.content);
  const claimFns = findFunctions(claim.content);
  assert.ok(acceptFns.some((f) => f.name === 'accept_invitation' && f.outColumns.includes('search_id')));
  assert.ok(claimFns.some((f) => f.name === 'claim_prospective_search' && f.outColumns.includes('search_id')));
});
