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
