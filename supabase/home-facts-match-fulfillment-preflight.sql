-- READ-ONLY preflight and impact report for
-- migrations/2026-11-16-home-facts-match-fulfillment.sql (PR #187).
--
-- Run in the Supabase SQL Editor of the PRODUCTION project before applying the
-- migration. It is one SELECT: it writes nothing, and returns schema facts and
-- row COUNTS only (no ids, emails, addresses, preferences or answers).
--
-- Proceed only if every row with check = 'required' shows ok = true. Rows with
-- check = 'info' count, per scored participant (owner and co-buyer) with no
-- Yes / No of their own, the evaluations that change when the migration and
-- the app ship together:
--   * Garage, read for the participant's own Any / Attached / Detached
--     qualifier from garage type and spaces (before: spaces only, any qualifier);
--   * Central Air, newly answered from the Cooling text;
--   * No HOA is unchanged until someone sets the new HOA status (has_hoa is a
--     new column: every home starts Unknown).
-- test/home-facts-match-fulfillment-db.test.js runs this before and after the
-- migration and asserts it changes nothing.
with
fn as (
  select p.oid, p.prosecdef, p.proconfig, md5(replace(p.prosrc, chr(13), '')) as body_md5_lf
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace and p.proname = 'resolve_cobuyer_compare_perspectives'
    and pg_get_function_identity_arguments(p.oid) = 'p_search_id uuid, p_home_ids uuid[]'
),
versions(body_md5, label) as (values
  ('ee7daf7cbc20d5e361aaac18c8b3735b', 'expected: 2026-11-02-home-facts-match-parity.sql'),
  ('a574987d00d0a16e919c5e3af42715ba', 'ALREADY APPLIED: 2026-11-16-home-facts-match-fulfillment.sql'),
  ('507da3d7681a30eec49a8311d30bb180', 'OLDER: 2026-10-18-lot-size-units-match-parity.sql (stop: apply 2026-11-02-home-facts-match-parity.sql first)')
),
needed(table_name, column_name) as (values
  ('homes', 'search_id'), ('homes', 'user_id'), ('homes', 'garage_spaces'), ('homes', 'garage_type'), ('homes', 'cooling'),
  ('homes', 'hoa_fee_monthly'), ('homes', 'basement_style'), ('homes', 'basement_condition'), ('homes', 'laundry_location'),
  ('homes', 'checks'), ('home_member_state', 'home_id'), ('home_member_state', 'user_id'), ('home_member_state', 'checks'),
  ('search_member_priorities', 'search_id'), ('search_member_priorities', 'user_id'), ('search_member_priorities', 'priorities'),
  ('searches', 'user_id'), ('searches', 'priorities'), ('search_members', 'search_id'), ('search_members', 'user_id'), ('search_members', 'role')
),
missing as (
  select n.table_name || '.' || n.column_name as name from needed n
  where not exists (select 1 from information_schema.columns c
                    where c.table_schema = 'public' and c.table_name = n.table_name and c.column_name = n.column_name)
),
-- Each scored participant's preference document, with the scorer's precedence.
participants as (
  select s.id as search_id, s.user_id, coalesce(smp.priorities, s.priorities, '{}'::jsonb) as priorities
  from public.searches s
  left join public.search_member_priorities smp on smp.search_id = s.id and smp.user_id = s.user_id
  union all
  select sm.search_id, sm.user_id, coalesce(smp.priorities, '{}'::jsonb)
  from public.search_members sm
  left join public.search_member_priorities smp on smp.search_id = sm.search_id and smp.user_id = sm.user_id
  where sm.role = 'co_buyer'
),
-- The criteria this change reads, as the scorer counts them: purchase folds
-- 'features:Central Air' onto 'features:Central air' (once, and not at all when
-- the current label is selected too); rentals keep 'features:Central Air'.
selected_raw as (
  select p.search_id, p.user_id, c.category || ':' || t.key as key, t.value #>> '{}' as tier,
         coalesce(p.priorities ->> 'searchType', '') in ('purchase', 'buy') as purchase,
         case when p.priorities #>> '{exterior,garagePreference}' in ('attached', 'detached')
           then p.priorities #>> '{exterior,garagePreference}' else 'any' end as garage_pref
  from participants p
  cross join (values ('features'), ('exterior')) c(category)
  cross join lateral jsonb_each(coalesce(p.priorities #> array[c.category, 'tiers'], '{}'::jsonb)) t
  where t.value #>> '{}' <> 'dontcare'
),
selected as (
  select s.search_id, s.user_id, s.tier, s.garage_pref,
         case when s.purchase and s.key = 'features:Central Air' then 'features:Central air' else s.key end as key,
         case when s.purchase and s.key in ('features:Central air', 'features:Central Air') then 'features:Central Air' end as legacy_key
  from selected_raw s
  where s.key in ('exterior:Garage', 'features:Central air', 'features:Central Air')
    and not (s.purchase and s.key = 'features:Central Air' and exists (
      select 1 from selected_raw cur where cur.search_id = s.search_id and cur.user_id = s.user_id and cur.key = 'features:Central air'))
),
homes_read as (
  select h.*,
         case
           when btrim(coalesce(h.garage_spaces, '')) = '' then null
           when btrim(h.garage_spaces) ~* '^(none|no|no garage)$' then 0
           when h.garage_spaces !~* '\m(no|none|not|without)\M'
             and (select count(*) from regexp_matches(h.garage_spaces, '[0-9]+(\.[0-9]+)?|\.[0-9]+', 'g')) = 1
             then substring(h.garage_spaces from '[0-9]+(?:\.[0-9]+)?|\.[0-9]+')::numeric
         end as spaces
  from public.homes h
  where coalesce(h.suggestion_staged, false) = false
),
homes_flags as (
  select h.*,
         coalesce(h.garage_type = 'none', false) or coalesce(h.spaces = 0, false) as absent,
         coalesce(h.garage_type in ('attached', 'detached'), false) or coalesce(h.spaces > 0, false) as present
  from homes_read h
),
-- Every home × participant × criterion: their own answer (as the scorer reads
-- it), the reading before (spaces only for Garage; nothing for Central Air)
-- and after (the migration's table).
pairs as (
  select h.id as home_id, h.search_id, sel.user_id, sel.key, sel.tier, sel.garage_pref,
         coalesce(coalesce(hms.checks, case when h.user_id = sel.user_id then h.checks else '{}'::jsonb end) -> sel.key,
                  coalesce(hms.checks, case when h.user_id = sel.user_id then h.checks else '{}'::jsonb end) -> sel.legacy_key) as own_raw,
         case when sel.key = 'exterior:Garage' then (h.spaces > 0)::integer end as before_fact,
         case
           when sel.key = 'exterior:Garage' then case
             when h.absent and h.present then null
             when h.absent then 0
             when not h.present then null
             when sel.garage_pref = 'any' then 1
             when h.garage_type = sel.garage_pref then 1
             when h.garage_type in ('attached', 'detached') then 0
           end
           else case
             when coalesce(h.cooling, '') !~ '\S' then null
             when h.cooling ~* '^\s*(none|no|no cooling|no (central )?(air|a/c|ac|air conditioning))\s*$' then 0
             when h.cooling ~* '\mcentral\M' and h.cooling !~* '\m(no|not|none|without|evaporative|swamp|possibly|possible|maybe|unknown|unclear|unverified|tbd)\M|\?' then 1
           end
         end as after_fact
  from selected sel
  join homes_flags h on h.search_id = sel.search_id
  left join public.home_member_state hms on hms.home_id = h.id and hms.user_id = sel.user_id
),
classified as (
  -- No answer (NULL) is not explicit: coalesce, or NOT would drop those rows.
  select *, coalesce(own_raw in ('true'::jsonb, '"no"'::jsonb), false) as own_explicit from pairs
),
changed as (
  select * from classified where not own_explicit and before_fact is distinct from after_fact
)
select section, "check", item, ok, detail from (
  -- 1. Prerequisites -------------------------------------------------------
  select 1 as section, 'required' as "check", 'resolve_cobuyer_compare_perspectives(uuid, uuid[]) exists' as item,
         exists (select 1 from fn) as ok, null::text as detail
  union all
  select 1, 'required', 'current body is the 2026-11-02 Home Facts parity version (or this one)',
         exists (select 1 from fn f where f.body_md5_lf in ('ee7daf7cbc20d5e361aaac18c8b3735b', 'a574987d00d0a16e919c5e3af42715ba')),
         coalesce((select v.label from fn f join versions v on v.body_md5 = f.body_md5_lf),
                  'NO REPOSITORY MATCH: ' || coalesce((select body_md5_lf from fn), 'function absent') || ' — stop and review')
  union all
  select 1, 'required', 'function is SECURITY DEFINER with an empty search_path',
         exists (select 1 from fn where prosecdef and proconfig @> array['search_path=""']), null
  union all
  select 1, 'required', 'every column the function reads exists (has_hoa is added by the migration)',
         not exists (select 1 from missing), (select string_agg(name, ', ' order by name) from missing)
  union all
  select 1, 'required', 'authenticated may execute it',
         coalesce((select has_function_privilege('authenticated', f.oid, 'execute') from fn f), false), null
  union all
  select 1, 'info', 'homes.has_hoa already exists', null,
         case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'homes' and column_name = 'has_hoa')
           then 'yes (re-run)' else 'no — the migration adds it (nullable, no default, nothing backfilled)' end
  -- 2. Garage ----------------------------------------------------------------
  union all
  select 2, 'info', 'Garage selections by qualifier (any / attached / detached)', null,
         (select count(*) filter (where garage_pref = 'any') || ' / ' || count(*) filter (where garage_pref = 'attached') || ' / '
            || count(*) filter (where garage_pref = 'detached') from selected where key = 'exterior:Garage')
  union all
  select 2, 'info', 'Garage evaluations that change, without an own answer (qualifier: Unknown->Yes, Unknown->No, Yes->No, No->Yes, Yes->Unknown, No->Unknown)', null,
         coalesce((select string_agg(garage_pref || ': ' || uy || ', ' || un || ', ' || yn || ', ' || ny || ', ' || yu || ', ' || nu, '; ' order by garage_pref) from (
           select garage_pref,
                  count(*) filter (where before_fact is null and after_fact = 1) as uy, count(*) filter (where before_fact is null and after_fact = 0) as un,
                  count(*) filter (where before_fact = 1 and after_fact = 0) as yn, count(*) filter (where before_fact = 0 and after_fact = 1) as ny,
                  count(*) filter (where before_fact = 1 and after_fact is null) as yu, count(*) filter (where before_fact = 0 and after_fact is null) as nu
           from changed where key = 'exterior:Garage' group by garage_pref) t), 'none')
  union all
  select 2, 'info', 'Garage: Must-Haves that become a confirmed miss', null,
         (select count(*)::text from changed where key = 'exterior:Garage' and tier = 'must' and after_fact = 0)
  union all
  select 2, 'info', 'Garage: own Yes / No kept as an override over a different new reading', null,
         (select count(*)::text from classified where key = 'exterior:Garage' and own_explicit and after_fact is not null
            and after_fact <> case when own_raw = 'true'::jsonb then 1 else 0 end)
  union all
  select 2, 'info', 'saved homes by garage type (none / attached / detached / Unknown)', null,
         (select count(*) filter (where garage_type = 'none') || ' / ' || count(*) filter (where garage_type = 'attached') || ' / '
            || count(*) filter (where garage_type = 'detached') || ' / ' || count(*) filter (where garage_type is null) from homes_flags)
  union all
  select 2, 'info', 'saved homes whose garage type and spaces contradict (now Unknown for Garage)', null,
         (select count(*)::text from homes_flags where absent and present)
  -- 3. Central Air ---------------------------------------------------------------
  union all
  select 3, 'info', 'Central Air selections (purchase and rental labels, counted once)', null,
         (select count(*)::text from selected where key <> 'exterior:Garage')
  union all
  select 3, 'info', 'Central Air evaluations newly answered from Cooling, without an own answer (tier: Yes / No)', null,
         coalesce((select string_agg(tier || ': ' || yes || ' / ' || no, ', ' order by tier) from (
           select tier, count(*) filter (where after_fact = 1) as yes, count(*) filter (where after_fact = 0) as no
           from changed where key <> 'exterior:Garage' group by tier) t), 'none')
  union all
  select 3, 'info', 'Central Air: Must-Haves that become a confirmed miss (Cooling "None")', null,
         (select count(*)::text from changed where key <> 'exterior:Garage' and tier = 'must' and after_fact = 0)
  union all
  select 3, 'info', 'saved homes by Cooling reading (central air / no cooling / Unknown)', null,
         (select count(*) filter (where cooling ~* '\mcentral\M' and cooling !~* '\m(no|not|none|without|evaporative|swamp|possibly|possible|maybe|unknown|unclear|unverified|tbd)\M|\?') || ' / '
            || count(*) filter (where cooling ~* '^\s*(none|no|no cooling|no (central )?(air|a/c|ac|air conditioning))\s*$') || ' / '
            || count(*) filter (where not coalesce(cooling ~* '\mcentral\M' and cooling !~* '\m(no|not|none|without|evaporative|swamp|possibly|possible|maybe|unknown|unclear|unverified|tbd)\M|\?', false)
                                  and not coalesce(cooling ~* '^\s*(none|no|no cooling|no (central )?(air|a/c|ac|air conditioning))\s*$', false))
          from homes_flags)
  -- 4. Totals ---------------------------------------------------------------------
  union all
  select 4, 'info', 'home × participant pairs with a changed evaluation (and searches)', null,
         (select count(distinct (home_id, user_id)) || ' (' || count(distinct search_id) || ' searches)' from changed)
  union all
  select 4, 'info', 'migration rewrites preferences, homes or answers', null,
         'no — it adds one nullable column and replaces one function body'
) report
order by section, item;
