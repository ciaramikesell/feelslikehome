# PR #82 — Realtor notes, tour suggestions, and buyer invitations

## Audit and preserved architecture

PRs #78–#81 were audited before implementation. Roles remain relationships on
`search_members`: the search row's `user_id` is its Owner, `co_buyer` is a
participant, and `realtor` is a read-mostly professional relationship. The
#79 roster remains a narrow RPC rooted in current Realtor memberships. #80's
staged `realtor_suggestions` and participant-owned `suggestion_dispositions`
remain unchanged; a staged suggestion is not a contender. #81's explicit
`suggestion_staged` column privilege repair remains intact.

Homes are search-scoped shared facts while `home_member_state` holds each
participant's Favorite, Want to Tour, archive, reaction, and ratings. Match is
still participant-specific. Buyer property notes/pros/cons remain on the
existing shared Home model and were not generalized. Existing invitation UUID
tokens, seven-day expiry, email binding, auth redirect continuation, Universal
Links, and the single-search-per-owner bootstrap were reused. There is no
transactional email provider in the repository, so #82 deliberately provides a
secure copy/share link rather than introducing an email platform.

## Models and authorization

`realtor_notes` is the smallest separate model that preserves author, search,
Home, content, and timestamps without risking buyer note migration. One row per
Realtor/search/Home is upserted idempotently. Current decision-makers can read
history; a current Realtor relationship is required to read professional data
or create/update/delete the caller's note. Matching search and Home IDs and a
non-staged contender are rechecked inside narrowly granted RPCs.

`tour_suggestions` stores one durable Realtor/search/Home recommendation. Its
unique key prevents repeat nags. Creation requires a current Realtor
relationship, matching non-staged Home, and at least one non-archived
participant state. Archive therefore hides/blocks the active presentation but
preserves history. It never writes `home_member_state`; buyers use the existing
participant-owned Want to Tour action independently.

Both tables use RLS keyed by `search_id`. A canonical property/Home reused in a
different search cannot expose either contribution. Removing the Realtor's
membership immediately makes reads and RPC writes fail closed while preserving
buyer-visible history. No Realtor Match, household aggregate, or buyer-state
write was added.

## Realtor-to-buyer invitation

The existing `search_invitations` table gains a direction and safe inviter name;
its `search_id` is temporarily null for a Realtor-to-buyer invitation. A
currently authenticated Realtor (someone with at least one active Realtor
membership) creates an email-bound, expiring invitation. Duplicate pending
requests reuse the valid token. The Realtor receives no buyer data or
membership at this point.

The authenticated buyer explicitly accepts. The RPC locks and validates the
invitation, verifies the signed-in email, selects the buyer's existing owned
search (the signup trigger creates exactly one), and inserts the inviter as its
Realtor idempotently. It never creates a Realtor-owned search or silently picks
among unrelated shared searches. A new buyer proceeds through normal onboarding;
an already-onboarded buyer is redirected by the existing onboarding guard to
Homes. The exact `/invite/<uuid>` path survives signup/login and uses the
existing Universal Link bridge.

The People I'm Helping page now offers **Invite a buyer**, including its empty
state. The acceptance screen explains buyer value, ownership, and consent and
uses **Start my search**. Pending invite analytics, reminders, CRM metadata,
and email campaigns are intentionally absent.

## Deployment and QA

Deploy the new Supabase migration before the web build. It is additive for Home,
Match, and participant state; existing invitation rows receive the
`buyer_to_realtor` default. No Vercel environment variable or native project
change is required. The already-associated HTTPS invite route continues to
handle browser and installed-app entry.

Automated contract coverage checks ownership, cross-search keys, revocation
predicates, staged/archive eligibility, WTT separation, duplicate prevention,
email binding, buyer-owned search selection, idempotent acceptance, narrow RPC
grants, #79 roster non-modification, and canonical-schema parity. Human QA is
still required with four real accounts for keyboard behavior, mobile Safari,
installed-iPhone handoff, Supabase production RLS, long names, clipboard
sharing, signup/onboarding interruption, and relationship revocation.
