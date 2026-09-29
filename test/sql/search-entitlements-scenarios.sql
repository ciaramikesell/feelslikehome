-- Phase 1 entitlement scenarios run as the authenticated role. Any failed
-- expectation raises and stops the script; success prints ALL PASS.
\set ON_ERROR_STOP 1
create or replace function public.t_expect(p_sql text, p_code text) returns void language plpgsql as $$
begin
  begin execute p_sql; exception when others then
    if sqlstate = p_code then return; end if;
    raise exception 'expected % for [%] but got % %', p_code, p_sql, sqlstate, sqlerrm;
  end;
  raise exception 'expected % for [%] but it succeeded', p_code, p_sql;
end $$;
grant execute on function public.t_expect(text,text) to authenticated;
create or replace function public.t_eq(a anyelement, b anyelement, label text) returns void language plpgsql as $$
begin if a is distinct from b then raise exception '% : expected % got %', label, b, a; end if; end $$;
grant execute on function public.t_eq(anyelement,anyelement,text) to authenticated;

set role authenticated;
-- Owner A (fresh search A): homes 1-3 admitted
set test.uid = 'aaaaaaaa-0000-0000-0000-000000000001';
select t_eq((select free_homes_remaining from get_search_entitlement('00000000-0000-0000-0000-00000000000a')), 3, 'A starts with 3');
select t_eq(check_home_admission('00000000-0000-0000-0000-00000000000a','https://z.com/a1','10 Pine'), 'free', 'precheck free');
insert into homes(search_id,user_id,address,listing_url) values ('00000000-0000-0000-0000-00000000000a','aaaaaaaa-0000-0000-0000-000000000001','10 Pine','https://z.com/a1?utm=x');
-- duplicate URL (normalized) does not consume
insert into homes(search_id,user_id,address,listing_url) values ('00000000-0000-0000-0000-00000000000a','aaaaaaaa-0000-0000-0000-000000000001','10 Pine Street','https://Z.com/a1/');
-- duplicate address with no URL does not consume
insert into homes(search_id,user_id,address) values ('00000000-0000-0000-0000-00000000000a','aaaaaaaa-0000-0000-0000-000000000001','10 pine');
select t_eq((select free_homes_used from get_search_entitlement('00000000-0000-0000-0000-00000000000a')), 1, 'dupes do not consume');
-- co-buyer B adds 2nd, owner 3rd
set test.uid = 'bbbbbbbb-0000-0000-0000-000000000001';
insert into homes(search_id,user_id,address) values ('00000000-0000-0000-0000-00000000000a','bbbbbbbb-0000-0000-0000-000000000001','11 Pine');
set test.uid = 'aaaaaaaa-0000-0000-0000-000000000001';
insert into homes(search_id,user_id,address) values ('00000000-0000-0000-0000-00000000000a','aaaaaaaa-0000-0000-0000-000000000001','12 Pine');
select t_eq((select free_homes_remaining from get_search_entitlement('00000000-0000-0000-0000-00000000000a')), 0, 'A exhausted');
select t_eq(check_home_admission('00000000-0000-0000-0000-00000000000a','','13 Pine'), 'paywall_required', 'precheck paywall');
select t_eq(check_home_admission('00000000-0000-0000-0000-00000000000a','','12 Pine'), 'existing', 'precheck existing');
-- 4th unique rejected, for owner and co-buyer
select t_expect($$insert into homes(search_id,user_id,address) values ('00000000-0000-0000-0000-00000000000a','aaaaaaaa-0000-0000-0000-000000000001','13 Pine')$$, 'FL402');
set test.uid = 'bbbbbbbb-0000-0000-0000-000000000001';
select t_expect($$insert into homes(search_id,user_id,address) values ('00000000-0000-0000-0000-00000000000a','bbbbbbbb-0000-0000-0000-000000000001','13 Pine')$$, 'FL402');
-- editing an existing home via upsert still works when exhausted
set test.uid = 'aaaaaaaa-0000-0000-0000-000000000001';
insert into homes(id,search_id,user_id,address) select id, search_id, user_id, '12 Pine Ave' from homes where address='12 Pine'
  on conflict (id) do update set address = excluded.address;
select t_eq((select count(*)::int from homes where address='12 Pine Ave'), 1, 'upsert edit ok');
-- delete does not restore slot; re-add of admitted property allowed without consuming
delete from homes where address='11 Pine';
select t_eq((select free_homes_remaining from get_search_entitlement('00000000-0000-0000-0000-00000000000a')), 0, 'delete no restore');
select t_expect($$insert into homes(search_id,user_id,address) values ('00000000-0000-0000-0000-00000000000a','aaaaaaaa-0000-0000-0000-000000000001','14 Pine')$$, 'FL402');
insert into homes(search_id,user_id,address) values ('00000000-0000-0000-0000-00000000000a','aaaaaaaa-0000-0000-0000-000000000001','11 Pine');
-- client cannot touch entitlement tables or internal functions
select t_expect($$update search_entitlements set status='unlocked'$$, '42501');
select t_expect($$insert into search_entitlements(search_id,status,unlocked_at,source) values ('00000000-0000-0000-0000-00000000000d','unlocked',now(),'apple')$$, '42501');
select t_expect($$delete from search_home_admissions$$, '42501');
select t_expect($$select * from search_entitlement_transactions$$, '42501');
select t_expect($$select record_search_entitlement_unlock('00000000-0000-0000-0000-00000000000a','admin','x')$$, '42501');
select t_expect($$select admit_search_home('00000000-0000-0000-0000-00000000000a',gen_random_uuid(),'','99 Q','buyer_add',null)$$, '42501');
-- realtor and stranger cannot read entitlement
set test.uid = 'cccccccc-0000-0000-0000-000000000001';
select t_expect($$select * from get_search_entitlement('00000000-0000-0000-0000-00000000000a')$$, '42501');
set test.uid = 'dddddddd-0000-0000-0000-000000000001';
select t_expect($$select * from get_search_entitlement('00000000-0000-0000-0000-00000000000a')$$, '42501');
select t_expect($$select check_home_admission('00000000-0000-0000-0000-00000000000a','','x')$$, '42501');

