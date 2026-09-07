-- Feels Like Home — Supabase schema
-- Run this once, in full, in the Supabase SQL Editor for a brand-new project.
-- It is safe to re-run: every statement either uses "if not exists" or replaces
-- the previous version of itself.

create extension if not exists "pgcrypto";

-- =============================================================================
-- profiles — one row per user, tracks onboarding status
-- =============================================================================
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  onboarding_complete boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- =============================================================================
-- searches — one row per user in V1 (enforced by the unique constraint below).
-- Holds every My Search preference as a single JSON document, matching the
-- shape the app already works with. The table itself doesn't forbid a user
-- from having more than one search someday — only the unique constraint and
-- the app's UI make it "one search per user" for now. Removing that
-- constraint later, plus a "select a search" screen, is all multi-search
-- would need — no data model rewrite.
-- =============================================================================
create table if not exists public.searches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  priorities jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id)
);

alter table public.searches enable row level security;

drop policy if exists "searches_select_own" on public.searches;
create policy "searches_select_own" on public.searches
  for select using (auth.uid() = user_id);

drop policy if exists "searches_insert_own" on public.searches;
create policy "searches_insert_own" on public.searches
  for insert with check (auth.uid() = user_id);

drop policy if exists "searches_update_own" on public.searches;
create policy "searches_update_own" on public.searches
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "searches_delete_own" on public.searches;
create policy "searches_delete_own" on public.searches
  for delete using (auth.uid() = user_id);

-- =============================================================================
-- homes — one row per home a user is tracking
-- =============================================================================
create table if not exists public.homes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  search_id uuid references public.searches(id) on delete set null,

  address text not null default '',
  crossroads text not null default '',
  listing_url text not null default '',
  photo_url text not null default '',

  price text not null default '',
  est_monthly text not null default '',
  sqft text not null default '',
  beds text not null default '',
  baths text not null default '',
  lot_size text not null default '',
  garage_spaces text not null default '',
  year_built text not null default '',
  days_on_market text not null default '',

  home_layout text[] not null default '{}',
  primary_bedroom_location text not null default '',
  secondary_bedroom_location text not null default '',

  status text not null default 'Considering',
  reaction text,
  rejection_reason text not null default '',

  -- Namespaced "category:label" -> value maps (e.g. "location:Schools": 4),
  -- matching the app's in-memory shape exactly, so custom criteria and
  -- reordering never require a schema change.
  ratings jsonb not null default '{}'::jsonb,
  checks jsonb not null default '{}'::jsonb,

  notes text not null default '',
  pros text not null default '',
  cons text not null default '',

  -- Auto Enrichment 1.0 — already-returned RentCast facts we previously discarded.
  -- All nullable: existing homes simply have null here until their next successful
  -- lookup. Never contribute to Match, never shown as onboarding/My Search criteria.
  -- latitude/longitude are infrastructure for future location features and are
  -- never surfaced in the UI. hoa_fee_monthly/property_tax_annual are plain
  -- informational facts; property_tax_year records which year that amount applies
  -- to, since RentCast returns a multi-year tax history and we only keep the most
  -- recent entry (selected by its own `year` field, never by array/object order).
  latitude numeric,
  longitude numeric,
  hoa_fee_monthly numeric,
  property_tax_annual numeric,
  property_tax_year integer,

  -- Auto Enrichment — School District: a plain district name from Geocodio's school
  -- data append, resolved from the property's coordinates (or address as a fallback).
  -- Never a rating/score. Informational only — never contributes to Match, never
  -- appears in onboarding/My Search.
  school_district text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.homes enable row level security;

drop policy if exists "homes_select_own" on public.homes;
create policy "homes_select_own" on public.homes
  for select using (auth.uid() = user_id);

drop policy if exists "homes_insert_own" on public.homes;
create policy "homes_insert_own" on public.homes
  for insert with check (auth.uid() = user_id);

drop policy if exists "homes_update_own" on public.homes;
create policy "homes_update_own" on public.homes
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "homes_delete_own" on public.homes;
create policy "homes_delete_own" on public.homes
  for delete using (auth.uid() = user_id);

create index if not exists homes_user_id_idx on public.homes(user_id);
create index if not exists searches_user_id_idx on public.searches(user_id);

