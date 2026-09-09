import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync('supabase/migrations/2026-09-09-rental-v1-shared-facts.sql', 'utf8');
const schema = fs.readFileSync('supabase/schema.sql', 'utf8');
const app = fs.readFileSync('src/lib/supabase/collaboration.js', 'utf8');
const constants = fs.readFileSync('src/lib/constants.js', 'utf8');
const verifier = fs.readFileSync('supabase/rental-v1-shared-facts-verification.sql', 'utf8');
const columns = ['property_type', 'available_on', 'pets_allowed', 'utilities_included', 'in_unit_laundry'];

test('migration adds exactly the five nullable Pass B facts without a rewrite', () => {
  assert.match(migration, /^begin;/m);
  assert.match(migration, /add column property_type text,[\s\S]*add column available_on date,[\s\S]*add column pets_allowed boolean,[\s\S]*add column utilities_included boolean,[\s\S]*add column in_unit_laundry boolean;/);
  assert.match(migration, /homes_property_type_check[\s\S]*not valid;[\s\S]*validate constraint homes_property_type_check/);
  for (const value of ['apartment','house','townhome','condo','multifamily','other']) assert.match(migration, new RegExp(`'${value}'`));
  assert.doesNotMatch(migration, /\b(update|delete)\s+public\.homes\b/i);
  assert.doesNotMatch(migration, /monthly_rent|\bunknown\b\s*[,)]/i);
});

test('canonical schema and restricted grants include every shared fact', () => {
  for (const column of columns) {
    assert.match(schema, new RegExp(`${column} (?:text|date|boolean)`));
    assert.match(migration, new RegExp(`grant select \\([^)]*${column}`, 's'));
  }
  assert.match(migration, /revoke select, insert, update on table public\.homes from authenticated/);
  assert.doesNotMatch(migration, /grant (?:select|insert|update) on (?:table )?public\.homes/i);
  assert.match(verifier, /legacy private homes columns remain denied/);
});

test('mappers are null-safe and runtime retries only missing Pass B schema', () => {
  for (const [db, js] of [['property_type','propertyType'],['available_on','availableOn'],['pets_allowed','petsAllowed'],['utilities_included','utilitiesIncluded'],['in_unit_laundry','inUnitLaundry']]) {
    assert.match(app, new RegExp(db)); assert.match(app, new RegExp(js)); assert.match(constants, new RegExp(`${js}: null`));
  }
  assert.match(app, /isPrePassBSchemaError/);
  assert.match(app, /HOME_SHARED_COLUMNS_PRE_PASS_B/);
});

test('RPC foundations use authoritative shared facts and preserve sanitized contracts', () => {
  assert.match(migration, /propertyType', 'preferredPropertyTypes/);
  assert.match(migration, /petsAllowed', 'features:Pets Allowed/);
  assert.match(migration, /utilitiesIncluded', 'features:Utilities Included/);
  assert.match(migration, /inUnitLaundry', 'features:In-Unit Laundry/);
  assert.doesNotMatch(migration, /availableOn',/);
  assert.match(migration, /v_home\.property_type is not null[\s\S]*v_raw \? v_home\.property_type/);
  assert.match(migration, /shared facts are authoritative[\s\S]*if v_score is null then continue/);
  assert.match(verifier, /awareness return shape remains boolean-only/);
  assert.match(verifier, /compare return shape remains sanitized/);
});
