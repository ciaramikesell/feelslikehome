-- READ-ONLY preflight and impact report for
-- migrations/2026-11-02-home-facts-match-parity.sql.
--
-- Run in the Supabase SQL Editor of the PRODUCTION project before applying the
-- migration. It is one SELECT: it writes nothing, and returns schema facts and
-- row COUNTS only (no ids, emails, addresses, preferences or answers).
--
-- Proceed only if every row with check = 'required' shows ok = true. Rows with
-- check = 'info' count, per scored participant (owner and co-buyer), the
-- evaluations that change: criteria newly answered by an exact Home Fact
-- (Unknown -> Yes / No), Garage answers of the participant's own that now
-- override garage spaces, garage-space text that is no longer read as 0, and
-- searches saved under pre-unification purchase labels. The same changes apply
-- to the participant's own Match (computeMatch) when the app is deployed.
-- test/home-fact-match-parity-db.test.js runs this before and after the
-- migration and asserts it changes nothing.
with
fn as (
  select p.oid, p.prosecdef, p.proconfig, md5(replace(p.prosrc, chr(13), '')) as body_md5_lf
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace and p.proname = 'resolve_cobuyer_compare_perspectives'
    and pg_get_function_identity_arguments(p.oid) = 'p_search_id uuid, p_home_ids uuid[]'
),
versions(body_md5, label) as (values
  ('507da3d7681a30eec49a8311d30bb180', 'expected: 2026-10-18-lot-size-units-match-parity.sql'),
  ('ee7daf7cbc20d5e361aaac18c8b3735b', 'ALREADY APPLIED: 2026-11-02-home-facts-match-parity.sql'),
  ('7e70b54fa45614c9c0e219d7d8df9a4f', 'OLDER: 2026-10-15-cobuyer-compare-mudroom-parity.sql (stop: apply 2026-10-18-lot-size-units-match-parity.sql first)'),
  ('960d7123231eb983709350e11602b6f9', 'OLDER: 2026-10-07-cobuyer-compare-garage-parity.sql (stop: apply the 2026-10-15 and 2026-10-18 scorers first)')
),
needed(table_name, column_name) as (values
  ('homes', 'search_id'), ('homes', 'user_id'), ('homes', 'price'), ('homes', 'sqft'), ('homes', 'lot_size'),
  ('homes', 'beds'), ('homes', 'baths'), ('homes', 'home_layout'), ('homes', 'home_condition'),
  ('homes', 'primary_bedroom_location'), ('homes', 'secondary_bedroom_location'), ('homes', 'property_type'),
  ('homes', 'pets_allowed'), ('homes', 'utilities_included'), ('homes', 'in_unit_laundry'), ('homes', 'garage_spaces'),
  ('homes', 'basement_style'), ('homes', 'basement_condition'), ('homes', 'laundry_location'), ('homes', 'hoa_fee_monthly'),
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
-- The criteria this change reads, under every label they are stored as.
fact_keys(key) as (values
  ('exterior:Garage'), ('features:Finished basement'), ('features:Finished Basement'), ('features:Walkout basement'),
  ('features:Walkout Basement'), ('features:First-floor laundry'), ('features:First-Floor Laundry'),
  ('features:Second-Floor Laundry'), ('features:First-Floor Primary'), ('location:No HOA')
),
selected_raw as (
  select p.search_id, p.user_id, c.category || ':' || t.key as key, t.value #>> '{}' as tier,
         coalesce(p.priorities ->> 'searchType', '') in ('purchase', 'buy') as purchase
  from participants p
  cross join (values ('features'), ('exterior'), ('location')) c(category)
  cross join lateral jsonb_each(coalesce(p.priorities #> array[c.category, 'tiers'], '{}'::jsonb)) t
  where t.value #>> '{}' <> 'dontcare'
),
-- Pre-unification purchase labels, [legacy, current], exactly as the scorer folds them.
label_aliases(legacy, current) as (values
  ('location:Parks Nearby', 'location:Parks nearby'), ('features:Home Office', 'features:Home office'),
  ('features:Central Air', 'features:Central air'), ('features:Primary Ensuite', 'features:Primary ensuite'),
  ('features:First-Floor Laundry', 'features:First-floor laundry'), ('features:Guest suite', 'features:Guest / In-Law Suite'),
  ('exterior:Fenced Yard', 'exterior:Fenced yard'), ('exterior:Patio / Deck / Outdoor Living', 'exterior:Patio / deck')
),
-- What the scorer counts: a purchase legacy label counts once, under the current
-- label, and not at all when the current label is selected too.
selected as (
  select s.search_id, s.user_id, coalesce(a.current, s.key) as key, s.tier, s.purchase,
         (select a2.legacy from label_aliases a2 where s.purchase and a2.current = coalesce(a.current, s.key)) as legacy_key
  from selected_raw s
  left join label_aliases a on s.purchase and a.legacy = s.key
  where a.current is null or not exists (
    select 1 from selected_raw cur where cur.search_id = s.search_id and cur.user_id = s.user_id and cur.key = a.current)
),
-- Every home × participant × fact criterion, with the participant's own answer
-- (as the scorer reads it) and the exact fact reading (the migration's table).
pairs as (
  select h.id as home_id, sel.user_id, sel.key, sel.tier, h.garage_spaces,
         -- The answer under today's key, else (purchase) under its older label, as the scorer reads it.
         coalesce(coalesce(hms.checks, case when h.user_id = sel.user_id then h.checks else '{}'::jsonb end) -> sel.key,
                  coalesce(hms.checks, case when h.user_id = sel.user_id then h.checks else '{}'::jsonb end) -> sel.legacy_key) as own_raw,
         case
           when sel.key = 'exterior:Garage' then case
             when btrim(coalesce(h.garage_spaces, '')) = '' then null
             when btrim(h.garage_spaces) ~* '^(none|no|no garage)$' then 0
             when h.garage_spaces !~* '\m(no|none|not|without)\M'
               and (select count(*) from regexp_matches(h.garage_spaces, '[0-9]+(\.[0-9]+)?|\.[0-9]+', 'g')) = 1
               then (substring(h.garage_spaces from '[0-9]+(?:\.[0-9]+)?|\.[0-9]+')::numeric > 0)::integer
           end
           when sel.key in ('features:Finished basement', 'features:Finished Basement') then case
             when h.basement_condition = 'unfinished' then 0
             when (h.basement_style = 'none' and h.basement_condition in ('finished', 'unfinished', 'partially_finished'))
               or (h.basement_condition = 'none' and h.basement_style in ('traditional', 'gardenview', 'walkout')) then null
             when h.basement_condition = 'finished' then 1
             when h.basement_condition = 'none' or h.basement_style = 'none' then 0
           end
           when sel.key in ('features:Walkout basement', 'features:Walkout Basement') then case
             when (h.basement_style = 'none' and h.basement_condition in ('finished', 'unfinished', 'partially_finished'))
               or (h.basement_condition = 'none' and h.basement_style in ('traditional', 'gardenview', 'walkout')) then null
             when h.basement_style = 'walkout' then 1
             when h.basement_style = 'none' or h.basement_condition = 'none' then 0
           end
           when sel.key in ('features:First-floor laundry', 'features:First-Floor Laundry') then case when h.laundry_location = 'first_floor' then 1 end
           when sel.key = 'features:Second-Floor Laundry' then case when h.laundry_location = 'second_floor' then 1 end
           when sel.key = 'features:First-Floor Primary' then case h.primary_bedroom_location when 'Main Floor' then 1 when 'Upstairs' then 0 end
           when sel.key = 'location:No HOA' then case when h.hoa_fee_monthly > 0 then 0 end
         end as fact
  from selected sel
  join fact_keys f on f.key = sel.key
  join public.homes h on h.search_id = sel.search_id and coalesce(h.suggestion_staged, false) = false
  left join public.home_member_state hms on hms.home_id = h.id and hms.user_id = sel.user_id
),
classified as (
  -- No answer (NULL) is not explicit: coalesce, or NOT would drop those rows.
  select *, coalesce(own_raw in ('true'::jsonb, '"no"'::jsonb), false) as own_explicit from pairs
),
-- One row per evaluation whose result changes when the migration and the app
-- ship: newly answered by a fact (not Garage, which was already read from
-- spaces), or a Garage own answer that now counts (over disagreeing spaces, or,
-- in the participant's own Match, where spaces are Unknown).
changed as (
  select home_id, user_id, key, tier,
         case when key = 'exterior:Garage' then case when own_raw = 'true'::jsonb then 1 else 0 end else fact end as now_score
  from classified
  where (key <> 'exterior:Garage' and not own_explicit and fact is not null)
     or (key = 'exterior:Garage' and own_explicit and (fact is null or fact <> case when own_raw = 'true'::jsonb then 1 else 0 end))
),
changed_pairs as (
  select home_id, user_id, count(*) as n, bool_or(now_score = 0 and tier = 'must') as must_miss from changed group by home_id, user_id
),
legacy_labels(key) as (select legacy from label_aliases),
legacy_selected as (
  select s.* from selected_raw s join legacy_labels l on l.key = s.key where s.purchase
)
select section, "check", item, ok, detail from (
  -- 1. Prerequisites -------------------------------------------------------
  select 1 as section, 'required' as "check", 'resolve_cobuyer_compare_perspectives(uuid, uuid[]) exists' as item,
         exists (select 1 from fn) as ok, null::text as detail
  union all
  select 1, 'required', 'current body is the 2026-10-18 lot-size version (or this one)',
         exists (select 1 from fn f where f.body_md5_lf in ('507da3d7681a30eec49a8311d30bb180', 'ee7daf7cbc20d5e361aaac18c8b3735b')),
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
  -- 2. Criteria newly answered by an exact Home Fact ------------------------
  union all
  select 2, 'info', 'participant selections of the fact-backed criteria (criterion: count)', null,
         coalesce((select string_agg(key || ': ' || n, ', ' order by key) from (select s.key, count(*) as n from selected s join fact_keys f on f.key = s.key group by s.key) t), 'none')
  union all
  select 2, 'info', 'home × participant evaluations newly answered by Home Facts (criterion tier: Yes / No)', null,
         coalesce((select string_agg(key || ' ' || tier || ': ' || yes || ' / ' || no, ', ' order by key, tier) from (
           select key, tier, count(*) filter (where fact = 1) as yes, count(*) filter (where fact = 0) as no
           from classified where not own_explicit and fact is not null and key <> 'exterior:Garage' group by key, tier) t), 'none')
  union all
  select 2, 'info', 'Must-Haves that become a confirmed miss from a Home Fact', null,
         (select count(*)::text from classified where not own_explicit and fact = 0 and tier = 'must' and key <> 'exterior:Garage')
  union all
  select 2, 'info', 'own answers that differ from the Home Fact (kept: the answer is an override)', null,
         (select count(*)::text from classified where own_explicit and fact is not null and key <> 'exterior:Garage'
            and fact <> case when own_raw = 'true'::jsonb then 1 else 0 end)
  union all
  select 2, 'info', 'home × participant pairs by number of changed evaluations (1 / 2 / 3+), and with a newly missed Must-Have', null,
         (select coalesce(sum((n = 1)::int), 0) || ' / ' || coalesce(sum((n = 2)::int), 0) || ' / ' || coalesce(sum((n >= 3)::int), 0)
            || '; Must-Have newly missed: ' || coalesce(sum(must_miss::int), 0) from changed_pairs)
  union all
  select 2, 'info', 'searches with at least one changed evaluation (of all searches)', null,
         (select count(distinct h.search_id) || ' of ' || (select count(*) from public.searches)
            from changed_pairs c join public.homes h on h.id = c.home_id)
  -- 3. Garage --------------------------------------------------------------
  union all
  select 3, 'info', 'Garage: own Yes / No that disagrees with garage spaces (own answer now wins; by tier)', null,
         coalesce((select string_agg(tier || ': ' || n, ', ' order by tier) from (
           select tier, count(*) as n from classified where key = 'exterior:Garage' and own_explicit and fact is not null
             and fact <> case when own_raw = 'true'::jsonb then 1 else 0 end group by tier) t), 'none')
  union all
  select 3, 'info', 'Garage: Must-Haves that become a confirmed miss (own No now wins over spaces > 0)', null,
         (select count(*)::text from classified where key = 'exterior:Garage' and own_raw = '"no"'::jsonb and fact = 1 and tier = 'must')
  union all
  select 3, 'info', 'Garage: own Yes / No with garage spaces Unknown (own Match: Unknown -> answered; Compare already counted it)', null,
         (select count(*)::text from classified where key = 'exterior:Garage' and own_explicit and fact is null)
  union all
  select 3, 'info', 'Garage: historical false answers (stay Unknown; never an override)', null,
         (select count(*)::text from classified where key = 'exterior:Garage' and own_raw = 'false'::jsonb)
  union all
  select 3, 'info', 'saved homes whose garage spaces have no digits and are not "none" (own Match: read as 0, now Unknown)', null,
         (select count(*)::text from public.homes h where btrim(coalesce(h.garage_spaces, '')) <> ''
            and regexp_replace(h.garage_spaces, '[^0-9.]', '', 'g') = '' and btrim(h.garage_spaces) !~* '^(none|no|no garage)$')
  union all
  select 3, 'info', 'saved homes whose garage spaces have digits but several numbers or a negation (e.g. "1-2", "No garage, 2 carport"; read as the digits run together, now Unknown)', null,
         (select count(*)::text from public.homes h where regexp_replace(coalesce(h.garage_spaces, ''), '[^0-9.]', '', 'g') <> ''
            and btrim(h.garage_spaces) !~* '^(none|no|no garage)$'
            and (h.garage_spaces ~* '\m(no|none|not|without)\M'
              or (select count(*) from regexp_matches(h.garage_spaces, '[0-9]+(\.[0-9]+)?|\.[0-9]+', 'g')) <> 1))
  union all
  select 3, 'info', 'saved homes whose garage spaces made the Compare cast fail (e.g. "1.2.3"; now Unknown)', null,
         (select count(*)::text from public.homes h where regexp_replace(coalesce(h.garage_spaces, ''), '[^0-9.]', '', 'g') <> ''
            and regexp_replace(h.garage_spaces, '[^0-9.]', '', 'g') !~ '^([0-9]+\.?[0-9]*|\.[0-9]+)$')
  -- 4. Pre-unification purchase labels (Compare now folds them like computeMatch) --
  union all
  select 4, 'info', 'purchase preference documents with a pre-unification label selected', null,
         (select count(distinct (search_id, user_id))::text from legacy_selected)
  union all
  select 4, 'info', 'of those, with the current label also selected (Compare counted the criterion twice)', null,
         (select count(*)::text from legacy_selected l join label_aliases a on a.legacy = l.key
            join selected_raw cur on cur.search_id = l.search_id and cur.user_id = l.user_id and cur.key = a.current)
  union all
  select 4, 'info', 'migration rewrites preferences, homes or answers', null, 'no — it replaces one function body only'
) report
order by section, item;
