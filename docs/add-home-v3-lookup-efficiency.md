# Add Home V3, phase 4: reliable, cost-conscious property lookups

**FLH does the homework. The buyer makes the decisions.** The app should be
efficient with both the buyer's time and the founder's money.

This phase works out how many RentCast requests Add Home makes, and removes
the avoidable ones using only the infrastructure FLH already has. It also fixes
a stale-data bug: one property's details could be saved with another property's
address. Anything that needs a new service, a migration or an ongoing cost is
written up in §4 for approval, and is **not** built.

What this phase does not do:
- no migration, RLS or storage change;
- no new service or subscription;
- no live RentCast call;
- no Match or scoring change;
- no automatic save.

Floor Plans and #166 are untouched.

## 1. Audit: the lookup flow on `main` (`1e6f71b`)

```
Find (link or address) ─┬─ link already saved in this search? → open it (no request)
                        └─ POST /api/import-listing  { address, mode }
                              auth → address ≤ 200 chars → lookupRentCast()
                                 ├─ GET /v1/properties?address=…            (1 request)
                                 └─ GET /v1/listings/sale|rental/long-term  (1 request)
                              address-match guard → normalizeRentCastFields → JSON
Add Home form ← mergeImportFields (fills EMPTY fields only)
Save Home → link already saved? → open it; else save (with the listing_import snapshot)
```

**Each lookup costs 2 RentCast requests.** Requests are not counted anywhere in
FLH; RentCast's dashboard is the only meter.

**Protections that were already in place:**
- Signed-in users only. The address is capped at 200 characters.
- The Find button is disabled while a lookup is loading.
- The same address, after a lookup that worked, is not looked up again.
- An exact-link duplicate opens the saved home, both at Find and at Save.
  Share intake uses the same rule.
- The address-match guard: a response for a different property is dropped.
- Failures are not retried automatically, either by the server or by the client.

**Gaps:**

| # | Gap | Effect |
|---|---|---|
| 1 | No cache anywhere | A → B → A in one Add Home cost 6 requests. Re-opening Add Home for the same address cost 2 more |
| 2 | Duplicates matched by exact link only | The same house via another site's link, or typed as an address, cost 2 requests and could be saved twice |
| 3 | No per-user limit | One account, or a stuck script, could use the whole monthly quota (still possible across instances: see §2) |
| 4 | No backoff on RentCast 429 | The buyer could click straight back into the rate limit |
| 5 | A double-click raced the loading guard | The guard read React state, so two clicks in one tick could both send |
| 6 | **Stale fields on a second lookup** | `mergeImportFields` only fills *empty* fields. A's price, days on market, beds and so on survived into B. If B's lookup failed, the home was saved with B's address, A's details and no snapshot to say where they came from |

## 2. What this phase implements (existing infrastructure only)

### Lookup cache: one Add Home session, client-side
- **What:** a `Map` held by Add Home, of successful `/api/import-listing`
  responses.
- **Key:** `lookupCacheKey(address, mode)`. That is the listing kind plus the
  strict `propertyAddressKey`: number, street, suffix, direction, unit and
  ZIP (or city|state).
  - Formatting variants ("Street"/"St", ZIP+4, case, punctuation) share a key.
  - Another unit, direction, street type or house number never does.
  - An address FLH can't identify strictly keys on its exact text.
  - Sale and rental never share a key.
- **What is cached:** successful responses only. Failures and "busy" are
  never cached.
- **Expiry:** it lasts until Add Home closes, which is minutes. It is never
  shared between users, tabs or devices. Nothing is written to storage.
- **Why not on the server:** a server in-memory cache on Vercel serverless
  lives in one warm instance and is lost on a cold start, so it is unreliable.
  A durable cache needs approval (§4).

### Duplicates by property, before any request
- `findHomeByAddress(homes, address)` uses the same strict key against homes
  already **saved** in this search.
- It is checked at Find (before the request) and again at Save, after the
  existing exact-link check.
- A match opens the existing home, with "You've already added a home at this
  address" (or "Someone in this search…" for a co-buyer's home). There is no
  request and no import.
- **Behaviour change to note:** a search can no longer hold two homes at
  exactly the same address under different links. Different units are still
  different homes. A missing ZIP is not enough to call two addresses the same.

