# Home Facts + automatic Match fulfillment (PR #187)

> FLH does the homework. The buyer makes the decisions.

Unknown is never No. A Home Fact is evidence, never a mandate: the buyer's own
Yes / No always wins, and nothing derived is ever written into anyone's answers.

## Audit (before editing)

### Storage

| Fact | Where | Values | Before this PR |
|---|---|---|---|
| Garage type | `homes.garage_type` | `none` / `attached` / `detached` / null (check constraint; **one value**) | Not a Match input |
| Garage spaces | `homes.garage_spaces` (text) | count, `0`, `none`, free text | Answers Garage (count > 0 Yes, 0 No) |
| Garage qualifier | buyer's own `priorities.exterior.garagePreference` | `any` / `attached` / `detached` (absent = any) | Stored only; **not a Match input** (PR #186 deferred it) |
| Basement | `homes.basement_condition`, `homes.basement_style` (enums); `homes.basement_notes` (legacy free text) | see `2026-10-17-home-facts-details.sql` | Condition/style answer Finished / Walkout; notes never read |
| Laundry | `homes.laundry_location` (optional column) | `basement` / `first_floor` / `second_floor` | `first_floor` answers First-floor laundry Yes (never No) |
| Cooling | `homes.cooling` (free text; RentCast `coolingType`, e.g. "Central") | text | Not a Match input |
| HOA | `homes.hoa_fee_monthly` (numeric) | number / null | Fee > 0 answers No HOA "No"; $0 Unknown |
| HOA presence | — | — | **No field existed.** "No HOA" could never be fulfilled by a fact |
| Fencing | — | — | **No structured fence fact exists** (Fenced Yard / Privacy Fence are personal answers only) |
| Schools | `school_district_name`, `elementary_school`, `middle_school`, `high_school`, legacy `schools_notes` | text | Not Match inputs |
| Notes | `homes.notes` (shared) | text | Not a Match input. **Also written by** post-tour notes (`appendPostTourNote`) and "Add to notes" listing-paste suggestions; shown on cards, Compare and Tour Feedback. Realtor notes are a separate table (`realtor_notes`), untouched |

### Fact sources and precedence (unchanged contract, now documented)

1. **The buyer's own explicit Yes (`true`) / No (`'no'`)** in their own
   `home_member_state.checks` — always wins, per buyer. Co-buyers never share answers.
2. **Shared Home Facts on `homes.*`** — whatever a person saved (manual edit,
   accepted paste suggestion) or the importer filled when the home was added
   (RentCast fills only empty fields; pasted text only fills a field after the
   buyer chooses *Use*, and never one that already has a value). A person's
   correction is simply the stored value, so a later import/paste never
   overwrites it.
3. **Otherwise Unknown** (never counted).

Never read by Match: unaccepted suggestions (`listing_import.offeredFacts`),
the import snapshot itself, "Listing says …" hints, county-record context,
and historical `false` checks. Facts are read on every evaluation and never
copied into checks, so correcting a fact updates every buyer without an override.

### Scorers

