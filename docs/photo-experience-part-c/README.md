# Part C: Photo experience

Based on main `3f319f3` (merged #193, #194, #195). Isolated branch `ux/photo-experience-part-c`. No schema/RLS, native/signing, Floor Plans, dependency or Production changes.

Recognized user uploads now offer **Position photo** in Home Detail: drag with touch/pointer or use labeled keyboard-accessible sliders, preview, then Save/Cancel. Primary property frames use 4:3 with CSS `object-fit: cover`; positioning never modifies original pixels. Actual cropping/derivative storage is unnecessary for this scope.

## Acquisition and display audit

| Path/source | Acquisition and persistence | Presentation and cleanup |
| --- | --- | --- |
| Add Home upload | Validated JPEG/PNG/WebP, 5MB limit; local blob preview until save; existing owner-folder Storage upload | CSS cover, no pixel crop. Position after home is saved. Quick-save upload failure retains the existing save-without-photo behavior. |
| Full home editor | Upload or manually entered HTTP(S) URL; validation retained; failed upload blocks save | Shared preview; cleanup follows successful replacement and compares underlying image identity, so fragment-only edits cannot delete the object. |
| Home Detail | Existing URL, upload replacement or removal | Shared renderer plus position editor for recognized public uploads. Replacement cleanup follows confirmed save. Remove clears the reference and retains the stored object, matching existing behavior. |
| My Homes, comparison, map | Read shared home `photo_url` | Central renderer/position utility; stable fallback. Primary cards/comparison use 4:3; small map/context thumbnails retain their existing ratios. |
| Realtor workspace/detail, suggestions, shared searches | Existing shared field and authorized suggestion flow | Same renderer and anchor. Existing co-buyer/Realtor permissions remain authoritative. Read-only Realtor views have no framing controls. |
| Listing lookup/import | Current RentCast lookup supplies listing data; it does not fetch/copy/hotlink listing photos | No automatic image imports added. Older third-party/manual URLs remain display-only. |
| Fallbacks | Approved local assets or neutral fallback when source missing/fails | Reserved frame dimensions avoid blank containers and image-loading layout shifts; cached pre-hydration failures are handled. |

Every property-photo display uses `HomePhoto`; only the position preview handles its own image geometry. Uploads retain original bytes. All visual cropping is CSS; no upload-time crop or editing dependency was added.

## Storage and safety

The existing shared `photo_url` stores a versioned fragment envelope, for example `https://PROJECT/storage/v1/object/public/home-photos/OWNER/photo.jpg#flh-photo-frame=ENCODED_JSON`. Its decoded value contains `{version:1, fragment:originalFragmentOrNull, position:{x:30,y:75}}`. Center restores the exact original URL. No additional records, storage objects or columns are created.

`src/lib/photoFraming.js` owns parsing, serialization, URL validation, image identity, request sources and cleanup paths. Components do not interpret fragments. Recognized metadata is unwrapped for rendering/validation and excluded from cleanup and image identity. Legitimate original fragments and signed query bytes/order are preserved. Ambiguous namespace collisions remain unchanged, centered and uneditable; browsers omit all fragments from HTTP requests.

The save uses the existing guarded shared-field writer. Its exact previous `photo_url` comparison is a concurrency/version check, including framing: a stale editor cannot overwrite another frame or replacement. Cleanup separately compares image identity. Browser QA verified framing makes no Storage upload/delete or listing-import request and leaves original image SHA-256 unchanged.

Only this project's recognized public `home-photos/UUID/filename.jpg|jpeg|png|webp` uploads can be positioned. Signed/transformed URLs, third-party URLs, unsaved blob previews, unknown legacy paths, oversized original fragments, namespace collisions and unknown metadata versions are unsupported for editing. Signed/external sources remain display-only; signed expiry/refresh behavior is unchanged. Unsafe URL schemes or embedded credentials are not accepted/displayed. Unrecognized cleanup paths are conservatively retained rather than deleted.

Tradeoffs: raw copied database URLs carry FLH metadata; external apps ignore framing. The visible image source and URL input expose the original source. Different frame ratios share the same percentage anchor but show different amounts of the image. A future dedicated-field migration must extract known envelopes with this utility and retain unknown payloads for review. See the [detailed safety review](design-review.md).

## Verification and limits

Production build passed. Unit tests: 1,413 passed, 253 database-dependent tests skipped in the unit run. PostgreSQL suite: 1,664 passed, two missing live RentCast-fixture checks skipped. Production browser QA: 69 assertions passed, including upload/replacement/removal, invalid MIME/size, failed upload/save, URL entry, unchanged-object cleanup guard, concurrent replacement, refresh, separate co-buyer browser context, read-only Realtor, suggestions, pointer/touch drag, keyboard/Escape, malformed/future metadata and cross-view framing.

Actual PostgreSQL home-row RLS was exercised for owner, co-buyer, Realtor and outsider. Local Storage HTTP is a stand-in: hosted bucket authorization, real deletion and signed-URL expiration require founder QA. No live Production connection was used. Browser captures use Chromium mobile viewports and touch emulation, not physical iOS. External font requests were blocked for deterministic fallback-font captures. The production build uses the exact final application source.

Reproducible browser runner: `scripts/qa/photo-experience-part-c.mjs <before|after> <standin.json> <outputRoot> <baseUrl>` with the existing local PostgreSQL/stand-in setup and Playwright Chromium. It refuses a non-test database. [Assertion results](browser-results.json) · [Counts](verification.json).

## Founder QA checklist

- [ ] On physical iPhone, upload a portrait and landscape photo; drag, use sliders, Cancel, Save, center/reset. Check VoiceOver labels/focus, Dynamic Type and the native picker.
- [ ] Refresh and open a second device/co-buyer session; compare Detail, My Homes, comparison and shared search. Confirm Realtor framing and unchanged edit permissions.
- [ ] Replace/remove photos; simulate upload failure; confirm saved photos and unrelated home/search data remain intact.
- [ ] In a non-Production hosted test environment, verify owner-folder upload/delete policies, replacement cleanup, retained-object removal behavior, and signed URL expiry/refresh. Confirm a framing-only/full-editor URL edit never deletes the object.
- [ ] Review phone/desktop captures below; verify real property images with important rooflines/architectural details.

## Before and after

Baseline is latest main including #193–195. All captures use the same original image bytes. New framing anchors the image at 30%/75%. The editor is new: [320px](screenshots/after/position-editor-320.png) · [375px](screenshots/after/position-editor-375.png) · [390px](screenshots/after/position-editor-390.png) · [430px](screenshots/after/position-editor-430.png) · [1280px](screenshots/after/position-editor-1280.png).

| Surface | Width | Baseline | Part C |
| --- | --- | --- | --- |
| detail | 320px | [Before](screenshots/before/detail-320.png) | [After](screenshots/after/detail-320.png) |
| detail | 375px | [Before](screenshots/before/detail-375.png) | [After](screenshots/after/detail-375.png) |
| detail | 390px | [Before](screenshots/before/detail-390.png) | [After](screenshots/after/detail-390.png) |
| detail | 430px | [Before](screenshots/before/detail-430.png) | [After](screenshots/after/detail-430.png) |
| detail | 1280px | [Before](screenshots/before/detail-1280.png) | [After](screenshots/after/detail-1280.png) |
| my-homes | 320px | [Before](screenshots/before/my-homes-320.png) | [After](screenshots/after/my-homes-320.png) |
| my-homes | 375px | [Before](screenshots/before/my-homes-375.png) | [After](screenshots/after/my-homes-375.png) |
| my-homes | 390px | [Before](screenshots/before/my-homes-390.png) | [After](screenshots/after/my-homes-390.png) |
| my-homes | 430px | [Before](screenshots/before/my-homes-430.png) | [After](screenshots/after/my-homes-430.png) |
| my-homes | 1280px | [Before](screenshots/before/my-homes-1280.png) | [After](screenshots/after/my-homes-1280.png) |
| compare | 320px | [Before](screenshots/before/compare-320.png) | [After](screenshots/after/compare-320.png) |
| compare | 375px | [Before](screenshots/before/compare-375.png) | [After](screenshots/after/compare-375.png) |
| compare | 390px | [Before](screenshots/before/compare-390.png) | [After](screenshots/after/compare-390.png) |
| compare | 430px | [Before](screenshots/before/compare-430.png) | [After](screenshots/after/compare-430.png) |
| compare | 1280px | [Before](screenshots/before/compare-1280.png) | [After](screenshots/after/compare-1280.png) |
| realtor | 320px | [Before](screenshots/before/realtor-320.png) | [After](screenshots/after/realtor-320.png) |
| realtor | 375px | [Before](screenshots/before/realtor-375.png) | [After](screenshots/after/realtor-375.png) |
| realtor | 390px | [Before](screenshots/before/realtor-390.png) | [After](screenshots/after/realtor-390.png) |
| realtor | 430px | [Before](screenshots/before/realtor-430.png) | [After](screenshots/after/realtor-430.png) |
| realtor | 1280px | [Before](screenshots/before/realtor-1280.png) | [After](screenshots/after/realtor-1280.png) |
