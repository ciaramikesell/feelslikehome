-- READ-ONLY production verification for the co-buyer invitation journey.
--
-- Run in the Supabase SQL Editor of the PRODUCTION project (the one whose URL
-- is in Vercel's NEXT_PUBLIC_SUPABASE_URL). Nothing here writes, deletes, or
-- changes any data or definition. Output contains ids, booleans, counts, and
-- timestamps only: no emails, tokens, names, or preference contents.
--
-- Run each numbered section separately and keep the results.

------------------------------------------------------------------------------
-- 0. Prerequisites for the 2026-10-07 migrations. ALL must be true before
--    applying them. The replacement accept_invitation /
--    claim_prospective_search bodies use the 2026-09-16 Realtor-started-search
--    objects, and the compare function uses the 2026-09-18 columns. If any is
--    false, do not apply the migrations: production is behind the repository
--    in a way that needs its own review first.
------------------------------------------------------------------------------
select
  to_regclass('public.prospective_searches') is not null as has_prospective_searches,
  exists (select 1 from information_schema.columns where table_schema = 'public'
          and table_name = 'search_invitations' and column_name = 'prospective_search_id') as has_invitation_prospective_link,
  exists (select 1 from information_schema.columns where table_schema = 'public'
          and table_name = 'search_invitations' and column_name = 'invitation_direction') as has_invitation_direction,
  exists (select 1 from pg_constraint where conname = 'search_members_search_id_user_id_key') as has_members_unique,
  exists (select 1 from pg_constraint where conname = 'search_member_priorities_search_id_user_id_key') as has_priorities_unique,
  exists (select 1 from information_schema.columns where table_schema = 'public'
          and table_name = 'homes' and column_name = 'suggestion_staged') as has_homes_suggestion_staged,
  exists (select 1 from information_schema.columns where table_schema = 'public'
          and table_name = 'homes' and column_name = 'property_type') as has_homes_property_type;

------------------------------------------------------------------------------
-- 1. Which database code is deployed?
------------------------------------------------------------------------------
-- accept_invitation / claim_prospective_search:
--   fixed      = 2026-10-07-invitation-acceptance-conflict-targets.sql applied
--   ambiguous  = pre-fix body (fails with 42702 unless variable_conflict is
--                overridden, see the last column)
-- compare_parity  = 2026-10-07-cobuyer-compare-garage-parity.sql applied
select
  p.proname,
  p.prosrc like '%on conflict on constraint search_members_search_id_user_id_key%' as fixed,
  p.prosrc like '%on conflict(search_id,user_id)%' as ambiguous,
  case when p.proname = 'resolve_cobuyer_compare_perspectives'
       then p.prosrc not like '%''exterior:Garage''%' end as compare_parity,
  p.proconfig as function_settings,
  current_setting('plpgsql.variable_conflict', true) as session_variable_conflict
from pg_proc p
where p.pronamespace = 'public'::regnamespace
  and p.proname in ('accept_invitation', 'claim_prospective_search', 'resolve_cobuyer_compare_perspectives')
order by p.proname;

-- Database/role-level overrides of plpgsql.variable_conflict (an override
-- would explain acceptance working without the conflict-target migration).
select coalesce(d.datname, '(all databases)') as database, coalesce(r.rolname, '(all roles)') as role, s.setconfig
from pg_db_role_setting s
left join pg_database d on d.oid = s.setdatabase
left join pg_roles r on r.oid = s.setrole
where exists (select 1 from unnest(s.setconfig) c where c like 'plpgsql.%');

-- 2026-10-07-onboarding-state.sql applied? Expect 2 rows.
select column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'profiles'
  and column_name in ('onboarding_version', 'onboarding_state');

------------------------------------------------------------------------------
-- 2. Look up the two account ids (run once; use the ids below, not emails).
------------------------------------------------------------------------------
-- select id from auth.users where lower(email) = lower('<owner email>');
-- select id from auth.users where lower(email) = lower('<co-buyer email>');

------------------------------------------------------------------------------
-- 3. The journey, checkpoint by checkpoint. Replace the two placeholder ids.
------------------------------------------------------------------------------
with ids as (
  select '00000000-0000-0000-0000-000000000001'::uuid as owner_id,     -- <owner user id>
         '00000000-0000-0000-0000-000000000002'::uuid as co_buyer_id   -- <co-buyer user id>
),
owner_search as (
  select s.id from public.searches s, ids where s.user_id = ids.owner_id
),
co_buyer_own_search as (
  select s.id from public.searches s, ids where s.user_id = ids.co_buyer_id
)
select
  (select id from owner_search) as shared_search_id,
  (select id from co_buyer_own_search) as co_buyer_own_search_id,
  (select count(*) from public.searches s, ids where s.user_id = ids.co_buyer_id) as co_buyer_owned_search_count,
  -- invitation (latest from the owner's search to the co-buyer's address)
  (select i.status from public.search_invitations i, ids
     where i.search_id = (select id from owner_search) and i.relationship_type = 'co_buyer'
       and lower(i.invited_email) = (select lower(u.email) from auth.users u where u.id = ids.co_buyer_id)
     order by i.created_at desc limit 1) as invitation_status,
  -- 1. membership
  (select sm.role from public.search_members sm, ids
     where sm.search_id = (select id from owner_search) and sm.user_id = ids.co_buyer_id) as membership_role,
  -- 2. active search
  (select p.active_search_id = (select id from owner_search) from public.profiles p, ids where p.id = ids.co_buyer_id) as active_is_shared,
  (select p.active_search_id = (select id from co_buyer_own_search) from public.profiles p, ids where p.id = ids.co_buyer_id) as active_is_own,
  (select p.onboarding_complete from public.profiles p, ids where p.id = ids.co_buyer_id) as onboarding_complete,
  -- 4. where the co-buyer's preferences live
  exists (select 1 from public.search_member_priorities m, ids
     where m.user_id = ids.co_buyer_id and m.search_id = (select id from owner_search)) as prefs_on_shared,
  exists (select 1 from public.search_member_priorities m, ids
     where m.user_id = ids.co_buyer_id and m.search_id = (select id from co_buyer_own_search)) as prefs_on_own,
  (select count(*) from public.homes h where h.search_id = (select id from owner_search)) as shared_home_count;

-- Only if 2026-10-07-onboarding-state.sql is applied: which search onboarding
-- progress was made against, and where it stopped.
-- with ids as (select '00000000-0000-0000-0000-000000000002'::uuid as co_buyer_id)
-- select p.onboarding_version,
--        p.onboarding_state #>> '{context,searchId}' as progress_search_id,
--        p.onboarding_state #>> '{context,role}' as progress_role,
--        p.onboarding_state ->> 'step' as step,
--        p.onboarding_state ->> 'completedAt' as completed_at
-- from public.profiles p, ids where p.id = ids.co_buyer_id;

-- Which app build the co-buyer was running, if they sent any beta feedback
-- (app_version = Vercel commit SHA of the deployment that served them).
-- with ids as (select '00000000-0000-0000-0000-000000000002'::uuid as co_buyer_id)
-- select f.app_version, f.route, f.created_at
-- from public.beta_feedback f, ids where f.user_id = ids.co_buyer_id
-- order by f.created_at desc limit 5;

------------------------------------------------------------------------------
-- Reading the result
------------------------------------------------------------------------------
-- membership_role = co_buyer, active_is_shared = true          → accept + switch worked
-- prefs_on_own = true and prefs_on_shared = false               → preferences stranded on
--     the co-buyer's own search (pre-fix onboarding, or an existing account that
--     was never asked). Nothing is lost; see docs/cobuyer-journey-incident.md.
-- prefs_on_shared = true                                        → set up correctly
-- co_buyer_owned_search_count > 1                               → unexpected duplicate
--     search; report before changing anything.
