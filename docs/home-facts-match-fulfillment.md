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

`2026-11-16-home-facts-match-fulfillment.sql`, **one transaction**:

1. **Adds `homes.has_hoa boolean`**: nullable, no default, no backfill;
   select / insert / update granted to `authenticated` exactly like
   `laundry_location`. *Why:* nothing stored could express "this home has no
   HOA", and a $0 fee is not proof, so No HOA could never be fulfilled.
2. **Replaces the Compare scorer body.** The signature, SECURITY DEFINER, empty
   search_path and grants are unchanged. Only the Garage, No HOA and Central Air
   readings change. Re-runnable.

### Keeping the two scorers in agreement

The app knows which scorer the database has, because the migration adds the
column and the new scorer together. A home read from a database without
`has_hoa` is marked by the data layer (`matchFactRules: 'pre-2026-11-16'`, set
in `rowToHome`). That home is scored with the 2026-11-02 rules the database
still uses: Garage from spaces only, for any qualifier, and no Central Air
reading. As soon as the migration commits, the next read has the column and
both scorers switch to the new rules together.

So the app can safely ship first. The only gap is a page loaded before the
migration and not yet refreshed. Nothing is written in that window, and it ends
on the next load. `test/home-facts-match-fulfillment-db.test.js` proves JS = SQL
on the pre-migration database and again after the migration.

Before the migration, the HOA status control is hidden. The optional-column
fallback drops only the column the database names, so `laundry_location` is
still read and saved.

### Release order (each step needs founder approval)

1. **Merge and deploy the app** (Vercel Production). Against the pre-migration
   database it scores with the 2026-11-02 rules, so Match is unchanged for buyers.
2. **Run the preflight** `supabase/home-facts-match-fulfillment-preflight.sql`
   in the Production SQL editor. It is a single read-only SELECT that returns
   counts only.
   - Every `required` row must be `ok`.
   - The body row must read `expected: 2026-11-02-home-facts-match-parity.sql`.
   - Review the `info` counts: Garage changes by qualifier, Must-Haves that
     become misses, Central Air newly answered.
3. **Apply the migration.** Column and scorer change in one transaction.
4. **Re-run the preflight.** The body row then reads `ALREADY APPLIED`, and
   `has_hoa already exists` reads yes.
5. Spot-check one owner / co-buyer search: their own Match % equals what the
   other buyer sees in Compare.

### Rollback

- **App only** (the migration was not applied): promote the previous Vercel
  deployment. Nothing else to undo.
- **After the migration**: re-apply `2026-11-02-home-facts-match-parity.sql`
  (scorer body only) and promote the previous Vercel deployment, back to back.
  - The previous app doesn't read `has_hoa` and uses the 2026-11-02 rules, so
    the two again agree.
  - Between the two steps, Compare may briefly show the other rule set. Nothing
    is written.
  - `has_hoa` stays (nullable and unused). Dropping it is never needed. If ever
    wanted, it is a separate, explicitly approved step, because it would discard
    HOA answers buyers entered.
- No step rewrites preferences, homes or answers. The tests run migrate →
  rollback → migrate again and check that nothing changed.

**Score impact** (counted by the preflight):
- Attached/Detached buyers whose homes have garage spaces but no recorded type
  move from Yes to Unknown.
- A garage of the other type becomes a miss.
- Homes with a recorded type and blank spaces become answered.
- Contradictory type and spaces become Unknown.
- Central Air is newly answered from Cooling.
- No HOA moves only once someone sets the status.

## Add / Edit Home editor: same basement path

The Add / Edit Home editor (`HomeModal`, add and edit modes) used to bind
Basement to `basement_notes` only. An edit there never reached Match until
someone clicked "Use as …" in Home Facts. Its Basement field now uses the same
parser and storage as Home Facts (`applyBasementDescription` over
`basementDescriptionPatch`), so the edit counts as soon as the home is saved.

- Typing starts from the basement fields as they were when the person began
  (the baseline). Saved facts they don't change are never rewritten, and
  re-typing exactly what was shown is not an edit.
- A legacy note is kept. A fully read new description becomes the facts, and
  the old note stays visible as "Earlier note". Words FLH can't fully read
  replace only the text the person was editing.
- The same "Match reads Finished … · Walkout …" line shows under the field.
- `test/home-facts-ux-187.test.js` checks that both entry points store
  identical results over 9 starting states × 11 descriptions. The browser QA
  edits Basement in the editor, saves, and checks the database, Home Facts and
  Match.

"Use as …" remains in Home Facts only for legacy notes nobody has edited since.

## Founder decisions (PR #187 review)

1. **Central Air**: conservative, as implemented. Explicit "no cooling" is No;
   other systems and ambiguous text stay Unknown.
2. **Fenced Yard / Privacy Fence** automatic fulfillment is deferred to a future PR.
3. **Garage "Both"**: wanted eventually, not in this PR. Homes with both kinds,
   or an ambiguous kind, stay Unknown for Attached / Detached and are never
   matched or rejected.
4. **Add / Edit Home basement**: fixed (above).
5. Styling, manual-answer precedence, JS / SQL parity, owner / co-buyer
   independence and Unknown-is-neutral are unchanged.

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
