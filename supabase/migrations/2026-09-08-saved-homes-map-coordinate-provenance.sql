-- Saved Homes Map: coordinates are displayable only when their provenance is
-- tied to the address that produced them. Existing coordinate pairs are kept
-- for historical/reference purposes but deliberately remain unresolved until
-- the address is looked up again.
alter table public.homes
  add column if not exists coordinate_status text not null default 'unresolved'
    check (coordinate_status in ('unresolved', 'resolved')),
  add column if not exists coordinate_source text,
  add column if not exists coordinate_address text;

update public.homes
set coordinate_status = 'unresolved',
    coordinate_source = null,
    coordinate_address = null;
