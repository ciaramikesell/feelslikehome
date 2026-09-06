-- Co-Buyer V1 — Phase A, Step 2 (CORRECTED): New foundation schema + RLS.
--
-- This file REPLACES the previous 2026-09-05-cobuyer-phase-a-foundation.sql.
-- If you already ran the earlier version, run the "supersede" block at the very
-- bottom of this file first (it safely drops the earlier flawed policies before
-- this file recreates them correctly) — otherwise just run this file directly.
--
-- WHAT CHANGED FROM THE PREVIOUS VERSION, AND WHY:
--
-- 1) RECURSIVE RLS (found in review, before this was ever run): the previous
--    version had search_members_select query `searches` directly, while
--    searches_select_member queried `search_members` directly. Since both
--    tables have RLS enabled, evaluating either policy's subquery requires
--    re-evaluating the OTHER table's policies — which loops back. This is a
--    known PostgreSQL/Supabase RLS pitfall; boolean short-circuiting does NOT
--    reliably prevent it, since RLS quals are folded into the query plan, not
--    evaluated as simple ordered conditions.
--
--    FIX: three small SECURITY DEFINER helper functions
--    (is_search_owner, is_search_member, can_access_search, can_access_home).
--    A SECURITY DEFINER function executes with its owner's privileges, which
--    bypasses RLS for the queries INSIDE the function body — so calling one
--    of these from a policy is a plain function call that resolves once and
--    terminates, never re-triggering RLS evaluation on any table. Every
--    cross-table policy check below goes through one of these functions now;
--    none of them contain a direct correlated subquery against another
--    RLS-protected table.
--
-- 2) PERSONAL TABLE WRITE AUTHORIZATION (found in review): the previous
--    version's search_member_priorities/home_member_state insert/update
--    policies only checked `auth.uid() = user_id` — proving "this row is
--    mine" but NOT "I'm actually allowed to attach a row to this search/home
--    at all." A user who knew (or guessed) an unrelated search_id or home_id
--    could have inserted their own row against it. FIX: insert/update now
--    also require can_access_search(...)/can_access_home(...) to be true.
--
-- Everything else — searches.user_id/unique(user_id) untouched, owner never
-- gets an explicit search_members row, legacy fallback (no backfill), shared
-- Pros/Cons/Notes, no combined Match — is unchanged from the original design.

-- =============================================================================
-- Authorization helper functions.
--
-- - SECURITY DEFINER: bypasses RLS for the internal lookups, which is the
--   whole point (see above) — this is not a general-purpose escalation, since
--   every function here ONLY ever returns a plain boolean, never row data.
-- - STABLE: no side effects, safe to evaluate once per statement.
-- - search_path pinned to `public` to prevent search-path hijacking, matching
--   the existing pattern already used by handle_new_user/set_updated_at.
-- - EXECUTE is revoked from PUBLIC and granted only to `authenticated`: every
--   real query against these tables in this app is already gated behind a
--   signed-in session at the page level (confirmed by inspecting every
--   page.js in the app — none query searches/homes without first checking
--   supabase.auth.getUser()), so `anon` never legitimately needs this.
-- =============================================================================

create or replace function public.is_search_owner(p_search_id uuid, p_user_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.searches s
    where s.id = p_search_id and s.user_id = p_user_id
  );
$$;

create or replace function public.is_search_member(p_search_id uuid, p_user_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.search_members sm
    where sm.search_id = p_search_id and sm.user_id = p_user_id
  );
$$;

