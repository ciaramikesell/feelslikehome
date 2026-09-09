-- READ-ONLY operator queries for the participant lifecycle migration.
-- Run the PRE-MIGRATION section before applying the migration and retain its
-- output so status/reaction totals can be compared with the POST section.

-- =============================================================================
-- PRE-MIGRATION INVENTORY
-- =============================================================================

select 'homes' as storage_path, status, count(*) as row_count
from public.homes
group by status
order by status nulls first;

select 'homes' as storage_path, reaction, count(*) as row_count
from public.homes
group by reaction
order by reaction nulls first;

select 'home_member_state' as storage_path, status, count(*) as row_count
from public.home_member_state
group by status
order by status nulls first;

select 'home_member_state' as storage_path, reaction, count(*) as row_count
from public.home_member_state
group by reaction
order by reaction nulls first;

select 'homes' as storage_path,
       count(*) filter (where status = 'Toured') as toured_rows,
       count(*) filter (where reaction = 'love') as love_rows,
       count(*) as total_rows
from public.homes
union all
select 'home_member_state',
       count(*) filter (where status = 'Toured'),
       count(*) filter (where reaction = 'love'),
       count(*)
from public.home_member_state;

-- Diagnostic only: do not use this uncertain evidence to populate toured_at.
select 'homes' as storage_path,
       count(*) filter (where ratings ? 'tour:overall') as archived_with_overall_feeling,
       count(*) filter (where exists (
         select 1 from jsonb_object_keys(ratings) as rating_key
         where rating_key like 'tour:%'
       )) as archived_with_any_tour_rating
from public.homes
where status = 'Archived'
union all
select 'home_member_state',
       count(*) filter (where ratings ? 'tour:overall'),
       count(*) filter (where exists (
         select 1 from jsonb_object_keys(ratings) as rating_key
         where rating_key like 'tour:%'
       ))
from public.home_member_state
where status = 'Archived';

-- =============================================================================
-- POST-MIGRATION VALIDATION
-- =============================================================================

-- Expect four rows. toured_at is nullable with no default; is_favorite is
-- non-nullable, boolean, and defaults to false on both tables.
select table_name, column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name in ('homes', 'home_member_state')
  and column_name in ('toured_at', 'is_favorite')
order by table_name, column_name;

-- For a first application of this additive migration, all four violation
-- counts should be zero. This also demonstrates that uncertain history stayed
-- null and that no non-love row was made Favorite by this migration.
select 'homes' as storage_path,
       count(*) filter (where status = 'Toured' and toured_at is null) as toured_missing_timestamp,
       count(*) filter (where status is distinct from 'Toured' and toured_at is not null) as non_toured_with_timestamp,
       count(*) filter (where reaction = 'love' and not is_favorite) as love_not_favorite,
       count(*) filter (where reaction is distinct from 'love' and is_favorite) as non_love_favorite
from public.homes
union all
select 'home_member_state',
       count(*) filter (where status = 'Toured' and toured_at is null),
       count(*) filter (where status is distinct from 'Toured' and toured_at is not null),
       count(*) filter (where reaction = 'love' and not is_favorite),
       count(*) filter (where reaction is distinct from 'love' and is_favorite)
from public.home_member_state;

-- Reconcile these totals with the retained pre-migration inventory. The total,
-- status, and reaction counts must be identical; toured_at/favorite counts must
-- equal the pre-migration exact-Toured/exact-love counts on first application.
select 'homes' as storage_path,
       count(*) as total_rows,
       count(*) filter (where status = 'Toured') as toured_status_rows,
       count(toured_at) as toured_at_rows,
       count(*) filter (where reaction = 'love') as love_reaction_rows,
       count(*) filter (where is_favorite) as favorite_rows
from public.homes
union all
select 'home_member_state',
       count(*),
       count(*) filter (where status = 'Toured'),
       count(toured_at),
       count(*) filter (where reaction = 'love'),
       count(*) filter (where is_favorite)
from public.home_member_state;

-- Compare these complete result sets with their pre-migration counterparts to
-- confirm the migration did not modify any status or reaction value.
select 'homes' as storage_path, status, count(*) as row_count
from public.homes
group by status
order by status nulls first;

select 'homes' as storage_path, reaction, count(*) as row_count
from public.homes
group by reaction
order by reaction nulls first;

select 'home_member_state' as storage_path, status, count(*) as row_count
from public.home_member_state
group by status
order by status nulls first;

select 'home_member_state' as storage_path, reaction, count(*) as row_count
from public.home_member_state
group by reaction
order by reaction nulls first;
