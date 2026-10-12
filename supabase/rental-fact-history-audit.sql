-- READ-ONLY AUDIT — historical Pets / In-Unit Laundry / Utilities answers.
-- Returns aggregate counts only: no ids, emails, addresses or answers per person.
-- Changes nothing (read-only transaction, rolled back). Safe to run in the
-- Supabase SQL editor. See docs/rental-fact-history-audit.md for how to read it.
begin read only;

with keys(criterion, field) as (
  values ('features:Pets Allowed', 'pets_allowed'),
         ('features:In-Unit Laundry', 'in_unit_laundry'),
         ('features:Utilities Included', 'utilities_included')
),
personal as (
  -- One row per person per home per criterion with a personal Yes/No-style value.
  select k.criterion, k.field, s.home_id, s.user_id, s.updated_at,
         s.checks -> k.criterion as answer
  from public.home_member_state s
  join keys k on s.checks ? k.criterion
),
shared as (
  select h.id as home_id, k.criterion,
         case k.field when 'pets_allowed' then h.pets_allowed
                      when 'in_unit_laundry' then h.in_unit_laundry
                      else h.utilities_included end as shared_value
  from public.homes h cross join keys k
),
per_home as (
  select p.criterion, p.home_id,
         count(*) filter (where p.answer = 'true'::jsonb) as yes_answers,
         count(*) filter (where p.answer = '"no"'::jsonb) as no_answers,
         count(*) filter (where p.answer = 'false'::jsonb) as legacy_false_answers,
         count(*) filter (where p.answer not in ('true'::jsonb, '"no"'::jsonb, 'false'::jsonb)) as other_answers
  from personal p group by p.criterion, p.home_id
)
-- 1. Personal answers by value and by when they were last written
--    (before 2026-09-16 = older check controls; from 2026-09-16 = Edit Home's Yes/No/Unknown).
select '1 personal answers' as section, criterion, jsonb_typeof(answer) || ':' || answer::text as detail,
       case when updated_at < '2026-09-16' then 'before 2026-09-16' else 'from 2026-09-16' end as period,
       count(*)::int as n
from personal group by criterion, answer, period
union all
-- 2. Homes: what a migration rule would see, per criterion.
select '2 homes', ph.criterion,
       case
         when sh.shared_value is not null and (ph.yes_answers > 0 or ph.no_answers > 0)
              and ((sh.shared_value and ph.no_answers = 0) or (not sh.shared_value and ph.yes_answers = 0)) then 'shared fact set; personal answers agree'
         when sh.shared_value is not null and (ph.yes_answers > 0 or ph.no_answers > 0) then 'shared fact set; a personal answer disagrees'
         when sh.shared_value is not null then 'shared fact set; only legacy/other personal values'
         when ph.yes_answers > 0 and ph.no_answers > 0 then 'shared fact unknown; members disagree'
         when ph.yes_answers > 0 or ph.no_answers > 0 then 'shared fact unknown; explicit personal answers all agree'
         else 'shared fact unknown; only legacy false/other personal values'
       end,
       null, count(*)::int
from per_home ph join shared sh on sh.home_id = ph.home_id and sh.criterion = ph.criterion
group by 1, 2, 3
union all
-- 3. Of the "all agree" homes, how many answers came from more than one person.
select '3 agreeing homes by number of people', ph.criterion,
       (ph.yes_answers + ph.no_answers)::text || ' explicit answer(s)', null, count(*)::int
from per_home ph join shared sh on sh.home_id = ph.home_id and sh.criterion = ph.criterion
where sh.shared_value is null and (ph.yes_answers > 0) <> (ph.no_answers > 0)
group by 1, 2, 3
union all
-- 4. Shared facts already recorded (from listing import or the earlier Rental details fields).
select '4 shared facts recorded', k.criterion, coalesce(sh.shared_value::text, 'unknown'), null, count(*)::int
from shared sh join keys k on k.criterion = sh.criterion
group by 1, 2, 3
union all
-- 5. Older labels and the legacy homes.checks column (frozen since the 2026-09-09 privacy cutover).
select '5 legacy', 'features:Pet Policy (retired label)', 'personal answers', null,
       (select count(*)::int from public.home_member_state where checks ? 'features:Pet Policy')
union all
select '5 legacy', k.criterion, 'homes.checks (legacy column)', null,
       (select count(*)::int from public.homes h where h.checks ? k.criterion)
from keys k
order by 1, 2, 3, 4;

rollback;
