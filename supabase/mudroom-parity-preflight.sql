-- READ-ONLY preflight for migrations/2026-10-15-cobuyer-compare-mudroom-parity.sql.
--
-- Run in the Supabase SQL Editor of the PRODUCTION project before applying the
-- migration. It is one SELECT: it writes nothing, and returns schema facts and
-- row COUNTS only (no ids, emails, addresses, preferences or other user data).
--
-- Proceed only if every row with check = 'required' shows ok = true. Rows with
-- check = 'info' describe what the migration will change for existing data.
-- test/mudroom-match-parity-db.test.js runs this file before and after the
-- migration and asserts it changes nothing.
with
fn as (
  select p.oid, p.proname, p.prosecdef, p.proconfig,
         -- LF-normalized, as production-function-fingerprints.sql matches bodies
         -- (a body pasted from a Windows clipboard is the same code with CRLF).
         md5(replace(p.prosrc, chr(13), '')) as body_md5_lf
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace and p.proname = 'resolve_cobuyer_compare_perspectives'
    and pg_get_function_identity_arguments(p.oid) = 'p_search_id uuid, p_home_ids uuid[]'
),
-- LF md5 of every repository version of the function (supabase/production-function-fingerprints.sql).
versions(body_md5, label) as (values
  ('960d7123231eb983709350e11602b6f9', 'expected: 2026-10-07-cobuyer-compare-garage-parity.sql'),
  ('7e70b54fa45614c9c0e219d7d8df9a4f', 'ALREADY APPLIED: 2026-10-15-cobuyer-compare-mudroom-parity.sql'),
  ('bbe2d68d428207e631c3ec19f323badb', 'OLDER: 2026-09-18-tour-evaluations.sql (Garage parity missing; this migration also restores it — see docs)'),
  ('b22f5c5ff9b3780de761266d9b84622c', 'OLDER: 2026-09-16-realtor-role-foundation.sql (tour-evaluation scoring missing: stop, apply 2026-09-18 and 2026-10-07 first)'),
  ('eea824396ba4dfbb6512564db20aaefd', 'OLDER: 2026-09-09-rental-v1-shared-facts.sql (stop, apply the later migrations first)'),
  ('6ce961e577d63a42fe4f96a7e02319ce', 'OLDER: 2026-09-08-secure-compare-perspectives.sql (stop, apply the later migrations first)'),
  ('5b3a3b795ef7fec66ba93409d25d7675', 'OLDER: schema.sql snapshot (stop, apply the later migrations first)')
),
-- Every column the new body reads. The body is validated only at call time,
-- so a missing column would surface as a Compare error, not a migration error.
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
-- Participant preference documents: a co-buyer's (or owner's) own row, else
-- the owner's legacy searches.priorities — the same precedence the function uses.
docs as (
  select smp.priorities from public.search_member_priorities smp
  union all
  select s.priorities from public.searches s
  where not exists (select 1 from public.search_member_priorities smp where smp.search_id = s.id and smp.user_id = s.user_id)
),
mudroom_docs as (
  select priorities #>> '{features,tiers,Mudroom}' as tier,
         coalesce(priorities ->> 'searchType', '') in ('purchase', 'buy') as purchase
  from docs
  where coalesce(priorities #>> '{features,tiers,Mudroom}', 'dontcare') <> 'dontcare'
)
select section, "check", item, ok, detail from (
  -- 1. Prerequisites -------------------------------------------------------
  select 1 as section, 'required' as "check", 'resolve_cobuyer_compare_perspectives(uuid, uuid[]) exists' as item,
         exists (select 1 from fn) as ok, null::text as detail
  union all
  select 1, 'required', 'current body is a known repository version (not hand-edited)',
         exists (select 1 from fn f join versions v on v.body_md5 = f.body_md5_lf),
         coalesce((select v.label from fn f join versions v on v.body_md5 = f.body_md5_lf),
                  'NO REPOSITORY MATCH: ' || coalesce((select body_md5_lf from fn), 'function absent') || ' — stop and review')
  union all
  select 1, 'required', 'current body is the 2026-10-07 garage-parity version or newer',
         exists (select 1 from fn f where f.body_md5_lf in ('960d7123231eb983709350e11602b6f9', '7e70b54fa45614c9c0e219d7d8df9a4f')), null
  union all
  select 1, 'required', 'function is SECURITY DEFINER with an empty search_path',
         exists (select 1 from fn where prosecdef and proconfig @> array['search_path=""']), null
  union all
  select 1, 'required', 'public.can_access_search(uuid, uuid) exists',
         exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'can_access_search'
                 and pg_get_function_identity_arguments(p.oid) = 'p_search_id uuid, p_user_id uuid'), null
  union all
  select 1, 'required', 'every column the function reads exists',
         not exists (select 1 from missing), (select string_agg(name, ', ' order by name) from missing)
  union all
  select 1, 'required', 'authenticated may execute it',
         coalesce((select has_function_privilege('authenticated', f.oid, 'execute') from fn f), false), null
  -- 2. What changes for existing data (counts only) ------------------------
  union all
  select 2, 'info', 'purchase preference documents with Mudroom selected (start counting in Compare)', null,
         (select count(*)::text from mudroom_docs where purchase)
  union all
  select 2, 'info', 'of those, by level', null,
         coalesce((select string_agg(tier || ': ' || n, ', ' order by tier) from (select tier, count(*) as n from mudroom_docs where purchase group by tier) t), 'none')
  union all
  select 2, 'info', 'non-purchase documents with Mudroom selected (already counted; unchanged)', null,
         (select count(*)::text from mudroom_docs where not purchase)
  union all
  select 2, 'info', 'personal Mudroom answers on homes (Yes / No) that become scored', null,
         (select 'yes: ' || count(*) filter (where checks -> 'features:Mudroom' = 'true'::jsonb)
                 || ', no: ' || count(*) filter (where checks -> 'features:Mudroom' = '"no"'::jsonb)
          from public.home_member_state)
  union all
  select 2, 'info', 'migration rewrites preferences or home rows', null, 'no — it replaces one function body only'
) report
order by section, item;
