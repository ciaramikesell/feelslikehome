import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const invite = read('src/app/invite/[token]/AcceptInvitationClient.jsx');
const repair = read('supabase/migrations/2026-09-22-realtor-invitation-acceptance-repair.sql');
const sheet = read('src/components/Sheet.jsx');

function fn(name) { return repair.match(new RegExp(`create (?:or replace )?function public\\.${name}[\\s\\S]*?end; \\$\\$;`, 'i'))?.[0] || ''; }

/* ------------------------------ BUG 1: co-buyer and Realtor share one already-repaired function ------------------------------ */

test('co-buyer and Realtor acceptance are the SAME accept_invitation function, both branches already redeployed together — this is not two separate bugs needing two separate fixes', () => {
  const accept = fn('accept_invitation');
  // realtor_to_buyer branch (a Realtor invited a buyer, or a Realtor
  // connecting to an existing buyer) — unaffected by this bug report.
  assert.match(accept, /if inv\.invitation_direction='realtor_to_buyer' then/);
  // else branch — covers BOTH co_buyer and buyer-invites-Realtor
  // (invitation_direction defaults to 'buyer_to_realtor'), using the
  // invitation's own stored relationship_type, never a hardcoded role.
  assert.match(accept, /target_search:=inv\.search_id;/);
  assert.match(accept, /insert into public\.search_members\(search_id,user_id,role\) values\(target_search,caller,inv\.relationship_type\)/);
  // No branch is co_buyer-specific or realtor-specific beyond the single
  // invitation_direction check above — same insert statement, same
  // exception handler, same stage tracking for both.
});

test('the diagnostic exception wrapper covers the entire function body, including the co-buyer/relationship_type insert — not just the realtor_to_buyer path', () => {
  const accept = fn('accept_invitation');
  const exceptionIndex = accept.indexOf('exception when others then');
  const realtorInsertIndex = accept.indexOf("insert into public.search_members(search_id,user_id,role) values(target_search,inv.invited_by,'realtor')");
  const coBuyerInsertIndex = accept.indexOf('insert into public.search_members(search_id,user_id,role) values(target_search,caller,inv.relationship_type)');
  assert.ok(exceptionIndex > -1 && realtorInsertIndex > -1 && coBuyerInsertIndex > -1, 'expected to find both inserts and the exception handler');
  assert.ok(realtorInsertIndex < exceptionIndex, 'the realtor insert must be inside the guarded block, before the exception handler');
  assert.ok(coBuyerInsertIndex < exceptionIndex, 'the co-buyer insert must be inside the guarded block, before the exception handler');
  assert.match(accept, /exception when others then\s*\n\s*return query select false, \('error_' \|\| stage \|\| '_' \|\| sqlstate\), null::uuid;/);
});

test('a failed acceptance now logs the real Supabase/Postgres error fields explicitly (message/code/details/hint), not just an opaque error object — this is a logging improvement only, not a new fallback path', () => {
  const acceptFn = invite.match(/const accept = async \(\) => \{[\s\S]*?\n  \};/)?.[0] || '';
  const catchBlock = acceptFn.match(/\} catch \(err\) \{[\s\S]*?\n    \}/)?.[0] || '';
  assert.match(catchBlock, /message: err\?\.message,/);
  assert.match(catchBlock, /code: err\?\.code,/);
  assert.match(catchBlock, /details: err\?\.details,/);
  assert.match(catchBlock, /hint: err\?\.hint,/);
  // Still no second RPC attempt, no silent alternate query, no bypassed
  // RLS — this only changes what gets logged when the same single
  // acceptInvitation() call fails.
  assert.equal((acceptFn.match(/acceptInvitation\(/g) || []).length, 1);
});

test('the known short-code reasons (already-established, safe to log) already distinguish RPC-not-found from an in-function failure — result.reason is logged unconditionally on !result.success', () => {
  assert.match(invite, /console\.error\('Invitation not accepted, reason:', result\.reason\);/);
});

/* ------------------------------ BUG 2: Sheet focus-management effect no longer re-runs on every parent re-render ------------------------------ */

test('root cause: Sheet\'s focus-management effect depends only on `open`, not `onClose` — an inline onClose recreated every render (the common calling pattern) can no longer re-trigger the initial-focus line on every keystroke', () => {
  const effectHeader = sheet.match(/useEffect\(\(\) => \{\s*\n\s*if \(!open\) return undefined;[\s\S]*?\n  \}, \[[^\]]*\]\);/)?.[0] || '';
  assert.ok(effectHeader, 'expected to find the focus-management effect');
  assert.match(effectHeader, /\}, \[open\]\);$/);
  assert.doesNotMatch(effectHeader, /\[open, onClose\]/);
});

test('Escape still calls the CURRENT onClose via a ref, not a stale closure from when the dialog first opened', () => {
  assert.match(sheet, /const onCloseRef = useRef\(onClose\);/);
  assert.match(sheet, /useEffect\(\(\) => \{ onCloseRef\.current = onClose; \}, \[onClose\]\);/);
  assert.match(sheet, /onCloseRef\.current\(\);/);
});

test('the close button and backdrop click still call the live onClose prop directly (unaffected — only the keydown-listener closure needed the ref)', () => {
  assert.match(sheet, /onMouseDown=\{\(event\) => dismissOnBackdrop && event\.target === event\.currentTarget && onClose\(\)\}/);
  assert.match(sheet, /<button type="button" className="hh-sheet-close" onClick=\{onClose\} aria-label="Close">/);
});
