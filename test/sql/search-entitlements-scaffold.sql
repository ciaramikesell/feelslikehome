-- Minimal stand-in for the production schema pieces the entitlement migration
-- touches (searches, members, homes, suggestions, RLS). Loaded before the
-- migration by test/monetization-phase-1.test.js when FLH_TEST_PG is set.
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
grant usage on schema auth to authenticated;
create table public.searches (id uuid primary key, user_id uuid);
create table public.search_members (search_id uuid, user_id uuid, role text);
create table public.homes (id uuid primary key default gen_random_uuid(), search_id uuid, user_id uuid, address text default '', listing_url text default '',
  suggestion_staged boolean not null default false, created_at timestamptz default now());
create table public.home_member_state (home_id uuid references public.homes(id) on delete cascade, user_id uuid, status text, primary key(home_id,user_id));
create table public.realtor_suggestions (id uuid primary key default gen_random_uuid(), search_id uuid, home_id uuid references public.homes(id) on delete cascade,
  status text default 'pending', promoted_by uuid, promoted_at timestamptz, updated_at timestamptz);
create function public.is_search_owner(p uuid, u uuid) returns boolean language sql security definer stable set search_path='' as $$ select exists(select 1 from public.searches s where s.id=p and s.user_id=u) $$;
create function public.is_search_decision_maker(p uuid, u uuid) returns boolean language sql security definer stable set search_path='' as $$
  select public.is_search_owner(p,u) or exists(select 1 from public.search_members sm where sm.search_id=p and sm.user_id=u and sm.role='co_buyer') $$;
grant execute on function public.is_search_decision_maker(uuid,uuid) to authenticated;
alter table public.homes enable row level security;
alter table public.home_member_state enable row level security;
alter table public.realtor_suggestions enable row level security;
create policy homes_select on public.homes for select using (public.is_search_decision_maker(search_id, auth.uid()));
create policy homes_insert_decision_maker on public.homes for insert with check (auth.uid()=user_id and not suggestion_staged and public.is_search_decision_maker(search_id,auth.uid()));
create policy homes_update_decision_maker on public.homes for update using (not suggestion_staged and public.is_search_decision_maker(search_id,auth.uid())) with check (not suggestion_staged and public.is_search_decision_maker(search_id,auth.uid()));
create policy homes_delete_own on public.homes for delete using (auth.uid()=user_id);
grant select, insert, update, delete on public.homes to authenticated;
grant select on public.realtor_suggestions to authenticated;
create or replace function public.suggestion_listing_identity(p_url text, p_address text)
returns text language sql immutable set search_path = '' as $$
  select case when nullif(trim(p_url),'') is not null
    then lower(regexp_replace(regexp_replace(trim(p_url), '[?#].*$', ''), '/+$', ''))
    else 'address:' || lower(regexp_replace(trim(coalesce(p_address,'')), '[^a-zA-Z0-9]+', '', 'g')) end;
$$;
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
grant execute on function public.promote_realtor_suggestion(uuid) to authenticated;
-- seed: owner a, cobuyer b, realtor r, stranger x
insert into public.searches values ('00000000-0000-0000-0000-00000000000a','aaaaaaaa-0000-0000-0000-000000000001'),
 ('00000000-0000-0000-0000-00000000000b','aaaaaaaa-0000-0000-0000-000000000002'),
 ('00000000-0000-0000-0000-00000000000c','aaaaaaaa-0000-0000-0000-000000000003'),
 ('00000000-0000-0000-0000-00000000000d','aaaaaaaa-0000-0000-0000-000000000004');
insert into public.search_members values ('00000000-0000-0000-0000-00000000000a','bbbbbbbb-0000-0000-0000-000000000001','co_buyer'),
 ('00000000-0000-0000-0000-00000000000a','cccccccc-0000-0000-0000-000000000001','realtor');
-- grandfathered data: search B has 5 homes (one duplicate address), search C has 2, search D none
insert into public.homes(search_id,user_id,address,listing_url,created_at) values
 ('00000000-0000-0000-0000-00000000000b','aaaaaaaa-0000-0000-0000-000000000002','1 Elm St','https://z.com/1', now()-interval '5 day'),
 ('00000000-0000-0000-0000-00000000000b','aaaaaaaa-0000-0000-0000-000000000002','2 Elm St','', now()-interval '4 day'),
 ('00000000-0000-0000-0000-00000000000b','aaaaaaaa-0000-0000-0000-000000000002','2 Elm St.','', now()-interval '3 day'),
 ('00000000-0000-0000-0000-00000000000b','aaaaaaaa-0000-0000-0000-000000000002','3 Elm St','', now()-interval '2 day'),
 ('00000000-0000-0000-0000-00000000000b','aaaaaaaa-0000-0000-0000-000000000002','4 Elm St','', now()-interval '1 day'),
 ('00000000-0000-0000-0000-00000000000c','aaaaaaaa-0000-0000-0000-000000000003','9 Oak St','', now()-interval '1 day'),
 ('00000000-0000-0000-0000-00000000000c','aaaaaaaa-0000-0000-0000-000000000003','8 Oak St','', now()-interval '1 day');
insert into public.homes(search_id,user_id,address,suggestion_staged) values ('00000000-0000-0000-0000-00000000000c','cccccccc-0000-0000-0000-000000000001','Staged Rd',true);
