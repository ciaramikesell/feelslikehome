#!/usr/bin/env node
// Local Supabase stand-in for full-stack browser QA. DEVELOPMENT ONLY — it is
// never deployed and has no production configuration.
//
// It builds a throwaway Postgres database from the repository's own SQL (the
// same harness as the real-Postgres tests, test/support/supabaseDb.mjs) and
// serves the small slice of the Supabase HTTP API the app uses:
//
//   /auth/v1/user, /auth/v1/token, /auth/v1/logout   (signed tokens are not
//        verified: the token's `sub` is the user, exactly what auth.uid() reads)
//   /rest/v1/<table>  select / insert / upsert / update / delete with eq, neq,
//        in, is, order, limit, one-level embeds, and single-object responses
//   /rest/v1/rpc/<fn>
//   /storage/v1/object/<bucket>/<path> upload and public reads (in memory)
//
// Every REST/RPC request runs through psql as the `authenticated` role with
// request.jwt.claim.sub set, so RLS, column grants, triggers, constraints and
// SECURITY DEFINER functions behave as they do for a signed-in app user.
//
//   FLH_TEST_PGHOST=/tmp/flh-pg FLH_TEST_PGPORT=54329 node scripts/qa/supabase-standin.mjs [port]
//
// On start it prints one JSON line: { url, database, users } (see seed()).
import { createServer } from 'node:http';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { register } from 'node:module';
import { createTestDatabase } from '../../test/support/supabaseDb.mjs';

register('../../test/support/aliasHooks.mjs', import.meta.url);

const PORT = Number(process.argv[2] || 54321);
const ident = (name) => { if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw Object.assign(new Error(`bad identifier ${name}`), { status: 400 }); return name; };
const text = (value) => `'${String(value).replace(/'/g, "''")}'`;
function literal(value) {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return text(`{${value.map((v) => (v === null ? 'NULL' : `"${String(v).replace(/(["\\])/g, '\\$1')}"`)).join(',')}}`);
  if (typeof value === 'object') return text(JSON.stringify(value));
  return text(value);
}

