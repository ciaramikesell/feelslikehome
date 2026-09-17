-- Preserve the immutable listing-derived snapshot separately from user-corrected
-- canonical Home fields so the shared inspector remains honest on later edits.
alter table public.homes
  add column if not exists listing_import jsonb;

comment on column public.homes.listing_import is
  'Immutable-at-edit listing import snapshot used by What FLH Found; never canonical Home truth.';
