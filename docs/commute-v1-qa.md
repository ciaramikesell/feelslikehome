# Commute V1 deployment and QA

## Deployment order

1. Enable the Google Geocoding API and Routes API for restricted server credentials.
2. Add `GOOGLE_GEOCODING_API_KEY` and `GOOGLE_ROUTES_API_KEY` to the deployment environment.
3. Immediately before deploying this application version, apply
   `supabase/migrations/2026-09-08-commute-v1.sql` in production Supabase.
4. Deploy the application. Do not deploy the application before the migration: its
   server-rendered pages query `commute_destinations`.
5. Run the signed-in smoke tests below. Do not treat commute times as production-
   verified until a real Google request returns expected Detroit-area results.

The migration is additive. It copies valid legacy JSON destinations without deleting
the old JSON, ignores historical per-destination tiers, and leaves the participant's
single `location.tiers.Commute` priority untouched.

## QA matrix

| ID | Scenario | Expected result | Coverage |
|---|---|---|---|
| A | Single destination + passing threshold | Commute is satisfied; detail is `All commute limits met` | Automated |
| B | Single destination + failing threshold | One confirmed miss with destination, actual, and maximum | Automated |
| C | Multiple required destinations all pass | One satisfied Commute criterion | Automated |
| D | One of multiple required destinations fails | One missed Commute criterion; no averaging | Automated |
| E | Required destination unavailable | Commute is unknown and excluded from score | Automated + staging |
| F | Informational-only destinations | Times display; Commute is excluded from score | Automated + manual |
| G | Required and informational mix | Only required destination affects Match | Automated + manual |
| H | One destination versus many | Exactly one Commute criterion weight | Automated |
| I | Add destination | Row saves and address status appears without leaving My Search | Manual |
| J | Edit label only | Label changes; confirmed address remains confirmed | Manual/code review |
| K | Edit address | Address is checked again and old coordinates are replaced/cleared | Manual/staging |
| L | Edit maximum only | Match reevaluates without another address lookup | Manual/code review |
| M | Delete destination | Only current participant's row is removed | Manual |
| N | Invalid destination | Calm check-address message; My Search remains usable | Automated provider mapping + staging |
| O | Ambiguous destination | Calm city/ZIP message; My Search remains usable | Automated provider mapping + staging |
| P | RentCast home with coordinates | Insert trigger fingerprints imported address and permits routing | SQL/staging |
| Q | Manual home without coordinates | First commute request resolves home before routing | Staging |
| R | Existing home address changed | Database trigger clears old coordinate provenance | SQL/staging |
| S | Old coordinates after address change | Fingerprint check prevents use; route remains unknown until resolved | Automated utility + SQL/staging |
| T | Current participant versus Co-Buyer | RLS/API return and route only caller-owned destinations | SQL policy review + two-user staging |
| U | Single-user legacy priorities | Legacy destinations copy for owner; existing Commute tier remains | Migration staging |
| V | Google unavailable | Structured unavailable result and calm UI | Automated provider mapping + staging |
| W | No driving route | `No driving route found`; unknown is not a failure | Automated provider parsing + staging |
| X | Home Card with no destinations | No Commute section | Manual |
| Y | Home Card with one destination | One compact row | Manual |
| Z | Home Card with 3+ destinations | Two rows and `+N more`; required rows first | Automated sorting + manual |

## Required staging checks with real Google credentials

- Confirm Compute Route Matrix returns an array using `originIndex`,
  `destinationIndex`, `condition`, and protobuf `duration` strings for the enabled
  project and API version.
- Confirm a known Detroit route rounds to the expected minute.
- Confirm a deliberately impossible driving pair returns `ROUTE_NOT_FOUND`.
- Confirm an invalid address returns `ZERO_RESULTS` from Geocoding.
- Confirm a partial address that Google marks `partial_match` receives the clarification
  message.
- Confirm browser network responses never contain either Google API key.
- Confirm a second participant cannot select, edit, delete, or request the first
  participant's destination ID.
- Confirm a home address edit clears the old coordinates in Supabase before the next
  route is calculated.
