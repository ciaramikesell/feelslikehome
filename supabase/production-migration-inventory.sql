-- READ-ONLY production migration inventory (2026-10-08).
--
-- Run in the Supabase SQL Editor of the PRODUCTION project. It writes nothing
-- and returns only schema facts (no user data): one row per migration since
-- the 2026-09-16 Realtor work, showing whether the objects it creates or
-- changes are present.
--
-- Use it to decide exactly which migrations production is missing; do not
-- replay ones that show applied = true. See
-- docs/production-schema-drift-repair.md for how to read the result.
with fn as (
  select p.proname, p.prosrc, pg_get_function_result(p.oid) as result
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace
),
col as (
  select table_name, column_name from information_schema.columns where table_schema = 'public'
)
select * from (values
  ('2026-09-16-realtor-role-foundation.sql',
     exists (select 1 from fn where proname = 'is_search_decision_maker'),
     'is_search_decision_maker() exists'),
  ('2026-09-16-realtor-suggestions.sql',
     to_regclass('public.realtor_suggestions') is not null and exists (select 1 from col where table_name = 'homes' and column_name = 'suggestion_staged'),
     'realtor_suggestions table + homes.suggestion_staged'),
  ('2026-09-16-realtor-suggestions-homes-select-fix.sql',
     exists (select 1 from col where table_name = 'homes' and column_name = 'suggestion_staged')
       and has_column_privilege('authenticated', 'public.homes', 'suggestion_staged', 'select'),
     'authenticated may SELECT homes.suggestion_staged'),
  ('2026-09-16-realtor-notes-tours-buyer-invitations.sql',
     to_regclass('public.realtor_notes') is not null and exists (select 1 from col where table_name = 'search_invitations' and column_name = 'invitation_direction'),
     'realtor_notes table + search_invitations.invitation_direction'),
  ('2026-09-16-map-collaborator-places.sql / my-search-collaborator-display-name.sql',
     exists (select 1 from fn where proname = 'resolve_collaborator_search_context' and result like '%display_name%'),
     'resolve_collaborator_search_context returns display_name'),
  ('2026-09-16-realtor-started-searches.sql',
     to_regclass('public.prospective_searches') is not null
       and exists (select 1 from col where table_name = 'search_invitations' and column_name = 'prospective_search_id'),
     'prospective_searches table + search_invitations.prospective_search_id'),
  ('2026-09-17-listing-import-provenance.sql',
     exists (select 1 from col where table_name = 'homes' and column_name = 'listing_import'),
     'homes.listing_import'),
  ('2026-09-17-listing-import-z-privileges-hotfix.sql',
     exists (select 1 from col where table_name = 'homes' and column_name = 'listing_import')
       and has_column_privilege('authenticated', 'public.homes', 'listing_import', 'select'),
     'authenticated may SELECT homes.listing_import'),
  ('2026-09-18-people-workspace-draft-select-privileges.sql',
     to_regclass('public.prospective_searches') is not null
       and has_column_privilege('authenticated', 'public.prospective_searches', 'draft_priorities', 'select')
       and not has_column_privilege('authenticated', 'public.prospective_searches', 'started_by', 'select'),
     'prospective_searches SELECT narrowed to the workspace projection'),
  ('2026-09-18-tour-evaluations.sql',
     exists (select 1 from fn where proname = 'resolve_cobuyer_compare_perspectives' and prosrc like '%"positive"%'),
     'compare projection scores semantic tour responses'),
  ('2026-09-19-account-name-capture-and-realtor-home.sql',
     exists (select 1 from col where table_name = 'profiles' and column_name = 'first_name')
       and exists (select 1 from fn where proname = 'resolve_display_name')
       and exists (select 1 from fn where proname = 'create_realtor_connection_request'),
     'profiles.first_name + resolve_display_name() + create_realtor_connection_request()'),
  ('2026-10-07-invitation-acceptance-conflict-targets.sql',
     exists (select 1 from fn where proname = 'accept_invitation' and prosrc like '%on conflict on constraint search_members_search_id_user_id_key%'),
     'accept_invitation uses named conflict constraint'),
  ('2026-10-07-cobuyer-compare-garage-parity.sql',
     exists (select 1 from fn where proname = 'resolve_cobuyer_compare_perspectives' and prosrc not like '%''exterior:Garage''%'),
     'compare projection no longer retires Garage'),
  ('2026-10-07-onboarding-state.sql',
     exists (select 1 from col where table_name = 'profiles' and column_name = 'onboarding_state'),
     'profiles.onboarding_state')
) as inventory(migration, applied, evidence)
union all
-- Facts that explain how invitations currently behave.
select 'FACT: accept_invitation conflict clause',
       null,
       (select case
          when prosrc like '%on conflict on constraint%' then 'named constraint (fixed)'
          when prosrc like '%on conflict(search_id,user_id)%' then 'ambiguous on conflict(search_id,user_id): fails with 42702 unless variable_conflict is overridden'
          else 'no ON CONFLICT clause (an older definition)' end
        from fn where proname = 'accept_invitation' limit 1)
union all
-- 2026-09-16-realtor-started-searches.sql uses plain CREATE FUNCTION for these
-- three; when that migration shows applied = false this must read 'none'.
select 'FACT: Realtor-started functions present', null,
       coalesce((select string_agg(proname, ', ' order by proname) from fn
                 where proname in ('create_prospective_search', 'invite_prospective_client', 'claim_prospective_search')), 'none')
union all
select 'FACT: plpgsql.variable_conflict overrides', null,
       coalesce((select string_agg(c, ', ') from pg_db_role_setting s, unnest(s.setconfig) c where c like 'plpgsql.%'), 'none')
union all
select 'FACT: preview_invitation returns', null,
       (select result from fn where proname = 'preview_invitation' limit 1);
