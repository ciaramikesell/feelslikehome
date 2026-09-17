-- Hotfix: the listing_import migration added a column to the application's
-- explicit homes projection without extending the authenticated column ACL.
-- Keep the Pass 3C.3 column boundary intact; homes RLS continues to decide
-- which rows each authenticated search participant may read or write.
begin;

grant select (listing_import) on public.homes to authenticated;
grant insert (listing_import) on public.homes to authenticated;
grant update (listing_import) on public.homes to authenticated;

notify pgrst, 'reload schema';
commit;
