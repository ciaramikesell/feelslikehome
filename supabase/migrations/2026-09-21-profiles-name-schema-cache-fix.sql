-- Production repair: Account Settings' profile-name save was failing with
-- PostgREST error PGRST204 — "Could not find the 'first_name' column of
-- 'profiles' in the schema cache" — even though profiles.first_name/
-- last_name are the intended canonical name columns (added by
-- 2026-09-19-account-name-capture-and-realtor-home.sql) and are already read
-- successfully (handle_new_user() writes them via a direct trigger, which
-- runs inside Postgres and never goes through PostgREST; resolve_display_name
-- and plain `select=*` reads work the same way/bypass PostgREST's per-column
-- cache). An UPDATE naming first_name/last_name explicitly in its body,
-- like Account Settings and the Realtor onboarding name prompt both do,
-- requires PostgREST's OWN schema cache to know those columns exist — and
-- that cache only refreshes on its own periodically or on a NOTIFY, never
-- automatically the instant a migration runs. Whether that migration's DDL
-- reached this database's live schema at all, or reached it but never
-- triggered a PostgREST reload, this repair covers both: re-assert the
-- columns (idempotent, a no-op if they're already there) and force
-- PostgREST to reload its schema cache so it actually notices them.
begin;

alter table public.profiles
  add column if not exists first_name text,
  add column if not exists last_name text;

alter table public.profiles drop constraint if exists profiles_first_name_length;
alter table public.profiles add constraint profiles_first_name_length
  check (first_name is null or char_length(first_name) <= 100);
alter table public.profiles drop constraint if exists profiles_last_name_length;
alter table public.profiles add constraint profiles_last_name_length
  check (last_name is null or char_length(last_name) <= 100);

commit;

-- Must run outside the transaction block — NOTIFY takes effect immediately
-- either way, but keeping it separate from `commit` makes it explicit this
-- is the step that actually fixes PostgREST's stale cache, not incidental
-- transaction cleanup. Supabase's own PostgREST instance listens for this
-- on the `pgrst` channel and reloads its schema cache in response, the same
-- effect as the dashboard's "API > Reload schema cache" button.
notify pgrst, 'reload schema';
