-- READ-ONLY preflight and impact report for
-- migrations/2026-10-18-lot-size-units-match-parity.sql.
--
-- Run in the Supabase SQL Editor of the PRODUCTION project before applying the
-- migration. It is one SELECT: it writes nothing, and returns schema facts and
-- row COUNTS only (no ids, emails, addresses, lot sizes, preferences or other
-- user data).
--
-- Proceed only if every row with check = 'required' shows ok = true. Rows with
-- check = 'info' describe the stored lot-size shapes and how the lot-size
-- criterion's reading changes for saved homes, per participant (owner and
-- co-buyer) whose preferences select a lot-size target. Rows with
-- check = 'review' are the ambiguous values this change deliberately does NOT
-- reinterpret. test/lot-size-match-db.test.js runs this file before and after
-- the migration and asserts it changes nothing.
with
fn as (
  select p.oid, p.prosecdef, p.proconfig, md5(replace(p.prosrc, chr(13), '')) as body_md5_lf
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace and p.proname = 'resolve_cobuyer_compare_perspectives'
    and pg_get_function_identity_arguments(p.oid) = 'p_search_id uuid, p_home_ids uuid[]'
),
versions(body_md5, label) as (values
  ('7e70b54fa45614c9c0e219d7d8df9a4f', 'expected: 2026-10-15-cobuyer-compare-mudroom-parity.sql'),
  ('ac2ed056e7b25f39ae533e578214a145', 'ALREADY APPLIED: 2026-10-18-lot-size-units-match-parity.sql'),
  ('960d7123231eb983709350e11602b6f9', 'OLDER: 2026-10-07-cobuyer-compare-garage-parity.sql (stop: apply 2026-10-15-cobuyer-compare-mudroom-parity.sql first)')
),
needed(table_name, column_name) as (values
  ('homes', 'search_id'), ('homes', 'user_id'), ('homes', 'price'), ('homes', 'sqft'), ('homes', 'lot_size'),
  ('homes', 'beds'), ('homes', 'baths'), ('homes', 'home_layout'), ('homes', 'home_condition'),
  ('homes', 'primary_bedroom_location'), ('homes', 'secondary_bedroom_location'), ('homes', 'property_type'),
  ('homes', 'pets_allowed'), ('homes', 'utilities_included'), ('homes', 'in_unit_laundry'), ('homes', 'garage_spaces'),
  ('homes', 'ratings'), ('homes', 'checks'),
  ('home_member_state', 'home_id'), ('home_member_state', 'user_id'), ('home_member_state', 'ratings'), ('home_member_state', 'checks'),
  ('search_member_priorities', 'search_id'), ('search_member_priorities', 'user_id'), ('search_member_priorities', 'priorities'),
  ('searches', 'user_id'), ('searches', 'priorities'), ('search_members', 'search_id'), ('search_members', 'user_id'), ('search_members', 'role')
),
missing as (
  select n.table_name || '.' || n.column_name as name from needed n
  where not exists (select 1 from information_schema.columns c
                    where c.table_schema = 'public' and c.table_name = n.table_name and c.column_name = n.column_name)
),
-- Every saved home's lot size, read three ways. Nothing leaves this CTE but counts.
lots as (
  select h.id, h.search_id, raw, stripped, lot.unit, lot.amount,
         -- The old SQL reading (every non-digit stripped). A leftover like '0.25.'
         -- made the cast — and so the whole Compare projection — fail.
         case when stripped = '' then null when stripped ~ '^[0-9]*\.?[0-9]+$|^[0-9]+\.$' then stripped::numeric end as old_acres,
         stripped <> '' and stripped !~ '^[0-9]*\.?[0-9]+$|^[0-9]+\.$' as old_error,
         -- The old JS reading (parseNum): text with no digits read as 0 (a miss),
         -- an uncastable leftover as Unknown.
         case when raw = '' then null when stripped = '' then 0
              when stripped ~ '^[0-9]*\.?[0-9]+$|^[0-9]+\.$' then stripped::numeric end as old_js_acres,
         -- The new reading: exactly the migration's expression (src/lib/lotSize.js).
         nullif(case
           when lot.unit = '' or lot.unit ~* '^(acres?|ac)\.?$' then lot.amount
           when lot.unit ~* '^(sq\.?\s*ft\.?|sqft|sf|ft2|ft²|square\s*f(ee|oo)t)$' then lot.amount / 43560
           when lot.unit ~* '^(sq\.?\s*m\.?|sqm|m2|m²|square\s*met(er|re)s?)$' then lot.amount / 4046.8564224
           when lot.unit ~* '^(hectares?|ha)$' then lot.amount * 2.4710538147
         end, 0) as new_acres,
         case
           when raw = '' then 'blank'
           when lot.unit is null or not lot.known_unit then 'unparsed (fraction, decimal comma, words …)'
           when lot.amount = 0 then 'zero'
           when lot.unit = '' then 'bare number'
           when lot.unit ~* '^(acres?|ac)\.?$' then 'acres'
           when lot.unit ~* '^(sq\.?\s*ft\.?|sqft|sf|ft2|ft²|square\s*f(ee|oo)t)$' then 'sq ft'
           when lot.unit ~* '^(sq\.?\s*m\.?|sqm|m2|m²|square\s*met(er|re)s?)$' then 'sq m'
           else 'hectares'
         end as shape
  from public.homes h
  cross join lateral (select btrim(coalesce(h.lot_size, '')) as raw) r
  cross join lateral (select regexp_replace(r.raw, '[^0-9.]', '', 'g') as stripped) s
  left join lateral (
    select replace(m[1], ',', '')::numeric as amount, btrim(m[2]) as unit,
           btrim(m[2]) ~* '^$|^(acres?|ac)\.?$|^(sq\.?\s*ft\.?|sqft|sf|ft2|ft²|square\s*f(ee|oo)t)$|^(sq\.?\s*m\.?|sqm|m2|m²|square\s*met(er|re)s?)$|^(hectares?|ha)$' as known_unit
    from regexp_match(r.raw, '^([0-9]{1,3}(?:,[0-9]{3})+(?:\.[0-9]+)?|[0-9]*\.?[0-9]+)\s*(.*)$') m
  ) lot on true
),
-- Each scored participant's preference document, with the precedence the scorer
-- uses: own search_member_priorities row, else the owner's searches.priorities.
participants as (
  select s.id as search_id, coalesce(smp.priorities, s.priorities, '{}'::jsonb) as priorities
  from public.searches s
  left join public.search_member_priorities smp on smp.search_id = s.id and smp.user_id = s.user_id
  union all
  select sm.search_id, coalesce(smp.priorities, '{}'::jsonb)
  from public.search_members sm
  left join public.search_member_priorities smp on smp.search_id = sm.search_id and smp.user_id = sm.user_id
  where sm.role = 'co_buyer'
),
targets as (
  select search_id, coalesce(priorities #>> '{lotSizeTarget,tier}', 'dontcare') as tier,
         nullif(regexp_replace(coalesce(priorities #>> '{lotSizeTarget,value}', ''), '[^0-9.]', '', 'g'), '') as target_text
  from participants
),
selected as (
  select search_id, tier, target_text::numeric as target from targets
  where tier <> 'dontcare' and target_text ~ '^[0-9]*\.?[0-9]+$' and target_text::numeric > 0
),
pairs as (
  select l.search_id, l.id as home_id, sel.tier, l.shape,
         case when l.old_error then 'Compare error' when l.old_acres is null then 'unknown'
              when l.old_acres >= sel.target then 'met' else 'missed' end as old_state,
         case when l.new_acres is null then 'unknown' when l.new_acres >= sel.target then 'met' else 'missed' end as new_state,
         case when l.old_js_acres is null then 'unknown' when l.old_js_acres >= sel.target then 'met' else 'missed' end as old_js_state,
         case when l.old_acres is null then null else least(1, l.old_acres / sel.target) end as old_score,
         case when l.new_acres is null then null else least(1, l.new_acres / sel.target) end as new_score
  from lots l join selected sel on sel.search_id = l.search_id
),
changed as (
  select * from pairs where old_state <> new_state or coalesce(old_score, -1) <> coalesce(new_score, -1)
)
select section, "check", item, ok, detail from (
  -- 1. Prerequisites -------------------------------------------------------
  select 1 as section, 'required' as "check", 'resolve_cobuyer_compare_perspectives(uuid, uuid[]) exists' as item,
         exists (select 1 from fn) as ok, null::text as detail
  union all
  select 1, 'required', 'current body is the 2026-10-15 mudroom-parity version (or this one)',
         exists (select 1 from fn f where f.body_md5_lf in ('7e70b54fa45614c9c0e219d7d8df9a4f', 'ac2ed056e7b25f39ae533e578214a145')),
         coalesce((select v.label from fn f join versions v on v.body_md5 = f.body_md5_lf),
                  'NO REPOSITORY MATCH: ' || coalesce((select body_md5_lf from fn), 'function absent') || ' — stop and review')
  union all
  select 1, 'required', 'function is SECURITY DEFINER with an empty search_path',
         exists (select 1 from fn where prosecdef and proconfig @> array['search_path=""']), null
  union all
  select 1, 'required', 'every column the function reads exists',
         not exists (select 1 from missing), (select string_agg(name, ', ' order by name) from missing)
  union all
  select 1, 'required', 'authenticated may execute it',
         coalesce((select has_function_privilege('authenticated', f.oid, 'execute') from fn f), false), null
  -- 2. Stored lot-size shapes (counts only) ---------------------------------
  union all
  select 2, 'info', 'saved homes by lot-size shape', null,
         (select string_agg(shape || ': ' || n, ', ' order by shape) from (select shape, count(*) as n from lots group by shape) t)
  union all
  select 2, 'info', 'sq ft values under 1 acre (the RentCast import shape; read as acres today)', null,
         (select count(*)::text from lots where shape = 'sq ft' and new_acres < 1)
  union all
  select 2, 'info', 'homes whose lot-size reading changes', null,
         (select count(*)::text from lots where old_error or coalesce(old_acres, -1) <> coalesce(new_acres, -1))
  union all
  select 2, 'info', 'homes whose lot size makes co-buyer Compare error today', null,
         (select count(*)::text from lots where old_error)
  -- 3. Match impact, per scored participant with a lot-size target -----------
  union all
  select 3, 'info', 'participant preference documents with a lot-size target selected', null,
         coalesce((select string_agg(tier || ': ' || n, ', ' order by tier) from (select tier, count(*) as n from selected group by tier) t), 'none')
  union all
  select 3, 'info', 'home × participant lot-size evaluations that change', null,
         (select count(*)::text from changed)
  union all
  select 3, 'info', 'distinct homes / searches affected', null,
         (select count(distinct home_id) || ' homes, ' || count(distinct search_id) || ' searches' from changed)
  union all
  select 3, 'info', 'changes by stored shape', null,
         coalesce((select string_agg(shape || ': ' || n, ', ' order by shape) from (select shape, count(*) as n from changed group by shape) t), 'none')
  union all
  select 3, 'info', 'Compare state transitions (tier: old -> new)', null,
         coalesce((select string_agg(tier || ': ' || old_state || ' -> ' || new_state || ' ×' || n, ', ' order by tier, old_state, new_state)
                   from (select tier, old_state, new_state, count(*) as n from changed group by 1, 2, 3) t), 'none')
  union all
  select 3, 'info', 'own Match (computeMatch) state transitions (tier: old -> new)', null,
         coalesce((select string_agg(tier || ': ' || old_js_state || ' -> ' || new_state || ' ×' || n, ', ' order by tier, old_js_state, new_state)
                   from (select tier, old_js_state, new_state, count(*) as n from pairs where old_js_state <> new_state group by 1, 2, 3) t), 'none')
  union all
  select 3, 'info', 'Must-Have status changes (no-miss -> missed / missed -> no-miss)', null,
         (select count(*) filter (where old_state <> 'missed' and new_state = 'missed') || ' / '
                 || count(*) filter (where old_state = 'missed' and new_state <> 'missed')
          from changed where tier = 'must')
  union all
  select 3, 'info', 'lot-size criterion score change (mean / largest drop, 0–1)', null,
         coalesce((select round(avg(new_score - old_score), 3) || ' / ' || round(min(new_score - old_score), 3)
                   from changed where old_score is not null and new_score is not null), 'n/a')
  union all
  select 3, 'info', 'selected lot-size targets the scorer cannot read (Compare errors before and after; not changed here)', null,
         (select count(*)::text from targets where tier <> 'dontcare' and target_text is not null and target_text !~ '^[0-9]*\.?[0-9]+$|^[0-9]+\.$')
  -- 4. Deliberately unchanged ambiguous values ------------------------------
  union all
  select 4, 'review', 'bare numbers (still read as acres, the field''s labeled unit): ≤ 50 / > 50', null,
         (select count(*) filter (where amount <= 50) || ' / ' || count(*) filter (where amount > 50) from lots where shape = 'bare number')
  union all
  select 4, 'info', 'migration rewrites preferences or home rows', null, 'no — it replaces one function body only'
) report
order by section, item;
