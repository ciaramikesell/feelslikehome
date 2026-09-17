# Listing Autofill V2 — canonical import audit

## Architecture and supported paths

There is one import path. `HomeModal` accepts an address or URL; `listingUrl.js`
extracts address identity from known URL shapes; the authenticated
`/api/import-listing` route performs exact-address RentCast property and active
sale/rental listing requests; and `rentcast.js` normalizes both responses. The
same modal is used by ordinary Add Home and Realtor Suggest a Home. `/homes?url=`
and the native share/deep-link contract only prefill and auto-trigger that modal,
so they do not have separate parsers. Unsupported URLs retain the URL and fall
back to address entry or user-pasted listing text.

Recognized URL shapes include Zillow, Realtor.com, Trulia, Redfin, Homes.com,
Apartments.com, and generic address-like URLs. These sites are identity inputs,
not scraped providers. RentCast is the only property/listing data provider.

The route makes parallel `/v1/properties` and sale or long-term-rental listing
requests with the shared timeout helper. One empty response is allowed; two
upstream failures return a sanitized 429/502. Failed requests remain retryable.
The client prevents duplicate successful lookups for the same address, merges
only into empty fields, and the `/homes?url=` intake checks existing canonical
listing URLs before opening Add Home.

## Data audit and V2 normalization

Previously normalized fields remain: address, current asking price/rent, beds,
baths, square footage, lot size, year built, canonical property type, garage
spaces, days on market, coordinates, monthly HOA fee, latest annual property tax,
and tax year. Coverage is source-dependent: listing data supplies current market
facts while the property record supplies structural, tax, HOA, and coordinate
facts. Image URLs and public remarks were not previously consumed.

The canonical normalizer now also retains available structured review facts for
stories/levels, exterior, roof, foundation, fireplaces, pool, basement, garage
and parking type/spaces, carport, explicit HOA presence, heating, cooling, water,
sewer, fuel, status, listing identifier, appliances, laundry, and fencing. Missing
keys are omitted (Unknown), while an upstream boolean `false` or zero HOA fee is
retained as an explicit negative. These richer facts are session-scoped review
evidence rather than new Match inputs.

RentCast listing `description`, `text`, `remarks`, or `publicRemarks`, when
present, passes through the same canonical normalizer. A narrow deterministic
allowlist recognizes only explicit phrases. Sentence-level guards reject
negation, hypothetical/potential language, uncertainty, conversions, and repair
needs. Description findings retain `listing_description` provenance and never
write participant checks, ratings, or Match state.

## Provenance, persistence, and corrections

Existing autofill findings retain structured source/provider evidence. Rich
structured facts and description features preserve source class in the import
response and inspection UI for the current session. No migration is required:
canonical editable Home columns remain authoritative, and `mergeImportFields`
never overwrites a non-empty value (including `false` and zero). A retry is
idempotent and cannot casually replace a correction. Durable evidence storage is
deferred until automatic refresh/audit requirements justify a separately secured
append-only model and RLS review.

## Deliberately not implemented

- No provider HTML scraping, hotlinked listing photos, or assumption that an
  Open Graph image is licensed/stable. Upload and pasted photo URL remain.
- No inference from photos or marketing synonyms; “bright,” “spacious,” and
  “chef-inspired” establish none of the allowlisted facts.
- No automatic Match checks from description prose and no mutation of ratings.
- No facts for fields absent from the contracted payload; absence remains Unknown.
- No permanent columns for every provider feature. Their first use is inspection;
  persistence needs product editing semantics, freshness, and RLS design first.

Manual QA should cover representative permitted RentCast addresses in each
supported search mode, provider quota/error behavior, desktop sidecar placement,
mobile disclosure wrapping, keyboard focus, and the Realtor suggestion lifecycle.