let db;
function sql(userId, query) {
  const args = ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-h', process.env.FLH_TEST_PGHOST, '-U', process.env.FLH_TEST_PGUSER || 'postgres', '-d', db.name, '-f', '-'];
  if (process.env.FLH_TEST_PGPORT) args.push('-p', process.env.FLH_TEST_PGPORT);
  const role = userId ? `set local role authenticated;\nset local request.jwt.claim.sub = ${text(userId)};` : 'set local role anon;';
  const result = spawnSync('psql', args, { input: `begin;\n${role}\n${query};\ncommit;\n`, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const line = (result.stderr || '').split('\n').find((entry) => /ERROR:/.test(entry));
  if (result.status !== 0 || line) {
    const match = line?.match(/ERROR:\s+([0-9A-Z]{5}):\s+(.*)$/);
    return { error: { code: match?.[1] || 'XX000', message: match?.[2] || line || result.stderr, details: null, hint: null } };
  }
  return { data: JSON.parse(result.stdout.trim() || 'null') };
}

/* ------------------------------ PostgREST subset ------------------------------ */

function splitTopLevel(input) {
  const parts = [];
  let depth = 0; let current = '';
  for (const char of input) {
    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;
    if (char === ',' && depth === 0) { parts.push(current.trim()); current = ''; } else current += char;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function selectList(table, select, alias = 't0') {
  return splitTopLevel(select || '*').map((part) => {
    const embed = part.match(/^([a-z_]+)(?:!\w+)?\((.*)\)$/s);
    if (!embed) return part === '*' ? `${alias}.*` : `${alias}.${ident(part)}`;
    // One-level many-to-one embed through <singular>_id (e.g. homes via home_id).
    const target = ident(embed[1]);
    const fk = `${target.replace(/s$/, '')}_id`;
    // Aliased like PostgREST (homes_1), so a missing column fails with the
    // production message: 42703 column homes_1.<column> does not exist.
    const embedAlias = `${target}_1`;
    return `(select row_to_json(e) from (select ${selectList(target, embed[2], embedAlias)} from public.${target} ${embedAlias} where ${embedAlias}.id = ${alias}.${ident(fk)}) e) as ${target}`;
  }).join(', ');
}

function unquote(value) { return value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value; }
function filtersFrom(params) {
  const where = [];
  for (const [key, raw] of params) {
    if (['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'].includes(key)) continue;
    const column = ident(key);
    const [, op, value] = raw.match(/^(eq|neq|in|is|gt|gte|lt|lte|cs)\.(.*)$/s) || [];
    if (!op) throw Object.assign(new Error(`unsupported filter ${key}=${raw}`), { status: 400 });
    if (op === 'in') {
      const values = splitTopLevel(value.replace(/^\(|\)$/g, '')).map(unquote);
      where.push(values.length ? `${column} in (${values.map(literal).join(', ')})` : 'false');
    } else if (op === 'is') where.push(`${column} is ${value === 'null' ? 'null' : value === 'true' ? 'true' : 'false'}`);
    else if (op === 'cs') where.push(`${column} @> ${literal(value)}`);
    else where.push(`${column} ${{ eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=' }[op]} ${literal(value)}`);
  }
  return where.length ? ` where ${where.join(' and ')}` : '';
}

function orderFrom(params) {
  const order = params.get('order');
  if (!order) return '';
  return ` order by ${order.split(',').map((part) => { const [column, dir = 'asc', nulls] = part.split('.'); return `${ident(column)} ${dir === 'desc' ? 'desc' : 'asc'}${nulls ? ` ${nulls === 'nullsfirst' ? 'nulls first' : 'nulls last'}` : ''}`; }).join(', ')}`;
}

function rest(method, table, params, body, prefer) {
  const target = `public.${ident(table)}`;
  const where = filtersFrom(params);
  // Like PostgREST, return only the selected columns: column-level grants
  // (Pass 3C.3) refuse RETURNING * on homes, exactly as they should.
  const returned = method === 'GET' || method === 'HEAD' ? '' : (params.get('select') && params.get('select') !== '*' ? splitTopLevel(params.get('select')).map(ident).join(', ') : 'id');
  const returning = 'r.*';
  if (method === 'GET' || method === 'HEAD') {
    const limit = params.get('limit') ? ` limit ${Number(params.get('limit'))}` : '';
    return `select coalesce(json_agg(q), '[]'::json) from (select ${selectList(table, params.get('select'))} from ${target} t0${where}${orderFrom(params)}${limit}) q`;
  }
  if (method === 'DELETE') return `with r as (delete from ${target}${where} returning ${returned}) select coalesce(json_agg(x), '[]'::json) from (select ${returning} from r) x`;
  const rows = Array.isArray(body) ? body : [body];
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))].map(ident);
  const source = `select ${columns.join(', ')} from jsonb_populate_recordset(null::${target}, ${text(JSON.stringify(rows))}::jsonb)`;
  if (method === 'PATCH') {
    return `with r as (update ${target} set (${columns.join(', ')}) = (select ${columns.join(', ')} from jsonb_populate_record(null::${target}, ${literal(body)}::jsonb))${where} returning ${returned}) select coalesce(json_agg(x), '[]'::json) from (select ${returning} from r) x`;
  }
  let conflict = '';
  if (/resolution=(merge|ignore)-duplicates/.test(prefer)) {
    const keys = (params.get('on_conflict') || 'id').split(',').map((c) => ident(c.trim()));
    const updates = columns.filter((c) => !keys.includes(c)).map((c) => `${c} = excluded.${c}`);
    conflict = ` on conflict (${keys.join(', ')}) do ${/merge/.test(prefer) && updates.length ? `update set ${updates.join(', ')}` : 'nothing'}`;
  }
  return `with r as (insert into ${target} (${columns.join(', ')}) ${source}${conflict} returning ${returned}) select coalesce(json_agg(x), '[]'::json) from (select ${returning} from r) x`;
}

const fnShapes = new Map();
function rpc(userId, fn, args) {
  const name = ident(fn);
  if (!fnShapes.has(name)) {
    const [shape] = db.admin(`select p.proretset as set, t.typtype as kind from pg_proc p join pg_type t on t.oid = p.prorettype where p.pronamespace = 'public'::regnamespace and p.proname = '${name}' limit 1`);
    fnShapes.set(name, shape || { set: true, kind: 'c' });
  }
  const shape = fnShapes.get(name);
  const named = Object.entries(args || {}).map(([key, value]) => `${ident(key)} => ${literal(value)}`).join(', ');
  const result = sql(userId, `select coalesce(json_agg(t), '[]'::json) from public.${name}(${named}) t`);
  if (result.error) return result;
  if (shape.set) return result;
  const [row] = result.data;
  if (shape.kind === 'c') return { data: row ?? null };
  // A scalar function aggregates to bare values ([true]), not rows.
  return { data: row !== null && typeof row === 'object' ? Object.values(row)[0] : row ?? null };
}

/* ----------------------------------- auth ----------------------------------- */

const b64url = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
export function accessToken(user) {
  const now = Math.floor(Date.now() / 1000);
  return `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ sub: user.id, email: user.email, role: 'authenticated', aud: 'authenticated', iat: now, exp: now + 7 * 24 * 3600 })}.qa`;
}
function userFromToken(header) {
  const token = (header || '').replace(/^Bearer\s+/i, '');
  try { const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()); return payload.sub ? payload : null; } catch { return null; }
}
function authUser(id) {
  const [row] = db.admin(`select id, email, raw_user_meta_data as meta, created_at from auth.users where id = '${id}'`);
  return row ? { id: row.id, aud: 'authenticated', role: 'authenticated', email: row.email, user_metadata: row.meta || {}, app_metadata: { provider: 'email' }, created_at: row.created_at } : null;
}
export function sessionFor(user) {
  return { access_token: accessToken(user), refresh_token: `refresh-${user.id}`, token_type: 'bearer', expires_in: 7 * 24 * 3600, expires_at: Math.floor(Date.now() / 1000) + 7 * 24 * 3600, user: authUser(user.id) };
}

