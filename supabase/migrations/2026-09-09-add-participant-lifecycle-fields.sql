-- Additive participant-owned lifecycle compatibility fields. Existing status
-- and reaction values remain the application's source of behavior until the
-- follow-up application migration is deployed.
alter table public.homes
  add column if not exists toured_at timestamptz,
  add column if not exists is_favorite boolean not null default false;

alter table public.home_member_state
  add column if not exists toured_at timestamptz,
  add column if not exists is_favorite boolean not null default false;

comment on column public.homes.toured_at is
  'Participant is known to have toured by this timestamp; migration-backfilled timestamps do not represent the exact historical tour time.';
comment on column public.home_member_state.toured_at is
  'Participant is known to have toured by this timestamp; migration-backfilled timestamps do not represent the exact historical tour time.';
comment on column public.homes.is_favorite is
  'Independent participant-owned preference and organization flag.';
comment on column public.home_member_state.is_favorite is
  'Independent participant-owned preference and organization flag.';

-- Preserve Favorites membership without changing the legacy reaction value.
update public.homes
set is_favorite = true
where reaction = 'love'
  and is_favorite = false;

update public.home_member_state
set is_favorite = true
where reaction = 'love'
  and is_favorite = false;

-- No trustworthy historical tour time exists. now() is the transaction time:
-- these participants are known to have toured by the migration date only.
update public.homes
set toured_at = now()
where status = 'Toured'
  and toured_at is null;

update public.home_member_state
set toured_at = now()
where status = 'Toured'
  and toured_at is null;