create or replace function public.can_access_search(p_search_id uuid, p_user_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select public.is_search_owner(p_search_id, p_user_id) or public.is_search_member(p_search_id, p_user_id);
$$;

create or replace function public.can_access_home(p_home_id uuid, p_user_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.homes h
    where h.id = p_home_id and public.can_access_search(h.search_id, p_user_id)
  );
$$;

revoke all on function public.is_search_owner(uuid, uuid) from public;
revoke all on function public.is_search_member(uuid, uuid) from public;
revoke all on function public.can_access_search(uuid, uuid) from public;
revoke all on function public.can_access_home(uuid, uuid) from public;
grant execute on function public.is_search_owner(uuid, uuid) to authenticated;
grant execute on function public.is_search_member(uuid, uuid) to authenticated;
grant execute on function public.can_access_search(uuid, uuid) to authenticated;
grant execute on function public.can_access_home(uuid, uuid) to authenticated;

-- =============================================================================
-- profiles.active_search_id — nullable; null means "view my own owned search",
-- identical to today's behavior for every existing user.
-- =============================================================================
alter table public.profiles
  add column if not exists active_search_id uuid references public.searches(id) on delete set null;

-- =============================================================================
-- search_members — membership only. The owner is never a row here; ownership
-- is searches.user_id. A row here means "this user is an accepted co-buyer."
-- =============================================================================
create table if not exists public.search_members (
  id uuid primary key default gen_random_uuid(),
  search_id uuid not null references public.searches(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('member')),
  joined_at timestamptz not null default now(),
  unique (search_id, user_id)
);

alter table public.search_members enable row level security;

-- A member can see their own membership row directly (auth.uid() = user_id,
-- no function call needed). An owner sees the whole list via is_search_owner
-- — a function call, not a subquery against searches, so no recursion.
drop policy if exists "search_members_select" on public.search_members;
create policy "search_members_select" on public.search_members
  for select using (
    auth.uid() = user_id
    or public.is_search_owner(search_id, auth.uid())
  );

-- Only the owner can add a member — enforced via the function, and a
-- malicious user cannot self-insert as a member of someone else's search
-- merely by knowing its UUID, since is_search_owner checks THEIR OWN
-- ownership, not the target row's user_id.
drop policy if exists "search_members_owner_insert" on public.search_members;
create policy "search_members_owner_insert" on public.search_members
  for insert with check (
    public.is_search_owner(search_id, auth.uid())
  );

-- Owner may remove a member; a member may remove themselves (leave).
drop policy if exists "search_members_owner_delete" on public.search_members;
create policy "search_members_owner_delete" on public.search_members
  for delete using (
    public.is_search_owner(search_id, auth.uid())
    or auth.uid() = user_id
  );

-- =============================================================================
-- search_member_priorities — one priorities document per (search, user).
-- Legacy fallback: if no row exists for a user, the app reads
-- searches.priorities instead (only valid for the owner). This table only
-- ever gets a row once a user with My Search access actually saves a change.
-- =============================================================================
create table if not exists public.search_member_priorities (
  id uuid primary key default gen_random_uuid(),
  search_id uuid not null references public.searches(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  priorities jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (search_id, user_id)
);

alter table public.search_member_priorities enable row level security;

-- Read: own row only — no need to expose a co-buyer's priorities in V1.
drop policy if exists "smp_own_select" on public.search_member_priorities;
create policy "smp_own_select" on public.search_member_priorities
  for select using (auth.uid() = user_id);

-- Write: must be your own row AND you must actually have access to the
-- parent search (owner or accepted member) — this is the fix for Issue 2. A
-- stranger cannot attach a priorities row to an unrelated search merely by
-- knowing its UUID, even though the row's user_id would technically be theirs.
drop policy if exists "smp_own_insert" on public.search_member_priorities;
create policy "smp_own_insert" on public.search_member_priorities
  for insert with check (
    auth.uid() = user_id
    and public.can_access_search(search_id, auth.uid())
  );

drop policy if exists "smp_own_update" on public.search_member_priorities;
create policy "smp_own_update" on public.search_member_priorities
  for update using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and public.can_access_search(search_id, auth.uid())
  );

drop trigger if exists smp_set_updated_at on public.search_member_priorities;
create trigger smp_set_updated_at
  before update on public.search_member_priorities
  for each row execute function public.set_updated_at();

-- =============================================================================
-- home_member_state — one personal lifecycle/evaluation record per (home,
-- user). Legacy fallback: if no row exists for a user who is the home's
-- original owner (homes.user_id), the app reads the existing flat columns on
-- homes itself instead. Deliberately NOT named home_member_feedback — this
-- shape covers the full personal lifecycle, not just a feedback blob.
-- =============================================================================
create table if not exists public.home_member_state (
  id uuid primary key default gen_random_uuid(),
  home_id uuid not null references public.homes(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,

  status text, -- personal: 'Want to Tour' | 'Toured' | 'Archived' | null (Saved)
  reaction text, -- personal: 'love' | null
  rejection_reason text not null default '',
  ratings jsonb not null default '{}'::jsonb,
  checks jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (home_id, user_id)
);

alter table public.home_member_state enable row level security;

-- Read: your own state, OR any member's state for a home you can access (via
-- can_access_home — a function call, not a subquery against homes/searches/
-- search_members directly, so no recursion). This is what "Archived by
-- Co-Buyer" and future Compare need — reading a co-buyer's state — while
-- writes below remain strictly own-row only.
drop policy if exists "hms_select_members" on public.home_member_state;
create policy "hms_select_members" on public.home_member_state
  for select using (
    auth.uid() = user_id
    or public.can_access_home(home_id, auth.uid())
  );

-- Write: must be your own row AND you must actually have access to the
-- parent home's search — the same Issue 2 fix as search_member_priorities.
drop policy if exists "hms_own_insert" on public.home_member_state;
create policy "hms_own_insert" on public.home_member_state
  for insert with check (
    auth.uid() = user_id
    and public.can_access_home(home_id, auth.uid())
  );

drop policy if exists "hms_own_update" on public.home_member_state;
create policy "hms_own_update" on public.home_member_state
  for update using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and public.can_access_home(home_id, auth.uid())
  );

drop trigger if exists hms_set_updated_at on public.home_member_state;
create trigger hms_set_updated_at
  before update on public.home_member_state
  for each row execute function public.set_updated_at();