/* ---------------------------------- server ---------------------------------- */

const objects = new Map();
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS,HEAD', 'access-control-expose-headers': 'content-range' };
function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json', ...CORS, ...headers });
  res.end(body === undefined ? '' : (Buffer.isBuffer(body) ? body : JSON.stringify(body)));
}
const readBody = (req) => new Promise((resolve) => { const chunks = []; req.on('data', (c) => chunks.push(c)); req.on('end', () => resolve(Buffer.concat(chunks))); });

async function handle(req, res) {
  if (req.method === 'OPTIONS') return send(res, 204);
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;
  const caller = userFromToken(req.headers.authorization);
  const raw = await readBody(req);

  if (path === '/auth/v1/user') return caller && authUser(caller.sub) ? send(res, 200, authUser(caller.sub)) : send(res, 401, { code: 401, msg: 'invalid JWT' });
  if (path === '/auth/v1/token') {
    const body = JSON.parse(raw.toString() || '{}');
    const id = body.refresh_token?.replace(/^refresh-/, '') || db.admin(`select id from auth.users where email = ${text(body.email || '')}`)[0]?.id;
    return id ? send(res, 200, sessionFor({ id, email: authUser(id)?.email })) : send(res, 400, { error: 'invalid_grant' });
  }
  if (path.startsWith('/auth/v1/logout')) return send(res, 204);

  // supabase-js uploads a File/Blob as multipart form data (field "" or
  // "file"), the way Supabase Storage expects: keep only the file part.
  const storedObject = (body, type) => {
    const boundary = type.match(/^multipart\/form-data;\s*boundary=(.+)$/)?.[1];
    if (!boundary) return { body, type };
    const delimiter = Buffer.from(`--${boundary}`);
    let start = body.indexOf(delimiter);
    while (start !== -1) {
      const next = body.indexOf(delimiter, start + delimiter.length);
      if (next === -1) break;
      const part = body.subarray(start + delimiter.length + 2, next - 2);
      const split = part.indexOf('\r\n\r\n');
      const headers = part.subarray(0, split).toString();
      if (/filename=/.test(headers) || /content-type:/i.test(headers)) {
        return { body: part.subarray(split + 4), type: headers.match(/content-type:\s*([^\r\n]+)/i)?.[1] || 'application/octet-stream' };
      }
      start = next;
    }
    return { body, type };
  };
  if (await floorPlanStorage(req, res, path, url, caller, raw, storedObject)) return undefined;

  const storage = path.match(/^\/storage\/v1\/object\/(public\/)?([^/]+)\/(.+)$/);
  if (storage) {
    const key = `${storage[2]}/${decodeURIComponent(storage[3])}`;
    if (req.method === 'GET') { const object = objects.get(key); return object ? send(res, 200, object.body, { 'content-type': object.type }) : send(res, 404, { message: 'not found' }); }
    if (!caller) return send(res, 401, { message: 'unauthorized' });
    objects.set(key, storedObject(raw, req.headers['content-type'] || 'application/octet-stream'));
    return send(res, 200, { Key: key });
  }

  const rpcMatch = path.match(/^\/rest\/v1\/rpc\/([a-z_0-9]+)$/);
  const tableMatch = path.match(/^\/rest\/v1\/([a-z_0-9]+)$/);
  if (!rpcMatch && !tableMatch) return send(res, 404, { message: `standin: no route ${path}` });
  try {
    const result = rpcMatch
      ? rpc(caller?.sub, rpcMatch[1], JSON.parse(raw.toString() || '{}'))
      : sql(caller?.sub, rest(req.method, tableMatch[1], url.searchParams, raw.length ? JSON.parse(raw.toString()) : null, req.headers.prefer || ''));
    if (result.error) return send(res, ['42501'].includes(result.error.code) ? 403 : 400, result.error);
    const single = /vnd\.pgrst\.object/.test(req.headers.accept || '');
    if (single) {
      const rows = Array.isArray(result.data) ? result.data : [result.data];
      if (rows.length !== 1) return send(res, 406, { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: `The result contains ${rows.length} rows` });
      return send(res, 200, rows[0]);
    }
    if (tableMatch && req.method !== 'GET' && /return=minimal/.test(req.headers.prefer || '')) return send(res, 201);
    return send(res, 200, result.data);
  } catch (error) {
    return send(res, error.status || 500, { code: 'STANDIN', message: error.message });
  }
}

