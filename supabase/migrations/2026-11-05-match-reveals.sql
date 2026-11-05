-- Match Reveal (docs/match-reveal.md): remembers, per participant and home,
-- that their one-time Match reveal has been shown, so it never repeats across
-- reloads, devices or reinstalls.
--
-- A table of its own (not a home_member_state column): home_member_state rows
-- are readable by the other participants and the connected Realtor, and one
-- buyer's progress is nobody else's business. This table has no read policy at
-- all; the only way in is claim_match_reveal, as the signed-in buyer, for
-- themselves.
--
-- claim_match_reveal(home) records the reveal and returns true exactly once per
-- (home, caller): an insert that does nothing on a repeat, so rapid saves and
-- several open tabs can race and only one wins. It refuses (42501) anyone who
-- is not the owner or an accepted co-buyer of the home's search (so never a
-- Realtor, a removed member or an outsider), and a home that is still a pending
-- Realtor suggestion. The search is the home's own search (homes.search_id).
--
-- Adds one table and one function; changes no existing table, policy, grant or
-- Match function. Safe to re-run. Rollback: drop the function, then the table.
begin;

create table if not exists public.match_reveals (
  home_id uuid not null references public.homes(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  revealed_at timestamptz not null default now(),
  primary key (home_id, user_id)
);

alter table public.match_reveals enable row level security;
-- No policies: nobody reads or writes the table directly.
revoke all on public.match_reveals from public, anon, authenticated;

create or replace function public.claim_match_reveal(p_home_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
volatile
as $$
declare
  v_caller uuid := auth.uid();
  v_search uuid;
  v_inserted integer;
begin
  if v_caller is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  select h.search_id into v_search from public.homes h where h.id = p_home_id and not h.suggestion_staged;
  if v_search is null or not coalesce(public.is_search_decision_maker(v_search, v_caller), false) then
    raise exception 'Match reveal not available' using errcode = '42501';
  end if;
  insert into public.match_reveals (home_id, user_id) values (p_home_id, v_caller)
  on conflict (home_id, user_id) do nothing;
  get diagnostics v_inserted = row_count;
  return v_inserted = 1;
end;
$$;

revoke all on function public.claim_match_reveal(uuid) from public;
revoke execute on function public.claim_match_reveal(uuid) from anon;
grant execute on function public.claim_match_reveal(uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
