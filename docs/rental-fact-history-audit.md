# Historical Pets / In-Unit Laundry / Utilities answers — audit

**Status:** audit only. Nothing has been migrated, overwritten or deleted.
**Production counts:** run `supabase/rental-fact-history-audit.sql` (read-only, counts only) and fill in the table at the end.

## Where answers were stored, and by what

| Period | Where the answer went | Written by | Did Match use it? |
|---|---|---|---|
| Before 2026-09-09 | Each person's own checks. Before the 2026-09-09 privacy cutover this was `homes.checks`; the cutover copied it into `home_member_state.checks`. Keys were `features:In-Unit Laundry`, `features:Utilities Included` and `features:Pet Policy` (the old label), for apartment and rented-home searches. | Check chips (historical `true`/`false`); from 2026-09-07, the Yes/No control (`true` / `'no'`). | **Yes**, as that person's own answer. |
| From 2026-09-09 (Rental Pass B–D) | **Shared columns** on the home: `homes.pets_allowed`, `in_unit_laundry`, `utilities_included`. | Listing import (pasted text, rentals). The "Rental details" Yes/No/Unknown fields in Edit Home, for rented homes only, not apartments, until 2026-09-17. | **Yes.** Match switched these three criteria to read only the shared columns. |
| From 2026-09-09 until the editor fix (branch `claude/charming-bell-i0xo4w`) | Each person's own checks, under `features:Pets Allowed`, `features:In-Unit Laundry` and `features:Utilities Included`. | The Yes/No control (2026-09-09 → 09-16), then Edit Home's Yes/No/Unknown (from 2026-09-16). | **No.** This is the bug: recorded answers were silently ignored. |
| Legacy, frozen | `homes.checks` (column revoked from users since 2026-09-09). | Nothing since the cutover. | No. |

Personal answers can therefore mean two different things:

1. **Before 2026-09-09:** one person's own answer, which Match used. Under the current model it would count as a shared fact.
2. **From 2026-09-09:** one person recording a property fact. Match never used it.

Neither kind says whether the person checked the listing, or whether other members agree.

## Can a migration be safe and unambiguous?

Only for a narrow subset. A candidate rule would be: copy a personal answer into the shared field only when all of these hold.

- The shared field is still unknown, so nothing recorded on the property is overwritten.
- The answer is an explicit `true` or `'no'`. Historical `false` came from blind chip toggles and has always meant Unknown.
- Every member's explicit answer on that home agrees.
- The key is one of the three current keys. `features:Pet Policy` is excluded: the old label is ambiguous (a policy could allow or forbid pets).

Things a migration must never do:

- Overwrite a recorded shared fact, even where a personal answer disagrees.
- Choose between members who disagree.
- Treat `false` as No.
- Delete or rewrite any personal answer. The personal value stays where it is, as history.

Open questions before any migration:

- **Who answered.** For homes where only one person answered, should their answer become everyone's shared fact? That is the same thing the fixed editor now does going forward. It may still surprise co-buyers whose earlier answers were private.
- **Which answers.** Should answers from before 2026-09-09, made under the personal-answer model, be included, or only those from 2026-09-09 onwards?

## Production counts (to fill in)

Run the audit and paste the sections here:

1. personal answers by value and period;
2. homes by category (agree / disagree / shared already set / only legacy values);
3. agreeing homes by number of answers;
4. shared facts already recorded;
5. legacy labels and columns.

| Category (section 2) | Pets | Laundry | Utilities |
|---|---|---|---|
| Shared fact unknown; explicit personal answers all agree (**migration candidates**) | | | |
| Shared fact unknown; members disagree (leave) | | | |
| Shared fact set; a personal answer disagrees (leave; review) | | | |
| Shared fact set; personal answers agree (nothing to do) | | | |
| Only legacy `false`/other values (leave) | | | |
