-- READ-ONLY review of saved lot sizes that are a bare number (no unit), for
-- PR "Lot size Match reads the stored unit". One SELECT; writes nothing.
--
-- One row per bare-number home, with NO ids, addresses, names, emails or
-- preference values: only the saved number and facts that help tell whether
-- it was meant as acres or square feet. Rows are ordered by the saved number,
-- not by any identifier.
--
--   saved_value            the bare number as saved
--   as_acres / as_sq_ft    what it would mean in each unit
--   home_sqft              the home's own square footage (a lot equal to it
--                          suggests the house size was typed in the lot field)
--   listing_says           the importer's lot size for this home, if it has a
--                          listing snapshot (shows the unit the listing used)
--   property_type, saved_month
--   lot_targets            per selected lot-size target in that search: its
--                          level and whether this value meets it read as acres
--                          or as square feet (the target itself is not shown)
with bare as (
  select h.*, btrim(h.lot_size) as raw
  from public.homes h
  where btrim(h.lot_size) ~ '^([0-9]{1,3}(,[0-9]{3})+(\.[0-9]+)?|[0-9]*\.?[0-9]+)$'
),
docs as (
  select s.id as search_id, coalesce(smp.priorities, s.priorities, '{}'::jsonb) as priorities
  from public.searches s
  left join public.search_member_priorities smp on smp.search_id = s.id and smp.user_id = s.user_id
  union all
  select sm.search_id, coalesce(smp.priorities, '{}'::jsonb)
  from public.search_members sm
  left join public.search_member_priorities smp on smp.search_id = sm.search_id and smp.user_id = sm.user_id
  where sm.role = 'co_buyer'
)
select b.raw as saved_value,
       replace(b.raw, ',', '')::numeric as as_acres,
       round(replace(b.raw, ',', '')::numeric / 43560, 3) as as_sq_ft_in_acres,
       nullif(b.sqft, '') as home_sqft,
       nullif(b.raw, '') = nullif(b.sqft, '') as equals_home_sqft,
       coalesce(b.listing_import #>> '{fields,lotSize}', '(no listing snapshot)') as listing_says,
       b.property_type,
       to_char(b.created_at, 'YYYY-MM') as saved_month,
       -- Level of each selected lot-size target in the search and how this value
       -- scores against it read as acres (Match today) — never the target itself.
       coalesce((select string_agg(t.tier || ': ' || case when replace(b.raw, ',', '')::numeric >= t.target then 'met as acres' else 'missed as acres' end
                                   || ', ' || case when replace(b.raw, ',', '')::numeric / 43560 >= t.target then 'met as sq ft' else 'missed as sq ft' end, '; ')
                 from (select d.priorities #>> '{lotSizeTarget,tier}' as tier,
                              nullif(regexp_replace(coalesce(d.priorities #>> '{lotSizeTarget,value}', ''), '[^0-9.]', '', 'g'), '') as target_text
                       from docs d where d.search_id = b.search_id) raw_t
                 cross join lateral (select raw_t.tier, case when raw_t.target_text ~ '^[0-9]*\.?[0-9]+$' then raw_t.target_text::numeric end as target) t
                 where coalesce(raw_t.tier, 'dontcare') <> 'dontcare'
                   and t.target > 0), 'none') as lot_targets
from bare b
order by replace(b.raw, ',', '')::numeric;
