-- Repair the production ACL needed by the root People I’m Helping workspace.
-- RLS remains the row boundary: authenticated callers can select only drafts
-- whose started_by is auth.uid(). The private ownership column itself is not
-- exposed to PostgREST clients.
begin;

revoke select on table public.prospective_searches from authenticated;
grant select (
  id, client_name, invited_email, status, draft_priorities, created_at, updated_at
) on table public.prospective_searches to authenticated;

revoke all on table public.prospective_searches from anon;

commit;
