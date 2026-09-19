-- FLH+ entitlement foundation, plus a one-time backfill granting it to every
-- current legitimate beta search.
--
-- Model: FLH+ belongs to a SEARCH, never to a person. One row in
-- search_entitlements means "this search has FLH+"; no row means Free.
-- source distinguishes how it was granted (beta/purchase/admin/promo) without
-- ever encoding a recurring subscription — there is no expiration/renewal
-- concept here, matching the product's one-time-purchase model. A future
-- $7.99 checkout completing is the same shape as this beta grant: insert one
-- row with source='purchase'. The UI must always ask the same single
-- question — "does this search have FLH+?" — via resolve_search_entitlement
-- below, never by re-deriving access from unrelated signals like whether a
-- co-buyer/Realtor happens to already be connected.
--
-- Writes are trusted-server-side only: RLS grants SELECT (via
-- can_access_search — owner, co-buyer, or Realtor) but no INSERT/UPDATE/
-- DELETE policy exists for `authenticated` at all, so no client can grant,
-- alter, or revoke its own or another search's entitlement. The backfill
-- below and any future purchase-completion write both happen as trusted
-- SECURITY DEFINER/migration operations, never a client-issued table write.
begin;

create table if not exists public.search_entitlements (
  search_id uuid primary key references public.searches(id) on delete cascade,
  source text not null check (source in ('beta', 'purchase', 'admin', 'promo')),
  granted_by uuid references auth.users(id) on delete set null,
  granted_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
alter table public.search_entitlements enable row level security;

drop policy if exists "search_entitlements_select" on public.search_entitlements;
create policy "search_entitlements_select" on public.search_entitlements
  for select using (public.can_access_search(search_id, auth.uid()));

revoke all on public.search_entitlements from public, anon, authenticated;
grant select on public.search_entitlements to authenticated;

-- Canonical resolver. Raises rather than returning a false "no access" for
-- a search the caller cannot access at all — that distinction matters for a
-- caller debugging "why don't I see FLH+", same pattern as
-- resolve_search_relationships.
create or replace function public.resolve_search_entitlement(p_search_id uuid)
returns table (has_flh_plus boolean, source text, granted_at timestamptz)
language plpgsql security definer stable set search_path = '' as $$
declare caller uuid := auth.uid(); entitlement public.search_entitlements%rowtype;
begin
  if caller is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if not public.can_access_search(p_search_id, caller) then raise exception 'Search access denied' using errcode = '42501'; end if;
  select * into entitlement from public.search_entitlements se where se.search_id = p_search_id;
  if entitlement.search_id is null then
    return query select false, null::text, null::timestamptz;
  else
    return query select true, entitlement.source, entitlement.granted_at;
  end if;
end; $$;
revoke all on function public.resolve_search_entitlement(uuid) from public;
grant execute on function public.resolve_search_entitlement(uuid) to authenticated;
revoke execute on function public.resolve_search_entitlement(uuid) from anon, service_role;

-- Beta backfill: every search whose owner has completed real buyer
-- onboarding. onboarding_complete is the same signal /account/page.js
-- already uses for "this is a legitimate buyer search, not a Realtor-only
-- account's unused default row" — every account gets an owned `searches`
-- row at signup regardless of role, and a Realtor-only account's row stays
-- an untouched, never-onboarded default forever, which this excludes the
-- same way. Nothing else in this schema distinguishes a "test fixture" from
-- a real beta signup — every searches row belongs to a real completed
-- signup by FK + this onboarding filter, so this is the full, unambiguous
-- current beta population. Idempotent: on conflict do nothing, safe to
-- run more than once and grants no duplicate/second entitlement row.
insert into public.search_entitlements (search_id, source, granted_by, granted_at)
select s.id, 'beta', null, now()
from public.searches s
join public.profiles p on p.id = s.user_id
where p.onboarding_complete = true
on conflict (search_id) do nothing;

notify pgrst, 'reload schema';
commit;
