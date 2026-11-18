-- REVIEW ONLY. Disable the guest entry in the app before applying.
begin;
revoke execute on function flh_guest_transfer.save_guest_onboarding_v1(uuid, uuid, text, jsonb, jsonb)
  from flh_guest_writer;
revoke usage on schema flh_guest_transfer from flh_guest_writer;
drop trigger zz_flh_guest_transfer_capture_signup on auth.users;
commit;
