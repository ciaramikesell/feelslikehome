-- READ-ONLY preflight for migrations/2026-10-12-realtor-access-and-home-ownership.sql.
--
-- Run in the Supabase SQL Editor of the PRODUCTION project before applying the
-- migration. It is one SELECT: it writes nothing, and returns schema facts and
-- row COUNTS only (no ids, emails, addresses, notes or other user data).
--
-- Proceed only if every row with check = 'required' shows ok = true. Rows with
-- check = 'info' describe what the migration will change for existing data.
-- If it fails with "relation public.realtor_suggestions does not exist", the
-- 2026-09-16 Realtor migrations are missing: stop, and run
-- production-migration-inventory.sql (docs/production-schema-drift-repair.md).
-- test/realtor-security-db.test.js runs this file inside a read-only
-- transaction before and after the migration.
with
fn as (
  select p.proname, md5(p.prosrc) as body_md5
  from pg_proc p where p.pronamespace = 'public'::regnamespace
),
col as (
  select table_name, column_name from information_schema.columns where table_schema = 'public'
),
pol as (
  select tablename, policyname, cmd, permissive, qual
  from pg_policies
  where schemaname = 'public'
    and tablename in ('homes', 'home_member_state', 'search_member_priorities', 'commute_destinations',
                      'realtor_suggestions', 'suggestion_dispositions', 'search_members')
),
-- Permissive SELECT/DELETE policies the migration does not replace. Any row
-- here would make the migration abort (by design): reconcile it first.
unexpected as (
  select tablename || '.' || policyname || ' (' || cmd || ')' as name
  from pol
  where permissive = 'PERMISSIVE' and cmd in ('SELECT', 'DELETE', 'ALL')
    and tablename in ('homes', 'home_member_state', 'search_member_priorities', 'commute_destinations', 'realtor_suggestions')
    and (tablename, policyname) not in (
      ('homes', 'homes_select_member'), ('homes', 'homes_select_own'),
      ('homes', 'homes_delete_own'), ('homes', 'homes_delete_departed_adder'),
      ('home_member_state', 'hms_participant_or_realtor_select'),
      ('search_member_priorities', 'smp_participant_or_realtor_select'),
      ('commute_destinations', 'commute_destinations_participant_or_realtor_select'),
      ('commute_destinations', 'commute_destinations_decision_maker_delete'),
      ('realtor_suggestions', 'suggestions_participant_select')
    )
),
ready as (
  select to_regclass('public.realtor_suggestions') is not null
     and exists (select 1 from col where table_name = 'homes' and column_name = 'suggestion_staged')
     and exists (select 1 from fn where proname = 'is_search_decision_maker')
     and exists (select 1 from fn where proname = 'is_search_realtor') as ok
)
select * from (
  -- 1. Prerequisites -----------------------------------------------------
  select 1 as section, 'required' as "check", 'realtor_suggestions + homes.suggestion_staged + role helpers exist' as item,
         (select ok from ready) as ok, null::text as detail
  union all
  select 1, 'required', 'resolve_display_name() exists (2026-09-19 account-name migration)',
         exists (select 1 from fn where proname = 'resolve_display_name'), null
  union all
  select 1, 'required', 'suggestion_listing_identity() exists',
         exists (select 1 from fn where proname = 'suggestion_listing_identity'), null
  union all
  select 1, 'required', 'home identity guard trigger present (prevents orphaning homes by deleting a search)',
         exists (select 1 from pg_trigger where tgname = 'homes_enforce_shared_identity' and tgrelid = 'public.homes'::regclass and not tgisinternal), null
  union all
  select 1, 'required', 'no unexpected permissive SELECT/DELETE policy (the migration would abort)',
         not exists (select 1 from unexpected), (select string_agg(name, ', ' order by name) from unexpected)
  union all
  select 1, 'required', 'realtor_suggestions.status has only pending/dismissed/accepted/withdrawn values',
         case when (select ok from ready) then (select count(*) = 0 from public.realtor_suggestions where status not in ('pending', 'dismissed', 'accepted', 'withdrawn')) end, null
  -- 2. Which versions production runs ---------------------------------------
  union all
  select 2, 'info', 'create_realtor_suggestion body',
         null, case (select body_md5 from fn where proname = 'create_realtor_suggestion')
           when '38dc64a99a1441c3470a4d4d48526170' then 'expected: 2026-09-19-account-name-capture-and-realtor-home.sql'
           when 'd4b0ac83709d201dad00c054c733144d' then 'OLDER: 2026-09-16-realtor-suggestions.sql (apply the 2026-09-19 repair first)'
           when '37cd42b7818b8aee64b6ff23be0d678d' then 'ALREADY APPLIED: 2026-10-12'
           else coalesce('NO REPOSITORY MATCH: ' || (select body_md5 from fn where proname = 'create_realtor_suggestion'), 'NOT PRESENT') end
  union all
  select 2, 'info', 'promote_realtor_suggestion body',
         null, case (select body_md5 from fn where proname = 'promote_realtor_suggestion')
           when '59f366db6c2935f9b02a8e55034dd969' then 'expected: 2026-09-16-realtor-suggestions.sql'
           when '99b5eca35ec7cb47420d4473ccbc2a4f' then 'ALREADY APPLIED: 2026-10-12'
           else coalesce('NO REPOSITORY MATCH: ' || (select body_md5 from fn where proname = 'promote_realtor_suggestion'), 'NOT PRESENT') end
  union all
  select 2, 'info', 'dismiss_realtor_suggestion body',
         null, case (select body_md5 from fn where proname = 'dismiss_realtor_suggestion')
           when 'ec27e647a743885bba960e7e21d25927' then 'expected: 2026-09-16-realtor-suggestions.sql'
           when '9a35df10d00dee5cb08a361009bcb5dc' then 'ALREADY APPLIED: 2026-10-12'
           else coalesce('NO REPOSITORY MATCH: ' || (select body_md5 from fn where proname = 'dismiss_realtor_suggestion'), 'NOT PRESENT') end
  union all
  select 2, 'info', 'Supabase CLI migration history (supabase_migrations.schema_migrations)',
         null, case when to_regclass('supabase_migrations.schema_migrations') is null
           then 'table absent: migrations were applied by hand; rely on the object checks above'
           else 'rows: ' || (xpath('/row/n/text()', query_to_xml('select count(*) as n from supabase_migrations.schema_migrations', false, true, '')))[1]::text
             || ', latest: ' || coalesce((xpath('/row/v/text()', query_to_xml('select max(version) as v from supabase_migrations.schema_migrations', false, true, '')))[1]::text, 'none') end
  -- 3. Current policies on the affected tables (names and rules) ------------
  union all
  select 3, 'info', tablename || '.' || policyname || ' [' || cmd || ', ' || lower(permissive) || ']', null, qual
  from pol
  -- 4. Existing rows the new rules apply to (counts only) -------------------
  union all
  select 4, 'info', 'homes outside any search (search_id is null): become unreachable through the API', null,
         (select count(*)::text from public.homes where search_id is null)
  union all
  select 4, 'info', 'accepted Realtor-suggested homes: buyers become able to delete; Realtors no longer can', null,
         case when (select ok from ready) then (select count(*)::text from public.homes h where not h.suggestion_staged and exists (select 1 from public.realtor_suggestions rs where rs.home_id = h.id)) end
  union all
  select 4, 'info', 'homes whose adder is no longer an owner/co-buyer of the search (deletable by current buyers)', null,
         case when (select ok from ready) then (select count(*)::text from public.homes h where h.search_id is not null and not h.suggestion_staged and not public.is_search_decision_maker(h.search_id, h.user_id)) end
  union all
  select 4, 'info', 'of those, added by a former co-buyer (no Realtor suggestion)', null,
         case when (select ok from ready) then (select count(*)::text from public.homes h where h.search_id is not null and not h.suggestion_staged and not public.is_search_decision_maker(h.search_id, h.user_id) and not exists (select 1 from public.realtor_suggestions rs where rs.home_id = h.id)) end
  union all
  select 4, 'info', 'pending suggestions whose Realtor already left: hidden now, marked withdrawn if re-invited', null,
         case when (select ok from ready) then (select count(*)::text from public.realtor_suggestions rs where rs.status = 'pending' and not public.is_search_realtor(rs.search_id, rs.suggested_by)) end
  union all
  select 4, 'info', 'suggestions by status', null,
         case when (select ok from ready) then (select string_agg(status || ': ' || n, ', ' order by status) from (select status, count(*) as n from public.realtor_suggestions group by status) s) end
  union all
  select 4, 'info', 'home assessments readable by a Realtor today but belonging to departed members (hidden after)', null,
         case when (select ok from ready) then (select count(*)::text from public.home_member_state s join public.homes h on h.id = s.home_id
           where h.search_id is not null and not public.is_search_decision_maker(h.search_id, s.user_id)
             and exists (select 1 from public.search_members sm where sm.search_id = h.search_id and sm.role = 'realtor')) end
) report
order by section, item;
