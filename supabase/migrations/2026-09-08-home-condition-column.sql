-- Home Condition persistence fix: home_condition has never existed as a
-- column on homes, so per-home selections were never saved (confirmed via
-- direct schema/code audit — home_layout is the correct existing pattern to
-- follow). Purely additive: nullable-safe with a default empty array, no
-- existing rows touched, no data deleted or migrated.
alter table public.homes
  add column if not exists home_condition text[] not null default '{}';

-- Run this after the column exists, in case PostgREST's schema cache doesn't
-- pick up the new column automatically (this exact class of issue happened
-- earlier in this project with other new columns).
notify pgrst, 'reload schema';
