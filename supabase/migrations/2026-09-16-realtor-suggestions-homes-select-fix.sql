-- PR #80 follow-up: homes uses an explicit authenticated column allowlist.
-- Adding suggestion_staged did not add it to that allowlist, so every runtime
-- query that selected or filtered on the column failed before RLS was reached.
begin;

grant select (suggestion_staged) on public.homes to authenticated;

notify pgrst, 'reload schema';
commit;
