# PR #93 Add Home intake audit and blocker

## Decision

Implementation is intentionally stopped at the audit boundary required by the
product brief. The current application cannot safely deduplicate a home added by
address and the same home later added by listing URL. Closing that gap requires a
canonical, search-scoped property identity and an atomic create-or-attach write.
Neither exists today, and adding either would require the schema/RLS/privileged
function work that this change explicitly says not to undertake without first
reporting the blocker.

Client-side address string matching is not an acceptable substitute. It would be
racy, would not cover alternate but equivalent address formatting, and could
incorrectly merge apartment communities, units, or similarly named properties.

## Existing architecture

### Entry points and presentation

- `HomeModal` is the shared Add/Edit surface. It is opened from the Homes board
  primary action and empty state, `/homes?add=1`, the Compare empty state, the
  Map empty state, the My Search handoff, and the Realtor Suggest a Home flow.
- `/homes?url=<url>` first checks the already-loaded homes for an exact listing URL
  match. If found, it navigates to that home. Otherwise it opens `HomeModal` with
  the original URL and asks the modal to run its normal intake behavior once.
- Existing-home editing uses the same component in both modal and detail-panel
  presentation modes. Realtor suggestions also reuse it, but save through
  `create_realtor_suggestion`; they do not use the buyer Home/member-state write.
- Mobile currently turns the modal into a full-height surface, stacks the combined
  find row, stacks notes, and keeps a sticky action footer.

### Current intake behavior

- The visible Add Home intake is one ambiguous field accepting a listing URL,
  address, or (for apartment searches) a property name.
- A value recognized as an HTTP(S) URL is **not fetched or scraped**. The importer
  parses an address candidate from known URL path shapes (Redfin, Realtor.com,
  Zillow, Homes.com, then a generic path fallback). The original URL is retained.
- If an address can be extracted, the same address lookup used for manually typed
  addresses is called. If it cannot, the UI asks for an address while retaining
  the URL. Apartment URLs have an additional conservative community-identity
  parser and still require an address before lookup/save.
- A plain address is sent to authenticated `POST /api/import-listing`. Google
  Places autocomplete can help select a formatted US address, but typed input
  remains usable when Places is unavailable.
- The route makes bounded, server-side RentCast requests for one exact address:
  `/v1/properties` plus the sale or long-term-rental listing endpoint. Provider
  credentials remain server-only.
- The adapter can populate canonical address, price, beds, baths, square footage,
  lot size, year built, property type, garage spaces, days on market, coordinates,
  monthly HOA fee, and the most recent annual property tax/year. Missing values
  are omitted rather than converted into negative facts. Apartment-community mode
  deliberately excludes arbitrary unit-level listing price/bed/bath/square-footage
  and garage facts.
- Import merges fill only empty fields and do not overwrite user corrections.
  Source listing URLs are saved only when actually supplied; address lookup does
  not fabricate one.
- The unstructured "Paste listing details" fallback is a separate client-side
  parser which feeds the same import-resolution utilities. Those reusable parsing
  utilities are not exclusive to the fallback and should not be deleted merely
  because its UI is removed.

### Creation, collaboration, photos, and retries

- `HomesBoard` sends new and materially shared edits through
  `saveHomePersonalAndShared`. Shared facts are upserted into `homes`; the caller's
  lifecycle, ratings, and checks are then upserted into `home_member_state`.
- The two writes are not a database transaction. The existing recovery contract
  attaches the already-created Home ID to a member-state failure, and both the
  modal and board adopt it on retry to avoid creating an orphan duplicate.
- Photo files are staged locally, validated as JPEG/PNG/WebP up to 5 MB, and only
  uploaded on Save. Replaced uploaded objects are removed best-effort after a
  successful save. External photo URLs are preserved and never deleted from an
  external host.
- Pros, cons, and general notes are shared Home fields. The modal already receives
  collaboration context and can therefore present truthful solo/collaborative copy
  without a new data path.
- Manual property fields and tri-state facts preserve unknown values explicitly.
  More details are already partially disclosed, while notes are currently always
  expanded.

## P0 identity gap

The only pre-create duplicate check is exact `listingUrl` equality in the already
loaded client collection. The database has no canonical property identifier, no
normalized-address identity column, and no uniqueness constraint covering a
property within a search. `saveHomePersonalAndShared` performs a plain upsert with
no conflict target other than an existing Home ID. Consequently:

1. adding a property by address and later by URL can create two rows;
2. adding the same address twice can create two rows;
3. concurrent tabs/devices can race even if a client-only preflight is added; and
4. Realtor suggestion deduplication cannot be safely reused as buyer Home identity.

This is the exact architecture the brief says must cause implementation to stop,
rather than introducing a heuristic or parallel creation path.

## Required prerequisite decision

Before resuming the visual refresh, approve a narrowly scoped identity design:

1. Define a defensible, provider-independent property identity for homes and for
   apartment communities/units. It must distinguish a community from a specific
   unit and represent genuinely unknown unit identity without fabrication.
2. Store the identity in a search-scoped canonical form, with an appropriate
   uniqueness guarantee. Address normalization alone should not be assumed to be
   sufficient without a documented equivalence and confidence policy.
3. Introduce one atomic/idempotent create-or-attach operation that creates the
   shared Home and participant state together, or safely completes an existing
   partial operation. Both listing-link and address intake must call it.
4. Preserve exact listing URL matching as a fast path, but allow an authoritative
   resolved identity to attach the URL to an existing address-originated Home.
5. Define how staged Realtor suggestions relate to the identity without allowing a
   Realtor to create buyer decision state.
6. Review the migration, RPC, grants, and RLS as a separate security-sensitive
   prerequisite before changing the Add Home UI.

## Planned UI work after the blocker is resolved

Once the canonical identity prerequisite exists, the existing modal can be
refreshed without creating a second importer:

- replace the combined field with separately labeled Listing link and Address
  actions, both converging on the same lookup result and canonical save operation;
- remove only the user-facing pasted-listing-details disclosure;
- retain structured manual fields behind **More home details**;
- place notes behind **Add notes**, using collaboration-aware supporting copy;
- keep current photo staging/source precedence and show **Change photo** when a
  usable image already exists;
- make import failures recommend Address, keep address failures retryable, and do
  not expose provider/infrastructure language;
- preserve dialog semantics, autocomplete keyboard behavior, full-height mobile
  scrolling, stacked task actions, and the accessible sticky Save/Cancel footer;
- update focused intake, collaboration, Realtor, lifecycle/idempotency, mobile,
  and accessibility regression coverage before running the full suite and build.

## Scope and impact of this audit commit

- Data/loaders: unchanged.
- Schema/migrations: unchanged.
- Security/RLS: unchanged.
- Runtime behavior and UI: unchanged.
- Realtor permissions and suggestion lifecycle: unchanged.
- Human visual QA: deferred because no perceptible application change was made.

