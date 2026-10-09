-- READ-ONLY. Every search one account owns or belongs to. Replace the id.
with me as (select '00000000-0000-0000-0000-000000000000'::uuid as id)
select s.id as search_id,
       case when s.user_id = me.id then 'owner' else sm.role end as relationship,
       (p.active_search_id = s.id) as is_active,
       (select count(*) from public.homes h where h.search_id = s.id) as homes,
       (select count(*) from public.home_member_state hms join public.homes h on h.id = hms.home_id
         where h.search_id = s.id and hms.user_id = me.id) as my_home_states,
       exists (select 1 from public.search_member_priorities m where m.search_id = s.id and m.user_id = me.id) as has_my_preferences
from me
join public.searches s on s.user_id = me.id
  or exists (select 1 from public.search_members x where x.search_id = s.id and x.user_id = me.id)
left join public.search_members sm on sm.search_id = s.id and sm.user_id = me.id
join public.profiles p on p.id = me.id
order by (s.user_id = me.id) desc, s.created_at;
