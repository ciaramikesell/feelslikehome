#!/usr/bin/env node
// Applies one or more supabase/migrations/*.sql files directly to a
// Postgres connection string, in the order given, each inside its own
// transaction (every migration in this repo already wraps itself in its
// own begin/commit). This exists because supabase db push requires
// migration filenames in <timestamp>_name.sql form — this repo's
// migrations predate that convention and were applied by hand through the
// Supabase dashboard's SQL editor, which has repeatedly corrupted
// multi-statement pastes (see docs/deploying-migrations.md). supabase db
// query --file also can't run these: its single prepared-statement
// execution rejects a file containing more than one SQL command. Plain
// pg.Client#query, used here, runs a whole multi-statement string as one
// simple-protocol call, which Postgres accepts natively.
//
// Usage:
//   SUPABASE_DB_URL="postgresql://postgres:[password]@[host]:5432/postgres" \
//     npm run db:migrate -- supabase/migrations/2026-09-26-example.sql
//
// Never pass --db-url/password on the command line or hardcode it here —
// only ever read from the environment, so nothing lands in shell history
// or source control.
import { readFileSync } from 'node:fs';
import pg from 'pg';

const files = process.argv.slice(2);

if (!files.length) {
  console.error('Usage: SUPABASE_DB_URL=... npm run db:migrate -- supabase/migrations/<file>.sql [more files...]');
  process.exit(1);
}

const connectionString = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
if (!connectionString) {
  console.error(
    "Set SUPABASE_DB_URL (or DATABASE_URL) to this project's Postgres connection string first.\n" +
    'Find it in the Supabase dashboard: Project Settings -> Database -> Connection string -> URI\n' +
    '(e.g. postgresql://postgres:[password]@[host]:5432/postgres). Never commit this value.'
  );
  process.exit(1);
}

const client = new pg.Client({ connectionString });
await client.connect();
try {
  for (const file of files) {
    const sql = readFileSync(file, 'utf8');
    process.stdout.write(`Applying ${file} ... `);
    await client.query(sql);
    console.log('done.');
  }
  console.log(`Applied ${files.length} migration${files.length === 1 ? '' : 's'}.`);
} finally {
  await client.end();
}
