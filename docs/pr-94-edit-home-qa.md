# PR #94 — Edit Home audit and human QA

## Architecture and persistence audit

- Edit Home and Add Home intentionally continue to share `HomeModal`; existing homes now branch to a focused editor while Add Home keeps its import/review flow.
- Shared property facts are written to `homes`. Lifecycle, favorite, reaction, ratings, and Match check answers remain scoped to the caller's `home_member_state` row.
- The canonical address is the existing single `homes.address` value. The original listing URL remains `homes.listing_url`; neither is parsed into invented identity fields during editing.
- Photos keep the existing `home-photos` upload path, staged upload, public URL contract, and best-effort removal of replaced uploaded objects. The URL method is disclosed only on request.
- Price, estimated monthly payment, beds, baths, square footage, lot size, year built, and garage use their existing `homes` columns. Home details reuse basement/school notes plus the existing structured fact definitions. No mortgage calculation or Match calculation was added.
- Pros, cons, and notes remain shared `homes` fields. The editor changes only their presentation from always-open textareas to summary-first editing.
- Import review had listed `floorPlanImageUrl`, and the generic shared-row serializer always emitted `floor_plan_image_url: null`, even for ordinary homes. Although an additive apartment migration exists in repository history, environments without that optional experiment reject every edit at PostgREST schema validation. The field has no supported importer producer or downstream presentation. It is now removed from runtime reads, import merging, defaults, shared-change detection, and update serialization. The historical nullable column/migration is retained for deployed database compatibility; no new migration is required.
- No RLS policy, grant, RPC, Match weight, or Realtor permission changed.

## Human QA checklist

1. Edit and save a fully populated Home.
2. Edit and save a partially populated Home.
3. Open a Home with many Unknown Match criteria and confirm Unknown is selected.
4. Change only price; reload and confirm Unknown criteria remain Unknown.
5. Change a Match fact from Yes to No; reload and verify it.
6. Change a Match fact from No to Yes; reload and verify it.
7. Upload/change a photo and verify the new image after reload.
8. Remove a photo and verify the intentional empty state after reload.
9. Edit the original listing URL and verify the exact URL after reload.
10. Edit Pros, Cons, and Notes; save, reload, and inspect the summary.
11. Make edits, cancel, and verify the existing close/cancel behavior.
12. Force a network/save failure and confirm the dialog stays open with edits intact.
13. Restore connectivity and retry once; confirm only one save occurs.
14. In a collaborative search, edit a shared fact and verify both participants see it.
15. Verify the other participant's Favorite, Want to Tour, reaction, ratings, and checks are untouched.
16. Repeat the core save flow in a solo search.
17. Verify a Realtor-associated search retains its existing read/write restrictions.
18. Check the wide two-column editor, sticky footer, keyboard tab loop, Escape, and restored focus on desktop.
19. Check the single-column editor, touch targets, reachable footer, and absence of horizontal scrolling on mobile.
20. Save a pre-existing ordinary and apartment Home and confirm no `floor_plan_image_url` schema-cache error occurs.

## Known risks

- The historical apartment floor-plan image value is no longer editable or loaded. No current product surface consumes it; a future apartment-specific visual pass should design a supported secure image contract before restoring that capability.
- Browser and real Supabase QA remain necessary for storage upload/removal, RLS enforcement, and focus behavior across assistive technologies.
