-- REVIEW ONLY. Disable the guest entry in the app before applying.
begin;
revoke execute on function public.save_guest_onboarding_v1(uuid, text, jsonb, jsonb)
  from authenticated;
drop trigger zz_flh_guest_transfer_capture_signup on auth.users;
commit;
