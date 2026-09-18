-- /people reads this deliberately narrow draft projection before it can render
-- the normal zero-draft state. Production had no usable authenticated SELECT
-- privilege on the relation, so PostgREST returned 42501 before RLS could
-- return the caller's (possibly empty) owner-scoped result.
begin;

revoke select on table public.prospective_searches from authenticated;
grant select (
  id, client_name, invited_email, status, draft_priorities, created_at, updated_at
) on table public.prospective_searches to authenticated;

-- RLS remains the authority over rows: the ACL only permits evaluating the
-- projection, while this policy restricts it to drafts started by the caller.
drop policy if exists "prospective_searches_owner_select" on public.prospective_searches;
create policy "prospective_searches_owner_select" on public.prospective_searches
  for select to authenticated using (started_by = auth.uid());

notify pgrst, 'reload schema';
commit;
