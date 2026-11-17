# Photo framing safety review (Part C)

Base: main `3f319f3`, including merged #193, #194 and #195. Worktree/branch: `ux/photo-experience-part-c`. No schema, RLS, native configuration, signing, feature flags or Floor Plans changes are needed.

## Decision and scope

Use a versioned fragment envelope in the existing shared `photo_url` text field **only for recognized public uploads in this project's Supabase `home-photos` bucket**. The envelope carries the original fragment verbatim plus an x/y percentage. Reset to center restores the exact original URL, including an originally empty `#`. No pixels, image bytes, storage keys or signature queries change. Cropping/exporting derivatives adds no value for this pass and is not implemented.

The sole parser/serializer is `src/lib/photoFraming.js`. Signed URLs, transformed-image URLs, external URLs, blob previews and unrecognized legacy upload paths remain display-only. We do not make third-party images positionable or download them into Storage. Existing valid external image URLs continue to display.

## Required invariants

1. All displays, URL validation, identity checks and storage cleanup use the central utility; components never parse fragments.
2. Recognized envelopes are unwrapped before rendering/validation. Cleanup extracts only a verified same-project public Storage path. Storage identity comparisons additionally recognize same-project signed/transformed variants so switching URL variants cannot delete the underlying object.
3. Original fragments are encoded inside the envelope and restored byte-for-byte. Unrecognized reserved-namespace fragments are preserved and are not editable: the utility cannot safely infer that they are ours. Like every URL fragment, they are never sent in HTTP requests by browsers. Unsupported versions center the image, preserve the stored URL, and restore the enclosed original fragment for display.
4. Framing saves change only `photo_url`, never upload, delete, duplicate, crop or re-import an image. A framing save must compare against the photo URL seen when opening the editor, so a concurrent replacement cannot be overwritten. Existing `saveHomeSharedFields` already supports guarded writes; no new grants or schema are required.
5. Signature query bytes/order are not normalized, decoded or rewritten. Signed URLs are not positionable or eligible for deletion by the public-upload cleanup helper.
6. The existing shared photo field and existing authorization remain authoritative. Read-only Realtor views can display framing but cannot gain editing controls or writes.
7. Non-numeric, missing, out-of-range or unsupported framing centers safely. No automatic repair is written to the database.
8. A shared display component must apply the utility across Home Detail, cards, comparison, map preview, saved confirmations, duplicate previews, suggestions and Realtor views.
9. The full editor's raw URL comparison is a deletion hazard. It must compare image/storage identity before cleanup; fragment-only changes must skip deletion.
10. Existing MIME/5MB validation, Storage owner folders and replacement cleanup after confirmed saves remain in place.

## Tradeoffs

- A copied stored field contains display metadata. In-app image requests and the Photo URL entry show the unwrapped source; copying the displayed image link therefore copies its original source. An external application ignores FLH framing, and cannot recover the original fragment from an envelope without our utility.
- Changing framing updates the shared home's photo field and timestamp. It does not create a new image, household score or participant-specific photo permission.
- Future migration to a dedicated field should use this utility to extract position and original URL, backfill the field, then write the original URL. Unknown versions/collisions must be retained for review rather than destructively rewritten.
- Malformed/unrecognized namespace payloads are centered and left unchanged in storage. They cannot be edited until explicitly replaced with a known original source. This prioritizes preserving old fragments over guessing at corrupt metadata.
- Long fragments and legacy paths outside the recognized upload pattern remain unsupported for editing. Signed URL expiry/refresh remains the existing external behavior; framing never extends credentials.
- Identical percentage anchors remain consistent across frames, but different aspect ratios can reveal different amounts of the image. Primary property frames should share 4:3; small context thumbnails may retain their existing purpose-specific frame.

Verification completed: seven utility tests, two PostgreSQL persistence/permission tests, and 69 production-browser assertions. See [verification, audit and founder checklist](README.md).
