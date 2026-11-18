# Isolated transfer rehearsal

The proposed SQL was applied to disposable PostgreSQL 16.16 databases only. Containers had no published ports or network egress. The transaction suite used a socket-only cluster and loaded the repository schema snapshot and its post-snapshot migration sequence. A separate loopback-only cluster ran GoTrue v2.177.0 and Mailpit with synthetic accounts, locally generated credentials, and no hosted configuration. The latter loaded the same application DDL and the exact reviewed transfer SQL against GoTrue's own auth schema.

## PostgreSQL results

The adversarial suite passed all 13 tests, with zero failures or skips.

Reproduce the [adversarial suite](transfer-postgres.test.mjs) from the repository root with `psql` available. Use a dedicated throwaway cluster with `listen_addresses=''`. A Docker-backed `psql` wrapper must forward `PGOPTIONS` into the container so the repository fixture can load the historical schema snapshot.

```sh
FLH_GUEST_TRANSFER_LOCAL=1 FLH_TEST_PGHOST=/var/run/postgresql \
  FLH_TEST_PGUSER=postgres node --test docs/founder-qa-phase-1b/transfer-postgres.test.mjs
```

| Check | Observed |
| --- | --- |
| Signup trigger order | The normal auth insert provisioned the owned search before capture. Ordinary signup, anonymous signup, and Realtor signup did not get transfer receipts. Changing metadata on an existing account did not generate a binding. |
| Direct database calls | Authenticated, anonymous, and Supabase service-role identities received SQLSTATE `42501` for both valid and malformed calls and could not switch to the writer role. The real writer login could execute the transfer and could not read the private receipt, identity, search, profile, or priorities tables directly. |
| Effective writer scope | The local catalog found one callable definer function among the inspected auth, public, storage, and transfer schemas. The only other function with an effective execute grant was `handle_new_user`, a trigger-only function. |
| Identity and retry | Unverified identity, switched accounts, a missing or wrong proof, an unrelated draft ID, and expiry blocked transfer. An identical replay after a later edit returned `already_saved` and preserved that edit. A changed payload returned `conflict`. |
| Existing state | The transfer left pre-existing priorities and other searches intact. A held profile update returned `retry`. After a switch to a shared search committed, transfer returned `conflict`. |
| Invitation concurrency | Real invitation RPCs ran on independent sessions for co-buyer and Realtor invitations in the buyer-to-collaborator direction and for Realtor-to-buyer approval. When acceptance held the relevant foreign-key lock first, transfer returned `retry` and then `conflict`. In the other order, `pg_stat_activity` showed acceptance waiting. It succeeded after transfer committed, with the draft saved only to its original owned search. |
| Atomicity and rollback | An injected receipt failure rolled back the priority insert and completion update. The same proof then saved successfully. The disable script revoked execution and removed capture while retaining committed data and ordinary signup. |

## Local GoTrue and email results

- A short-password signup failed without creating the auth row. Retrying the real signup with corrected credentials and the same locally held draft proof created the binding.
- The unconfirmed account could not transfer. Mailpit received the actual confirmation link. GoTrue issued a code, the original PKCE verifier exchanged it for the original account, and the transfer saved once.
- With a separate verifier representing a different browser context, code exchange failed. A missing draft proof also blocked transfer. Password sign-in to the verified account succeeded, and presenting the original proof then saved once.
- Both successful cases returned `already_saved` on replay. The Auth rehearsal drove the real HTTP protocol and SQL. It used synthetic verification contexts and a locally retained proof to model the two browsers.

## Rollout checks still open

- The [read-only preflight](proposed-preflight.sql) ran against the local GoTrue-managed auth schema. Production's catalog, migration role, deployment network, and pool/session identity have not been checked. Verify those against the intended environment before approving a hosted migration. Verify the FK constraints, trigger order, expected role permissions, and absence of a public transfer overload.
- This proposal contains no Next.js route, strict application payload validator, deployed flag, or browser storage implementation. Auth tests establish the protocol behavior. End-to-end browser, mobile Safari, native WebView, draft retention UI, and legacy autosave checks remain for implementation. Keep the guest entry and writer credential disabled in preview until the approved migration and QA pass.