### Usage safeguards
| Safeguard | Where | Limit | Buyer sees |
|---|---|---|---|
| In-flight guard (a ref, set before the first `await`) | Add Home | 1 request at a time | Nothing; the second click is ignored |
| Busy cooldown after any 429 | Add Home | `Retry-After`, capped at 10 minutes; otherwise 60 s | "Property lookups are busy right now. Add the address and fill in the rest on Home Facts, or try again in a minute." |
| Session cap | Add Home | 8 network lookups per Add Home (cache hits are free) | "That's a lot of lookups for one Add Home. Add this home by its address, or close Add Home and start again to look up more." |
| Per-user limit (**best-effort**, see below) | `/api/import-listing`, after auth and before RentCast | 20 lookups (40 requests) per user per 10 minutes **within one warm serverless instance**. `IMPORT_LOOKUP_USER_LIMIT` overrides it | "You've looked up a lot of addresses in a short time. Add this home by its address now, and try a lookup again in a few minutes." (429 + `Retry-After`) |

- Every safeguard ends on the address card with **Save Home** working. Manual
  save never needs a lookup.
- The server log line is `import-listing: per-user lookup limit reached`. It
  carries no user id, address or key.
- **The per-user limit is best-effort. It is not an account-wide quota and
  guarantees no ceiling.**
  - It is held in memory per serverless instance (bounded to 5,000 users,
    least-recently-active evicted).
  - Vercel can run several instances at once, each with its own count, and a
    cold start or redeploy resets the count to zero. So one account can make
    more than 20 lookups in 10 minutes. In the worst case that is 20 per
    instance per window, with no fixed bound on the number of instances.
  - It slows a runaway loop or a stuck client that keeps hitting one warm
    instance, which is the common case. It cannot protect the monthly RentCast
    quota.
  - The client-side safeguards above (in-flight guard, cooldown, session cap)
    only apply to the FLH app. A script calling the route directly bypasses
    them; only the route's auth and this best-effort limit apply to it.
  - An enforceable per-account limit needs shared state: option A in §4.
- Share Extension intake runs the same Find, so it inherits all of this.
  Co-buyers each have their own Add Home session and their own server count.

### One property per draft (isolation)
Every Find first decides whether it names **the property already in this
unsaved draft** (`findSwitchPlan` in `src/lib/lookupSession.js`):

| Find | What happens |
|---|---|
| No property yet in the draft (first find, or text pasted before any address) | **Keep.** Whatever the buyer already typed belongs to the home they are now finding |
| The same property: same strict identity, another spelling or another site's link | **Keep.** Everything stays, including answers confirmed from pasted text, notes, photo and facts. A re-paste for the same property keeps accepted answers (phase 2 rule) |
| A different property, and the draft holds only what lookups and pastes wrote | **Fresh draft**, straight away |
| A different property, and the draft holds the buyer's own content | **One question first.** Nothing is cleared and no request is made until the buyer answers |
| A link FLH can't read an address from (with a property in the draft) | Treated as a different property: fresh draft, or the question |

**The question.** It is the smallest UX change that avoids silently keeping
or silently discarding the buyer's work: one inline card above the found
home, with focus moved to it.

> **Start fresh for a different home?**
> 51687 Sass Rd is a different home from 51685 Sass Rd. Your notes, photo and
> pasted listing details for 51685 Sass Rd won't carry over.
> [Start fresh] [Keep 51685 Sass Rd]

- It names only the kinds of content actually present (`draftBuyerContent`):
  - notes, pros or cons;
  - photo;
  - Match answers or ratings;
  - pasted listing details, or facts added from them;
  - details you edited (any other field the buyer typed or corrected).
- What a lookup or paste wrote and the buyer left alone is not counted as the
  buyer's.
- **Keep** changes nothing. The search box shows the draft's own link or
  address again.
- **Start fresh** replays the same Find on a fresh draft.

**A fresh draft resets every property-specific state path** (`startFresh` +
`freshDraft`):

| State | Reset |
|---|---|
| Form: provider details, buyer edits, notes / pros / cons, Match checks and ratings, accepted shared facts, link, address, coordinates | `freshDraft` = `emptyHome()`. Only the stage and an apartment search's property type carry over |
| **Partial-save id** (adopted after a half-failed save) | Dropped. Before this, saving B would have upserted over A's row. A's row stays A's home |
| Staged photo and preview, photo error, photo-URL input | Cleared, preview revoked |
| Pasted text, parse message, reviewed text | Cleared |
| Answer suggestions, decisions and confirmed answers | Cleared |
| Fact suggestions, decisions, used facts, accepted note suggestions | Cleared |
| Import result (snapshot source: `listingFacts`, `descriptionFeatures`, pasted facts, offered facts), provider result, last looked-up address, what lookups wrote (`importApplied`) | Cleared |
| Session cache, request count, cooldown | **Kept.** They belong to the session, not the property |

