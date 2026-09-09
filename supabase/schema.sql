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
  toured_at timestamptz,
  is_favorite boolean not null default false,
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

  -- Legacy only: retained for backward compatibility, but no longer read, written,
  -- displayed, enriched, or used for Match by the application.
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
  toured_at timestamptz,
  is_favorite boolean not null default false,
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
--
-- IDENTIFIER-AMBIGUITY FIX (found from a live 42702 error): this function's
-- own `returns table (success boolean, reason text, search_id uuid)` clause
-- implicitly declares `search_id` as a PL/pgSQL variable inside the function
-- body, colliding with the real search_id COLUMN on search_members whenever
-- referenced bare. Fixed by explicitly aliasing every table reference (sm,
-- si, u) so no query reads a table column without a disambiguating
-- qualifier. The output column name itself is unchanged, since application
-- code reads result.search_id by that exact name.
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
    select si.* into inv from public.search_invitations si where si.token = p_token for update;

    if inv is null then
      return query select false, 'not_found', null::uuid;
      return;
    end if;
    if inv.status = 'accepted' then
      -- Idempotent: if this exact caller is already the member this
      -- invitation created, treat a repeat accept as a harmless success
      -- rather than an error (e.g. a double-click, or returning to the link).
      stage := 'check_existing_membership_accepted';
      if exists (select 1 from public.search_members sm where sm.search_id = inv.search_id and sm.user_id = caller) then
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
    select u.email into caller_email from auth.users u where u.id = caller;
    if caller_email is null or lower(caller_email) is distinct from lower(inv.invited_email) then
      return query select false, 'wrong_account', null::uuid;
      return;
    end if;

    stage := 'check_existing_membership';
    if exists (select 1 from public.search_members sm where sm.search_id = inv.search_id and sm.user_id = caller) then
      stage := 'update_invitation_existing_member';
      update public.search_invitations si set status = 'accepted', responded_at = now() where si.id = inv.id;
      return query select true, 'already_member', inv.search_id;
      return;
    end if;

    -- Note: this INSERT's column list is a target column list, not a value
    -- expression — PostgreSQL always resolves those as table columns
    -- regardless of any same-named variable, so this line was never
    -- ambiguous and needs no alias.
    stage := 'insert_member';
    insert into public.search_members (search_id, user_id, role) values (inv.search_id, caller, 'member');

    stage := 'update_invitation';
    update public.search_invitations si set status = 'accepted', responded_at = now() where si.id = inv.id;

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

-- Phase 3 refinement: property-details descriptive text fields.
alter table public.homes
  add column if not exists basement_notes text,
  add column if not exists schools_notes text,
  add column if not exists condition_notes text;

-- Home Condition persistence fix: home_condition never existed as a column;
-- per-home selections were never saved. Additive, follows the home_layout pattern.
alter table public.homes
  add column if not exists home_condition text[] not null default '{}';


-- =============================================================================
-- Tier-free shared-fact priority awareness RPC
-- =============================================================================
-- Tier-free shared-fact awareness for Add/Edit Home.
--
-- search_member_priorities intentionally remains own-row-only under RLS. This
-- function is the sole narrow bridge across that boundary: it verifies search
-- access, reads participant documents internally, and returns only booleans for
-- facts that already have shared homes columns.

create or replace function public.resolve_shared_fact_priority_awareness(p_search_id uuid)
returns table (
  field text,
  criterion_key text,
  selected_by_current_user boolean,
  selected_by_co_buyer boolean,
  selected_by_both boolean,
  co_buyer_only boolean,
  eligible_for_shared_fact_capture boolean
)
language plpgsql
security definer
set search_path = ''
stable
as $$
declare
  v_caller uuid := auth.uid();
