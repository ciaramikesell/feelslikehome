# Isolated transfer rehearsal

The implementation migration was applied to disposable PostgreSQL 16.16 databases only. The transaction database had no network interface, and the browser stack exposed its services only on loopback. The transaction suite used the local Unix socket and loaded the repository schema snapshot and its post-snapshot migration sequence. A separate disposable cluster ran GoTrue v2.177.0 and Mailpit with synthetic accounts, locally generated credentials, and no hosted configuration. The latter loaded the same application DDL and the implementation migration against GoTrue's own auth schema. The browser rehearsal used Next.js, GoTrue v2.177.0, PostgREST v12.2.12, Mailpit v1.21, and a verified TLS connection to the PostgreSQL writer. All runtime endpoints were local.

## PostgreSQL results

The adversarial suite passed all 14 tests, with zero failures or skips. The existing co-buyer journey, Realtor entry, Realtor-started searches, and onboarding-state suites passed 29 tests against the same local PostgreSQL cluster, with zero failures or skips.

Reproduce the [adversarial suite](transfer-postgres.test.mjs) from the repository root with `psql` available. Use a dedicated throwaway cluster with `listen_addresses=''`. A Docker-backed `psql` wrapper must forward `PGOPTIONS` into the container so the repository fixture can load the historical schema snapshot.

```sh
FLH_GUEST_TRANSFER_LOCAL=1 FLH_TEST_PGHOST=/var/run/postgresql \
  FLH_TEST_PGUSER=postgres node --test docs/founder-qa-phase-1b/transfer-postgres.test.mjs
```

| Check | Observed |
| --- | --- |
| Signup trigger order | The normal auth insert provisioned the owned search before capture. Ordinary signup, anonymous signup, and Realtor signup did not get transfer bindings. Changing metadata on an existing account did not generate a binding. |
| Direct database calls | Authenticated, anonymous, and Supabase service-role identities received SQLSTATE `42501` for both valid and malformed calls and could not switch to the writer role. The real writer login could execute the transfer and could not read the private receipt, identity, search, profile, or priorities tables directly. |
| Effective writer scope | The local catalog found one callable definer function among the inspected auth, public, storage, and transfer schemas. The only other function with an effective execute grant was `handle_new_user`, a trigger-only function. |
| Identity and retry | Unverified identity, switched accounts, a missing or wrong proof, an unrelated draft ID, and expiry blocked transfer. An identical replay after a later edit returned `already_saved` and preserved that edit. A changed payload returned `conflict`. |
| Existing state | The transfer left pre-existing priorities and other searches intact. A held profile update returned `retry`. After a switch to a shared search committed, transfer returned `conflict`. |
| Invitation concurrency | Real invitation RPCs ran on independent sessions for co-buyer and Realtor invitations in the buyer-to-collaborator direction and for Realtor-to-buyer approval. When acceptance held the relevant foreign-key lock first, transfer returned `retry` and then `conflict`. In the other order, `pg_stat_activity` showed acceptance waiting. It succeeded after transfer committed, with the draft saved only to its original owned search. |
| Stale onboarding | The owner autosave function refused a stale update after a committed transfer and refused writes to another owner’s search. When a legitimate owner autosave committed first, transfer reported a conflict. |
| Atomicity and rollback | An injected receipt failure rolled back the priority insert and completion update. The same proof then saved successfully. The disable script revoked execution and removed capture while retaining committed data and ordinary signup. |

## Local GoTrue and email results

- A short-password signup failed without creating the auth row. Retrying the real signup with corrected credentials and the same locally held draft proof created the binding.
- The unconfirmed account could not transfer. Mailpit received the actual confirmation link. GoTrue issued a code, the original PKCE verifier exchanged it for the original account, and the transfer saved once.
- With a separate verifier representing a different browser context, code exchange failed. A missing draft proof also blocked transfer. Password sign-in to the verified account succeeded, and presenting the original proof then saved once.
- Both successful cases returned `already_saved` on replay. The Auth rehearsal drove the real HTTP protocol and SQL. It used synthetic verification contexts and a locally retained proof to model the two browsers.

## Full-suite regression

The final full test run with PostgreSQL 16.16 and `C.UTF-8` collation reported **1,669 passed, 0 failed, 2 skipped**. The two optional checks require sanitized live RentCast fixtures, which are absent. The default-locale exploratory cluster exposed an existing Garage/Match preflight assertion that sorts differently by collation. It also reproduced on the untouched branch. The final run used the collation expected by that fixture.

```sh
FLH_TEST_PGHOST=127.0.0.1 FLH_TEST_PGPORT=55440 FLH_TEST_PGUSER=postgres \
  node --test --test-concurrency=4 test/*.test.js
```

The production Next.js build passed with guest onboarding off at build time. The browser rehearsal started the same build with and without the runtime flag.

## Browser results

The [browser driver](guest-browser.cjs) ran against the production build on a disposable local stack. It verified the flag-off 404, wrong-Origin rejection, native-style and desktop entry, retention after refresh, a real Kitchen Island ranking, zero search creation during anonymous onboarding, server rejection of a supplied user ID and a forged nested priority tier, and transfer into the original owned search. It deliberately dropped the first successful HTTP response, then recovered the same receipt and confirmed one stored search and priorities row. The buyer could open My Homes after saving. Starting signup for a different email and then signing into an existing account left both the draft and that account's saved Kitchen Island priority untouched.

The cross-browser case used separate Chromium contexts. The verification link opened without the original PKCE state, draft, or cookie, showed the recovery instructions, and allowed the verified buyer to sign in and save in the original context. The screenshots include [all requested widths](screenshots/README.md).

The driver expects an enabled Next.js process on `http://localhost:3110` and the same build with the flag off on port 3111. The local Supabase router on port 55542 sends `/auth/v1` to GoTrue and `/rest/v1` to PostgREST. GoTrue uses site URL `http://localhost:3110`, email confirmation enabled, a default JWT group of `authenticated`, and Mailpit on port 58025. Load the repository snapshot and post-snapshot migrations on the disposable Docker database `flh-1b-pg/authsmoke`, provision the test login and apply the implementation migration. PostgreSQL should require SCRAM and verified TLS for the writer. Use synthetic accounts and locally generated secrets.

```sh
FLH_GUEST_BROWSER_LOCAL=1 node docs/founder-qa-phase-1b/guest-browser.cjs
```

## Rollout checks still open

- The [read-only preflight](proposed-preflight.sql) ran against the local GoTrue-managed auth schema. Production's catalog, migration role, deployment network, and pool/session identity have not been checked. Verify those against the intended environment before approving a hosted migration. Verify the FK constraints, trigger order, expected role permissions, and absence of a public transfer overload.
- Mobile Safari and the native WebView remain device checks. The Playwright WebKit download and the alternate Docker image download were rejected by their registries in this environment. Chromium exercised separate browser contexts and a simulated Capacitor bridge. Keep guest entry and the writer credential disabled in preview until the approved migration and QA pass.
