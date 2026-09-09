# Pre-beta feedback deployment and verification

The application flag is intentionally enabled in source for Preview. Production must
not deploy that enabled build until the database step below succeeds. Merging the SQL
file does **not** apply it to Supabase.

## Exact production order

1. Apply `supabase/migrations/2026-09-09-pre-beta-feedback.sql` manually in the
   production Supabase SQL editor.
2. Run `supabase/beta-feedback-verification.sql`; require every check, including
   `all_checks_pass`, to be `true`.
3. With two ordinary authenticated test accounts, confirm each can insert a row only
   when `user_id = auth.uid()` and cannot spoof the other account's ID.
4. Confirm neither account can select feedback rows (its own or the other's), update
   a row, or delete a row.
5. Re-run the existing Pass 3C production verifier and require it to remain green.
6. Only then deploy the build with `BETA_FEEDBACK_ENABLED = true`. If migration or
   verification is delayed, set that one source constant to `false` before deploying.

Screenshot attachment is deliberately deferred: this pass creates no bucket, upload,
public URL, or storage policy. Email notification is also deferred because the repository
has no existing product-notification transport; successful database persistence remains
the entire submission contract.

## Manual Preview QA

- Desktop: check Homes, My Search, Want to Tour, Favorites, Archive, Compare, Map, and
  Home Detail. Confirm the small right-edge tab and narrow drawer do not cover actions.
- Mobile: repeat the route sweep and confirm the compact lower-right control avoids the
  header/navigation; open drawers and existing modals to confirm modal z-order wins.
- Submit a one-sentence message with no category. Then check Broken and Confusing with
  and without “I couldn't continue,” plus Idea.
- Force a failed insert and confirm the message remains available for retry. Double-click
  Send and confirm only one insert occurs. Confirm success is brief and collapses/reset.
- Inspect the insert payload: route, active search ID, Home Detail ID, normalized intent,
  viewport/device, user agent, and optional build ID must be correct. Confirm no notes,
  pros/cons, collaborator state, form values, credentials, tokens, cookies, DOM, or page
  text appears.
