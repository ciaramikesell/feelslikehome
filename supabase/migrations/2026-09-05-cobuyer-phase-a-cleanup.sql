-- Co-Buyer V1 — Phase A, Step 1: Remove abandoned Phase A collaboration remnants.
--
-- Safety basis (verified, not assumed):
--   - Confirmed via live inspection: all four tables below currently contain
--     zero rows. There is no user data to lose.
--   - Confirmed via a fresh grep of the entire current application source tree:
--     none of these tables, and no application code, reference is_search_member,
--     search_members, search_invitations, search_member_priorities, or
--     home_member_feedback anywhere. They are unused by anything currently live
--     in the app.
--   - Confirmed handle_new_user and set_updated_at are NOT touched here — they
--     are separately verified as active, current-production functions wired to
--     real triggers on searches/homes, unrelated to the abandoned attempt.
--
-- Order matters: policies are dropped explicitly (for clarity, even though
-- dropping a table also drops policies scoped to it), then tables (which also
-- removes any FK/constraint tied to them), then the now-orphaned helper
-- function last, since it could only ever have been called by the policies
-- just removed.
--
-- This does NOT touch: profiles, searches, homes, handle_new_user,
-- set_updated_at, or any existing user/home/priority/rating data.

-- Policies (explicit, for a clean audit trail)
drop policy if exists "home_member_feedback_select" on public.home_member_feedback;
drop policy if exists "home_member_feedback_write" on public.home_member_feedback;
drop policy if exists "search_invitations_insert" on public.search_invitations;
drop policy if exists "search_invitations_select" on public.search_invitations;
drop policy if exists "search_member_priorities_select" on public.search_member_priorities;
drop policy if exists "search_member_priorities_write" on public.search_member_priorities;
drop policy if exists "search_members_select" on public.search_members;

-- Tables (order here is defensive; none of these four actually reference each
-- other via foreign key, so any order is technically safe)
drop table if exists public.home_member_feedback;
drop table if exists public.search_invitations;
drop table if exists public.search_member_priorities;
drop table if exists public.search_members;

-- Helper function — only ever referenced by the policies just removed above,
-- confirmed via grep against current application code and the current
-- searches/homes/profiles policies (none of which call it).
drop function if exists public.is_search_member(uuid);

-- No rollback script is provided for this file: these objects held zero
-- user data and were confirmed unused, so there is nothing to restore. If you
-- ever need the abandoned Phase A shape again, it would need to be recreated
-- from scratch rather than un-dropped.
