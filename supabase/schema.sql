-- Feels Like Home — Supabase schema
-- Run this once, in full, in the Supabase SQL Editor for a brand-new project.
-- It is safe to re-run: every statement either uses "if not exists" or replaces
-- the previous version of itself.

create extension if not exists "pgcrypto";

-- =============================================================================
-- beta_feedback — temporary, one-way external-beta feedback channel
-- =============================================================================
create table if not exists public.beta_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  search_id uuid,
  home_id uuid,
  route text not null,
  search_intent text,
  feedback_type text,
  message text not null,
  is_blocking boolean not null default false,
  viewport_width integer,
  viewport_height integer,
  device_class text,
  user_agent text,
  app_version text,
  screenshot_path text,
  created_at timestamptz not null default now(),
  constraint beta_feedback_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade,
  constraint beta_feedback_route_check check (char_length(route) between 1 and 2048),
  constraint beta_feedback_search_intent_check check (search_intent is null or search_intent = any (array['purchase','rental','investment']::text[])),
  constraint beta_feedback_type_check check (feedback_type is null or feedback_type = any (array['broken','confusing','idea']::text[])),
  constraint beta_feedback_message_check check (char_length(btrim(message)) between 1 and 2000),
  constraint beta_feedback_viewport_width_check check (viewport_width is null or viewport_width between 1 and 100000),
  constraint beta_feedback_viewport_height_check check (viewport_height is null or viewport_height between 1 and 100000),
  constraint beta_feedback_device_class_check check (device_class is null or device_class = any (array['mobile','tablet','desktop']::text[])),
  constraint beta_feedback_user_agent_check check (user_agent is null or char_length(user_agent) <= 1024),
  constraint beta_feedback_app_version_check check (app_version is null or char_length(app_version) <= 255),
  constraint beta_feedback_screenshot_path_check check (screenshot_path is null or char_length(screenshot_path) <= 1024)
);

alter table public.beta_feedback enable row level security;
revoke all on table public.beta_feedback from public, anon, authenticated;
grant insert (user_id, search_id, home_id, route, search_intent, feedback_type,
  message, is_blocking, viewport_width, viewport_height, device_class,
  user_agent, app_version, screenshot_path) on public.beta_feedback to authenticated;
