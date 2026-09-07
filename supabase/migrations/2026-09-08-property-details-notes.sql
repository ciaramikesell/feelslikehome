-- Phase 3 refinement: property-details descriptive text fields.
-- Purely additive, nullable, no backfill, no existing column touched.
alter table public.homes
  add column if not exists basement_notes text,
  add column if not exists schools_notes text,
  add column if not exists condition_notes text;