-- =============================================================================
-- search_invitations — a simple, secure, copy-link invitation. No email
-- provider is used; the owner copies and sends the link however they choose.
-- Only the owner can see/manage their own search's invitations in this phase.
-- Invitation PREVIEW/ACCEPTANCE by the invitee (who is not yet a member, and
-- so has no RLS access to this table at all) is intentionally NOT implemented
-- here — it requires its own narrowly-scoped SECURITY DEFINER RPC or
-- server-side route, which is Phase B/D work, not Phase A foundation. This
-- schema leaves room for that without needing to change today.
-- =============================================================================
create table if not exists public.search_invitations (
  id uuid primary key default gen_random_uuid(),
  search_id uuid not null references public.searches(id) on delete cascade,
  invited_by uuid not null references auth.users(id) on delete cascade,
  invited_email text not null,
  token uuid not null default gen_random_uuid() unique,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'expired', 'revoked')),
  expires_at timestamptz not null default (now() + interval '7 days'),
  responded_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.search_invitations enable row level security;

drop policy if exists "search_invitations_owner_select" on public.search_invitations;
create policy "search_invitations_owner_select" on public.search_invitations
  for select using (
    public.is_search_owner(search_id, auth.uid())
  );

drop policy if exists "search_invitations_owner_insert" on public.search_invitations;
create policy "search_invitations_owner_insert" on public.search_invitations
  for insert with check (
    public.is_search_owner(search_id, auth.uid())
    and invited_by = auth.uid()
  );

-- =============================================================================
-- searches / homes — extend existing RLS to also allow an accepted member,
-- without removing or altering the existing owner-only policies in any way.
-- Both the existing "owner" policies and these new "member" policies apply
-- together (Postgres RLS policies for the same command are OR'd), so a plain
-- single-user account's access is completely unaffected by these additions.
-- =============================================================================
drop policy if exists "searches_select_member" on public.searches;
create policy "searches_select_member" on public.searches
  for select using (
    public.is_search_member(id, auth.uid())
  );

-- Both co-buyers need full access to EVERY home in the shared search,
-- regardless of which of them happened to add a given home row — homes.user_id
-- only records who added that specific home, not who owns the search it
-- belongs to. can_access_search checks BOTH ownership and membership.
drop policy if exists "homes_select_member" on public.homes;
create policy "homes_select_member" on public.homes
  for select using (
    public.can_access_search(search_id, auth.uid())
  );

-- Both co-buyers may add/edit shared objective home facts (per the approved
-- V1 permission model — no approval workflow).
drop policy if exists "homes_insert_member" on public.homes;
create policy "homes_insert_member" on public.homes
  for insert with check (
    public.can_access_search(search_id, auth.uid())
  );

drop policy if exists "homes_update_member" on public.homes;
create policy "homes_update_member" on public.homes
  for update using (
    public.can_access_search(search_id, auth.uid())
  ) with check (
    public.can_access_search(search_id, auth.uid())
  );

create index if not exists search_members_user_id_idx on public.search_members(user_id);
create index if not exists search_member_priorities_user_id_idx on public.search_member_priorities(user_id);
create index if not exists home_member_state_user_id_idx on public.home_member_state(user_id);
create index if not exists search_invitations_token_idx on public.search_invitations(token);

-- =============================================================================
-- SUPERSEDE BLOCK — only needed if you already ran the earlier (flawed)
-- version of this file. Run this first, then run everything above. If you
-- have NOT yet run any foundation migration, skip this block entirely — the
-- "if not exists"/"drop ... if exists" statements above already handle a
-- clean first run safely on their own.
-- =============================================================================
-- drop policy if exists "search_members_select" on public.search_members;
-- drop policy if exists "searches_select_member" on public.searches;
-- drop policy if exists "homes_select_member" on public.homes;
-- drop policy if exists "homes_insert_member" on public.homes;
-- drop policy if exists "homes_update_member" on public.homes;
-- (the CREATE POLICY statements above already re-create each of these
-- correctly, since every one uses "drop policy if exists" immediately before
-- its own "create policy")

-- Rollback (run manually only if you need to fully undo this migration; safe
-- since every object here starts and remains empty for any account that never
-- uses collaboration):
-- drop policy if exists "homes_update_member" on public.homes;
-- drop policy if exists "homes_insert_member" on public.homes;
-- drop policy if exists "homes_select_member" on public.homes;
-- drop policy if exists "searches_select_member" on public.searches;
-- drop table if exists public.search_invitations;
-- drop table if exists public.home_member_state;
-- drop table if exists public.search_member_priorities;
-- drop table if exists public.search_members;
-- drop function if exists public.can_access_home(uuid, uuid);
-- drop function if exists public.can_access_search(uuid, uuid);
-- drop function if exists public.is_search_member(uuid, uuid);
-- drop function if exists public.is_search_owner(uuid, uuid);
-- alter table public.profiles drop column if exists active_search_id;
