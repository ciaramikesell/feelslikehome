-- READ-ONLY preflight for the 2026-10-08 production repair
-- (docs/production-schema-drift-repair.md). Schema facts only; no user data.
--
-- PL/pgSQL does not check the tables/columns/functions a body uses until it
-- runs, so a migration can "succeed" and still fail later at call time. This
-- lists every object the seven repair files depend on but do not create
-- themselves. Every row must be ok = true; the final row is the verdict.
with required(kind, object, ok) as (
  values
    -- tables
    ('table', 'searches',                 to_regclass('public.searches') is not null),
    ('table', 'profiles',                 to_regclass('public.profiles') is not null),
    ('table', 'search_members',           to_regclass('public.search_members') is not null),
    ('table', 'search_member_priorities', to_regclass('public.search_member_priorities') is not null),
    ('table', 'search_invitations',       to_regclass('public.search_invitations') is not null),
    ('table', 'homes',                    to_regclass('public.homes') is not null),
    ('table', 'home_member_state',        to_regclass('public.home_member_state') is not null),
    ('table', 'commute_destinations',     to_regclass('public.commute_destinations') is not null),
    ('table', 'realtor_suggestions',      to_regclass('public.realtor_suggestions') is not null),
    ('table', 'realtor_notes',            to_regclass('public.realtor_notes') is not null),
    ('table', 'tour_suggestions',         to_regclass('public.tour_suggestions') is not null),
    -- helper functions called by the new bodies
    ('function', 'set_updated_at()',                     to_regprocedure('public.set_updated_at()') is not null),
    ('function', 'can_access_search(uuid,uuid)',         to_regprocedure('public.can_access_search(uuid,uuid)') is not null),
    ('function', 'is_search_realtor(uuid,uuid)',         to_regprocedure('public.is_search_realtor(uuid,uuid)') is not null),
    ('function', 'is_search_decision_maker(uuid,uuid)',  to_regprocedure('public.is_search_decision_maker(uuid,uuid)') is not null),
    ('function', 'suggestion_listing_identity(text,text)', to_regprocedure('public.suggestion_listing_identity(text,text)') is not null),
    -- unique constraints named by the conflict-target fix
    ('constraint', 'search_members_search_id_user_id_key',           exists (select 1 from pg_constraint where conname = 'search_members_search_id_user_id_key')),
    ('constraint', 'search_member_priorities_search_id_user_id_key', exists (select 1 from pg_constraint where conname = 'search_member_priorities_search_id_user_id_key'))
),
required_columns(tbl, col) as (
  values
    ('profiles','active_search_id'), ('profiles','onboarding_complete'),
    ('search_invitations','invitation_direction'), ('search_invitations','inviter_display_name'),
    ('search_invitations','relationship_type'), ('search_invitations','responded_at'), ('search_invitations','expires_at'),
    ('home_member_state','status'), ('home_member_state','reaction'), ('home_member_state','toured_at'),
    ('home_member_state','is_favorite'), ('home_member_state','ratings'), ('home_member_state','checks'),
    ('commute_destinations','label'), ('commute_destinations','address'), ('commute_destinations','max_drive_minutes'),
    -- homes columns read by the compare projection and written by create_realtor_suggestion (09-19)
    ('homes','address'), ('homes','crossroads'), ('homes','listing_url'), ('homes','photo_url'), ('homes','price'),
    ('homes','est_monthly'), ('homes','sqft'), ('homes','beds'), ('homes','baths'), ('homes','lot_size'),
    ('homes','garage_spaces'), ('homes','year_built'), ('homes','days_on_market'), ('homes','home_layout'),
    ('homes','home_condition'), ('homes','primary_bedroom_location'), ('homes','secondary_bedroom_location'),
    ('homes','notes'), ('homes','pros'), ('homes','cons'), ('homes','ratings'), ('homes','checks'),
    ('homes','property_type'), ('homes','pets_allowed'), ('homes','utilities_included'), ('homes','in_unit_laundry'),
    ('homes','property_name'), ('homes','selected_floor_plan_name'), ('homes','selected_unit_label'),
    ('homes','floor_plan_image_url'), ('homes','suggestion_staged')
),
checks as (
  select kind, object, ok from required
  union all
  select 'column', rc.tbl || '.' || rc.col,
         exists (select 1 from information_schema.columns c
                 where c.table_schema = 'public' and c.table_name = rc.tbl and c.column_name = rc.col)
  from required_columns rc
)
select kind, object, ok from checks
union all
select 'VERDICT',
       case when bool_and(ok) then 'all prerequisites present'
            else 'STOP: ' || count(*) filter (where not ok) || ' missing (rows above with ok = false)' end,
       bool_and(ok)
from checks;
