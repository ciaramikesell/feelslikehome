# Home Facts: compact Garage / Basement + inline Notes, Pros & Cons

Layout and editing only. No migration, no Match or Home Facts evaluation change,
no RentCast / import change, Floor Plans untouched.

## Layout (HomeOverlay → Home Facts)

Left column unchanged: Basic Details, School Details. Right column:
**Garage → Basement → Notes, Pros & Cons**. Match sits below, unchanged.

* **Garage** (Type · Spaces) and **Basement** (Style · Condition): the same four
  separate controls, labels, options, `garagePatch` / `basementPatch` saves and
  None-vs-Unknown rules. Side by side, equal width, each label above its control.
* The right column is a CSS container (`hf-side`). Below **360px** wide each pair
  falls back to the earlier label-beside-control rows (44% / 56%), so no option
  text is clipped. Every option of every select is measured in QA.

| Width | Right column | Garage / Basement |
|---|---|---|
| Desktop 1440 | 570px | side by side (278 / 278px) |
| iPad landscape 1024 | 420px | side by side (203 / 203px) |
| iPad portrait 768 | 312px | stacked rows |
| iPhone 390 | 358px (single column page) | stacked rows |

* **Notes, Pros & Cons**: three compact textareas (2 rows, growing to 3, then
  scrolling) using the Add / Edit Home definitions (`NOTE_LIST_FIELDS`: same
  order, labels, placeholders and "n · one per line" hint). 16px text on phones
  (no iOS zoom). "Shared with this search" sits beside the heading in shared
  searches. Read-only viewers (Realtors) see the section only when something is
  written, as lists.
* Height: on desktop the notes fill the old whitespace; with the sample data
  (Pros at three lines) the right column ends ~44px below the left (~24px when
  each field has two lines or fewer). On narrow layouts the section adds its own
  height below Basement; no new accordion.

## Saving and synchronization

* Same storage as #171: the shared `homes.notes / pros / cons` text columns, one
  entry per line, saved as typed.
* Each field autosaves through the overlay's existing queue (`editor.saveShared`):
  after a 0.9s typing pause, on leaving the field, or on Close (`registerDraft`),
  with the overlay's Saving / Saved / Couldn't save + Retry state and the field
  marked on failure.
* `applyLocal` updates the board's copy at once, so the Home Card
  "Notes (n) · Pros (n) · Cons (n)" previews match immediately; co-buyers see the
  text on their next load (no live push).
* Tour Feedback's notes editor is unchanged and writes the same fields through the
  same queue.
* Match Reveal is untouched: notes don't affect completeness, and the reveal still
  runs only from this buyer's completed saves.

### No silent overwrites

Other shared facts keep their column-level UPDATE. Notes / Pros / Cons writes are
guarded (`saveHomeSharedFields(…, { expected })`):

1. The overlay remembers the text it last saw saved for each field (from the
   server read, then from each of its own successful saves).
2. A write reads the row's `updated_at` and the guarded columns. If a field was
   changed by someone else (and isn't already the text being written), nothing is
   written and a `SharedNotesConflictError` carries their text.
3. Otherwise it UPDATEs only the patched columns `where id = … and updated_at = <read>`
   (the `homes_set_updated_at` trigger bumps it on every update). A change landing
   in between matches no row, and the read is repeated (up to 4 times).

A conflict shows a banner with their version and two choices: **Keep mine**
(save over it, deliberately) or **Use theirs**. Nothing else is blocked: other
facts saved in the same batch are written separately and first. Same-text edits
are not conflicts. Permissions and RLS are unchanged.

## Not covered

* The full editor for apartments / rentals (`HomeModal` "detail-panel") still
  saves the whole row as before, without the notes guard.
* Co-buyers don't see each other's edits until they reload the home.

## QA

`scripts/qa/home-facts-notes-qa.mjs` (desktop, iPad landscape and portrait,
iPhone 13). Screenshots: `docs/home-facts-notes-screenshots/{before,after}`.
