# Apartment import correction: provider scope and Google configuration

## Google browser key

Address suggestions and the saved-properties map share `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`. The browser key must have:

- **API restrictions:** Maps JavaScript API and Places API (New) only.
- **Application restrictions:** Websites (HTTP referrers), including the production origins (`https://feelslikehome.app/*` and `https://www.feelslikehome.app/*` if used), localhost patterns needed for development, and only the trusted Vercel preview-domain patterns used by the team.

Places is loaded dynamically through Maps JavaScript `importLibrary('places')`. The address control uses the Places API (New) `AutocompleteSuggestion` and `Place.fetchFields` APIs. It requests a formatted address and keeps the place ID transient. Routes API and Geocoding API are not required on this browser key; their existing server keys remain separate.

## Apartment RentCast scope

A community-address lookup is not selected-option evidence. Apartment imports classify currently available RentCast values as follows:

- **Safe property scope:** canonical formatted address, latitude, longitude, property type, year built, lot size, HOA fee, and dated annual property tax.
- **Option scoped:** listing price/rent, bedrooms, bathrooms, square footage, availability, floor-plan identity, unit identity, and floor-plan image. These require a future source that explicitly identifies the selected plan or unit.
- **Ambiguous at community level:** listing days on market and garage-space counts. They are not used as a selected-option summary. Boolean rental amenities are never inferred from omission.

The current adapter therefore ignores the arbitrary current rental listing's price, beds, baths, square footage, and days on market in apartment-community mode. It also ignores property-record beds, baths, and square footage because a multifamily/community record does not prove the selected option. Existing user values always win. Home-to-buy and home-to-rent keep their existing merge behavior.

## Limitations

V1 still recognizes only the conservative URL shapes already supported. It does not scrape listing pages or floor plans, and ApartmentList redirect URLs intentionally fall back to manual property name/address entry. A later explicitly plan- or unit-scoped adapter can emit selected-option fields, but community RentCast responses cannot.

No database migration or production configuration file is part of this correction.
