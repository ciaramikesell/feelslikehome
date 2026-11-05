# Home card: Notes / Pros / Cons previews + calmer property facts

Presentation and editing only. No migration, no Match, filter, Compare,
RentCast-import, pasted-listing or Floor Plans change.

## Storage (unchanged)

Notes, Pros and Cons are the shared home's existing `homes.notes`, `homes.pros`
and `homes.cons` text columns (`SHARED_FIELDS` in `src/lib/supabase/collaboration.js`),
visible to everyone in the search. They are saved exactly as typed.

**Entries are one per line** (`noteEntries` in `src/lib/homeDisplay.js`):

* never split on commas, so an existing `"Bright, open living room, Huge backyard"`
  is still one pro, as before;
* blank lines are skipped, and a typed list marker (`- `, `• `, `* `, `1. `, `2) `)
  is dropped from the displayed entry (the stored text is not rewritten);
* the older `condition_notes` field, no longer edited anywhere, is shown under Notes
  so nothing previously counted on the card disappears.

Why no migration: a list in a text column is enough for "short freeform text or a
short list", keeps every existing value valid, keeps co-buyer / Realtor visibility
and RLS exactly as they are, and needs no backfill.

## Editing

* **Add Home** (the "We found your home" / address card): a collapsed, optional
  *Add notes, pros, or cons* section. Saved with the home through the same single
  `submit()`.
* **Edit Home** (full editor, apartments and Realtor suggestions): the same three
  fields (`NoteListFields`), in card order Notes, Pros, Cons, each with a live
  "n · one per line" hint.
* **Tour Feedback** on the home (where the card's *Edit* and the preview's
  *View or edit notes* link lead for houses): the existing notes editor, now hinting
  "One per line"; Pros / Cons display as lists.

## Card

`Notes (n) · Pros (n) · Cons (n)` sits below Commute and above the tour /
action rows, only for groups with something written (nothing renders otherwise).
Pros in sage, Cons in brick, Notes in the secondary ink, each with a quiet
link-style underline, like the Match summaries.

| Input | Behaviour |
|---|---|
| Mouse | Hover shows the preview; moving into it keeps it; leaving closes it. Click pins it; click again closes. Hovering never replaces a pinned preview. |
| Touch | Tap opens; tap again, tap another count, or tap anywhere else closes / switches. 44px targets on phones and coarse pointers. |
| Keyboard | Tab to a count shows its preview (2px focus ring); Enter / Space pins; Escape closes and keeps focus on the count; Tab reaches the preview's link, then the next count. |

The preview opens above the row, is never wider than the card
(`min(280px, 100cqw)`), and scrolls past 240px. Buttons expose `aria-expanded`
and `aria-controls`; the preview is a labelled region.

## Property facts

The condensed two-column, small-caps grid (#169) is reverted to label → value rows
(the earlier layout) with values at 13px and slightly roomier rows. Same facts,
order and helpers.

## QA

`scripts/qa/home-card-notes-qa.mjs` (desktop 1440 + iPhone 13 against the local
stand-in). Screenshots: `docs/home-card-notes-preview-screenshots/{before,after}`.
