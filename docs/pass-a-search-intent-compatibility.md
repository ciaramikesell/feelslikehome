# V1 Rental Pass A: direct search-type branch audit

Pass A adds a read-only compatibility layer and deliberately leaves the following raw
search-type branches in place to preserve production behavior.

## Pass C: explicit canonical writes and product activation

- `src/components/onboarding/Onboarding.jsx` owns the four legacy choice buttons,
  selected-value toggle, and Investment-only onboarding controls.
- `src/components/MySearchPanel.jsx` owns the Investment-only editor and summary.
- `src/lib/constants.js` keeps `SEARCH_TYPE_OPTIONS`, `getItemlistCategories`, and the
  legacy display/layout wrapper APIs raw-aware. The two Rental legacy values must keep
  selecting different catalogs until the unified Rental catalog is activated.

## Pass D: shared home facts and display

- `src/components/HomeModal.jsx` and `src/components/MySearchPanel.jsx` consume legacy
  terminology. They should move to canonical intent only when Rental facts and their
  display behavior are introduced.

## Pass E: Match and parser behavior

- `src/lib/matching.js` passes the raw priority value into `getItemlistCategories`.
  This intentionally preserves selected legacy criteria and current Match semantics.
- `src/lib/matching.js#parseListingText` has no search-type branch today. Rental paste
  and display changes remain deferred rather than being folded into this pass.

No database, migration, RLS, grant, RPC, saved-priority, onboarding, or Match changes
are part of Pass A.
