-- PR #79: the UI needs human-readable participant identity, but profiles do
-- not contain names and auth.users is intentionally not directly readable.
-- This narrow projection accepts only search ids on which the caller is the
-- Realtor and returns no contact details beyond an email-derived display name.
begin;

create or replace function public.get_realtor_client_roster(p_search_ids uuid[])
returns table (search_id uuid, user_id uuid, display_name text, relationship text)
language sql security definer stable set search_path = '' as $$
  select participants.search_id, participants.user_id,
    coalesce(nullif(initcap(replace(split_part(u.email, '@', 1), '.', ' ')), ''), 'Buyer') as display_name,
    participants.relationship
  from (
    select s.id as search_id, s.user_id, 'Owner'::text as relationship
      from public.searches s
    union all
    select sm.search_id, sm.user_id, 'Co-buyer'::text as relationship
      from public.search_members sm where sm.role = 'co_buyer'
  ) participants
  join auth.users u on u.id = participants.user_id
  where participants.search_id = any(p_search_ids)
    and public.is_search_realtor(participants.search_id, auth.uid());
$$;
revoke all on function public.get_realtor_client_roster(uuid[]) from public;
revoke execute on function public.get_realtor_client_roster(uuid[]) from anon, service_role;
grant execute on function public.get_realtor_client_roster(uuid[]) to authenticated;

notify pgrst, 'reload schema';
commit;