- The buyer is told: "Started fresh. Nothing from 51684 Sass Rd carries over
  to this one."
- A Find is ignored while a lookup is in flight, so an earlier answer can never
  land on a later draft.
- **Saved homes are never modified.** Duplicates are checked before the plan,
  so opening an existing home never touches the draft.
- **If B's lookup fails,** the address card holds the fresh draft with B's
  address. Manual Save stores B's address only, with no snapshot.
- **In today's UI** the switch is reachable only from the found card, where
  personal Match answers are deferred to the Match view. Checks and ratings
  are still reset, in case another path ever reaches it.

**History of this section.**
- The first version (`9fd729f`) took back only what lookups wrote and kept
  everything else.
- The isolation audit for #178 (`a551cbc`) found that this kept A's notes,
  pros and cons, staged photo, pasted text, Match answers, ratings, corrected
  details and partial-save id. They would be saved on B. It also found that an
  unreadable link kept all of A's data under the new link.
- This design replaces it. Browser QA had caught one earlier bug: the clear ran
  in a React updater after its record was reset.

## 3. Estimated effect on RentCast usage

Per Add Home session, in requests:

| Situation | Before | Now |
|---|---|---|
| Find one address, save | 2 | 2 |
| A → B → A (comparing, or a typo and back) | 6 | 4 |
| The same address typed or shared again, already saved | 2 | 0 |
| The same house under another site's link, already saved | 2 | 0 |
| Double-click / Enter + click | 4 | 2 |
| Retrying while RentCast says busy | 2 per click | 0 until the cooldown ends |
| A stuck loop in the FLH app, one account | unbounded | ≤ 16 per Add Home (client cap). The server adds a best-effort ≤ 40 per 10 minutes **per warm instance**: not an account-wide ceiling |

- For the expected pattern (one lookup per home, with occasional re-shares and
  re-checks), this is roughly **10–25% fewer requests**. The exact figure
  depends on how often buyers re-add homes they already have, which FLH
  doesn't measure.
- These safeguards **reduce** runaway usage in the FLH app. They **cannot
  guarantee** that one account, or a script calling the route directly, won't
  use up the monthly RentCast quota. The server limit is per instance and
  resets on a cold start. An enforceable account-wide limit needs option A in
  §4 (a migration, which needs approval).
- The durable options in §4 would add cross-session savings, for example two
  co-buyers looking up the same house.

## 4. Decisions that need founder approval (not built)

| Option | What | Cost / change | Reliability | Recommendation |
|---|---|---|---|---|
| **A. Supabase lookup cache + usage table** | `lookup_cache(key, kind, response jsonb, fetched_at)` holding only RentCast's public property/listing data, with no user data. Plus `lookup_usage(user_id, window_start, count)` and a `security definer` RPC that checks and increments it atomically. Service-role access only; no client RLS exposure | **Migration** plus RLS review. No new vendor; existing Postgres | Durable, shared across instances, exact per-user quota | **Recommended** if usage grows. TTL: property record ~24 h, listing ~6 h (status and price change). Never cache failures. Upsert with `on conflict` handles concurrent misses (at most one duplicate fetch per race) |
| B. Vercel Data Cache (`fetch(…, { next: { revalidate } })`) | Cache the two RentCast GETs by URL on Vercel | No code beyond the fetch options. Vercel bills cache reads and writes past plan limits; behaviour with an `X-Api-Key` header and per-region caches needs checking on a Preview | Shared, but invalidation is coarse; does not give a per-user quota | Possible later; verify on a Preview first |
| C. Upstash Redis / Vercel KV | Cache plus a rate limiter (`@upstash/ratelimit`) | **New service**; free tier, then paid | Durable and simple | Not needed at current volume |

Whichever is chosen:
- the key stays the strict `propertyAddressKey` plus kind;
- the address-match guard still runs on every response, cached or not;
- the stale-data rules above don't change.

## 5. Validation plan: a small, redacted fixture capture (needs approval)

**Goal:** settle what phase 3 left as "live test needed":
- the fireplace, pool and view enum values;
- history price semantics;
- new-construction `listingType`;
- foundation and floor count;
- how often each field is populated.

**Budget:** 5 properties × 2 requests = **10 requests**, inside the free
Developer plan (50 a month). There is no paid key, and nothing runs until you
approve.