begin
  if v_caller is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if not coalesce(public.can_access_search(p_search_id, v_caller), false) then
    raise exception 'Search access denied' using errcode = '42501';
  end if;

  return query
  with search_row as (
    select s.user_id as owner_id, s.priorities as owner_priorities
    from public.searches s
    where s.id = p_search_id
  ),
  participants as (
    select sr.owner_id as user_id from search_row sr
    union
    select sm.user_id
    from public.search_members sm
    where sm.search_id = p_search_id
  ),
  resolved_priorities as (
    select
      p.user_id,
      coalesce(smp.priorities,
        case when p.user_id = sr.owner_id then sr.owner_priorities else '{}'::jsonb end,
        '{}'::jsonb) as priorities
    from participants p
    cross join search_row sr
    left join public.search_member_priorities smp
      on smp.search_id = p_search_id and smp.user_id = p.user_id
  ),
  selections as (
    select rp.user_id, f.field, f.criterion_key,
      case f.criterion_key
        when 'budget' then coalesce(rp.priorities #>> '{budget,tier}', 'important') <> 'dontcare'
        when 'bedsMin' then coalesce(rp.priorities #>> '{bedsMin,tier}', 'important') <> 'dontcare'
        when 'bathsMin' then coalesce(rp.priorities #>> '{bathsMin,tier}', 'nice') <> 'dontcare'
        when 'sqftTarget' then coalesce(rp.priorities #>> '{sqftTarget,tier}', 'nice') <> 'dontcare'
        when 'lotSizeTarget' then coalesce(rp.priorities #>> '{lotSizeTarget,tier}', 'dontcare') <> 'dontcare'
        when 'homeLayout' then coalesce(rp.priorities #>> '{homeLayout,tier}', 'dontcare') <> 'dontcare'
        when 'homeCondition' then coalesce(rp.priorities #>> '{homeCondition,tier}', 'dontcare') <> 'dontcare'
        when 'primaryBedroomLocation' then coalesce(rp.priorities #>> '{primaryBedroomLocation,tier}', 'dontcare') <> 'dontcare'
        when 'secondaryBedroomLocation' then coalesce(rp.priorities #>> '{secondaryBedroomLocation,tier}', 'dontcare') <> 'dontcare'
        when 'exterior:Garage' then coalesce(rp.priorities #>> '{exterior,tiers,Garage}', 'dontcare') <> 'dontcare'
        when 'features:Basement' then coalesce(rp.priorities #>> '{features,tiers,Basement}', 'dontcare') <> 'dontcare'
        when 'location:Schools' then
          coalesce(rp.priorities #>> '{location,schoolsRelevance}', '') <> 'no'
          and coalesce(rp.priorities #>> '{location,tiers,Schools}', 'dontcare') <> 'dontcare'
        else false
      end as selected
    from resolved_priorities rp
    cross join (values
      ('price', 'budget'),
      ('beds', 'bedsMin'),
      ('baths', 'bathsMin'),
      ('sqft', 'sqftTarget'),
      ('lotSize', 'lotSizeTarget'),
      ('homeLayout', 'homeLayout'),
      ('homeCondition', 'homeCondition'),
      ('primaryBedroomLocation', 'primaryBedroomLocation'),
      ('secondaryBedroomLocation', 'secondaryBedroomLocation'),
      ('garageSpaces', 'exterior:Garage'),
      ('basementNotes', 'features:Basement'),
      ('schoolsNotes', 'location:Schools')
    ) as f(field, criterion_key)
  ),
  projected as (
    select s.field, s.criterion_key,
      bool_or(s.selected) filter (where s.user_id = v_caller) as current_selected,
      coalesce(bool_or(s.selected) filter (where s.user_id <> v_caller), false) as cobuyer_selected
    from selections s
    group by s.field, s.criterion_key
  )
  select p.field, p.criterion_key,
    coalesce(p.current_selected, false),
    p.cobuyer_selected,
    coalesce(p.current_selected, false) and p.cobuyer_selected,
    not coalesce(p.current_selected, false) and p.cobuyer_selected,
    coalesce(p.current_selected, false) or p.cobuyer_selected
  from projected p;
end;
$$;

revoke all on function public.resolve_shared_fact_priority_awareness(uuid) from public;
grant execute on function public.resolve_shared_fact_priority_awareness(uuid) to authenticated;
-- Sanitized co-buyer perspectives for Compare.
--
-- The protected priority document and personal state are read only inside this
-- SECURITY DEFINER function. Callers receive one independently-derived score,
-- the co-buyer's overall feeling, and actual opposing experiential reactions.

create or replace function public.resolve_cobuyer_compare_perspectives(
  p_search_id uuid,
  p_home_ids uuid[]
)
returns table (
  home_id uuid,
  pct integer,
  evaluated_count integer,
  selected_count integer,
  overall_feeling integer,
  different_takes jsonb
)
language plpgsql
security definer
set search_path = ''
stable
as $$
declare
  v_caller uuid := auth.uid();
  v_participant uuid;
  v_priorities jsonb;
  v_home public.homes%rowtype;
  v_state public.home_member_state%rowtype;
  v_caller_state public.home_member_state%rowtype;
  v_tier text;
  v_target numeric;
  v_actual numeric;
  v_actual_text text;
  v_score numeric;
  v_weight numeric;
  v_total_weight numeric;
  v_weighted_sum numeric;
  v_selected integer;
  v_evaluated integer;
  v_category text;
  v_label text;
  v_key text;
  v_raw jsonb;
  v_caller_raw jsonb;
  v_differences jsonb;
  v_legacy_ratings jsonb;
  v_legacy_checks jsonb;
begin
  if v_caller is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if not coalesce(public.can_access_search(p_search_id, v_caller), false) then
    raise exception 'Search access denied' using errcode = '42501';
  end if;

  -- V1 collaboration permits one co-buyer. Selecting only an accepted
  -- participant prevents a caller from choosing an arbitrary user id.
  select p.user_id into v_participant
  from (
    select s.user_id from public.searches s where s.id = p_search_id
    union
    select sm.user_id from public.search_members sm where sm.search_id = p_search_id
  ) p
  where p.user_id <> v_caller
  limit 1;
  if v_participant is null then return; end if;

  select coalesce(smp.priorities,
    case when s.user_id = v_participant then s.priorities else '{}'::jsonb end,
    '{}'::jsonb)
  into v_priorities
  from public.searches s
  left join public.search_member_priorities smp
    on smp.search_id = s.id and smp.user_id = v_participant
  where s.id = p_search_id;

  for v_home in
    select h.* from public.homes h
    where h.search_id = p_search_id and h.id = any(coalesce(p_home_ids, '{}'::uuid[]))
  loop
    select * into v_state from public.home_member_state hms
      where hms.home_id = v_home.id and hms.user_id = v_participant;
    select * into v_caller_state from public.home_member_state hms
      where hms.home_id = v_home.id and hms.user_id = v_caller;

    v_legacy_ratings := case when v_home.user_id = v_participant then v_home.ratings else '{}'::jsonb end;
    v_legacy_checks := case when v_home.user_id = v_participant then v_home.checks else '{}'::jsonb end;
    v_selected := 0; v_evaluated := 0; v_total_weight := 0; v_weighted_sum := 0;

    -- Numeric threshold priorities share computeMatch's partial-credit rules.
    for v_key, v_actual in select * from (values
      ('budget', nullif(regexp_replace(v_home.price, '[^0-9.]', '', 'g'), '')::numeric),
      ('sqftTarget', nullif(regexp_replace(v_home.sqft, '[^0-9.]', '', 'g'), '')::numeric),
      ('lotSizeTarget', nullif(regexp_replace(v_home.lot_size, '[^0-9.]', '', 'g'), '')::numeric),
      ('bedsMin', nullif(regexp_replace(v_home.beds, '[^0-9.]', '', 'g'), '')::numeric),
      ('bathsMin', nullif(regexp_replace(v_home.baths, '[^0-9.]', '', 'g'), '')::numeric)
    ) n(key, actual)
    loop
      v_tier := coalesce(v_priorities #>> array[v_key, 'tier'], 'dontcare');
      v_target := nullif(regexp_replace(v_priorities #>> array[v_key, 'value'], '[^0-9.]', '', 'g'), '')::numeric;
      if v_tier <> 'dontcare' and v_target is not null and v_target > 0 then
        v_selected := v_selected + 1;
        if v_actual is not null then
          v_evaluated := v_evaluated + 1;
          v_weight := case v_tier when 'must' then 4 when 'important' then 2 else 1 end;
          v_score := case when v_key = 'budget'
            then greatest(0, 1 - greatest(0, v_actual - v_target) / v_target)
            else least(1, v_actual / v_target) end;
          v_total_weight := v_total_weight + v_weight;
          v_weighted_sum := v_weighted_sum + v_score * v_weight;
        end if;
      end if;
    end loop;

    -- Shared categorical facts.
    for v_key in select unnest(array['homeLayout','homeCondition']) loop
      v_tier := coalesce(v_priorities #>> array[v_key, 'tier'], 'dontcare');
      if v_tier <> 'dontcare' and jsonb_array_length(coalesce(v_priorities #> array[v_key, 'values'], '[]'::jsonb)) > 0 then
        v_selected := v_selected + 1;
        if (case v_key when 'homeLayout' then cardinality(v_home.home_layout) else cardinality(v_home.home_condition) end) > 0 then
          v_evaluated := v_evaluated + 1;
          v_weight := case v_tier when 'must' then 4 when 'important' then 2 else 1 end;
          v_score := case when v_key = 'homeLayout' then exists (
            select 1 from unnest(v_home.home_layout) x where v_priorities #> array[v_key, 'values'] ? x
          ) else exists (
            select 1 from unnest(v_home.home_condition) x where v_priorities #> array[v_key, 'values'] ? x
          ) end::integer;
          v_total_weight := v_total_weight + v_weight; v_weighted_sum := v_weighted_sum + v_score * v_weight;
        end if;
      end if;
    end loop;

    for v_key, v_actual_text in select * from (values
      ('primaryBedroomLocation', v_home.primary_bedroom_location),
      ('secondaryBedroomLocation', v_home.secondary_bedroom_location)
    ) s(key, actual)
    loop
      v_tier := coalesce(v_priorities #>> array[v_key, 'tier'], 'dontcare');
      if v_tier <> 'dontcare' and coalesce(v_priorities #>> array[v_key, 'value'], '') <> '' then
        v_selected := v_selected + 1;
        if coalesce(v_actual_text, '') <> '' then
          v_evaluated := v_evaluated + 1;
          v_weight := case v_tier when 'must' then 4 when 'important' then 2 else 1 end;
          v_score := (v_actual_text = v_priorities #>> array[v_key, 'value'])::integer;
          v_total_weight := v_total_weight + v_weight; v_weighted_sum := v_weighted_sum + v_score * v_weight;
        end if;
      end if;
    end loop;

    -- Item-list priorities. Their selected tiers are the canonical stored list;
    -- state shape determines rating vs explicit Yes/No without disclosing either.
    foreach v_category in array array['location','features','exterior','homeFeel'] loop
      for v_label, v_tier in select key, value #>> '{}' from jsonb_each(coalesce(v_priorities #> array[v_category, 'tiers'], '{}'::jsonb)) loop
        if v_tier = 'dontcare' or (v_category = 'location' and v_label = 'Schools' and v_priorities #>> '{location,schoolsRelevance}' = 'no') then continue; end if;
        v_selected := v_selected + 1; v_key := v_category || ':' || v_label;
        v_raw := coalesce(v_state.ratings, v_legacy_ratings) -> v_key;
        if v_raw is not null and jsonb_typeof(v_raw) = 'number' and (v_raw #>> '{}')::numeric > 0 then
          v_score := (v_raw #>> '{}')::numeric / 5; v_evaluated := v_evaluated + 1;
        elsif v_category = 'exterior' and v_label = 'Garage' and coalesce(v_home.garage_spaces, '') <> '' then
          v_score := (nullif(regexp_replace(v_home.garage_spaces, '[^0-9.]', '', 'g'), '')::numeric > 0)::integer; v_evaluated := v_evaluated + 1;
        else
          v_raw := coalesce(v_state.checks, v_legacy_checks) -> v_key;
          if v_raw = 'true'::jsonb then v_score := 1; v_evaluated := v_evaluated + 1;
          elsif v_raw = '"no"'::jsonb then v_score := 0; v_evaluated := v_evaluated + 1;
          else continue;
          end if;
        end if;
        v_weight := case v_tier when 'must' then 4 when 'important' then 2 else 1 end;
        v_total_weight := v_total_weight + v_weight; v_weighted_sum := v_weighted_sum + v_score * v_weight;
      end loop;
    end loop;

    -- Only opposing, actually-evaluated experiential reactions are projected.
    select coalesce(jsonb_agg(jsonb_build_object(
      'key', r.key, 'label', split_part(r.key, ':', 2),
      'youLiked', (c.value #>> '{}')::numeric >= 3,
      'coBuyerLiked', (r.value #>> '{}')::numeric >= 3
    ) order by r.key), '[]'::jsonb)
    into v_differences
    from jsonb_each(coalesce(v_state.ratings, v_legacy_ratings)) r
    join jsonb_each(coalesce(v_caller_state.ratings,
      case when v_home.user_id = v_caller then v_home.ratings else '{}'::jsonb end)) c on c.key = r.key
    where r.key = any(array[
      'homeFeel:Overall Condition','homeFeel:Layout / Flow','homeFeel:Natural Light','homeFeel:Character / Charm','homeFeel:Room Sizes','homeFeel:Openness / Ceiling Height','homeFeel:Privacy',
      'location:Neighborhood','location:Immediate Street / Surroundings','exterior:Yard','exterior:Privacy','exterior:Exterior Condition','exterior:Landscaping','exterior:Outdoor Space','exterior:Noise Level'
    ]) and jsonb_typeof(r.value) = 'number' and jsonb_typeof(c.value) = 'number'
      and (r.value #>> '{}')::numeric > 0 and (c.value #>> '{}')::numeric > 0
      and ((r.value #>> '{}')::numeric >= 3) <> ((c.value #>> '{}')::numeric >= 3);

    home_id := v_home.id;
    selected_count := v_selected;
    evaluated_count := v_evaluated;
    pct := case when v_evaluated > 0 and v_total_weight > 0 then round(v_weighted_sum / v_total_weight * 100)::integer else null end;
    overall_feeling := nullif(coalesce(v_state.ratings, v_legacy_ratings) ->> 'tour:overall', '')::integer;
    different_takes := v_differences;
    return next;
  end loop;
end;
$$;

revoke all on function public.resolve_cobuyer_compare_perspectives(uuid, uuid[]) from public;
revoke execute on function public.resolve_cobuyer_compare_perspectives(uuid, uuid[]) from anon;
revoke execute on function public.resolve_cobuyer_compare_perspectives(uuid, uuid[]) from service_role;
grant execute on function public.resolve_cobuyer_compare_perspectives(uuid, uuid[]) to authenticated;
-- Commute V1: private participant destinations and address-bound coordinates.
-- Route results are intentionally not stored.

alter table public.homes
  add column if not exists coordinate_address_fingerprint text,
  add column if not exists coordinate_status text not null default 'unresolved',
  add column if not exists coordinate_source text;

create table if not exists public.commute_destinations (
  id uuid primary key default gen_random_uuid(),
  search_id uuid not null references public.searches(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  label text not null check (char_length(btrim(label)) between 1 and 80),
  address text not null check (char_length(btrim(address)) between 1 and 500),
  max_drive_minutes integer check (max_drive_minutes between 1 and 1440),
  latitude numeric,
  longitude numeric,
  coordinate_address_fingerprint text,
  coordinate_status text not null default 'unresolved'
    check (coordinate_status in ('unresolved', 'resolved', 'invalid', 'ambiguous', 'unavailable')),
  coordinate_source text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists commute_destinations_user_search_idx
  on public.commute_destinations(user_id, search_id);
create unique index if not exists commute_destinations_legacy_dedupe_idx
  on public.commute_destinations(user_id, search_id, lower(btrim(label)), lower(btrim(address)));

alter table public.commute_destinations enable row level security;

drop policy if exists "commute_destinations_select_own" on public.commute_destinations;
create policy "commute_destinations_select_own" on public.commute_destinations
  for select using (auth.uid() = user_id and public.can_access_search(search_id, auth.uid()));
drop policy if exists "commute_destinations_insert_own" on public.commute_destinations;
create policy "commute_destinations_insert_own" on public.commute_destinations
  for insert with check (auth.uid() = user_id and public.can_access_search(search_id, auth.uid()));
drop policy if exists "commute_destinations_update_own" on public.commute_destinations;
create policy "commute_destinations_update_own" on public.commute_destinations
  for update using (auth.uid() = user_id and public.can_access_search(search_id, auth.uid()))
  with check (auth.uid() = user_id and public.can_access_search(search_id, auth.uid()));
drop policy if exists "commute_destinations_delete_own" on public.commute_destinations;
create policy "commute_destinations_delete_own" on public.commute_destinations
  for delete using (auth.uid() = user_id and public.can_access_search(search_id, auth.uid()));

create or replace function public.invalidate_coordinates_on_address_change()
returns trigger language plpgsql set search_path = public as $$
begin
  if old.address is distinct from new.address then
    new.latitude = null;
    new.longitude = null;
    new.coordinate_address_fingerprint = null;
    new.coordinate_status = 'unresolved';
    new.coordinate_source = null;
  end if;
  return new;
end;
$$;

drop trigger if exists homes_invalidate_coordinates on public.homes;
create trigger homes_invalidate_coordinates before update of address on public.homes
  for each row execute function public.invalidate_coordinates_on_address_change();
drop trigger if exists commute_destinations_invalidate_coordinates on public.commute_destinations;
create trigger commute_destinations_invalidate_coordinates before update of address on public.commute_destinations
  for each row execute function public.invalidate_coordinates_on_address_change();
drop trigger if exists commute_destinations_set_updated_at on public.commute_destinations;
create trigger commute_destinations_set_updated_at before update on public.commute_destinations
  for each row execute function public.set_updated_at();

-- Additive, idempotent copy of legacy personal JSON. It is deliberately retained
-- in priorities for rollback/history and is no longer read by the application.
insert into public.commute_destinations (search_id, user_id, label, address, max_drive_minutes)
select s.id, s.user_id, left(btrim(d.item->>'name'), 80), left(btrim(d.item->>'address'), 500),
       case when (d.item->>'maxDriveMinutes') ~ '^[0-9]+$'
            then least(1440, greatest(1, (d.item->>'maxDriveMinutes')::integer)) end
from public.searches s
cross join lateral jsonb_array_elements(coalesce(s.priorities#>'{location,commuteDestinations}', '[]'::jsonb)) d(item)
where btrim(coalesce(d.item->>'name','')) <> '' and btrim(coalesce(d.item->>'address','')) <> ''
on conflict do nothing;

insert into public.commute_destinations (search_id, user_id, label, address, max_drive_minutes)
select p.search_id, p.user_id, left(btrim(d.item->>'name'), 80), left(btrim(d.item->>'address'), 500),
       case when (d.item->>'maxDriveMinutes') ~ '^[0-9]+$'
            then least(1440, greatest(1, (d.item->>'maxDriveMinutes')::integer)) end
from public.search_member_priorities p
cross join lateral jsonb_array_elements(coalesce(p.priorities#>'{location,commuteDestinations}', '[]'::jsonb)) d(item)
where btrim(coalesce(d.item->>'name','')) <> '' and btrim(coalesce(d.item->>'address','')) <> ''
on conflict do nothing;
-- Pass 3C.1A: additive privacy foundation.
-- This migration deliberately does not change RLS or existing table grants.

-- Preserve the original adder's legacy state before later reads move exclusively
-- to participant-owned rows. Existing participant state always wins.
insert into public.home_member_state (
  home_id, user_id, status, reaction, toured_at, is_favorite,
  rejection_reason, ratings, checks
)
select
  h.id, h.user_id, h.status, h.reaction, h.toured_at, h.is_favorite,
  h.rejection_reason, h.ratings, h.checks
from public.homes h
on conflict (home_id, user_id) do nothing;

-- Preserve each search owner's priority document without replacing a document
-- that has already moved to participant-owned storage.
insert into public.search_member_priorities (search_id, user_id, priorities)
select s.id, s.user_id, s.priorities
from public.searches s
on conflict (search_id, user_id) do nothing;

create or replace function public.resolve_cobuyer_lifecycle_signals(
  p_search_id uuid,
  p_home_ids uuid[]
)
returns table (
  home_id uuid,
  co_buyer_wants_to_tour boolean,
  co_buyer_favorited boolean,
  co_buyer_archived boolean,
  all_participants_archived boolean
)
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_home_ids uuid[] := coalesce(p_home_ids, '{}'::uuid[]);
begin
  if v_caller is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if p_search_id is null
     or not coalesce(public.can_access_search(p_search_id, v_caller), false) then
    raise exception 'Search access denied' using errcode = '42501';
  end if;

  -- 200 comfortably covers current list pages while bounding cross-products.
  if cardinality(v_home_ids) > 200 then
    raise exception 'Home batch exceeds 200 items' using errcode = '22023';
  end if;

  -- Duplicate IDs are intentionally accepted and deduplicated. The bound above
  -- applies to raw input elements; requested_homes below reads the base table,
  -- so [A,A] returns one A row and duplicates cannot weight an aggregate.
  -- NULL and '{}' both resolve to an empty array and safely return zero rows
  -- after search authorization still runs.
  if array_position(v_home_ids, null) is not null
     or (select count(distinct requested.home_id)
         from unnest(v_home_ids) as requested(home_id))
        <> (select count(*)
            from public.homes h
            where h.search_id = p_search_id
              and h.id = any(v_home_ids)) then
    -- One response covers missing, inaccessible, and wrong-search identifiers.
    raise exception 'Invalid home batch' using errcode = '22023';
  end if;

  return query
  with participants as (
    -- search_members is the current-membership relation: invitations have their
    -- own status table, acceptance creates this row, and remove/leave deletes it.
    select s.user_id
    from public.searches s
    where s.id = p_search_id
    union
    select sm.user_id
    from public.search_members sm
    where sm.search_id = p_search_id
  ),
  requested_homes as (
    select h.id, h.user_id, h.status, h.toured_at, h.is_favorite
    from public.homes h
    where h.search_id = p_search_id
      and h.id = any(v_home_ids)
  ),
  resolved_state as (
    select
      h.id as home_id,
      p.user_id,
      case
        when hms.id is not null then hms.status
        when p.user_id = h.user_id then h.status
        else null
      end as status,
      case
        when hms.id is not null then hms.toured_at
        when p.user_id = h.user_id then h.toured_at
        else null
      end as toured_at,
      case
        when hms.id is not null then hms.is_favorite
        when p.user_id = h.user_id then h.is_favorite
        else false
      end as is_favorite
    from requested_homes h
    cross join participants p
    left join public.home_member_state hms
      on hms.home_id = h.id and hms.user_id = p.user_id
  )
  select
    rs.home_id,
    coalesce(bool_or(
      rs.status = 'Want to Tour'
      and not (rs.toured_at is not null or rs.status = 'Toured')
    ) filter (where rs.user_id <> v_caller), false),
    coalesce(bool_or(rs.is_favorite)
      filter (where rs.user_id <> v_caller), false),
    coalesce(bool_or(coalesce(rs.status = 'Archived', false))
      filter (where rs.user_id <> v_caller), false),
    coalesce(bool_and(coalesce(rs.status = 'Archived', false)), false)
  from resolved_state rs
  group by rs.home_id;
end;
$$;

revoke all on function public.resolve_cobuyer_lifecycle_signals(uuid, uuid[]) from public;
revoke execute on function public.resolve_cobuyer_lifecycle_signals(uuid, uuid[]) from anon;
revoke execute on function public.resolve_cobuyer_lifecycle_signals(uuid, uuid[]) from service_role;
grant execute on function public.resolve_cobuyer_lifecycle_signals(uuid, uuid[]) to authenticated;
-- Pass 3C.3: enforce participant privacy at the database boundary.
-- Apply manually only after 3C.2 is live and 3c3-production-preflight.sql passes.
-- This migration changes ACLs/policies only; it never rewrites legacy values.

begin;

-- Fail closed on schema drift rather than installing a partial allowlist.
do $$
declare
  v_missing text[];
begin
  select array_agg(required.column_name order by required.column_name)
    into v_missing
  from (values
    ('id'), ('user_id'), ('search_id'), ('address'), ('crossroads'),
    ('listing_url'), ('photo_url'), ('price'), ('est_monthly'), ('sqft'),
    ('beds'), ('baths'), ('lot_size'), ('garage_spaces'), ('year_built'),
    ('days_on_market'), ('home_layout'), ('home_condition'),
    ('primary_bedroom_location'), ('secondary_bedroom_location'), ('notes'),
    ('pros'), ('cons'), ('latitude'), ('longitude'),
    ('coordinate_address_fingerprint'), ('coordinate_status'),
    ('coordinate_source'), ('hoa_fee_monthly'), ('property_tax_annual'),
    ('property_tax_year'), ('basement_notes'), ('schools_notes'),
    ('condition_notes'), ('created_at'), ('updated_at'),
    ('status'), ('reaction'), ('toured_at'), ('is_favorite'),
    ('rejection_reason'), ('ratings'), ('checks')
  ) required(column_name)
  left join information_schema.columns actual
    on actual.table_schema = 'public' and actual.table_name = 'homes'
   and actual.column_name = required.column_name
  where actual.column_name is null;

  if v_missing is not null then
    raise exception 'Pass 3C.3 aborted: public.homes is missing columns: %', v_missing;
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'searches'
      and column_name = 'priorities'
  ) then
    raise exception 'Pass 3C.3 aborted: public.searches.priorities is missing';
  end if;
end
$$;

-- Direct home state is caller-owned. There is intentionally still no DELETE
-- policy, preserving V1 behavior. Sanitized cross-participant signals use RPCs.
drop policy if exists "hms_select_members" on public.home_member_state;
drop policy if exists "hms_select_own" on public.home_member_state;
create policy "hms_select_own" on public.home_member_state
  for select using (auth.uid() = user_id);

-- Column ACLs are the smallest PostgREST-compatible boundary: explicit selects
-- continue to address public.homes, RLS still controls rows, and SELECT * fails
-- because authenticated has no privilege on the private/legacy columns.
revoke select, insert, update on table public.homes from authenticated;
revoke select (status, reaction, toured_at, is_favorite, rejection_reason,
  ratings, checks, school_district) on public.homes from authenticated;
revoke insert (status, reaction, toured_at, is_favorite, rejection_reason,
  ratings, checks, school_district, created_at) on public.homes from authenticated;
revoke update (status, reaction, toured_at, is_favorite, rejection_reason,
  ratings, checks, school_district, created_at) on public.homes from authenticated;
grant select (
  id, user_id, search_id, address, crossroads, listing_url, photo_url, price,
  est_monthly, sqft, beds, baths, lot_size, garage_spaces, year_built,
  days_on_market, home_layout, home_condition, primary_bedroom_location,
  secondary_bedroom_location, notes, pros, cons, latitude, longitude,
  coordinate_address_fingerprint, coordinate_status, coordinate_source,
  hoa_fee_monthly, property_tax_annual, property_tax_year, basement_notes,
  schools_notes, condition_notes, created_at, updated_at
) on public.homes to authenticated;

-- INSERT permits creating a shared record but not supplying legacy private
-- values. updated_at remains a compatibility target but is overwritten by the
-- trigger; RLS below binds the adder identity to the caller.
grant insert (
  id, user_id, search_id, address, crossroads, listing_url, photo_url, price,
  est_monthly, sqft, beds, baths, lot_size, garage_spaces, year_built,
  days_on_market, home_layout, home_condition, primary_bedroom_location,
  secondary_bedroom_location, notes, pros, cons, latitude, longitude,
  coordinate_address_fingerprint, coordinate_status, coordinate_source,
  hoa_fee_monthly, property_tax_annual, property_tax_year, basement_notes,
  schools_notes, condition_notes, updated_at
) on public.homes to authenticated;

-- Existing 3C.2 upserts include identity columns and updated_at in their SET
-- list. Granting those targets avoids an app cutover; the trigger below makes
-- identity changes impossible and owns updated_at. Legacy private columns are
-- deliberately absent. All objective/shared fields used by Edit Home and
-- coordinate enrichment are present.
grant update (
  id, user_id, search_id, address, crossroads, listing_url, photo_url, price,
  est_monthly, sqft, beds, baths, lot_size, garage_spaces, year_built,
  days_on_market, home_layout, home_condition, primary_bedroom_location,
  secondary_bedroom_location, notes, pros, cons, latitude, longitude,
  coordinate_address_fingerprint, coordinate_status, coordinate_source,
  hoa_fee_monthly, property_tax_annual, property_tax_year, basement_notes,
  schools_notes, condition_notes, updated_at
) on public.homes to authenticated;

create or replace function public.enforce_home_shared_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.updated_at := now();
    return new;
  end if;

  if new.id is distinct from old.id
     or new.user_id is distinct from old.user_id
     or new.search_id is distinct from old.search_id
     or new.created_at is distinct from old.created_at then
    raise exception 'Home identity fields are immutable' using errcode = '42501';
  end if;
  -- Never accept a client-selected system timestamp.
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists homes_enforce_shared_identity on public.homes;
create trigger homes_enforce_shared_identity
  before insert or update on public.homes
  for each row execute function public.enforce_home_shared_identity();

drop policy if exists "homes_insert_own" on public.homes;
drop policy if exists "homes_insert_member" on public.homes;
create policy "homes_insert_accessible_own_adder" on public.homes
  for insert with check (
    auth.uid() = user_id
    and public.can_access_search(search_id, auth.uid())
  );

-- Searches have no legitimate authenticated UPDATE path after 3C.2. Keep the
-- shared metadata readable by column, while priorities and all direct UPDATEs
-- are denied. INSERT/DELETE and their existing owner RLS behavior are untouched.
revoke select, update on table public.searches from authenticated;
revoke select (id, user_id, priorities, created_at, updated_at)
  on public.searches from authenticated;
revoke update (id, user_id, priorities, created_at, updated_at)
  on public.searches from authenticated;
grant select (id, user_id, created_at, updated_at)
  on public.searches to authenticated;

-- Close platform-role ACL entries explicitly. Function bodies/contracts are
-- unchanged; these statements are idempotent ACL hygiene.
revoke execute on function public.is_search_owner(uuid, uuid) from anon, service_role;
revoke execute on function public.is_search_member(uuid, uuid) from anon, service_role;
revoke execute on function public.can_access_search(uuid, uuid) from anon, service_role;
revoke execute on function public.can_access_home(uuid, uuid) from anon, service_role;
revoke execute on function public.resolve_shared_fact_priority_awareness(uuid) from anon, service_role;
revoke execute on function public.resolve_cobuyer_compare_perspectives(uuid, uuid[]) from anon, service_role;
revoke execute on function public.resolve_cobuyer_lifecycle_signals(uuid, uuid[]) from anon, service_role;

notify pgrst, 'reload schema';
commit;