/* --------------------------- private floor-plan bucket --------------------------- */

// home-floor-plans is private: upload, remove and signing go through the
// harness's two-stage Storage stand-in (test/support/supabaseDb.mjs), so the
// real storage.objects policies, bucket MIME / size limits and the 8-object
// cap decide, as the signed-in caller. Bytes are kept in memory. Signed URLs
// carry their own expiry (like Storage's JWT) and are served without
// re-checking access, exactly like the real service.
//
// QA switches (POST /__qa/floor-plans, JSON): { ttlSeconds } shortens every
// newly signed URL; { failSign: true } makes signing fail; { failUpload: true }
// fails uploads before Storage sees them; { reset: true } clears all of them.
const FLOOR_PLAN_BUCKET = 'home-floor-plans';
const qaFloorPlans = { ttlSeconds: null, failSign: false, failUpload: false };
// true once the request is answered.
const sent = (...args) => { send(...args); return true; };
async function floorPlanStorage(req, res, path, url, caller, raw, storedObject) {
  if (path === '/__qa/floor-plans' && req.method === 'POST') {
    const body = JSON.parse(raw.toString() || '{}');
    if (body.reset) Object.assign(qaFloorPlans, { ttlSeconds: null, failSign: false, failUpload: false });
    for (const key of ['ttlSeconds', 'failSign', 'failUpload']) if (key in body) qaFloorPlans[key] = body[key];
    return sent(res, 200, qaFloorPlans);
  }
  const bucketApi = () => db.clientFor(caller.sub).storage.from(FLOOR_PLAN_BUCKET);
  const signed = path.match(/^\/storage\/v1\/object\/sign\/home-floor-plans\/(.+)$/);
  if (signed && req.method === 'GET') {
    const key = decodeURIComponent(signed[1]);
    let claim = null;
    try { claim = JSON.parse(Buffer.from(url.searchParams.get('token') || '', 'base64url').toString()); } catch { /* invalid */ }
    if (!claim || claim.path !== key) return sent(res, 400, { statusCode: '400', error: 'InvalidJWT', message: 'invalid signature' });
    if (Date.now() > claim.exp) return sent(res, 400, { statusCode: '400', error: 'InvalidJWT', message: '"exp" claim timestamp check failed' });
    const object = objects.get(`${FLOOR_PLAN_BUCKET}/${key}`);
    return object ? sent(res, 200, object.body, { 'content-type': object.type, 'cache-control': 'private, max-age=60' }) : sent(res, 404, { message: 'Object not found' });
  }
  if (path === `/storage/v1/object/sign/${FLOOR_PLAN_BUCKET}` && req.method === 'POST') {
    if (!caller) return sent(res, 400, { message: 'invalid JWT' });
    if (qaFloorPlans.failSign) return sent(res, 503, { message: 'QA: signing unavailable' });
    const { paths = [], expiresIn = 60 } = JSON.parse(raw.toString() || '{}');
    const { data, error } = await bucketApi().createSignedUrls(paths, expiresIn);
    if (error) return sent(res, 400, error);
    const ttl = (qaFloorPlans.ttlSeconds ?? expiresIn) * 1000;
    return sent(res, 200, data.map((entry) => (entry.signedUrl
      ? { path: entry.path, error: null, signedURL: `/object/sign/${FLOOR_PLAN_BUCKET}/${entry.path}?token=${b64url({ path: entry.path, exp: Date.now() + ttl })}` }
      : { path: entry.path, error: entry.error, signedURL: null })));
  }
  if (path === `/storage/v1/object/${FLOOR_PLAN_BUCKET}` && req.method === 'DELETE') {
    if (!caller) return sent(res, 400, { message: 'invalid JWT' });
    const { prefixes = [] } = JSON.parse(raw.toString() || '{}');
    const { data, error } = await bucketApi().remove(prefixes);
    if (error) return sent(res, 400, error);
    for (const row of data || []) objects.delete(`${FLOOR_PLAN_BUCKET}/${row.name}`);
    return sent(res, 200, (data || []).map((row) => ({ name: row.name, bucket_id: FLOOR_PLAN_BUCKET })));
  }
  const upload = path.match(/^\/storage\/v1\/object\/home-floor-plans\/(.+)$/);
  if (upload) {
    if (req.method !== 'POST') return sent(res, 400, { message: 'QA stand-in: home-floor-plans supports upload only (read through signed URLs)' });
    if (!caller) return sent(res, 400, { message: 'invalid JWT' });
    if (qaFloorPlans.failUpload) return sent(res, 500, { statusCode: '500', message: 'QA: upload failed' });
    const key = decodeURIComponent(upload[1]);
    const object = storedObject(raw, req.headers['content-type'] || 'application/octet-stream');
    const result = await bucketApi().upload(key, { size: object.body.length, type: object.type }, { contentType: object.type });
    if (result.error) return sent(res, Number(result.error.statusCode) || 400, { statusCode: result.error.statusCode, error: 'Error', message: result.error.message });
    objects.set(`${FLOOR_PLAN_BUCKET}/${key}`, object);
    return sent(res, 200, { Key: `${FLOOR_PLAN_BUCKET}/${key}`, Id: randomUUID() });
  }
  return false;
}