| # | Property type to pick | Checks |
|---|---|---|
| 1 | Active new-construction listing (builder subdivision) | `listingType: New Construction`; `history` with a single period; subdivision |
| 2 | Older single-family home with a fireplace and an in-ground pool in county records (Sun Belt county) | `features.fireplace/fireplaceType`, `pool/poolType`, `viewType` values |
| 3 | Condo with an HOA | `hoa.fee`, unit parsing, the strict unit key |
| 4 | Older 2-story home with a basement (Midwest) | `foundationType`, `floorCount`; a relisted home for multi-period `history` and its `price` |
| 5 | A long-term rental | `/v1/listings/rental/long-term` shape and `history` events |

**Procedure:**
1. Use a script run locally by you (not CI), with the key in your shell
   environment only.
2. Save raw JSON to a git-ignored folder.
3. Redact before anything is committed:
   - replace the house number and street with fixture values (keep the
     suffix, unit form and ZIP3);
   - drop owner names, mailing addresses, `id`, agent/office names, phones,
     emails and MLS numbers;
   - round coordinates to 2 decimal places;
   - keep every key and enum value as returned.
4. Commit only the redacted files under `test/fixtures/rentcast/`, plus
   tests that read them.
5. Record field coverage (populated / null / missing) in this doc.

## 6. Tests and QA

- **`test/lookup-efficiency.test.js`:**
  - strict identity and cache keys;
  - address duplicates;
  - same property or different (`sameProperty`, `findSwitchPlan`, including
    unreadable links);
  - the buyer's own content by kind (`draftBuyerContent`);
  - A with answers, notes, photo, facts, evidence and a partial-save id → B:
    the fresh draft and B's save hold none of A;
  - a same-property re-paste keeps accepted answers;
  - the limiter: limit, window, per-user, eviction, missing user;
  - route ordering: auth → limit → RentCast, with no personal data logged;
  - Add Home ordering: duplicate and cache before any request; failures not
    cached; cooldown; cap; the in-flight ref;
  - Find ordering: duplicates → plan → fresh draft → link handling or lookup.
    Every state path is reset; the session cache, count and cooldown are kept;
  - still 2 RentCast requests per lookup;
  - **real Postgres:**
    - A (with everything, partly saved) → B → Save: B's row and every buyer's
      state hold none of A, and A's row is unchanged (no upsert over it);
    - A → B → back to A: neither is contaminated;
    - A → B fails → manual Save: B's address only, no snapshot;
    - owner and co-buyer: separate drafts and switches, answers per buyer, the
      owner's home and answers unchanged.
- **`scripts/qa/add-home-lookup-efficiency-e2e.mjs`** (1440 and 390, counting
  every POST to `/api/import-listing`):
  - A→B clears and tells the buyer;
  - A→B→A→B makes 2 requests in total;
  - B's row holds only B;
  - a saved address opens with 0 requests;
  - a double-click makes 1 request;
  - 429 → cooldown → 0 requests → manual save with nothing of the earlier
    property;
  - the per-user limit message → manual save;
  - P with a note, staged photo, pasted text and an added fact → Find Q: the
    question first, with no request and focus on it. Keep changes nothing.
    Start fresh makes 1 request, and Q shows no photo, note or pasted text.
    Q's row has no note, photo, fact or P evidence, and P is not saved.
  - Run the dev server with `IMPORT_LOOKUP_USER_LIMIT=1000
    QA_RENTCAST_DELAY_MS=400`.
- Two older QA scripts saved the same address twice under different links.
  Each step now clears its own address first (the phase 4 duplicate rule).

## 7. Files

- `src/lib/rentcast.js`: `propertyAddressKey` (strict identity).
- `src/lib/lookupSession.js` (new):
  - `lookupCacheKey`, `findHomeByAddress`;
  - `appliedImportFields`, `sameProperty`, `draftBuyerContent`, `draftContentPhrase`, `findSwitchPlan`, `freshDraft`;
  - `SESSION_LOOKUP_LIMIT`, `BUSY_COOLDOWN_MS`.
- `src/lib/lookupRateLimit.js` (new): `createLookupLimiter`, the best-effort
  per-user limiter.
- `src/app/api/import-listing/route.js`: the per-user limit, after auth and
  before RentCast.
- `src/components/HomeModal.jsx`:
  - the session cache, cooldown, cap and in-flight guard;
  - the address duplicate at Find and at Save;
  - property isolation at Find: same property kept; a different property a
    fresh draft (`startFresh`), asked first (`SwitchPropertyConfirm`) when the
    draft holds the buyer's own content; no Find while a lookup is in flight;
  - the new failure notes.
- `src/app/globals.css`: `.flh-switch-note`, `.flh-switch-confirm`.
