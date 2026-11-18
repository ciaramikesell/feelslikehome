-- Apply only after provisioning the dedicated guest writer and reviewing preflight.
-- Run as the trusted migration role that owns the referenced tables (postgres).
begin;

-- Supabase deployments can differ in who owns auth.users. Fail closed if the
-- migration principal cannot take the same row locks used by the RPC.
do $$
begin
  if not pg_catalog.has_table_privilege(current_user, 'auth.users', 'SELECT')
     or not pg_catalog.has_table_privilege(current_user, 'auth.users', 'UPDATE')
     or not pg_catalog.has_table_privilege(current_user, 'auth.users', 'TRIGGER') then
    raise exception 'guest transfer migration role lacks required auth.users privileges';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_roles as r
    where r.rolname = 'flh_guest_writer' and r.rolcanlogin
      and not (r.rolsuper or r.rolbypassrls or r.rolcreatedb or r.rolcreaterole
               or r.rolreplication or r.rolinherit)
      and not exists (select 1 from pg_catalog.pg_auth_members as m
                      where m.member = r.oid or m.roleid = r.oid)
  ) then
    raise exception 'provision an isolated flh_guest_writer login first';
  end if;
end;
$$;

create schema flh_guest_transfer;
revoke all on schema flh_guest_transfer from public, anon, authenticated, service_role;

create table flh_guest_transfer.attempts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  search_id uuid not null,
  proof_digest bytea not null unique check (octet_length(proof_digest) = 32),
  seed_updated_at timestamptz not null,
  seed_digest bytea not null check (octet_length(seed_digest) = 32),
  expires_at timestamptz not null,
  request_digest bytea check (octet_length(request_digest) = 32),
  saved_at timestamptz,
  check ((request_digest is null) = (saved_at is null))
);
alter table flh_guest_transfer.attempts enable row level security;
revoke all on table flh_guest_transfer.attempts from public, anon, authenticated, service_role;

-- PostgreSQL fires equally timed triggers alphabetically. The existing
-- on_auth_user_created AFTER INSERT trigger provisions the profile and search first.
create function flh_guest_transfer.capture_signup()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  marker text := new.raw_user_meta_data ->> 'flh_guest_signup_v1';
begin
  if marker is null or marker !~ '^[0-9a-f]{64}$'
     or new.email is null or new.is_anonymous
     or new.raw_user_meta_data ->> 'account_entry_intent' = 'realtor' then
    return new;
  end if;

  insert into flh_guest_transfer.attempts (
    user_id, search_id, proof_digest, seed_updated_at, seed_digest, expires_at
  )
  select new.id, s.id, pg_catalog.decode(marker, 'hex'), s.updated_at,
         pg_catalog.sha256(pg_catalog.convert_to(s.priorities::text, 'UTF8')),
         new.created_at + interval '7 days'
  from public.searches as s
  where s.user_id = new.id
  on conflict do nothing;

  return new;
end;
$$;
revoke all on function flh_guest_transfer.capture_signup() from public, anon, authenticated, service_role;

create trigger zz_flh_guest_transfer_capture_signup
after insert on auth.users for each row execute function flh_guest_transfer.capture_signup();

create function flh_guest_transfer.save_guest_onboarding_v1(
  p_user_id uuid,
  p_draft_id uuid,
  p_secret text,
  p_priorities jsonb,
  p_progress jsonb
)
returns text
language plpgsql volatile security definer set search_path = ''
as $$
declare
  caller uuid := p_user_id;
  account auth.users%rowtype;
  attempt flh_guest_transfer.attempts%rowtype;
  profile public.profiles%rowtype;
  owned public.searches%rowtype;
  payload_digest bytea;
  now_at timestamptz := pg_catalog.statement_timestamp();
  saved_state jsonb;
  inserted uuid;