/* ----------------------------------- seed ----------------------------------- */

// A purchase search with real priorities, a co-buyer and a Realtor, plus one
// home saved before the Home Facts details existed (legacy data).
async function seed() {
  const { normalizePriorities } = await import('../../src/lib/constants.js');
  const { applySearchChoice } = await import('../../src/lib/onboarding.js');
  const { addCriterion } = await import('../../src/lib/searchProfile.js');
  const { acceptInvitation, createInvitation, savePriorities, setActiveSearch } = await import('../../src/lib/supabase/collaboration.js');
  const users = {
    owner: { email: 'ciara.qa@example.com', firstName: 'Ciara', lastName: 'M' },
    coBuyer: { email: 'andrew.qa@example.com', firstName: 'Andrew', lastName: 'M' },
    realtor: { email: 'rita.qa@example.com', firstName: 'Rita', lastName: 'R' },
  };
  for (const user of Object.values(users)) user.id = db.createUser(user);
  const search = db.admin(`select id from public.searches where user_id = '${users.owner.id}'`)[0].id;
  let priorities = applySearchChoice(normalizePriorities({}), 'home_buy');
  priorities.budget = { ...priorities.budget, value: '400000', tier: 'must' };
  priorities.bedsMin = { ...priorities.bedsMin, value: '3', tier: 'must' };
  priorities.bathsMin = { ...priorities.bathsMin, value: '2', tier: 'important' };
  priorities.homeCondition = { values: ['Move-In Ready'], tier: 'important' };
  priorities = addCriterion(priorities, { categoryKey: 'exterior', label: 'Garage', kind: 'check' }, 'must');
  priorities = addCriterion(priorities, { categoryKey: 'features', label: 'Finished basement', kind: 'check' }, 'important');
  priorities = addCriterion(priorities, { categoryKey: 'features', label: 'Fireplace', kind: 'check' }, 'nice');
  await savePriorities(db.clientFor(users.owner.id), { id: search }, users.owner.id, priorities);
  for (const [key, role] of [['coBuyer', 'co_buyer'], ['realtor', 'realtor']]) {
    const invitation = await createInvitation(db.clientFor(users.owner.id), search, users.owner.id, users[key].email, role);
    await acceptInvitation(db.clientFor(users[key].id), invitation.token);
  }
  // The co-buyer keeps their own list (a Fireplace Must-Have).
  await savePriorities(db.clientFor(users.coBuyer.id), { id: search }, users.coBuyer.id, addCriterion(applySearchChoice(normalizePriorities({}), 'home_buy'), { categoryKey: 'features', label: 'Fireplace', kind: 'check' }, 'must'));
  await setActiveSearch(db.clientFor(users.coBuyer.id), users.coBuyer.id, search);
  db.exec(`update public.profiles set onboarding_complete = true where id in ('${users.owner.id}', '${users.coBuyer.id}', '${users.realtor.id}')`);
  const legacySnapshot = { fields: { price: '289000', beds: '3', baths: '1.5', lotSize: '8712 sq ft' }, listingFacts: [{ key: 'heating', label: 'Heating', value: 'Forced air', group: 'utilities' }, { key: 'garageType', label: 'Garage', value: 'Detached', group: 'parking' }], descriptionFeatures: [] };
  const legacy = { id: randomUUID() };
  db.exec(`insert into public.homes (id, user_id, search_id, address, listing_url, price, beds, baths, lot_size, garage_spaces, basement_notes, schools_notes, listing_import, created_at)
    values ('${legacy.id}', '${users.owner.id}', '${search}', '208 Linden Ave, Royal Oak, MI 48073', 'https://www.zillow.com/homedetails/208-Linden-Ave/2_zpid/', '289000', '3', '1.5', '8712 sq ft', '4', 'Finished, walkout', 'Royal Oak Schools', ${literal(legacySnapshot)}::jsonb, now() - interval '3 days')`);
  db.exec(`insert into public.home_member_state (home_id, user_id, status, checks) values ('${legacy.id}', '${users.owner.id}', 'Saved', '{"features:Finished basement": true}')`);
  return { search, legacyHomeId: legacy.id, users: Object.fromEntries(Object.entries(users).map(([key, user]) => [key, { id: user.id, email: user.email, session: sessionFor(user) }])) };
}

db = createTestDatabase();
const seeded = await seed();
process.on('SIGINT', () => { db.drop(); process.exit(0); });
process.on('SIGTERM', () => { db.drop(); process.exit(0); });
// An error after the response went out (a client that hung up) is logged, never re-sent.
createServer((req, res) => handle(req, res).catch((error) => {
  if (res.headersSent) console.error(`standin: ${req.method} ${req.url}: ${error.message}`);
  else send(res, 500, { message: error.message });
})).listen(PORT, () => {
  console.log(JSON.stringify({ url: `http://localhost:${PORT}`, database: db.name, ...seeded }));
});
