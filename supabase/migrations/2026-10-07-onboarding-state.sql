-- Onboarding state foundation (Onboarding V2, Phase 1).
--
-- Adds the persisted onboarding version and resumable progress to profiles.
-- Purely additive: no existing column, policy, grant, function, or row is
-- changed, and nothing is backfilled.
--
--   onboarding_version  The onboarding flow version this person started or
--                       completed. NULL for every existing account: an
--                       account with onboarding_complete = true and a NULL
--                       version finished onboarding before versioning, and
--                       is never routed into a newer flow. The gate into
--                       /onboarding remains onboarding_complete alone.
--   onboarding_state    Resumable progress (src/lib/onboardingFlow.js): the
--                       current/finished screens, onboarding-only answers
--                       (e.g. who they are searching with), and the search
--                       and role the progress was made against, so an invited
--                       co-buyer's progress is tied to the shared search, not
--                       their own default search.
--
-- Security: profiles keeps its existing own-row policies
-- (profiles_select_own / profiles_update_own). Both columns are
-- user-writable by design. They steer presentation only, are never used for
-- authorization, and must never hold entitlement or other privileged state
-- (FLH+ entitlements will live in their own non-client-writable table).
begin;

alter table public.profiles
  add column if not exists onboarding_version smallint,
  add column if not exists onboarding_state jsonb not null default '{}'::jsonb;

alter table public.profiles drop constraint if exists profiles_onboarding_version_range;
alter table public.profiles add constraint profiles_onboarding_version_range
  check (onboarding_version is null or onboarding_version between 1 and 100);

alter table public.profiles drop constraint if exists profiles_onboarding_state_shape;
alter table public.profiles add constraint profiles_onboarding_state_shape
  check (jsonb_typeof(onboarding_state) = 'object' and pg_column_size(onboarding_state) <= 16384);

comment on column public.profiles.onboarding_version is
  'Onboarding flow version started/completed. NULL with onboarding_complete = true means completed before versioning; never re-routed.';
comment on column public.profiles.onboarding_state is
  'Resumable onboarding progress (src/lib/onboardingFlow.js). Presentation only; never used for authorization or entitlement.';

notify pgrst, 'reload schema';
commit;
