-- Apartment V1: one property plus one currently considered option snapshot.
-- Additive only: existing homes remain valid with all four values NULL.
begin;

alter table public.homes
  add column property_name text null,
  add column selected_floor_plan_name text null,
  add column selected_unit_label text null,
  add column floor_plan_image_url text null;

-- Preserve the existing explicit column-level shared-home ACL. Do not grant
-- table-level access; these facts are shared with participants in the search,
-- subject to the existing homes RLS policies.
grant select (property_name, selected_floor_plan_name, selected_unit_label, floor_plan_image_url)
  on public.homes to authenticated;
grant insert (property_name, selected_floor_plan_name, selected_unit_label, floor_plan_image_url)
  on public.homes to authenticated;
grant update (property_name, selected_floor_plan_name, selected_unit_label, floor_plan_image_url)
  on public.homes to authenticated;

commit;
