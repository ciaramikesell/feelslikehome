-- Read-only operator check: co-buyers whose onboarding preferences may have
-- been saved to the wrong search.
--
-- Until 2026-10-07 the onboarding page resolved the account's OWNED search
-- (getSearch) instead of the active search. An invited co-buyer who accepted
-- and then onboarded therefore saved their preferences to their own unused,
-- auto-created search, and has no participant document on the shared search
-- they actually belong to (their Match there is empty).
--
-- Note: from 2026-09-16 until the invitation-acceptance fix
-- (2026-10-07-invitation-acceptance-conflict-targets.sql) acceptance itself
-- failed, so affected rows should date from before that window.
--
-- This only reports. Nothing is copied or rewritten: both documents belong to
-- the same person, and moving one is a product action that person should
-- confirm (planned as an explicit, caller-owned "bring over my preferences"
-- step), never a silent bulk migration.
select
  sm.user_id                    as co_buyer_user_id,
  sm.search_id                  as shared_search_id,
  sm.joined_at,
  owned.id                      as owned_search_id,
  owned_doc.updated_at          as owned_priorities_updated_at
from public.search_members sm
join public.searches owned on owned.user_id = sm.user_id
join public.search_member_priorities owned_doc
  on owned_doc.search_id = owned.id and owned_doc.user_id = sm.user_id
left join public.search_member_priorities shared_doc
  on shared_doc.search_id = sm.search_id and shared_doc.user_id = sm.user_id
where sm.role = 'co_buyer'
  and shared_doc.id is null
order by sm.joined_at;