begin
  if session_user <> 'flh_guest_writer' or caller is null or p_draft_id is null or p_secret is null
     or p_secret !~ '^[0-9a-f]{64}$' then
    return 'unavailable';
  end if;

  if p_priorities is null or pg_catalog.jsonb_typeof(p_priorities) <> 'object'
     or pg_catalog.octet_length(p_priorities::text) > 65536
     or not coalesce((p_priorities ->> 'onboardingSearchType') in ('home_buy','home_rent','apartment_rent'), false)
     or (p_priorities ->> 'searchType') is distinct from
       (case p_priorities ->> 'onboardingSearchType' when 'home_buy' then 'purchase' else 'rental' end)
     or p_progress is null or pg_catalog.jsonb_typeof(p_progress) <> 'object'
     or pg_catalog.octet_length(p_progress::text) > 12000
     or p_progress -> 'schema' is distinct from '1'::jsonb
     or p_progress #>> '{answers,searchType}' is distinct from p_priorities ->> 'onboardingSearchType'
     or (p_progress - array['schema','step','completed','answers','skipped','startedAt']) <> '{}'::jsonb then
    return 'invalid_draft';
  end if;

  -- FOR UPDATE conflicts with FK KEY SHARE and serializes the eligibility
  -- checks with auth identity changes and new memberships of this caller.
  select u.* into account from auth.users as u where u.id = caller for update nowait;
  if not found or account.is_anonymous is distinct from false or account.email_confirmed_at is null
     or account.email is null then
    return 'unavailable';
  end if;

  select a.* into attempt from flh_guest_transfer.attempts as a
  where a.user_id = caller for update nowait;
  if not found or attempt.proof_digest <> pg_catalog.sha256(pg_catalog.convert_to(
       p_secret || ':' || p_draft_id::text || ':' || pg_catalog.lower(pg_catalog.btrim(account.email)), 'UTF8'
     )) then
    return 'unavailable';
  end if;

  payload_digest := pg_catalog.sha256(pg_catalog.convert_to(
    pg_catalog.jsonb_build_array(p_priorities, p_progress)::text, 'UTF8'));
  if attempt.saved_at is not null then
    return case when attempt.request_digest = payload_digest then 'already_saved' else 'conflict' end;
  end if;
  if attempt.expires_at <= now_at then return 'expired'; end if;

  select p.* into profile from public.profiles as p where p.id = caller for update nowait;
  if not found or profile.onboarding_complete or profile.onboarding_version is not null
     or profile.onboarding_state <> '{}'::jsonb
     or (profile.active_search_id is not null and profile.active_search_id <> attempt.search_id)
     or account.raw_user_meta_data ->> 'account_entry_intent' = 'realtor' then
    return 'conflict';
  end if;

  -- Lock the provisioned search, including its FK key. A newly accepted
  -- Realtor membership on this search must serialize with this transaction.
  select s.* into owned from public.searches as s
  where s.id = attempt.search_id and s.user_id = caller for update nowait;
  if not found or owned.updated_at <> attempt.seed_updated_at
     or pg_catalog.sha256(pg_catalog.convert_to(owned.priorities::text, 'UTF8')) <> attempt.seed_digest
     or exists (select 1 from public.search_members as m where m.user_id = caller or m.search_id = owned.id)
     or exists (select 1 from public.homes as h where h.search_id = owned.id or h.user_id = caller)
     or exists (select 1 from public.commute_destinations as d where d.search_id = owned.id or d.user_id = caller) then
    return 'conflict';
  end if;

  insert into public.search_member_priorities (search_id, user_id, priorities)
  values (owned.id, caller, p_priorities)
  on conflict (search_id, user_id) do nothing
  returning id into inserted;
  if inserted is null then return 'conflict'; end if;

  saved_state := p_progress || pg_catalog.jsonb_build_object(
    'context', pg_catalog.jsonb_build_object('role', 'owner', 'searchId', owned.id),
    'updatedAt', pg_catalog.to_char(now_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'completedAt', pg_catalog.to_char(now_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  );
  update public.profiles set onboarding_complete = true, onboarding_version = 4,
    onboarding_state = saved_state where id = caller;

  update flh_guest_transfer.attempts set request_digest = payload_digest, saved_at = now_at
  where user_id = caller;
  return 'saved';
exception when lock_not_available or deadlock_detected or serialization_failure then
  -- The PL/pgSQL exception boundary rolls back all writes in this invocation.
  return 'retry';
end;
$$;

revoke all on function flh_guest_transfer.save_guest_onboarding_v1(uuid, uuid, text, jsonb, jsonb)
  from public, anon, authenticated, service_role;
grant usage on schema flh_guest_transfer to flh_guest_writer;
grant execute on function flh_guest_transfer.save_guest_onboarding_v1(uuid, uuid, text, jsonb, jsonb)
  to flh_guest_writer;

-- The enabled application's authenticated owner onboarding uses this path.
-- Serialize its writes against the transfer's lock on the same profile.
create function public.save_incomplete_owner_onboarding(
  p_search_id uuid, p_priorities jsonb, p_version smallint, p_state jsonb
)
returns boolean
language plpgsql volatile security invoker set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  profile public.profiles%rowtype;
begin
  if caller is null then return false; end if;
  select p.* into profile from public.profiles as p where p.id = caller for update;
  if not found or profile.onboarding_complete
     or (profile.active_search_id is not null and profile.active_search_id <> p_search_id)
     or not exists (select 1 from public.searches s where s.id = p_search_id and s.user_id = caller) then
    return false;
  end if;

  if p_priorities is not null then
    insert into public.search_member_priorities (search_id, user_id, priorities)
    values (p_search_id, caller, p_priorities)
    on conflict (search_id, user_id) do update set priorities = excluded.priorities;
  end if;
  if p_state is not null then
    update public.profiles set onboarding_version = p_version, onboarding_state = p_state,
      onboarding_complete = coalesce(p_state ->> 'completedAt', '') <> ''
    where id = caller;
  end if;
  return true;
end;
$$;
revoke all on function public.save_incomplete_owner_onboarding(uuid, jsonb, smallint, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.save_incomplete_owner_onboarding(uuid, jsonb, smallint, jsonb) to authenticated;

commit;