drop policy if exists "beta_feedback_insert_own" on public.beta_feedback;
create policy "beta_feedback_insert_own" on public.beta_feedback
  for insert to authenticated
  with check (auth.uid() is not null and auth.uid() = user_id);

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

  -- Rental V1 Pass B shared facts. Nullable means unknown; no historical inference.
  property_type text,
  available_on date,
  pets_allowed boolean,
  utilities_included boolean,
  in_unit_laundry boolean,

  -- Apartment V1 property identity + one selected option snapshot.
  property_name text,
  selected_floor_plan_name text,
  selected_unit_label text,
  floor_plan_image_url text,
  constraint homes_property_type_check check (property_type is null or property_type = any (array['apartment','house','townhome','condo','multifamily','other']::text[])),

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
        when 'preferredPropertyTypes' then
          coalesce(rp.priorities #>> '{preferredPropertyTypes,tier}', 'important') <> 'dontcare'
          and jsonb_array_length(case when jsonb_typeof(rp.priorities -> 'preferredPropertyTypes') = 'array' then rp.priorities -> 'preferredPropertyTypes' else coalesce(rp.priorities #> '{preferredPropertyTypes,values}', '[]'::jsonb) end) > 0
        when 'features:Pets Allowed' then coalesce(rp.priorities #>> '{features,tiers,Pets Allowed}', 'dontcare') <> 'dontcare'
        when 'features:Utilities Included' then coalesce(rp.priorities #>> '{features,tiers,Utilities Included}', 'dontcare') <> 'dontcare'
        when 'features:In-Unit Laundry' then coalesce(rp.priorities #>> '{features,tiers,In-Unit Laundry}', 'dontcare') <> 'dontcare'
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
      ('schoolsNotes', 'location:Schools'),
      ('propertyType', 'preferredPropertyTypes'),
      ('petsAllowed', 'features:Pets Allowed'),
      ('utilitiesIncluded', 'features:Utilities Included'),
      ('inUnitLaundry', 'features:In-Unit Laundry')
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

    -- Future first-class property type preference. Values remain private;
    -- only their contribution to the sanitized score leaves this function.
    v_raw := case when jsonb_typeof(v_priorities -> 'preferredPropertyTypes') = 'array'
      then v_priorities -> 'preferredPropertyTypes'
      else coalesce(v_priorities #> '{preferredPropertyTypes,values}', '[]'::jsonb) end;
    v_tier := coalesce(v_priorities #>> '{preferredPropertyTypes,tier}', 'important');
    if v_tier <> 'dontcare' and jsonb_array_length(v_raw) > 0 then
      v_selected := v_selected + 1;
      if v_home.property_type is not null then
        v_evaluated := v_evaluated + 1;
        v_weight := case v_tier when 'must' then 4 when 'important' then 2 else 1 end;
        v_score := (v_raw ? v_home.property_type)::integer;
        v_total_weight := v_total_weight + v_weight;
        v_weighted_sum := v_weighted_sum + v_score * v_weight;
      end if;
    end if;

    -- Item-list priorities. Their selected tiers are the canonical stored list;
    -- state shape determines rating vs explicit Yes/No without disclosing either.
    foreach v_category in array array['location','features','exterior','homeFeel'] loop
      for v_label, v_tier in select key, value #>> '{}' from jsonb_each(coalesce(v_priorities #> array[v_category, 'tiers'], '{}'::jsonb)) loop
        if v_tier = 'dontcare' or (v_category = 'location' and v_label = 'Schools' and v_priorities #>> '{location,schoolsRelevance}' = 'no') then continue; end if;
        v_selected := v_selected + 1; v_key := v_category || ':' || v_label;
        -- These shared facts are authoritative. NULL is unevaluated and never
        -- falls back to participant-private historical checks.
        if v_key = any(array['features:Pets Allowed','features:Utilities Included','features:In-Unit Laundry']) then
          v_score := case v_key
            when 'features:Pets Allowed' then v_home.pets_allowed::integer
            when 'features:Utilities Included' then v_home.utilities_included::integer
            when 'features:In-Unit Laundry' then v_home.in_unit_laundry::integer end;
          if v_score is null then continue; end if;
          v_evaluated := v_evaluated + 1;
          v_weight := case v_tier when 'must' then 4 when 'important' then 2 else 1 end;
          v_total_weight := v_total_weight + v_weight;
          v_weighted_sum := v_weighted_sum + v_score * v_weight;
          continue;
        end if;
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
  schools_notes, condition_notes, property_type, available_on, pets_allowed,
  utilities_included, in_unit_laundry, property_name, selected_floor_plan_name,
  selected_unit_label, floor_plan_image_url, created_at, updated_at
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
  schools_notes, condition_notes, property_type, available_on, pets_allowed,
  utilities_included, in_unit_laundry, property_name, selected_floor_plan_name,
  selected_unit_label, floor_plan_image_url, updated_at
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
  schools_notes, condition_notes, property_type, available_on, pets_allowed,
  utilities_included, in_unit_laundry, property_name, selected_floor_plan_name,
  selected_unit_label, floor_plan_image_url, updated_at
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

-- Shared-search collaboration contract: approved read-only collaborator context.
-- Participant-owned tables remain own-write-only; this narrow SECURITY DEFINER
-- projection is the only cross-participant read path for priorities and places.
create or replace function public.resolve_collaborator_search_context(p_search_id uuid)
returns table (priorities jsonb, commute_destinations jsonb, home_states jsonb)
language plpgsql
security definer
set search_path = ''
stable
as $$
declare
  v_caller uuid := auth.uid();
  v_collaborator uuid;
begin
  if v_caller is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if not coalesce(public.can_access_search(p_search_id, v_caller), false) then
    raise exception 'Search access denied' using errcode = '42501';
  end if;

  select participant.user_id into v_collaborator
  from (
    select s.user_id from public.searches s where s.id = p_search_id
    union
    select sm.user_id from public.search_members sm where sm.search_id = p_search_id
  ) participant
  where participant.user_id <> v_caller
  limit 1;

  if v_collaborator is null then return; end if;

  return query
  select
    coalesce((select smp.priorities from public.search_member_priorities smp
      where smp.search_id = p_search_id and smp.user_id = v_collaborator), '{}'::jsonb),
    coalesce((select jsonb_agg(jsonb_build_object(
      'label', d.label, 'address', d.address, 'maxDriveMinutes', d.max_drive_minutes
    ) order by d.created_at)
      from public.commute_destinations d
      where d.search_id = p_search_id and d.user_id = v_collaborator), '[]'::jsonb),
    coalesce((select jsonb_agg(jsonb_build_object(
      'homeId', hms.home_id, 'status', hms.status, 'touredAt', hms.toured_at,
      'isFavorite', hms.is_favorite, 'reaction', hms.reaction
    )) from public.home_member_state hms
      join public.homes h on h.id = hms.home_id
      where h.search_id = p_search_id and hms.user_id = v_collaborator), '[]'::jsonb);
end;
$$;

revoke all on function public.resolve_collaborator_search_context(uuid) from public;
revoke execute on function public.resolve_collaborator_search_context(uuid) from anon;
revoke execute on function public.resolve_collaborator_search_context(uuid) from service_role;
grant execute on function public.resolve_collaborator_search_context(uuid) to authenticated;
notify pgrst, 'reload schema';

-- PR #78: search-scoped Owner / Co-buyer / Realtor permission foundation.
-- Existing `member` rows are preserved as decision-makers by migrating them to
-- `co_buyer`; no account-wide role is introduced.
begin;

alter table public.search_members drop constraint if exists search_members_role_check;
update public.search_members set role = 'co_buyer' where role = 'member';
alter table public.search_members alter column role set default 'co_buyer';
alter table public.search_members add constraint search_members_role_check
  check (role in ('co_buyer', 'realtor'));

alter table public.search_invitations add column if not exists relationship_type text;
update public.search_invitations set relationship_type = 'co_buyer' where relationship_type is null;
alter table public.search_invitations alter column relationship_type set default 'co_buyer';
alter table public.search_invitations alter column relationship_type set not null;
alter table public.search_invitations drop constraint if exists search_invitations_relationship_type_check;
alter table public.search_invitations add constraint search_invitations_relationship_type_check
  check (relationship_type in ('co_buyer', 'realtor'));

create or replace function public.is_search_realtor(p_search_id uuid, p_user_id uuid)
returns boolean language sql security definer stable set search_path = '' as $$
  select exists (select 1 from public.search_members sm
    where sm.search_id = p_search_id and sm.user_id = p_user_id and sm.role = 'realtor');
$$;
create or replace function public.is_search_decision_maker(p_search_id uuid, p_user_id uuid)
returns boolean language sql security definer stable set search_path = '' as $$
  select public.is_search_owner(p_search_id, p_user_id) or exists (
    select 1 from public.search_members sm
    where sm.search_id = p_search_id and sm.user_id = p_user_id and sm.role = 'co_buyer');
$$;
revoke all on function public.is_search_realtor(uuid, uuid) from public;
revoke all on function public.is_search_decision_maker(uuid, uuid) from public;
grant execute on function public.is_search_realtor(uuid, uuid) to authenticated;
grant execute on function public.is_search_decision_maker(uuid, uuid) to authenticated;

-- Owners may only create memberships through the email-bound acceptance RPC.
drop policy if exists "search_members_owner_insert" on public.search_members;

-- Realtors can inspect buyer decision inputs and outcomes, but every write is
-- restricted to the owner/co-buyer decision-makers and their own row.
drop policy if exists "smp_own_select" on public.search_member_priorities;
create policy "smp_participant_or_realtor_select" on public.search_member_priorities
  for select using (auth.uid() = user_id or public.is_search_realtor(search_id, auth.uid()));
drop policy if exists "smp_own_insert" on public.search_member_priorities;
create policy "smp_decision_maker_insert" on public.search_member_priorities
  for insert with check (auth.uid() = user_id and public.is_search_decision_maker(search_id, auth.uid()));
drop policy if exists "smp_own_update" on public.search_member_priorities;
create policy "smp_decision_maker_update" on public.search_member_priorities
  for update using (auth.uid() = user_id and public.is_search_decision_maker(search_id, auth.uid()))
  with check (auth.uid() = user_id and public.is_search_decision_maker(search_id, auth.uid()));

drop policy if exists "hms_select_own" on public.home_member_state;
drop policy if exists "hms_select_members" on public.home_member_state;
create policy "hms_participant_or_realtor_select" on public.home_member_state
  for select using (auth.uid() = user_id or public.is_search_realtor((select h.search_id from public.homes h where h.id = home_id), auth.uid()));
drop policy if exists "hms_own_insert" on public.home_member_state;
create policy "hms_decision_maker_insert" on public.home_member_state
  for insert with check (auth.uid() = user_id and public.is_search_decision_maker((select h.search_id from public.homes h where h.id = home_id), auth.uid()));
drop policy if exists "hms_own_update" on public.home_member_state;
create policy "hms_decision_maker_update" on public.home_member_state
  for update using (auth.uid() = user_id and public.is_search_decision_maker((select h.search_id from public.homes h where h.id = home_id), auth.uid()))
  with check (auth.uid() = user_id and public.is_search_decision_maker((select h.search_id from public.homes h where h.id = home_id), auth.uid()));

drop policy if exists "commute_destinations_select_own" on public.commute_destinations;
create policy "commute_destinations_participant_or_realtor_select" on public.commute_destinations
  for select using (auth.uid() = user_id or public.is_search_realtor(search_id, auth.uid()));
drop policy if exists "commute_destinations_insert_own" on public.commute_destinations;
create policy "commute_destinations_decision_maker_insert" on public.commute_destinations
  for insert with check (auth.uid() = user_id and public.is_search_decision_maker(search_id, auth.uid()));
drop policy if exists "commute_destinations_update_own" on public.commute_destinations;
create policy "commute_destinations_decision_maker_update" on public.commute_destinations
  for update using (auth.uid() = user_id and public.is_search_decision_maker(search_id, auth.uid()))
  with check (auth.uid() = user_id and public.is_search_decision_maker(search_id, auth.uid()));
drop policy if exists "commute_destinations_delete_own" on public.commute_destinations;
create policy "commute_destinations_decision_maker_delete" on public.commute_destinations
  for delete using (auth.uid() = user_id and public.is_search_decision_maker(search_id, auth.uid()));


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
    where sm.search_id = p_search_id and sm.role = 'co_buyer'
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
        when 'preferredPropertyTypes' then
          coalesce(rp.priorities #>> '{preferredPropertyTypes,tier}', 'important') <> 'dontcare'
          and jsonb_array_length(case when jsonb_typeof(rp.priorities -> 'preferredPropertyTypes') = 'array' then rp.priorities -> 'preferredPropertyTypes' else coalesce(rp.priorities #> '{preferredPropertyTypes,values}', '[]'::jsonb) end) > 0
        when 'features:Pets Allowed' then coalesce(rp.priorities #>> '{features,tiers,Pets Allowed}', 'dontcare') <> 'dontcare'
        when 'features:Utilities Included' then coalesce(rp.priorities #>> '{features,tiers,Utilities Included}', 'dontcare') <> 'dontcare'
        when 'features:In-Unit Laundry' then coalesce(rp.priorities #>> '{features,tiers,In-Unit Laundry}', 'dontcare') <> 'dontcare'
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
      ('schoolsNotes', 'location:Schools'),
      ('propertyType', 'preferredPropertyTypes'),
      ('petsAllowed', 'features:Pets Allowed'),
      ('utilitiesIncluded', 'features:Utilities Included'),
      ('inUnitLaundry', 'features:In-Unit Laundry')
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
    select sm.user_id from public.search_members sm where sm.search_id = p_search_id and sm.role = 'co_buyer'
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

    -- Future first-class property type preference. Values remain private;
    -- only their contribution to the sanitized score leaves this function.
    v_raw := case when jsonb_typeof(v_priorities -> 'preferredPropertyTypes') = 'array'
      then v_priorities -> 'preferredPropertyTypes'
      else coalesce(v_priorities #> '{preferredPropertyTypes,values}', '[]'::jsonb) end;
    v_tier := coalesce(v_priorities #>> '{preferredPropertyTypes,tier}', 'important');
    if v_tier <> 'dontcare' and jsonb_array_length(v_raw) > 0 then
      v_selected := v_selected + 1;
      if v_home.property_type is not null then
        v_evaluated := v_evaluated + 1;
        v_weight := case v_tier when 'must' then 4 when 'important' then 2 else 1 end;
        v_score := (v_raw ? v_home.property_type)::integer;
        v_total_weight := v_total_weight + v_weight;
        v_weighted_sum := v_weighted_sum + v_score * v_weight;
      end if;
    end if;

    -- Item-list priorities. Their selected tiers are the canonical stored list;
    -- state shape determines rating vs explicit Yes/No without disclosing either.
    foreach v_category in array array['location','features','exterior','homeFeel'] loop
      for v_label, v_tier in select key, value #>> '{}' from jsonb_each(coalesce(v_priorities #> array[v_category, 'tiers'], '{}'::jsonb)) loop
        if v_tier = 'dontcare' or (v_category = 'location' and v_label = 'Schools' and v_priorities #>> '{location,schoolsRelevance}' = 'no') then continue; end if;
        v_selected := v_selected + 1; v_key := v_category || ':' || v_label;
        -- These shared facts are authoritative. NULL is unevaluated and never
        -- falls back to participant-private historical checks.
        if v_key = any(array['features:Pets Allowed','features:Utilities Included','features:In-Unit Laundry']) then
          v_score := case v_key
            when 'features:Pets Allowed' then v_home.pets_allowed::integer
            when 'features:Utilities Included' then v_home.utilities_included::integer
            when 'features:In-Unit Laundry' then v_home.in_unit_laundry::integer end;
          if v_score is null then continue; end if;
          v_evaluated := v_evaluated + 1;
          v_weight := case v_tier when 'must' then 4 when 'important' then 2 else 1 end;
          v_total_weight := v_total_weight + v_weight;
          v_weighted_sum := v_weighted_sum + v_score * v_weight;
          continue;
        end if;
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
    where sm.search_id = p_search_id and sm.role = 'co_buyer'
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


create or replace function public.resolve_collaborator_search_context(p_search_id uuid)
returns table (priorities jsonb, commute_destinations jsonb, home_states jsonb)
language plpgsql
security definer
set search_path = ''
stable
as $$
declare
  v_caller uuid := auth.uid();
  v_collaborator uuid;
begin
  if v_caller is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if not coalesce(public.can_access_search(p_search_id, v_caller), false) then
    raise exception 'Search access denied' using errcode = '42501';
  end if;

  select participant.user_id into v_collaborator
  from (
    select s.user_id from public.searches s where s.id = p_search_id
    union
    select sm.user_id from public.search_members sm where sm.search_id = p_search_id and sm.role = 'co_buyer'
  ) participant
  where participant.user_id <> v_caller
  limit 1;

  if v_collaborator is null then return; end if;

  return query
  select
    coalesce((select smp.priorities from public.search_member_priorities smp
      where smp.search_id = p_search_id and smp.user_id = v_collaborator), '{}'::jsonb),
    coalesce((select jsonb_agg(jsonb_build_object(
      'label', d.label, 'address', d.address, 'maxDriveMinutes', d.max_drive_minutes
    ) order by d.created_at)
      from public.commute_destinations d
      where d.search_id = p_search_id and d.user_id = v_collaborator), '[]'::jsonb),
    coalesce((select jsonb_agg(jsonb_build_object(
      'homeId', hms.home_id, 'status', hms.status, 'touredAt', hms.toured_at,
      'isFavorite', hms.is_favorite, 'reaction', hms.reaction
    )) from public.home_member_state hms
      join public.homes h on h.id = hms.home_id
      where h.search_id = p_search_id and hms.user_id = v_collaborator), '[]'::jsonb);
end;
$$;

revoke all on function public.resolve_collaborator_search_context(uuid) from public;
revoke execute on function public.resolve_collaborator_search_context(uuid) from anon;
revoke execute on function public.resolve_collaborator_search_context(uuid) from service_role;
grant execute on function public.resolve_collaborator_search_context(uuid) to authenticated;

-- Shared homes remain readable to every accepted relationship, including
-- archived contenders. Only decision-makers may add or edit shared truth.
drop policy if exists "homes_insert_member" on public.homes;
drop policy if exists "homes_insert_accessible_own_adder" on public.homes;
drop policy if exists "homes_insert_own" on public.homes;
create policy "homes_insert_decision_maker" on public.homes
  for insert with check (auth.uid() = user_id and public.is_search_decision_maker(search_id, auth.uid()));
drop policy if exists "homes_update_member" on public.homes;
drop policy if exists "homes_update_decision_maker" on public.homes;
drop policy if exists "homes_update_own" on public.homes;
create policy "homes_update_decision_maker" on public.homes
  for update using (public.is_search_decision_maker(search_id, auth.uid()))
  with check (public.is_search_decision_maker(search_id, auth.uid()));

-- The invite preview discloses only validity and intended relationship.
drop function if exists public.preview_invitation(uuid);
create function public.preview_invitation(p_token uuid)
returns table (valid boolean, reason text, relationship_type text)
language plpgsql security definer stable set search_path = '' as $$
declare inv public.search_invitations%rowtype;
begin
  if auth.uid() is null then return query select false, 'not_authenticated', null::text; return; end if;
  select * into inv from public.search_invitations si where si.token = p_token;
  if inv is null then return query select false, 'not_found', null::text; return; end if;
  if inv.status = 'accepted' then return query select false, 'already_accepted', inv.relationship_type; return; end if;
  if inv.status = 'revoked' then return query select false, 'revoked', inv.relationship_type; return; end if;
  if inv.status = 'expired' or inv.expires_at < now() then return query select false, 'expired', inv.relationship_type; return; end if;
  return query select true, null::text, inv.relationship_type;
end; $$;
revoke all on function public.preview_invitation(uuid) from public;
grant execute on function public.preview_invitation(uuid) to authenticated;

create or replace function public.accept_invitation(p_token uuid)
returns table (success boolean, reason text, search_id uuid)
language plpgsql security definer set search_path = '' as $$
declare inv public.search_invitations%rowtype; caller uuid := auth.uid(); caller_email text;
begin
  if caller is null then return query select false, 'not_authenticated', null::uuid; return; end if;
  select * into inv from public.search_invitations si where si.token = p_token for update;
  if inv is null then return query select false, 'not_found', null::uuid; return; end if;
  if inv.status = 'accepted' then
    if exists (select 1 from public.search_members sm where sm.search_id=inv.search_id and sm.user_id=caller and sm.role=inv.relationship_type)
      then return query select true, 'already_member', inv.search_id; return; end if;
    return query select false, 'already_accepted', null::uuid; return;
  end if;
  if inv.status = 'revoked' then return query select false, 'revoked', null::uuid; return; end if;
  if inv.status = 'expired' or inv.expires_at < now() then return query select false, 'expired', null::uuid; return; end if;
  if inv.invited_by = caller then return query select false, 'self_invite', null::uuid; return; end if;
  select u.email into caller_email from auth.users u where u.id = caller;
  if caller_email is null or lower(caller_email) is distinct from lower(inv.invited_email)
    then return query select false, 'wrong_account', null::uuid; return; end if;
  if exists (select 1 from public.search_members sm where sm.search_id=inv.search_id and sm.user_id=caller) then
    return query select false, 'relationship_conflict', null::uuid; return;
  end if;
  insert into public.search_members(search_id,user_id,role) values(inv.search_id,caller,inv.relationship_type);
  update public.search_invitations si set status='accepted',responded_at=now() where si.id=inv.id;
  return query select true, null::text, inv.search_id;
exception when unique_violation then
  return query select false, 'relationship_conflict', null::uuid;
end; $$;
revoke all on function public.accept_invitation(uuid) from public;
grant execute on function public.accept_invitation(uuid) to authenticated;

-- Realtor Search View: relationship-scoped participant display projection.
create or replace function public.get_realtor_client_roster(p_search_ids uuid[])
returns table (search_id uuid, user_id uuid, display_name text, relationship text)
language sql security definer stable set search_path = '' as $$
  select participants.search_id, participants.user_id,
    coalesce(nullif(initcap(replace(split_part(u.email, '@', 1), '.', ' ')), ''), 'Buyer'),
    participants.relationship
  from (
    select s.id as search_id, s.user_id, 'Owner'::text as relationship from public.searches s
    union all
    select sm.search_id, sm.user_id, 'Co-buyer'::text from public.search_members sm where sm.role = 'co_buyer'
  ) participants
  join auth.users u on u.id = participants.user_id
  where participants.search_id = any(p_search_ids)
    and public.is_search_realtor(participants.search_id, auth.uid());
$$;
revoke all on function public.get_realtor_client_roster(uuid[]) from public;
revoke execute on function public.get_realtor_client_roster(uuid[]) from anon, service_role;
grant execute on function public.get_realtor_client_roster(uuid[]) to authenticated;

notify pgrst, 'reload schema';
commit;
-- PR #80: Realtor suggestions remain staged outside the contender collection
-- until one current decision-maker promotes them transactionally.
begin;

alter table public.homes add column if not exists suggestion_staged boolean not null default false;

create table if not exists public.realtor_suggestions (
  id uuid primary key default gen_random_uuid(),
  search_id uuid not null references public.searches(id) on delete cascade,
  home_id uuid not null unique references public.homes(id) on delete cascade,
  suggested_by uuid not null references auth.users(id) on delete restrict,
  suggested_by_display_name text not null,
  listing_identity text not null,
  status text not null default 'pending' check (status in ('pending','dismissed','accepted')),
  promoted_by uuid references auth.users(id) on delete set null,
  promoted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (search_id, listing_identity)
);

create table if not exists public.suggestion_dispositions (
  suggestion_id uuid not null references public.realtor_suggestions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  disposition text not null check (disposition = 'dismissed'),
  reasons text[] not null default '{}',
  other_text text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (suggestion_id, user_id),
  constraint suggestion_reasons_allowed check (reasons <@ array['Price','Location','Layout','Condition','Missing a must-have','Just don''t like it','Other']::text[]),
  constraint suggestion_other_text_length check (char_length(coalesce(other_text,'')) <= 280)
);

alter table public.realtor_suggestions enable row level security;
alter table public.suggestion_dispositions enable row level security;

-- Existing Home policies were intentionally broad for decision-makers. Staged
-- rows are readable as suggestion property truth, but cannot be edited or gain
-- personal contender state before the promotion RPC clears this flag.
drop policy if exists "homes_update_decision_maker" on public.homes;
create policy "homes_update_decision_maker" on public.homes for update
  using (not suggestion_staged and public.is_search_decision_maker(search_id,auth.uid()))
  with check (not suggestion_staged and public.is_search_decision_maker(search_id,auth.uid()));
drop policy if exists "homes_insert_decision_maker" on public.homes;
create policy "homes_insert_decision_maker" on public.homes for insert with check (
  auth.uid()=user_id and not suggestion_staged and public.is_search_decision_maker(search_id,auth.uid())
);
drop policy if exists "hms_decision_maker_insert" on public.home_member_state;
create policy "hms_decision_maker_insert" on public.home_member_state for insert with check (
  auth.uid()=user_id and public.is_search_decision_maker((select h.search_id from public.homes h where h.id=home_id and not h.suggestion_staged),auth.uid())
);

create policy "suggestions_participant_select" on public.realtor_suggestions for select using (
  public.is_search_decision_maker(search_id, auth.uid())
  or (suggested_by = auth.uid() and public.is_search_realtor(search_id, auth.uid()))
);
create policy "suggestion_dispositions_participant_select" on public.suggestion_dispositions for select using (
  exists (select 1 from public.realtor_suggestions rs where rs.id = suggestion_id and (
    public.is_search_decision_maker(rs.search_id, auth.uid())
    or (rs.suggested_by = auth.uid() and public.is_search_realtor(rs.search_id, auth.uid()))
  ))
);
create policy "suggestion_dispositions_own_insert" on public.suggestion_dispositions for insert with check (
  user_id = auth.uid() and exists (select 1 from public.realtor_suggestions rs
    where rs.id = suggestion_id and rs.status = 'pending'
      and public.is_search_decision_maker(rs.search_id, auth.uid()))
);
create policy "suggestion_dispositions_own_update" on public.suggestion_dispositions for update
  using (user_id = auth.uid()) with check (
    user_id = auth.uid() and exists (select 1 from public.realtor_suggestions rs
      where rs.id = suggestion_id and rs.status in ('pending','dismissed')
        and public.is_search_decision_maker(rs.search_id, auth.uid()))
  );

create or replace function public.suggestion_listing_identity(p_url text, p_address text)
returns text language sql immutable set search_path = '' as $$
  select case when nullif(trim(p_url),'') is not null
    then lower(regexp_replace(regexp_replace(trim(p_url), '[?#].*$', ''), '/+$', ''))
    else 'address:' || lower(regexp_replace(trim(coalesce(p_address,'')), '[^a-zA-Z0-9]+', '', 'g')) end;
$$;
revoke all on function public.suggestion_listing_identity(text,text) from public;

create or replace function public.create_realtor_suggestion(p_search_id uuid, p_home jsonb)
returns table (suggestion_id uuid, result text, home_id uuid)
language plpgsql security definer set search_path = '' as $$
declare
  caller uuid := auth.uid(); ident text; existing public.realtor_suggestions%rowtype;
  existing_home uuid; staged_home uuid; realtor_name text;
begin
  if caller is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if not public.is_search_realtor(p_search_id, caller) then raise exception 'Search access denied' using errcode='42501'; end if;
  if nullif(trim(p_home->>'address'),'') is null then raise exception 'A verified property address is required'; end if;
  ident := public.suggestion_listing_identity(p_home->>'listingUrl', p_home->>'address');
  if ident = 'address:' then raise exception 'Property identity is required'; end if;

  select h.id into existing_home from public.homes h where h.search_id=p_search_id and not h.suggestion_staged
    and public.suggestion_listing_identity(h.listing_url,h.address)=ident limit 1;
  if existing_home is not null then return query select null::uuid,'already_in_homes',existing_home; return; end if;
  select * into existing from public.realtor_suggestions rs where rs.search_id=p_search_id and rs.listing_identity=ident;
  if existing.id is not null then
    return query select existing.id, case existing.status when 'dismissed' then 'previously_dismissed' when 'accepted' then 'already_in_homes' else 'already_suggested' end, existing.home_id; return;
  end if;
  select coalesce(nullif(initcap(replace(split_part(u.email,'@',1),'.',' ')),''),'Realtor') into realtor_name from auth.users u where u.id=caller;
  insert into public.homes(user_id,search_id,address,crossroads,listing_url,photo_url,price,est_monthly,sqft,beds,baths,lot_size,garage_spaces,year_built,days_on_market,home_layout,home_condition,primary_bedroom_location,secondary_bedroom_location,notes,pros,cons,property_type,property_name,selected_floor_plan_name,selected_unit_label,floor_plan_image_url,suggestion_staged)
  values(caller,p_search_id,p_home->>'address',coalesce(p_home->>'crossroads',''),coalesce(p_home->>'listingUrl',''),coalesce(p_home->>'photoUrl',''),coalesce(p_home->>'price',''),coalesce(p_home->>'estMonthly',''),coalesce(p_home->>'sqft',''),coalesce(p_home->>'beds',''),coalesce(p_home->>'baths',''),coalesce(p_home->>'lotSize',''),coalesce(p_home->>'garageSpaces',''),coalesce(p_home->>'yearBuilt',''),coalesce(p_home->>'daysOnMarket',''),array(select jsonb_array_elements_text(coalesce(p_home->'homeLayout','[]'::jsonb))),array(select jsonb_array_elements_text(coalesce(p_home->'homeCondition','[]'::jsonb))),coalesce(p_home->>'primaryBedroomLocation',''),coalesce(p_home->>'secondaryBedroomLocation',''),coalesce(p_home->>'notes',''),'', '',nullif(p_home->>'propertyType',''),nullif(p_home->>'propertyName',''),nullif(p_home->>'selectedFloorPlanName',''),nullif(p_home->>'selectedUnitLabel',''),nullif(p_home->>'floorPlanImageUrl',''),true)
  returning id into staged_home;
  insert into public.realtor_suggestions(search_id,home_id,suggested_by,suggested_by_display_name,listing_identity)
  values(p_search_id,staged_home,caller,realtor_name,ident) returning id into suggestion_id;
  result := 'created'; home_id := staged_home; return next;
exception when unique_violation then
  select * into existing from public.realtor_suggestions rs where rs.search_id=p_search_id and rs.listing_identity=ident;
  return query select existing.id,'already_suggested',existing.home_id;
end; $$;

create or replace function public.dismiss_realtor_suggestion(p_suggestion_id uuid, p_reasons text[] default '{}', p_other_text text default null)
returns text language plpgsql security definer set search_path = '' as $$
declare caller uuid:=auth.uid(); sid uuid; decision_count int; dismissed_count int;
begin
  select search_id into sid from public.realtor_suggestions where id=p_suggestion_id for update;
  if caller is null or sid is null or not public.is_search_decision_maker(sid,caller) then raise exception 'Suggestion access denied' using errcode='42501'; end if;
  insert into public.suggestion_dispositions(suggestion_id,user_id,disposition,reasons,other_text)
  values(p_suggestion_id,caller,'dismissed',coalesce(p_reasons,'{}'),nullif(trim(p_other_text),''))
  on conflict(suggestion_id,user_id) do update set disposition='dismissed',reasons=excluded.reasons,other_text=excluded.other_text,updated_at=now();
  select 1 + count(*) into decision_count from public.search_members where search_id=sid and role='co_buyer';
  select count(*) into dismissed_count from public.suggestion_dispositions sd join public.search_members sm on sm.user_id=sd.user_id and sm.search_id=sid and sm.role='co_buyer' where sd.suggestion_id=p_suggestion_id;
  if exists(select 1 from public.suggestion_dispositions sd join public.searches s on s.user_id=sd.user_id and s.id=sid where sd.suggestion_id=p_suggestion_id) then dismissed_count:=dismissed_count+1; end if;
  if dismissed_count>=decision_count then update public.realtor_suggestions set status='dismissed',updated_at=now() where id=p_suggestion_id and status='pending'; end if;
  return case when dismissed_count>=decision_count then 'dismissed' else 'pending' end;
end; $$;

create or replace function public.promote_realtor_suggestion(p_suggestion_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare caller uuid:=auth.uid(); suggestion public.realtor_suggestions%rowtype;
begin
  select * into suggestion from public.realtor_suggestions where id=p_suggestion_id for update;
  if caller is null or suggestion.id is null or not public.is_search_decision_maker(suggestion.search_id,caller) then raise exception 'Suggestion access denied' using errcode='42501'; end if;
  if suggestion.status='accepted' then return suggestion.home_id; end if;
  update public.homes set suggestion_staged=false where id=suggestion.home_id;
  insert into public.home_member_state(home_id,user_id,status) values(suggestion.home_id,caller,'Saved') on conflict(home_id,user_id) do nothing;
  update public.realtor_suggestions set status='accepted',promoted_by=caller,promoted_at=now(),updated_at=now() where id=p_suggestion_id;
  return suggestion.home_id;
end; $$;

revoke all on function public.create_realtor_suggestion(uuid,jsonb) from public;
revoke all on function public.dismiss_realtor_suggestion(uuid,text[],text) from public;
revoke all on function public.promote_realtor_suggestion(uuid) from public;
grant execute on function public.create_realtor_suggestion(uuid,jsonb) to authenticated;
grant execute on function public.dismiss_realtor_suggestion(uuid,text[],text) to authenticated;
grant execute on function public.promote_realtor_suggestion(uuid) to authenticated;

-- suggestion_staged is shared workflow state. Keep the existing column-level
-- homes boundary: authenticated may read this column, but may not set it.
grant select (suggestion_staged) on public.homes to authenticated;

-- PR #82: search-scoped professional context, tour recommendations, and the
-- reverse (Realtor -> buyer) entry point into the existing invitation system.

create table public.realtor_notes (
  id uuid primary key default gen_random_uuid(),
  search_id uuid not null references public.searches(id) on delete cascade,
  home_id uuid not null references public.homes(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete restrict,
  author_display_name text not null,
  content text not null check (char_length(trim(content)) between 1 and 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (search_id, home_id, author_id)
);

create table public.tour_suggestions (
  id uuid primary key default gen_random_uuid(),
  search_id uuid not null references public.searches(id) on delete cascade,
  home_id uuid not null references public.homes(id) on delete cascade,
  suggested_by uuid not null references auth.users(id) on delete restrict,
  suggested_by_display_name text not null,
  created_at timestamptz not null default now(),
  unique (search_id, home_id, suggested_by)
);

alter table public.realtor_notes enable row level security;
alter table public.tour_suggestions enable row level security;

-- Decision-makers retain useful history. A Realtor only sees contributions
-- while their current membership still authorizes the search.
create policy "realtor_notes_relationship_select" on public.realtor_notes for select using (
  public.is_search_decision_maker(search_id, auth.uid()) or public.is_search_realtor(search_id, auth.uid())
);
create policy "tour_suggestions_relationship_select" on public.tour_suggestions for select using (
  public.is_search_decision_maker(search_id, auth.uid()) or public.is_search_realtor(search_id, auth.uid())
);
grant select on public.realtor_notes, public.tour_suggestions to authenticated;

create or replace function public.save_realtor_note(p_search_id uuid, p_home_id uuid, p_content text)
returns public.realtor_notes language plpgsql security definer set search_path = '' as $$
declare caller uuid:=auth.uid(); result public.realtor_notes; display_name text;
begin
  if caller is null or not public.is_search_realtor(p_search_id,caller) then raise exception 'Search access denied' using errcode='42501'; end if;
  if nullif(trim(p_content),'') is null or char_length(trim(p_content)) > 2000 then raise exception 'Note must be between 1 and 2000 characters'; end if;
  if not exists(select 1 from public.homes h where h.id=p_home_id and h.search_id=p_search_id and not h.suggestion_staged) then raise exception 'Home is not an eligible contender' using errcode='42501'; end if;
  select coalesce(nullif(trim(u.raw_user_meta_data->>'full_name'),''),nullif(initcap(replace(split_part(u.email,'@',1),'.',' ')),''),'Realtor') into display_name
    from auth.users u where u.id=caller;
  insert into public.realtor_notes(search_id,home_id,author_id,author_display_name,content)
  values(p_search_id,p_home_id,caller,display_name,trim(p_content))
  on conflict(search_id,home_id,author_id) do update set content=excluded.content,updated_at=now()
  returning * into result;
  return result;
end; $$;

create or replace function public.delete_realtor_note(p_note_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare caller uuid:=auth.uid(); affected int;
begin
  if caller is null then raise exception 'Authentication required' using errcode='42501'; end if;
  delete from public.realtor_notes n where n.id=p_note_id and n.author_id=caller and public.is_search_realtor(n.search_id,caller);
  get diagnostics affected=row_count; return affected=1;
end; $$;

create or replace function public.suggest_home_tour(p_search_id uuid, p_home_id uuid)
returns public.tour_suggestions language plpgsql security definer set search_path = '' as $$
declare caller uuid:=auth.uid(); result public.tour_suggestions; display_name text;
begin
  if caller is null or not public.is_search_realtor(p_search_id,caller) then raise exception 'Search access denied' using errcode='42501'; end if;
  if not exists(select 1 from public.homes h where h.id=p_home_id and h.search_id=p_search_id and not h.suggestion_staged
    and exists(select 1 from public.home_member_state s where s.home_id=h.id and s.status <> 'Archived'))
    then raise exception 'Home is not an active contender' using errcode='42501'; end if;
  select coalesce(nullif(trim(u.raw_user_meta_data->>'full_name'),''),nullif(initcap(replace(split_part(u.email,'@',1),'.',' ')),''),'Realtor') into display_name
    from auth.users u where u.id=caller;
  insert into public.tour_suggestions(search_id,home_id,suggested_by,suggested_by_display_name)
  values(p_search_id,p_home_id,caller,display_name)
  on conflict(search_id,home_id,suggested_by) do update set suggested_by_display_name=excluded.suggested_by_display_name
  returning * into result;
  return result;
end; $$;

-- A reverse invitation is still the same secure, email-bound invitation row.
-- It has no search until the buyer explicitly accepts and chooses their own
-- one-and-only owned search; invitation never grants pre-acceptance access.
alter table public.search_invitations alter column search_id drop not null;
alter table public.search_invitations add column invitation_direction text not null default 'buyer_to_realtor'
  check (invitation_direction in ('buyer_to_realtor','realtor_to_buyer'));
alter table public.search_invitations add column inviter_display_name text;

create or replace function public.create_buyer_invitation(p_invited_email text)
returns table(token uuid, expires_at timestamptz) language plpgsql security definer set search_path = '' as $$
declare caller uuid:=auth.uid(); caller_name text; existing public.search_invitations%rowtype;
begin
  if caller is null or not exists(select 1 from public.search_members sm where sm.user_id=caller and sm.role='realtor') then raise exception 'Realtor access required' using errcode='42501'; end if;
  if nullif(trim(p_invited_email),'') is null or position('@' in p_invited_email)=0 then raise exception 'A valid email is required'; end if;
  select * into existing from public.search_invitations i where i.invited_by=caller and i.invited_email=lower(trim(p_invited_email)) and i.invitation_direction='realtor_to_buyer' and i.status='pending' and i.expires_at>now() order by i.created_at desc limit 1;
  if existing.id is not null then return query select existing.token,existing.expires_at; return; end if;
  select coalesce(nullif(trim(u.raw_user_meta_data->>'full_name'),''),nullif(initcap(replace(split_part(u.email,'@',1),'.',' ')),''),'Your Realtor') into caller_name from auth.users u where u.id=caller;
  return query insert into public.search_invitations(search_id,invited_by,invited_email,relationship_type,invitation_direction,inviter_display_name)
    values(null,caller,lower(trim(p_invited_email)),'realtor','realtor_to_buyer',caller_name) returning search_invitations.token,search_invitations.expires_at;
end; $$;

-- Replace the #78 functions so preview supplies safe invitation copy and
-- acceptance converges both directions on search_members.
drop function public.preview_invitation(uuid);
create function public.preview_invitation(p_token uuid)
returns table(valid boolean, reason text, relationship_type text, invitation_direction text, inviter_display_name text)
language plpgsql security definer stable set search_path = '' as $$
declare inv public.search_invitations%rowtype;
begin
  if auth.uid() is null then return query select false,'not_authenticated',null::text,null::text,null::text; return; end if;
  select * into inv from public.search_invitations i where i.token=p_token;
  if inv is null then return query select false,'not_found',null::text,null::text,null::text; return; end if;
  if inv.status<>'pending' then return query select false,inv.status,inv.relationship_type,inv.invitation_direction,inv.inviter_display_name; return; end if;
  if inv.expires_at<now() then return query select false,'expired',inv.relationship_type,inv.invitation_direction,inv.inviter_display_name; return; end if;
  return query select true,null::text,inv.relationship_type,inv.invitation_direction,inv.inviter_display_name;
end; $$;

create or replace function public.accept_invitation(p_token uuid)
returns table(success boolean, reason text, search_id uuid) language plpgsql security definer set search_path = '' as $$
declare inv public.search_invitations%rowtype; caller uuid:=auth.uid(); caller_email text; target_search uuid;
begin
  if caller is null then return query select false,'not_authenticated',null::uuid; return; end if;
  select * into inv from public.search_invitations i where i.token=p_token for update;
  if inv is null then return query select false,'not_found',null::uuid; return; end if;
  if inv.invitation_direction='realtor_to_buyer' and inv.status='accepted' and exists(select 1 from public.searches s join public.search_members sm on sm.search_id=s.id where s.user_id=caller and sm.user_id=inv.invited_by and sm.role='realtor') then return query select true,'already_member',(select s.id from public.searches s where s.user_id=caller); return; end if;
  if inv.status<>'pending' then return query select false,inv.status,null::uuid; return; end if;
  if inv.expires_at<now() then return query select false,'expired',null::uuid; return; end if;
  if inv.invited_by=caller then return query select false,'self_invite',null::uuid; return; end if;
  select u.email into caller_email from auth.users u where u.id=caller;
  if lower(caller_email) is distinct from lower(inv.invited_email) then return query select false,'wrong_account',null::uuid; return; end if;
  if inv.invitation_direction='realtor_to_buyer' then
    select s.id into target_search from public.searches s where s.user_id=caller;
    if target_search is null then return query select false,'search_not_ready',null::uuid; return; end if;
    if exists(select 1 from public.search_members sm where sm.search_id=target_search and sm.user_id=inv.invited_by and sm.role<>'realtor') then return query select false,'relationship_conflict',null::uuid; return; end if;
    insert into public.search_members(search_id,user_id,role) values(target_search,inv.invited_by,'realtor') on conflict(search_id,user_id) do nothing;
  else
    target_search:=inv.search_id;
    if exists(select 1 from public.search_members sm where sm.search_id=target_search and sm.user_id=caller and sm.role<>inv.relationship_type) then return query select false,'relationship_conflict',null::uuid; return; end if;
    insert into public.search_members(search_id,user_id,role) values(target_search,caller,inv.relationship_type) on conflict(search_id,user_id) do nothing;
  end if;
  update public.search_invitations set status='accepted',responded_at=now(),search_id=target_search where id=inv.id;
  return query select true,null::text,target_search;
end; $$;

revoke all on function public.save_realtor_note(uuid,uuid,text), public.delete_realtor_note(uuid), public.suggest_home_tour(uuid,uuid), public.create_buyer_invitation(text), public.preview_invitation(uuid), public.accept_invitation(uuid) from public;
grant execute on function public.save_realtor_note(uuid,uuid,text), public.delete_realtor_note(uuid), public.suggest_home_tour(uuid,uuid), public.create_buyer_invitation(text), public.preview_invitation(uuid), public.accept_invitation(uuid) to authenticated;
revoke execute on function public.save_realtor_note(uuid,uuid,text), public.delete_realtor_note(uuid), public.suggest_home_tour(uuid,uuid), public.create_buyer_invitation(text), public.preview_invitation(uuid), public.accept_invitation(uuid) from anon, service_role;


notify pgrst, 'reload schema';
commit;