Two scorers must agree: `computeMatch` (JS, the buyer's own Match) and
`resolve_cobuyer_compare_perspectives` (SQL, the co-buyer's Match as Compare
shows it). Both now read the single table in `src/lib/homeFactCriteria.js`,
mirrored clause for clause in `2026-11-16-home-facts-match-fulfillment.sql`.

## What changed

### Match (Phase B)

| Criterion | Yes | No | Unknown |
|---|---|---|---|
| **Garage — Any** | type attached/detached, or spaces > 0 | type None, or 0 spaces | blank; contradiction (type None + spaces > 0, or type set + 0 spaces) |
| **Garage — Attached** | type Attached | type Detached; no garage | spaces with no type; contradiction |
| **Garage — Detached** | type Detached | type Attached; no garage | spaces with no type; contradiction |
| **Central Air** (`Central air` / `Central Air`) | Cooling names "central" with no negation, hedge ("possibly", "maybe", "?") or evaporative/swamp | Cooling is exactly None / No / No cooling / No A/C / No (central) air | blank; window units; mini-split; heat pump; anything else |
| **No HOA** | HOA status = No HOA (and fee not above $0) | HOA status = Has an HOA (even at $0); or status Unknown with fee > 0 | $0 alone; blank; status No with fee > 0 (they disagree) |

Garage is still **one** criterion: the qualifier only selects which type
fulfils it. Garage type holds one value; a listing that names both kinds is
imported as Unknown type (`canonicalGarageType`), so a home with both is never
recorded as one kind and never falsely rejected.

The Match row says why: "From Home Facts: **No** · 2-car detached garage — you
want attached · Garage ↗". Overrides read "Your answer · Home Facts: No".

**Fenced Yard / Privacy Fence:** no structured fence fact exists, so neither is
answered from Home Facts; the distinction (a fenced yard is never a privacy
fence) and the PR #186 yard-conflict note are unchanged. A fence fact would be
a separate, additive PR.

### Home Facts (Phase A)

- **Laundry** moved out of the photo summary to its own group directly after
  Basement. The First Floor choice reads **Main Floor** ("Counts for Main Floor
  Laundry"); stored token unchanged.
- **Basement** is one text field with suggestions (Finished Walkout, Finished,
  Partially Finished, Unfinished, Walkout, Unfinished Walkout, No basement)
  and a plain "Match reads Finished: Yes · Walkout: Yes" line computed by the
  Match reader itself. Parsing is whole-word (`Unfinished` is never
  `Finished`); Finished never implies Walkout and vice versa; two finishes,
  negations, hedges or unknown words leave that fact Unknown, and the
  person's words are kept in `basement_notes`. Existing structured values
  display as before; an earlier free-text note is shown and becomes Match
  evidence only when the buyer clicks **Use as …**.
- **HOA**: a new HOA status control ("Has an HOA" / "No HOA" / Unknown) beside
  the fee, with a note when the two disagree.
- **School Details**: District plus one freeform Details field
  (`schools_notes`). Saved school names still show and edit. No lookup.
- **Notes**: the empty generic Notes box is no longer offered (Home Facts and
  Add / Edit Home). Existing notes — typed, post-tour or pasted — stay visible
  and editable until cleared (the field stays mounted while edited). Pros and
  Cons unchanged. Nothing deleted.

## Migration (needs founder approval; not applied)

`2026-11-16-home-facts-match-fulfillment.sql`:

1. **Adds `homes.has_hoa boolean`** — nullable, no default, no backfill;
   select/insert/update granted to `authenticated` exactly like
   `laundry_location`. *Why:* nothing stored could express "this home has no
   HOA", and a $0 fee is not proof, so No HOA could never be fulfilled.
2. **Replaces the Compare scorer body** (same signature, SECURITY DEFINER,
   empty search_path, grants); only the Garage, No HOA and Central Air readings
   change. Re-runnable.

The app treats `has_hoa` as an optional column (like `laundry_location`): before
the migration the HOA status control is hidden and No HOA reads as before. The
optional-column fallback now drops only the column the database names.

**Order:** run `supabase/home-facts-match-fulfillment-preflight.sql`
(read-only counts; every `required` row must be ok), apply the migration,
deploy the app. **Rollback:** re-apply `2026-11-02-home-facts-match-parity.sql`
and promote the previous deployment; `has_hoa` can stay (unused).

**Score impact** (counted by the preflight): Attached/Detached buyers whose
homes have garage spaces but no recorded type move from Yes to Unknown; a
garage of the other type becomes a miss; homes with a recorded type and blank
spaces become answered; contradictory type/spaces become Unknown; Central Air
is newly answered from Cooling. No HOA moves only once someone sets the status.

## Tests and QA

- `test/home-facts-match-fulfillment.test.js` (unit): full grids for Garage
  (type × spaces × qualifier), Central Air (35 texts), HOA (status × fee),
  precedence, independence, one-criterion weighting, SQL ⇄ JS clause pins, and
  "the migration changes only these readings".
- `test/home-facts-match-fulfillment-db.test.js` (real Postgres): every grid in
  both scorers with identical %, selected and evaluated counts; owner and
  co-buyer with different qualifiers and overrides; both Central Air labels
  counted once; HOA status saves; production path (preflight counts,
  migration twice, nothing rewritten, privileges identical to
  `laundry_location`, rollback and forward again, pre-migration app still reads
  and saves).
- `test/home-facts-ux-187.test.js`: basement parsing / round-trip of every
  stored combination / patching, Laundry placement, HOA status, Schools, Notes.
- Older tests that pinned "the garage qualifier never changes Match" were
  updated to the new contract.
- Browser QA: `scripts/qa/home-facts-match-fulfillment-e2e.mjs` (9/9) and the
  existing `home-fact-match-parity-e2e.mjs` (11/11). Screenshots in
  `docs/home-facts-match-fulfillment-screenshots/`.

## Open questions for the founder

1. **Garage "both kinds"**: Garage type can't record attached *and* detached.
   Such homes stay Unknown type (never rejected). Add a "Both" choice later?
2. **Cooling "None"** is the only explicit No for Central Air; window units /
   mini-split stay Unknown. Confirm.
3. **Fence fact**: none exists; auto-fulfilling Fenced Yard / Privacy Fence
   needs a new shared field (separate PR).
4. The **Add / Edit Home** editor's legacy Basement text box still writes only
   `basement_notes` (shown on Home Facts as an earlier note with "Use as …").