-- Grandfathered search B (4 unique historical): all homes intact, next new blocked, dup allowed
set test.uid = 'aaaaaaaa-0000-0000-0000-000000000002';
select t_eq((select count(*)::int from homes where search_id='00000000-0000-0000-0000-00000000000b'), 5, 'B homes intact');
select t_eq((select free_homes_remaining from get_search_entitlement('00000000-0000-0000-0000-00000000000b')), 0, 'B none remaining');
select t_expect($$insert into homes(search_id,user_id,address) values ('00000000-0000-0000-0000-00000000000b','aaaaaaaa-0000-0000-0000-000000000002','5 Elm St')$$, 'FL402');
insert into homes(search_id,user_id,address) values ('00000000-0000-0000-0000-00000000000b','aaaaaaaa-0000-0000-0000-000000000002','4 Elm St');
update homes set address = '4 Elm Street' where address='4 Elm St' and search_id='00000000-0000-0000-0000-00000000000b';
-- Search C (2 historical): one remaining
set test.uid = 'aaaaaaaa-0000-0000-0000-000000000003';
select t_eq((select free_homes_remaining from get_search_entitlement('00000000-0000-0000-0000-00000000000c')), 1, 'C one remaining');
reset role;

-- Realtor suggestions: staged insert never counted; promotion admits or is refused and leaves suggestion
insert into homes(id,search_id,user_id,address,suggestion_staged) values
 ('11111111-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000000a','cccccccc-0000-0000-0000-000000000001','20 Realtor Rd',true),
 ('11111111-0000-0000-0000-000000000002','00000000-0000-0000-0000-00000000000c','cccccccc-0000-0000-0000-000000000001','21 Realtor Rd',true),
 ('11111111-0000-0000-0000-000000000003','00000000-0000-0000-0000-00000000000c','cccccccc-0000-0000-0000-000000000001','22 Realtor Rd',true),
 ('11111111-0000-0000-0000-000000000004','00000000-0000-0000-0000-00000000000a','cccccccc-0000-0000-0000-000000000001','12 Pine',true);
insert into realtor_suggestions(id,search_id,home_id) values
 ('22222222-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000000a','11111111-0000-0000-0000-000000000001'),
 ('22222222-0000-0000-0000-000000000002','00000000-0000-0000-0000-00000000000c','11111111-0000-0000-0000-000000000002'),
 ('22222222-0000-0000-0000-000000000003','00000000-0000-0000-0000-00000000000c','11111111-0000-0000-0000-000000000003'),
 ('22222222-0000-0000-0000-000000000004','00000000-0000-0000-0000-00000000000a','11111111-0000-0000-0000-000000000004');
set role authenticated;
set test.uid = 'aaaaaaaa-0000-0000-0000-000000000001';
select t_eq((select free_homes_used from get_search_entitlement('00000000-0000-0000-0000-00000000000a')), 3, 'staged not counted');
-- A exhausted: promotion refused, suggestion still pending, home still staged
select t_expect($$select promote_realtor_suggestion('22222222-0000-0000-0000-000000000001')$$, 'FL402');
reset role;
select t_eq((select status from realtor_suggestions where id='22222222-0000-0000-0000-000000000001'), 'pending', 'suggestion preserved');
select t_eq((select suggestion_staged from homes where id='11111111-0000-0000-0000-000000000001'), true, 'still staged');
set role authenticated;
-- promotion of an already-admitted property is allowed
select promote_realtor_suggestion('22222222-0000-0000-0000-000000000004');
-- buyer cannot unstage directly via update (RLS)
update homes set suggestion_staged=false where id='11111111-0000-0000-0000-000000000001';
reset role;
select t_eq((select suggestion_staged from homes where id='11111111-0000-0000-0000-000000000001'), true, 'direct unstage blocked');
-- C: one slot -> first promotion ok, second refused
set role authenticated;
set test.uid = 'aaaaaaaa-0000-0000-0000-000000000003';
select promote_realtor_suggestion('22222222-0000-0000-0000-000000000002');
select t_expect($$select promote_realtor_suggestion('22222222-0000-0000-0000-000000000003')$$, 'FL402');
reset role;

-- Unlock (service-side) then unlimited
select record_search_entitlement_unlock('00000000-0000-0000-0000-00000000000a','admin','flh_search_unlock');
set role authenticated;
set test.uid = 'bbbbbbbb-0000-0000-0000-000000000001';
select t_eq((select status from get_search_entitlement('00000000-0000-0000-0000-00000000000a')), 'unlocked', 'cobuyer sees unlock');
insert into homes(search_id,user_id,address) select '00000000-0000-0000-0000-00000000000a','bbbbbbbb-0000-0000-0000-000000000001', n||' Unlimited Ln' from generate_series(1,5) n;
set test.uid = 'aaaaaaaa-0000-0000-0000-000000000001';
select promote_realtor_suggestion('22222222-0000-0000-0000-000000000001');
reset role;
select t_expect($$select record_search_entitlement_unlock('00000000-0000-0000-0000-00000000000d','apple','x')$$, 'P0001');
select 'ALL PASS';