-- =============================================================================
-- Auto-create a profile + a default search the instant someone signs up, so
-- the app never has to handle "no search row yet" as a special case.
--
-- SECURITY DEFINER lets this function insert rows on behalf of a user who, at
-- the moment auth.users gets their row, doesn't have a session yet for RLS to
-- key off of. search_path is pinned to prevent search-path hijacking, per
-- Supabase's documented pattern for trigger functions.
-- =============================================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, onboarding_complete)
  values (new.id, false);

  insert into public.searches (user_id, priorities)
  values (
    new.id,
    '{
      "searchType": "",
      "investmentPropertyTypes": [],
      "budget": {"value": "", "tier": "important"},
      "sqftTarget": {"value": "", "tier": "nice"},
      "lotSizeTarget": {"value": "", "tier": "dontcare"},
      "bedsMin": {"value": "", "tier": "important"},
      "bathsMin": {"value": "", "tier": "nice"},
      "homeLayout": {"values": [], "tier": "dontcare"},
      "primaryBedroomLocation": {"value": "", "tier": "dontcare"},
      "secondaryBedroomLocation": {"value": "", "tier": "dontcare"},
      "location": {"customItems": [], "tiers": {}, "order": [], "hiddenCore": []},
      "homeFeel": {"customItems": [], "tiers": {}, "order": [], "hiddenCore": []},
      "exterior": {"customItems": [], "tiers": {}, "order": [], "hiddenCore": []},
      "features": {"customItems": [], "tiers": {}, "order": [], "hiddenCore": []}
    }'::jsonb
  );

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- =============================================================================
-- Keep updated_at current automatically, independent of what the app sends.
-- =============================================================================
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists searches_set_updated_at on public.searches;
create trigger searches_set_updated_at
  before update on public.searches
  for each row execute function public.set_updated_at();

drop trigger if exists homes_set_updated_at on public.homes;
create trigger homes_set_updated_at
  before update on public.homes
  for each row execute function public.set_updated_at();


-- =============================================================================
-- Co-Buyer V1 — Phase A foundation (see supabase/migrations/2026-09-05-cobuyer-
-- phase-a-foundation.sql for the full reasoning, including why this design
-- uses SECURITY DEFINER helper functions instead of direct cross-table
-- subqueries — a naive version of this schema was found during review to
-- create recursive RLS between searches and search_members, and was corrected
-- before ever being run). searches.user_id and its unique(user_id) constraint
-- above are NOT touched — every user still owns exactly one search.
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

alter table public.profiles
  add column if not exists active_search_id uuid references public.searches(id) on delete set null;

create table if not exists public.search_members (
  id uuid primary key default gen_random_uuid(),
  search_id uuid not null references public.searches(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('member')),
  joined_at timestamptz not null default now(),
  unique (search_id, user_id)
);

alter table public.search_members enable row level security;

drop policy if exists "search_members_select" on public.search_members;
create policy "search_members_select" on public.search_members
  for select using (
    auth.uid() = user_id
    or public.is_search_owner(search_id, auth.uid())
  );

drop policy if exists "search_members_owner_insert" on public.search_members;
create policy "search_members_owner_insert" on public.search_members
  for insert with check (
    public.is_search_owner(search_id, auth.uid())
  );

drop policy if exists "search_members_owner_delete" on public.search_members;
create policy "search_members_owner_delete" on public.search_members
  for delete using (
    public.is_search_owner(search_id, auth.uid())
    or auth.uid() = user_id
  );

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

drop policy if exists "smp_own_select" on public.search_member_priorities;
create policy "smp_own_select" on public.search_member_priorities
  for select using (auth.uid() = user_id);

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

