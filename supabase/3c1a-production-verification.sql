-- Pass 3C.1A post-deployment verification (read-only).
-- Results contain counts/booleans only; no participant-private values are shown.

-- Deliberately one result row, so SQL Editor result-pane handling cannot split
-- the home and priority checks into separate Result 1 / Result 2 panes.
with home_check as (
  select
    count(*) filter (where hms.id is null) as owner_home_state_gap,
    count(*) filter (where hms.id is not null and (
      hms.status is distinct from h.status
      or hms.reaction is distinct from h.reaction
      or hms.toured_at is distinct from h.toured_at
      or hms.is_favorite is distinct from h.is_favorite
      or hms.rejection_reason is distinct from h.rejection_reason
      or hms.ratings is distinct from h.ratings
      or hms.checks is distinct from h.checks
    )) as owner_state_rows_different_from_legacy_preserved,
    count(*) filter (where
      h.status is distinct from 'Considering'
      or h.reaction is not null
      or h.toured_at is not null
      or h.is_favorite
      or h.rejection_reason <> ''
      or h.ratings <> '{}'::jsonb
      or h.checks <> '{}'::jsonb
    ) as homes_with_legacy_personal_state
  from public.homes h
  left join public.home_member_state hms
    on hms.home_id = h.id and hms.user_id = h.user_id
), priority_check as (
  select
    count(*) filter (where smp.id is null) as owner_priority_gap,
    count(*) filter (where smp.id is not null
      and smp.priorities is distinct from s.priorities)
      as owner_priority_rows_different_from_legacy_preserved,
    count(*) filter (where s.priorities <> '{}'::jsonb)
      as searches_with_legacy_priorities
  from public.searches s
  left join public.search_member_priorities smp
    on smp.search_id = s.id and smp.user_id = s.user_id
)
select
  h.owner_home_state_gap,
  p.owner_priority_gap,
  h.homes_with_legacy_personal_state,
  p.searches_with_legacy_priorities,
  h.owner_state_rows_different_from_legacy_preserved,
  p.owner_priority_rows_different_from_legacy_preserved
from home_check h
cross join priority_check p;

-- Zero gaps prove every owner has a destination row. Difference counts can be
-- nonzero when an existing participant-owned row intentionally diverged; the
-- migration's ON CONFLICT DO NOTHING preserves those rows instead of overwriting
-- them. On a pre-deployment snapshot, the newly inserted subset should have zero
-- differences from its legacy source.

-- PostgreSQL serializes SET search_path = '' in proconfig as search_path="";
-- search_path= is not the catalog representation of the empty identifier.
-- This diagnostic returns raw and human-readable catalog forms for the exact
-- overload and always produces one row, even if the target is unexpectedly absent.
with target as (
  select p.*
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'resolve_cobuyer_lifecycle_signals'
    and pg_get_function_identity_arguments(p.oid) = 'p_search_id uuid, p_home_ids uuid[]'
), search_path_config as (
  select c.setting
  from target t
  cross join lateral unnest(coalesce(t.proconfig, '{}'::text[])) c(setting)
  where c.setting like 'search_path=%'
)
select
  (select pg_get_function_identity_arguments(t.oid) from target t)
    as identity_arguments,
  (select t.prosecdef from target t) as security_definer,
  (select t.proconfig from target t) as raw_proconfig,
  (select c.setting from search_path_config c) as search_path_configuration,
  (select substring(c.setting from length('search_path=') + 1)
    from search_path_config c) as configured_search_path_value,
  (select count(*) from target) = 1 as exact_overload_exists,
  coalesce((select t.prosecdef from target t), false)
    as all_overloads_security_definer,
  coalesce((select c.setting = 'search_path=""' from search_path_config c), false)
    as all_overloads_have_empty_search_path,
  coalesce((select not has_function_privilege('public', t.oid, 'EXECUTE')
    from target t), false) as public_cannot_execute,
  coalesce((select not has_function_privilege('anon', t.oid, 'EXECUTE')
    from target t), false) as anon_cannot_execute,
  coalesce((select has_function_privilege('authenticated', t.oid, 'EXECUTE')
    from target t), false) as authenticated_can_execute,
  coalesce((select not has_function_privilege('service_role', t.oid, 'EXECUTE')
    from target t), false) as service_role_cannot_execute;

-- Optional participant test (do not use service_role as privacy proof): connect
-- through the app/client with a normal authenticated JWT and call:
--   supabase.rpc('resolve_cobuyer_lifecycle_signals', {
--     p_search_id: '<accessible-search-uuid>',
--     p_home_ids: ['<home-in-that-search-uuid>']
--   })
-- Repeat as each participant, then verify an unrelated search and mixed-search
-- batch both fail. The SQL Editor cannot establish a normal authenticated JWT
-- merely by SET ROLE; use an actual participant session when testing privacy.