create table if not exists public.home_member_state (
  id uuid primary key default gen_random_uuid(),
  home_id uuid not null references public.homes(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text,
  reaction text,
  rejection_reason text not null default '',
  ratings jsonb not null default '{}'::jsonb,
  checks jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (home_id, user_id)
);

alter table public.home_member_state enable row level security;

drop policy if exists "hms_select_members" on public.home_member_state;
create policy "hms_select_members" on public.home_member_state
  for select using (
    auth.uid() = user_id
    or public.can_access_home(home_id, auth.uid())
  );

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

drop policy if exists "searches_select_member" on public.searches;
create policy "searches_select_member" on public.searches
  for select using (
    public.is_search_member(id, auth.uid())
  );

drop policy if exists "homes_select_member" on public.homes;
create policy "homes_select_member" on public.homes
  for select using (
    public.can_access_search(search_id, auth.uid())
  );

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
-- Co-Buyer V1 — Phase D: invitation preview/acceptance RPCs.
--
-- Invite CREATION needs no RPC — the search owner already has direct INSERT
-- rights on search_invitations via the existing Phase A policy
-- (search_invitations_owner_insert). This file only adds the two operations
-- an invitee (who has zero RLS access to search_invitations before accepting)
-- needs: a minimal, safe preview, and an atomic accept.
--
-- Both require an authenticated session (auth.uid() is not null) — this app
-- already gates every page behind sign-in first, so the invitee must sign in
-- or sign up before ever reaching either of these, consistent with existing
-- architecture rather than inventing a new unauthenticated access pattern.

-- preview_invitation: tells the caller ONLY whether a token is currently
-- usable, and why not if it isn't. Never returns the search's contents,
-- other invitations, member data, or home data.
create or replace function public.preview_invitation(p_token uuid)
returns table (valid boolean, reason text)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  inv record;
begin
  select * into inv from public.search_invitations where token = p_token;

  if inv is null then
    return query select false, 'not_found';
    return;
  end if;
  if inv.status = 'accepted' then
    return query select false, 'already_accepted';
    return;
  end if;
  if inv.status = 'revoked' then
    return query select false, 'revoked';
    return;
  end if;
  if inv.expires_at < now() then
    return query select false, 'expired';
    return;
  end if;

  return query select true, null::text;
end;
$$;

revoke all on function public.preview_invitation(uuid) from public;
revoke execute on function public.preview_invitation(uuid) from anon;
revoke execute on function public.preview_invitation(uuid) from service_role;
grant execute on function public.preview_invitation(uuid) to authenticated;

-- accept_invitation: validates everything, then atomically creates
-- membership and marks the invitation accepted. `select ... for update` locks
-- the invitation row for the transaction's duration, so a double-click (two
-- concurrent accept calls) cannot both succeed — the second call blocks
-- until the first commits, then sees status = 'accepted' and returns the
-- idempotent "already_accepted" outcome rather than creating a duplicate
-- membership row. The unique(search_id, user_id) constraint on
-- search_members is a second, database-level backstop against duplicates
-- even if this function's own logic ever had a bug.
--
-- DIAGNOSTIC WRAPPER: every validation branch below is UNCHANGED from the
-- original logic. The only addition is an outer BEGIN/EXCEPTION block with a
-- `stage` marker updated immediately before each risky operation, so an
-- uncaught error returns a sanitized `error_<stage>_<sqlstate>` reason
-- instead of a bare exception — never including the token, email, user id,
-- or search id.
create or replace function public.accept_invitation(p_token uuid)
returns table (success boolean, reason text, search_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  inv record;
  caller uuid := auth.uid();
  caller_email text;
  stage text := 'start';
begin
  if caller is null then
    return query select false, 'not_authenticated', null::uuid;
    return;
  end if;

  begin
    stage := 'lookup_invitation';
    select * into inv from public.search_invitations where token = p_token for update;

    if inv is null then
      return query select false, 'not_found', null::uuid;
      return;
    end if;
    if inv.status = 'accepted' then
      -- Idempotent: if this exact caller is already the member this
      -- invitation created, treat a repeat accept as a harmless success
      -- rather than an error (e.g. a double-click, or returning to the link).
      stage := 'check_existing_membership_accepted';
      if exists (select 1 from public.search_members where search_id = inv.search_id and user_id = caller) then
        return query select true, 'already_member', inv.search_id;
        return;
      end if;
      return query select false, 'already_accepted', null::uuid;
      return;
    end if;
    if inv.status = 'revoked' then
      return query select false, 'revoked', null::uuid;
      return;
    end if;
    if inv.expires_at < now() then
      return query select false, 'expired', null::uuid;
      return;
    end if;
    if inv.invited_by = caller then
      return query select false, 'self_invite', null::uuid;
      return;
    end if;

    -- Email-binding: only the invited address may accept. Reads ONLY the
    -- caller's own email (auth.uid() = caller), never any other user's row.
    stage := 'lookup_email';
    select email into caller_email from auth.users where id = caller;
    if caller_email is null or lower(caller_email) is distinct from lower(inv.invited_email) then
      return query select false, 'wrong_account', null::uuid;
      return;
    end if;

    stage := 'check_existing_membership';
    if exists (select 1 from public.search_members where search_id = inv.search_id and user_id = caller) then
      stage := 'update_invitation_existing_member';
      update public.search_invitations set status = 'accepted', responded_at = now() where id = inv.id;
      return query select true, 'already_member', inv.search_id;
      return;
    end if;

    stage := 'insert_member';
    insert into public.search_members (search_id, user_id, role) values (inv.search_id, caller, 'member');

    stage := 'update_invitation';
    update public.search_invitations set status = 'accepted', responded_at = now() where id = inv.id;

    return query select true, null::text, inv.search_id;
  exception when others then
    return query select false, ('error_' || stage || '_' || sqlstate), null::uuid;
    return;
  end;
end;
$$;

revoke all on function public.accept_invitation(uuid) from public;
revoke execute on function public.accept_invitation(uuid) from anon;
revoke execute on function public.accept_invitation(uuid) from service_role;
grant execute on function public.accept_invitation(uuid) to authenticated;
